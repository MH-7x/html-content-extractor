/* =========================================================================
   HTML Content Extractor — UI
   ========================================================================= */
'use strict';

(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const E = Extractor.esc;

  const input = $('#html-input');
  const urlInput = $('#page-url');
  let R = null, P = null; // current report + page

  const ui = {
    content: { view: 'grouped', regions: { header: true, nav: true, main: true, aside: true, footer: true }, showHidden: true, showTags: true },
    links: { type: 'all', region: 'all', q: '', issuesOnly: false },
    images: { filter: 'all', previews: true },
    headings: { mainOnly: false },
    issues: 'all',
    ai: { goal: 'rewrite', keyword: '', lang: 'same', includeContent: true },
    bulkAi: { goal: 'differentiate', lang: 'same' },
    bulk: { simMin: 0 },
  };

  const REGION_LABEL = { header: 'Header', nav: 'Navigation', main: 'Main content', body: 'Main content', aside: 'Sidebar', footer: 'Footer' };
  const SEV_ICON = { error: '✕', warning: '!', notice: 'i', pass: '✓' };

  /* ---------------------------------------------------------------------
     Small UI helpers
     --------------------------------------------------------------------- */
  const fmt = (n) => Number(n || 0).toLocaleString('en-US');
  const bytes = (b) => (b > 1048576 ? (b / 1048576).toFixed(2) + ' MB' : (b / 1024).toFixed(1) + ' KB');
  const chip = (text, cls = '') => `<span class="chip ${cls}">${E(text)}</span>`;
  const regionChip = (r) => `<span class="chip region r-${r}">${E(REGION_LABEL[r] || r)}</span>`;
  const sevBadge = (sev) => `<span class="sev sev-${sev}" aria-label="${sev}">${SEV_ICON[sev]}</span>`;
  const empty = (msg) => `<p class="empty">${E(msg)}</p>`;
  const linkOut = (url, text) => {
    if (!url) return '<span class="muted">—</span>';
    if (!/^https?:\/\//i.test(url)) return `<span class="mono break">${E(text ?? url)}</span>`;
    return `<a href="${E(url)}" target="_blank" rel="noopener noreferrer" class="mono break">${E(text ?? url)}</a>`;
  };
  const section = (title, body, extra = '') => `<section class="sec"><div class="sec-head"><h2>${title}</h2>${extra}</div>${body}</section>`;
  const kvTable = (rows) => `<table class="kv"><tbody>${rows.map(([k, v]) => `<tr><th scope="row">${k}</th><td>${v}</td></tr>`).join('')}</tbody></table>`;
  const val = (v) => (v === null || v === undefined || v === '' ? '<span class="missing">Not set</span>' : `<span dir="auto">${E(v)}</span>`);

  function meter(len, px, okMin, okMax, pxMax) {
    const pct = Math.min(100, Math.round(px / pxMax * 100));
    const state = len === 0 ? 'bad' : len < okMin ? 'warn' : (len > okMax || px > pxMax) ? 'warn' : 'ok';
    return `<div class="meter-wrap"><div class="meter"><span class="m-${state}" style="width:${pct}%"></span></div>
      <span class="small muted">${len} chars · ~${px}px of ${pxMax}px</span></div>`;
  }

  /* ---------------------------------------------------------------------
     Copy (Async Clipboard with legacy fallback for file:// edge cases)
     --------------------------------------------------------------------- */
  const COPY = new Map(); // key -> { scope, get }
  let copySeq = 0, copyScope = 'page';
  function copyBtn(label, getText, aria) {
    const key = 'c' + (++copySeq);
    COPY.set(key, { scope: copyScope, get: getText });
    return `<span class="copy"><button type="button" class="btn sm" data-copy="${key}" aria-label="${E(aria || label)}">${E(label)}</button><span class="tip" role="status"></span></span>`;
  }
  function clearCopy(scope) { for (const [k, v] of COPY) if (v.scope === scope) COPY.delete(k); }
  function legacyCopy(text) {
    const f = Object.assign(document.createElement('textarea'), { value: text });
    f.setAttribute('readonly', '');
    f.style.cssText = 'position:fixed;inset-block-start:0;opacity:0';
    document.body.append(f);
    f.select();
    try { return document.execCommand('copy'); } finally { f.remove(); }
  }
  const timers = new WeakMap();
  let lastMessage = '';
  function reportCopy(button, ok) {
    const tip = button.nextElementSibling;
    clearTimeout(timers.get(button));
    button.removeAttribute('data-copied'); button.removeAttribute('data-failed');
    let message = ok ? 'Copied' : 'Copy failed';
    if (message === lastMessage) message += ' ';
    lastMessage = message;
    tip.textContent = '';
    void button.offsetWidth;
    button.setAttribute(ok ? 'data-copied' : 'data-failed', '');
    requestAnimationFrame(() => (tip.textContent = message));
    timers.set(button, setTimeout(() => {
      button.removeAttribute('data-copied'); button.removeAttribute('data-failed'); tip.textContent = '';
    }, 2000));
  }
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-copy]');
    if (!b) return;
    const entry = COPY.get(b.dataset.copy);
    const get = entry && entry.get;
    const text = typeof get === 'function' ? get() : String(get ?? '');
    if (!text) return;
    try {
      try { await navigator.clipboard.writeText(text); }
      catch { if (!legacyCopy(text)) throw new Error('copy failed'); }
      reportCopy(b, true);
    } catch { reportCopy(b, false); }
  });

  /* ---------------------------------------------------------------------
     Downloads
     --------------------------------------------------------------------- */
  function download(name, text, type) {
    const blob = new Blob([text], { type });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  const csvCell = (v) => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const toCsv = (head, rows) => '﻿' + [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n'); // BOM so Excel shows Arabic correctly
  function slugName() {
    const base = (R.meta.baseUrl || R.head.title || 'page').replace(/^https?:\/\//, '').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 60);
    return base || 'page';
  }

  /* ---------------------------------------------------------------------
     Tabs (roving tabindex, selection follows focus) — reusable
     --------------------------------------------------------------------- */
  function setupTabs(listSel, tabPrefix, panelPrefix, onSelect) {
    const list = $(listSel);
    const tabs = $$('[role="tab"]', list);
    const panelOf = (t) => document.getElementById(t.id.replace(tabPrefix, panelPrefix));
    function select(tab, focus = true) {
      for (const t of tabs) {
        const on = t === tab;
        t.setAttribute('aria-selected', on);
        t.tabIndex = on ? 0 : -1;
        panelOf(t).hidden = on ? false : 'until-found';
      }
      if (focus) tab.focus();
      tab.scrollIntoView({ block: 'nearest', inline: 'nearest', container: 'nearest' });
      if (onSelect) onSelect(tab.id.replace(tabPrefix, ''));
    }
    tabs.forEach((t) => t.addEventListener('click', () => select(t)));
    list.addEventListener('keydown', (e) => {
      const i = tabs.indexOf(document.activeElement);
      if (i < 0) return;
      let n = null;
      if (e.key === 'ArrowRight') n = (i + 1) % tabs.length;
      else if (e.key === 'ArrowLeft') n = (i - 1 + tabs.length) % tabs.length;
      else if (e.key === 'Home') n = 0;
      else if (e.key === 'End') n = tabs.length - 1;
      if (n !== null) { e.preventDefault(); select(tabs[n]); }
    });
    // Find-in-page (Ctrl+F) can reveal a hidden="until-found" panel: sync its tab
    tabs.forEach((t) => panelOf(t).addEventListener('beforematch', () => select(t, false)));
    return { select: (name, focus = true) => select(document.getElementById(tabPrefix + name), focus),
      current: () => tabs.find((t) => t.getAttribute('aria-selected') === 'true').id.replace(tabPrefix, '') };
  }
  const pageTabs = setupTabs('#tablist', 'tab-', 'panel-');
  const bulkTabs = setupTabs('#bulk-tablist', 'btab-', 'bpanel-');
  const goTab = (name) => pageTabs.select(name);

  /* ---------------------------------------------------------------------
     Dialog (native modal) + toast
     --------------------------------------------------------------------- */
  const dlg = $('#dlg');
  function ask({ title, msg = '', input = null, label = 'Name', ok = 'OK', danger = false }) {
    $('#dlg-title').textContent = title;
    $('#dlg-msg').textContent = msg;
    $('#dlg-msg').hidden = !msg;
    $('#dlg-field').hidden = input === null;
    $('#dlg-label').textContent = label;
    $('#dlg-input').value = input ?? '';
    $('#dlg-ok').textContent = ok;
    $('#dlg-ok').classList.toggle('danger', danger);
    $$('[autofocus]', dlg).forEach((el) => el.removeAttribute('autofocus'));
    (input !== null ? $('#dlg-input') : danger ? $('#dlg-cancel') : $('#dlg-ok')).setAttribute('autofocus', '');
    dlg.returnValue = '';
    dlg.showModal();
    return new Promise((resolve) => {
      dlg.addEventListener('close', () => {
        const v = dlg.returnValue; dlg.returnValue = '';
        if (v !== 'ok') return resolve(null);
        resolve(input !== null ? $('#dlg-input').value.trim() : true);
      }, { once: true });
    });
  }
  $('#dlg-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); dlg.close('ok'); } });

  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.classList.remove('show'); setTimeout(() => (t.textContent = ''), 300); }, 3200);
  }

  /* ---------------------------------------------------------------------
     Storage: IndexedDB (falls back to memory if the browser blocks it)
     --------------------------------------------------------------------- */
  const Store = (() => {
    let db = null, mem = null;
    async function init() {
      try {
        db = await new Promise((res, rej) => {
          const r = indexedDB.open('hce-db', 1);
          r.onupgradeneeded = () => {
            const d = r.result;
            d.createObjectStore('projects', { keyPath: 'id' });
            d.createObjectStore('pages', { keyPath: 'id' }).createIndex('projectId', 'projectId');
          };
          r.onsuccess = () => res(r.result);
          r.onerror = () => rej(r.error);
          r.onblocked = () => rej(new Error('blocked'));
        });
        try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch {}
        return true;
      } catch {
        mem = { projects: new Map(), pages: new Map() };
        return false;
      }
    }
    const tx = (store, mode, fn) => new Promise((res, rej) => {
      const t = db.transaction(store, mode);
      const r = fn(t.objectStore(store));
      t.oncomplete = () => res(r ? r.result : undefined);
      t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
    });
    return {
      init,
      get persistent() { return !!db; },
      projects: () => (db ? tx('projects', 'readonly', (s) => s.getAll()) : Promise.resolve([...mem.projects.values()])),
      pages: (pid) => (db ? tx('pages', 'readonly', (s) => s.index('projectId').getAll(pid)) : Promise.resolve([...mem.pages.values()].filter((p) => p.projectId === pid))),
      put: (store, obj) => (db ? tx(store, 'readwrite', (s) => s.put(obj)) : (mem[store].set(obj.id, obj), Promise.resolve())),
      del: (store, id) => (db ? tx(store, 'readwrite', (s) => s.delete(id)) : (mem[store].delete(id), Promise.resolve())),
    };
  })();
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  /* ---------------------------------------------------------------------
     App state: projects, pages, reports, views
     --------------------------------------------------------------------- */
  const S = { projects: [], project: null, pages: [], reports: new Map(), view: 'add', editingId: null, bulk: null, filter: '' };
  const items = () => S.pages.filter((p) => S.reports.has(p.id)).map((p) => ({ page: p, report: S.reports.get(p.id) }));
  const getBulk = () => (S.bulk ||= Bulk.analyzeAll(items()));
  const pageIndex = (id) => S.pages.findIndex((p) => p.id === id);
  function pageLabel(id, max = 70) {
    const p = S.pages.find((x) => x.id === id); const r = S.reports.get(id);
    if (!p || !r) return '?';
    const t = r.head.title || Bulk.shortUrl(Bulk.pageUrl({ page: p, report: r })) || 'Untitled page';
    return t.length > max ? t.slice(0, max - 1) + '…' : t;
  }
  const pageNum = (id) => pageIndex(id) + 1;
  const labelOf = (id) => `[${pageNum(id)}] ${pageLabel(id, 80)}`;
  const pageLink = (id) => `<button type="button" class="linklike page-link" data-open-page="${id}" dir="auto"><span class="pnum">${pageNum(id)}</span> ${E(pageLabel(id))}</button>`;

  function persistErr(e) {
    console.error(e);
    toast(e && e.name === 'QuotaExceededError' ? 'Browser storage is full. Back up and delete an old project.' : 'Could not save to browser storage.');
  }

  async function loadProjects() {
    S.projects = (await Store.projects()).sort((a, b) => a.created - b.created);
    if (!S.projects.length) {
      const p = { id: uid(), name: 'My first project', created: Date.now() };
      await Store.put('projects', p).catch(persistErr);
      S.projects = [p];
    }
    let last = null;
    try { last = localStorage.getItem('hce:project'); } catch {}
    renderProjectSelect();
    await openProject(S.projects.some((p) => p.id === last) ? last : S.projects[0].id);
  }

  function renderProjectSelect() {
    $('#project-select').innerHTML = S.projects.map((p) => `<option value="${p.id}" ${S.project && p.id === S.project.id ? 'selected' : ''}>${E(p.name)}</option>`).join('');
  }

  async function openProject(id) {
    S.project = S.projects.find((p) => p.id === id);
    try { localStorage.setItem('hce:project', id); } catch {}
    renderProjectSelect();
    S.pages = (await Store.pages(id)).sort((a, b) => a.order - b.order);
    S.reports.clear(); S.bulk = null;
    renderSidebar();
    const note = $('#storage-note');
    for (let i = 0; i < S.pages.length; i++) {
      note.textContent = `Analyzing ${i + 1} of ${S.pages.length} pages…`;
      await new Promise((r) => setTimeout(r, 0));
      try { S.reports.set(S.pages[i].id, Extractor.analyze(S.pages[i].html, { pageUrl: S.pages[i].url })); } catch (e) { console.error(e); }
    }
    storageNote();
    renderSidebar();
    if (S.pages.length > 1) showBulk();
    else if (S.pages.length === 1) showPage(S.pages[0].id);
    else showAdd();
  }

  function storageNote() {
    $('#storage-note').textContent = Store.persistent
      ? 'Pages are saved in this browser. Use Backup to keep a copy or move it to another PC.'
      : 'This browser blocks local storage for files opened from disk: pages will be lost when you close the tab. Use Backup to save them.';
  }

  /* ---------- sidebar ---------- */
  function renderSidebar() {
    $('#page-count').textContent = S.pages.length;
    const q = S.filter.toLowerCase();
    const list = S.pages.filter((p) => {
      if (!q) return true;
      const r = S.reports.get(p.id);
      return (p.url || '').toLowerCase().includes(q) || (r && (r.head.title || '').toLowerCase().includes(q));
    });
    const maxSim = S.bulk ? S.bulk.sim.max : {};
    $('#page-list').innerHTML = list.length ? list.map((p) => {
      const r = S.reports.get(p.id);
      const errs = r ? r.issues.filter((i) => i.sev === 'error').length : 0;
      const warns = r ? r.issues.filter((i) => i.sev === 'warning').length : 0;
      const path = r ? Bulk.shortUrl(Bulk.pageUrl({ page: p, report: r })) : p.url;
      const sim = maxSim[p.id];
      return `<li><button type="button" class="side-item" data-page="${p.id}" aria-current="${S.view === 'page' && S.pageId === p.id ? 'page' : 'false'}">
        <span class="si-title" dir="auto"><span class="pnum">${pageIndex(p.id) + 1}</span> ${E(pageLabel(p.id, 64))}</span>
        <span class="si-sub"><span class="si-path" dir="auto">${E(path || 'no URL')}</span>
          <span class="si-badges">${r ? `<span>${fmt(r.stats.mainWords)} w</span>` : '<span>analyzing…</span>'}
          ${errs ? `<span class="b-err">${errs} err</span>` : ''}${warns ? `<span class="b-warn">${warns} warn</span>` : ''}
          ${sim >= 80 ? `<span class="b-err" title="Near-duplicate of another page">${sim}% dup</span>` : ''}</span></span>
      </button></li>`;
    }).join('') : `<li class="side-empty small muted">${S.pages.length ? 'No pages match.' : 'No pages yet. Paste a page’s HTML to start.'}</li>`;
    $('#side-all').setAttribute('aria-current', S.view === 'bulk' ? 'page' : 'false');
    $('#side-all').disabled = !S.pages.length;
    $('#side-add').classList.toggle('is-active', S.view === 'add');
  }
  $('#page-list').addEventListener('click', (e) => { const b = e.target.closest('[data-page]'); if (b) showPage(b.dataset.page); });
  $('#page-filter').addEventListener('input', (e) => { S.filter = e.target.value; renderSidebar(); });
  $('#side-add').addEventListener('click', () => showAdd());
  $('#side-all').addEventListener('click', () => showBulk());
  document.addEventListener('click', (e) => { const b = e.target.closest('[data-open-page]'); if (b) showPage(b.dataset.openPage); });

  /* ---------- views ---------- */
  function setView(v) {
    S.view = v;
    $('#input-section').hidden = v !== 'add';
    $('#summary-bar').hidden = v !== 'page';
    $('#report').hidden = v !== 'page';
    $('#bulk').hidden = v !== 'bulk';
    renderSidebar();
    window.scrollTo({ top: 0 });
  }
  function showAdd(editId = null) {
    S.editingId = editId;
    const p = editId && S.pages.find((x) => x.id === editId);
    $('#input-title').textContent = p ? `Replace HTML of page ${pageNum(editId)}` : 'Add a page';
    $('#analyze-btn').firstChild.textContent = p ? 'Update page ' : 'Add & open page ';
    $('#add-next-btn').hidden = !!p;
    $('#cancel-edit-btn').hidden = !p;
    if (p) { input.value = p.html; urlInput.value = p.url || ''; } else if (S.editingId === null && input.dataset.wasEdit) { input.value = ''; urlInput.value = ''; }
    input.dataset.wasEdit = p ? '1' : '';
    $('#input-error').hidden = true;
    updateSize();
    setView('add');
    input.focus();
  }
  function showPage(id) {
    const p = S.pages.find((x) => x.id === id);
    if (!p || !S.reports.has(id)) return;
    S.pageId = id; P = p; R = S.reports.get(id);
    copyScope = 'page'; clearCopy('page');
    renderAll();
    setView('page');
  }
  function showBulk() {
    if (!S.pages.length) return showAdd();
    copyScope = 'bulk'; clearCopy('bulk');
    getBulk();
    renderBulk();
    setView('bulk');
  }
  $('#prev-btn').addEventListener('click', () => { const i = pageIndex(S.pageId); if (i > 0) showPage(S.pages[i - 1].id); });
  $('#next-btn').addEventListener('click', () => { const i = pageIndex(S.pageId); if (i < S.pages.length - 1) showPage(S.pages[i + 1].id); });
  $('#edit-btn').addEventListener('click', () => showAdd(S.pageId));
  $('#cancel-edit-btn').addEventListener('click', () => { const id = S.editingId; input.value = ''; urlInput.value = ''; S.editingId = null; showPage(id); });
  $('#remove-btn').addEventListener('click', async () => {
    const id = S.pageId;
    if (!await ask({ title: 'Remove this page?', msg: `“${pageLabel(id)}” will be removed from “${S.project.name}”.`, ok: 'Remove', danger: true })) return;
    const i = pageIndex(id);
    await Store.del('pages', id).catch(persistErr);
    S.pages.splice(i, 1); S.reports.delete(id); S.bulk = null;
    toast('Page removed');
    if (S.pages.length) showPage(S.pages[Math.min(i, S.pages.length - 1)].id); else showAdd();
  });

  /* ---------- project actions ---------- */
  $('#project-select').addEventListener('change', (e) => openProject(e.target.value));
  $('#proj-new').addEventListener('click', async () => {
    const name = await ask({ title: 'New project', msg: 'One project per client or website works well.', input: '', label: 'Project name', ok: 'Create' });
    if (!name) return;
    const p = { id: uid(), name, created: Date.now() };
    await Store.put('projects', p).catch(persistErr);
    S.projects.push(p);
    await openProject(p.id);
  });
  $('#proj-rename').addEventListener('click', async () => {
    const name = await ask({ title: 'Rename project', input: S.project.name, label: 'Project name', ok: 'Rename' });
    if (!name) return;
    S.project.name = name;
    await Store.put('projects', S.project).catch(persistErr);
    renderProjectSelect();
    if (S.view === 'bulk') $('#bulk-project-name').textContent = name;
  });
  $('#proj-delete').addEventListener('click', async () => {
    const ok = await ask({ title: `Delete “${S.project.name}”?`, msg: `This deletes the project and its ${S.pages.length} saved page(s) from this browser. Download a Backup first if you may need them.`, ok: 'Delete project', danger: true });
    if (!ok) return;
    for (const p of S.pages) await Store.del('pages', p.id).catch(() => {});
    await Store.del('projects', S.project.id).catch(persistErr);
    S.projects = S.projects.filter((p) => p.id !== S.project.id);
    toast('Project deleted');
    await loadProjects();
  });
  $('#proj-backup').addEventListener('click', () => {
    const data = { app: 'html-content-extractor', version: 1, exported: new Date().toISOString(), project: { name: S.project.name },
      pages: S.pages.map((p) => ({ url: p.url, html: p.html, added: p.added, order: p.order })) };
    const slug = S.project.name.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'project';
    download(`${slug}-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data), 'application/json');
  });
  $('#proj-import').addEventListener('change', async (e) => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (data.app !== 'html-content-extractor' || !Array.isArray(data.pages)) throw new Error('Not a backup file from this app');
      let name = data.project && data.project.name || f.name.replace(/\.json$/i, '');
      if (S.projects.some((p) => p.name === name)) name += ' (imported)';
      const proj = { id: uid(), name, created: Date.now() };
      await Store.put('projects', proj);
      let order = Date.now();
      for (const pg of data.pages) await Store.put('pages', { id: uid(), projectId: proj.id, url: pg.url || '', html: String(pg.html || ''), added: pg.added || Date.now(), order: order++ });
      S.projects.push(proj);
      toast(`Imported “${name}” with ${data.pages.length} pages`);
      await openProject(proj.id);
    } catch (err) {
      toast('Import failed: ' + err.message);
    }
  });

  /* ---------------------------------------------------------------------
     Input handling (add / replace pages)
     --------------------------------------------------------------------- */
  function updateSize() {
    const v = input.value;
    $('#input-size').textContent = v ? `${bytes(new Blob([v]).size)} · ${fmt(v.split('\n').length)} lines` : '';
  }
  input.addEventListener('input', updateSize);
  input.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); submitPage(!e.shiftKey || !!S.editingId); }
  });
  urlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); input.focus(); } });
  $('#analyze-btn').addEventListener('click', () => submitPage(true));
  $('#add-next-btn').addEventListener('click', () => submitPage(false));
  $('#clear-btn').addEventListener('click', () => { input.value = ''; urlInput.value = ''; updateSize(); input.focus(); });
  $('#sample-btn').addEventListener('click', async () => {
    for (const s of window.SAMPLE_PAGES || []) await savePage(s.html, s.url, null);
    toast(`Added ${(window.SAMPLE_PAGES || []).length} sample pages`);
    showBulk();
  });
  $('#file-input').addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    input.value = await f.text(); updateSize(); e.target.value = '';
  });
  const drop = $('#drop');
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => {
    if (![...e.dataTransfer.types].includes('Files')) return;
    e.preventDefault(); drop.classList.add('dragging');
  }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove('dragging')));
  drop.addEventListener('drop', async (e) => {
    const f = e.dataTransfer.files[0];
    if (!f) return;
    e.preventDefault();
    input.value = await f.text(); updateSize();
  });

  // analyze + store one page; returns the page id
  async function savePage(html, url, editId) {
    const report = Extractor.analyze(html, { pageUrl: url });
    let page = editId ? S.pages.find((p) => p.id === editId) : null;
    let replaced = false;
    if (!page && url) {
      const key = Bulk.urlKey(url);
      page = key ? S.pages.find((p) => Bulk.urlKey(p.url) === key) : null;
      replaced = !!page;
    }
    if (page) { page.html = html; page.url = url; page.updated = Date.now(); }
    else {
      page = { id: uid(), projectId: S.project.id, url, html, added: Date.now(), order: Date.now() + S.pages.length };
      S.pages.push(page);
    }
    S.reports.set(page.id, report);
    S.bulk = null;
    await Store.put('pages', page).catch(persistErr);
    return { id: page.id, replaced };
  }

  async function submitPage(openAfter) {
    const html = input.value;
    const url = urlInput.value.trim();
    const err = $('#input-error');
    err.hidden = true;
    if (!html.trim()) { err.textContent = 'Paste some HTML first.'; err.hidden = false; input.focus(); return; }
    if (!/<[a-z!]/i.test(html)) { err.textContent = 'This does not look like HTML. Copy the <html> element from DevTools.'; err.hidden = false; return; }
    if (url && !/^https?:\/\//i.test(url)) { err.textContent = 'The page URL should start with https:// (or leave it empty).'; err.hidden = false; urlInput.focus(); return; }
    const btn = openAfter ? $('#analyze-btn') : $('#add-next-btn');
    btn.disabled = true;
    await new Promise((r) => setTimeout(r, 20));
    try {
      const editId = S.editingId;
      const { id, replaced } = await savePage(html, url, editId);
      input.value = ''; urlInput.value = ''; updateSize();
      S.editingId = null; input.dataset.wasEdit = '';
      toast(editId ? 'Page updated' : replaced ? `Replaced the existing page with the same URL (${pageLabel(id, 40)})` : `Added page ${pageNum(id)}: ${pageLabel(id, 50)}`);
      if (openAfter) showPage(id);
      else { renderSidebar(); urlInput.focus(); }
    } catch (ex) {
      console.error(ex);
      err.textContent = 'Could not analyze this HTML: ' + ex.message; err.hidden = false;
    } finally {
      btn.disabled = false;
    }
  }

  /* ---------------------------------------------------------------------
     Render one page's report
     --------------------------------------------------------------------- */
  function renderAll() {
    $('#sb-title').textContent = R.head.title || '(no title tag)';
    $('#sb-meta').textContent = [R.meta.baseUrl || R.meta.siteHost || 'URL unknown', bytes(R.meta.inputBytes) + ' HTML', `added ${new Date(P.updated || P.added).toLocaleDateString()}`].join(' · ');
    const i = pageIndex(P.id);
    $('#pos-label').textContent = `${i + 1} / ${S.pages.length}`;
    $('#prev-btn').disabled = i <= 0;
    $('#next-btn').disabled = i >= S.pages.length - 1;
    const ec = R.issues.filter((x) => x.sev === 'error').length, wc = R.issues.filter((x) => x.sev === 'warning').length;
    $('#tc-overview').textContent = ec + wc ? String(ec + wc) : '';
    $('#tc-overview').className = 'tcount' + (ec ? ' t-err' : wc ? ' t-warn' : '');
    $('#tc-schema').textContent = Object.keys(R.schema.typeCounts).length || '';
    $('#tc-headings').textContent = R.headings.length || '';
    $('#tc-content').textContent = R.content.blocks.length || '';
    $('#tc-links').textContent = R.links.items.length || '';
    $('#tc-images').textContent = R.images.items.length || '';
    renderOverview(); renderMeta(); renderSchema(); renderHeadings(); renderContent(); renderLinks();
    renderImages(); renderKeywords(); renderTechnical(); renderAiPrompt(); renderExport();
  }

  /* ---------------------------------------------------------------------
     OVERVIEW
     --------------------------------------------------------------------- */
  let _c;
  function truncPx(text, font, max) {
    if (!text) return '';
    _c ||= document.createElement('canvas').getContext('2d');
    _c.font = font;
    if (_c.measureText(text).width <= max) return text;
    let lo = 0, hi = text.length;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (_c.measureText(text.slice(0, mid) + ' …').width <= max) lo = mid; else hi = mid - 1; }
    return text.slice(0, lo).replace(/\s+\S*$/, '') + ' …';
  }

  function serpPreview() {
    const h = R.head;
    const url = h.canonicals[0] || R.meta.baseUrl || (R.meta.siteHost ? 'https://' + R.meta.siteHost : 'https://example.com');
    let crumbs = url;
    try { const u = new URL(url); crumbs = u.hostname + decodeURI(u.pathname).split('/').filter(Boolean).map((p) => ' › ' + p).join(''); } catch {}
    const site = (h.og['og:site_name'] || [])[0] || R.meta.siteHost || '';
    return `<div class="serp" dir="auto">
      <div class="serp-site"><span class="serp-fav" aria-hidden="true">${E((site || '?').trim().charAt(0).toUpperCase())}</span>
        <div><div class="serp-name">${E(site || 'Site name')}</div><div class="serp-url">${E(crumbs)}</div></div></div>
      <div class="serp-title">${E(truncPx(h.title || '(missing title)', '20px Arial', 580))}</div>
      <div class="serp-desc">${h.description ? E(truncPx(h.description, '14px Arial', 920)) : '<span class="missing">No meta description. Google will pull text from the page.</span>'}</div>
    </div>`;
  }

  function renderOverview() {
    const s = R.stats, L = R.links.summary, I = R.images.summary, h1 = R.headings.filter((x) => x.level === 1).length;
    const counts = { error: 0, warning: 0, notice: 0, pass: 0 };
    R.issues.forEach((i) => counts[i.sev]++);
    const types = Object.keys(R.schema.typeCounts);
    const stat = (label, value, sub = '', tab = '', cls = '') => `<button type="button" class="stat ${cls}" ${tab ? `data-goto="${tab}"` : 'disabled'}>
      <span class="stat-v">${value}</span><span class="stat-l">${label}</span>${sub ? `<span class="stat-s">${sub}</span>` : ''}</button>`;
    const platform = R.tech.found.filter((t) => ['CMS', 'Framework', 'SEO plugin', 'Page builder', 'E-commerce'].includes(t.cat));

    $('#pi-overview').innerHTML = `
      <div class="ov-top">
        <div class="ov-serp">
          <div class="sec-head"><h2>Google search preview</h2><span class="muted small">approximate, desktop</span></div>
          ${serpPreview()}
          <div class="chips">${platform.map((p) => chip(p.name, 'tech')).join('')}
            ${R.head.lang ? chip('lang: ' + R.head.lang) : ''}${s.script !== 'unknown' ? chip(s.script) : ''}
            ${R.meta.siteHost ? chip('domain: ' + R.meta.siteHost + (R.meta.baseSource ? ` (from ${R.meta.baseSource})` : '')) : ''}</div>
        </div>
        <div class="ov-issues-sum">
          <div class="sec-head"><h2>Checks</h2></div>
          <div class="sev-grid">
            ${['error', 'warning', 'notice', 'pass'].map((k) => `<button type="button" class="sev-card sc-${k}" data-issues="${k}">${sevBadge(k)}<b>${counts[k]}</b><span>${{ error: 'Errors', warning: 'Warnings', notice: 'Notices', pass: 'Passed' }[k]}</span></button>`).join('')}
          </div>
        </div>
      </div>
      <div class="stats">
        ${stat('Words (main)', fmt(s.mainWords), `${fmt(s.allWords)} on whole page`, 'keywords')}
        ${stat('Reading time', s.readingMin + ' min', `${s.sentences} sentences`, 'keywords')}
        ${stat('H1 headings', h1, `${R.headings.length} headings total`, 'headings', h1 === 1 ? '' : 'st-warn')}
        ${stat('Internal links', fmt(L.internal), `${fmt(L.external)} external · ${L.whatsapp + L.phone} WhatsApp/phone`, 'links')}
        ${stat('Images', fmt(I.total), I.missingAlt ? `${I.missingAlt} missing alt` : 'all have alt', 'images', I.missingAlt ? 'st-warn' : '')}
        ${stat('Schema types', types.length, types.slice(0, 3).join(', ') || 'none found', 'schema', types.length ? '' : 'st-warn')}
        ${stat('Content blocks', fmt(R.content.blocks.length), `${s.paragraphs} paragraphs · ${s.lists} lists`, 'content')}
        ${stat('Text / HTML', s.textRatio + '%', bytes(R.meta.inputBytes) + ' of HTML', 'technical')}
      </div>
      ${section('All checks', `
        <div class="seg" role="group" aria-label="Filter checks">
          ${['all', 'error', 'warning', 'notice', 'pass'].map((k) => `<button type="button" class="seg-btn" data-issues="${k}" aria-pressed="${ui.issues === k}">${k === 'all' ? 'All' : k[0].toUpperCase() + k.slice(1)} <span class="muted">${k === 'all' ? R.issues.length : counts[k]}</span></button>`).join('')}
        </div>
        <ul class="issues" id="issue-list"></ul>`)}`;
    renderIssueList();
  }

  function renderIssueList() {
    const list = R.issues.filter((i) => ui.issues === 'all' || i.sev === ui.issues);
    $('#issue-list').innerHTML = list.length ? list.map((i) => `<li class="issue is-${i.sev}">${sevBadge(i.sev)}
      <div><div><span class="chip cat">${E(i.cat)}</span> <span dir="auto">${E(i.msg)}</span></div>${i.detail ? `<div class="issue-d small muted break" dir="auto">${E(i.detail)}</div>` : ''}</div></li>`).join('')
      : `<li>${empty('Nothing in this category.')}</li>`;
    $$('#pi-overview .seg-btn').forEach((b) => b.setAttribute('aria-pressed', b.dataset.issues === ui.issues));
  }

  document.addEventListener('click', (e) => {
    const g = e.target.closest('[data-goto]');
    if (g) { goTab(g.dataset.goto); return; }
    const iss = e.target.closest('[data-issues]');
    if (iss) {
      ui.issues = iss.dataset.issues; renderIssueList();
      if (iss.classList.contains('sev-card')) $('#issue-list').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });

  /* ---------------------------------------------------------------------
     META & HEAD
     --------------------------------------------------------------------- */
  function renderMeta() {
    const h = R.head;
    const robots = [...h.robots].join(', ');
    const essentials = kvTable([
      ['Title', `${h.title ? `<div class="big-val" dir="auto">${E(h.title)}</div>${meter(h.titleLen, h.titlePx, 30, 60, 580)}` : val(null)}${h.titles.length > 1 ? `<div class="warn-t">${h.titles.length} title tags found</div>` : ''}`],
      ['Meta description', `${h.description ? `<div class="big-val" dir="auto">${E(h.description)}</div>${meter(h.descLen, h.descPx, 70, 160, 920)}` : val(null)}${h.descriptions.length > 1 ? `<div class="warn-t">${h.descriptions.length} descriptions found</div>` : ''}`],
      ['Canonical', h.canonicals.length ? h.canonicals.map((c) => linkOut(c)).join('<br>') : val(null)],
      ['Meta robots', robots ? `<code>${E(robots)}</code>${/noindex/i.test(robots) ? ' ' + chip('NOINDEX', 'bad') : ''}` : '<span class="muted">Not set (defaults to index, follow)</span>'],
      ...(h.googlebot.length ? [['Googlebot', `<code>${E(h.googlebot.join(', '))}</code>`]] : []),
      ['Viewport', val(h.viewport)],
      ['Charset', val(h.charset)],
      ['HTML lang / dir', `${val(h.lang)} ${h.dir ? ' · dir=' + E(h.dir) : ''}`],
      ['Author', val(h.author)],
      ['Generator', h.generator.length ? E(h.generator.join(' | ')) : val(null)],
      ['Theme color', h.themeColor ? `<span class="swatch" style="background:${E(h.themeColor)}"></span> ${E(h.themeColor)}` : val(null)],
      ['Favicon / icons', h.icons.length ? h.icons.map((i) => `<div class="icon-row"><img src="${E(i.href)}" alt="" width="16" height="16" loading="lazy" referrerpolicy="no-referrer"> ${linkOut(i.href)} <span class="muted small">${E(i.rel)} ${E(i.sizes)}</span></div>`).join('') : val(null)],
      ['Manifest', h.manifest ? linkOut(h.manifest) : val(null)],
      ...(h.prev || h.next ? [['Pagination', `prev: ${linkOut(h.prev)}<br>next: ${linkOut(h.next)}`]] : []),
      ...(h.amp ? [['AMP version', linkOut(h.amp)]] : []),
      ...(h.keywordsMeta ? [['Meta keywords', `<span dir="auto">${E(h.keywordsMeta)}</span> <span class="muted small">(ignored by Google)</span>`]] : []),
    ]);

    const ogRows = Object.entries(h.og);
    const ogImg = (h.og['og:image'] || [])[0];
    const ogCard = ogRows.length ? `<div class="og-card" dir="auto">
        ${ogImg ? `<div class="og-img"><img src="${E(ogImg)}" alt="og:image preview" loading="lazy" referrerpolicy="no-referrer"></div>` : '<div class="og-img og-noimg">No og:image</div>'}
        <div class="og-body"><div class="og-dom">${E(R.meta.siteHost || '')}</div>
        <div class="og-t">${E((h.og['og:title'] || [h.title || ''])[0])}</div>
        <div class="og-d">${E((h.og['og:description'] || [h.description || ''])[0])}</div></div></div>` : '';
    const tagTable = (obj) => `<table class="data"><thead><tr><th>Property</th><th>Content</th></tr></thead><tbody>
      ${Object.entries(obj).map(([k, vs]) => vs.map((v) => `<tr><td class="mono nowrap">${E(k)}</td><td dir="auto" class="break">${/^https?:\/\//.test(v) ? linkOut(v) : E(v)}</td></tr>`).join('')).join('')}</tbody></table>`;

    $('#pi-meta').innerHTML = `
      ${section('Essential tags', essentials, copyBtn('Copy title + description', () => `Title: ${h.title || ''}\nMeta description: ${h.description || ''}`))}
      ${section('Open Graph (Facebook, WhatsApp, LinkedIn)', ogRows.length ? `<div class="og-wrap">${ogCard}<div class="og-table">${tagTable(h.og)}</div></div>` : empty('No Open Graph tags found.'))}
      ${section('Twitter / X card', Object.keys(h.twitter).length ? tagTable(h.twitter) : empty('No twitter: tags found.'))}
      ${section('Hreflang alternates', h.hreflang.length ? `<table class="data"><thead><tr><th>hreflang</th><th>URL</th></tr></thead><tbody>${h.hreflang.map((x) => `<tr><td class="mono">${E(x.lang)}</td><td>${linkOut(x.href)}</td></tr>`).join('')}</tbody></table>` : empty('No hreflang tags. Fine for single-language pages.'))}
      ${h.verification.length ? section('Site verification tags', `<table class="data"><tbody>${h.verification.map((v) => `<tr><td class="mono">${E(v.key)}</td><td class="mono break">${E(v.content)}</td></tr>`).join('')}</tbody></table>`) : ''}
      ${section(`All meta tags <span class="muted">(${h.metas.length})</span>`, `<div class="scroll-x"><table class="data"><thead><tr><th>Attribute</th><th>Key</th><th>Content</th><th>In</th></tr></thead><tbody>
        ${h.metas.map((m) => `<tr><td class="muted small">${E(m.kind || '?')}</td><td class="mono nowrap">${E(m.key)}</td><td dir="auto" class="break">${E(m.content)}</td><td class="small">${m.inHead ? 'head' : chip('body', 'warn')}</td></tr>`).join('')}</tbody></table></div>`,
        copyBtn('Copy as CSV', () => toCsv(['attribute', 'key', 'content', 'location'], h.metas.map((m) => [m.kind, m.key, m.content, m.inHead ? 'head' : 'body'])).slice(1)))}
      ${section(`All &lt;link&gt; tags <span class="muted">(${h.linkTags.length})</span>`, h.linkTags.length ? `<div class="scroll-x"><table class="data"><thead><tr><th>rel</th><th>href</th><th>Other</th></tr></thead><tbody>
        ${h.linkTags.map((l) => `<tr><td class="mono nowrap">${E(l.rel)}</td><td>${linkOut(l.abs)}</td><td class="small muted">${E([l.hreflang && 'hreflang=' + l.hreflang, l.type, l.sizes, l.media, l.as && 'as=' + l.as].filter(Boolean).join(' · '))}</td></tr>`).join('')}</tbody></table></div>` : empty('No link tags.'))}`;
  }

  /* ---------------------------------------------------------------------
     SCHEMA
     --------------------------------------------------------------------- */
  function jsonTree(v, key, depth = 0) {
    const k = key !== undefined ? `<span class="jk">${E(key)}</span><span class="jp">: </span>` : '';
    if (v === null) return `<li>${k}<span class="jn">null</span></li>`;
    if (Array.isArray(v)) {
      if (!v.length) return `<li>${k}<span class="jp">[ ]</span></li>`;
      return `<li><details ${depth < 3 ? 'open' : ''}><summary>${k}<span class="jp">[${v.length}]</span></summary><ul class="jt">${v.map((x, i) => jsonTree(x, i, depth + 1)).join('')}</ul></details></li>`;
    }
    if (typeof v === 'object') {
      const t = v['@type'] ? ` <span class="jtype">${E([].concat(v['@type']).join(', '))}</span>` : '';
      const ents = Object.entries(v);
      if (!ents.length) return `<li>${k}<span class="jp">{ }</span></li>`;
      return `<li><details ${depth < 3 ? 'open' : ''}><summary>${k}<span class="jp">{${ents.length}}</span>${t}</summary><ul class="jt">${ents.map(([kk, vv]) => jsonTree(vv, kk, depth + 1)).join('')}</ul></details></li>`;
    }
    if (typeof v === 'string') {
      const inner = /^https?:\/\//.test(v) ? `<a href="${E(v)}" target="_blank" rel="noopener noreferrer">${E(v)}</a>` : E(v);
      return `<li>${k}<span class="js${/[\u0600-\u06FF]/.test(v) ? ' ar' : ''}" dir="auto">"${inner}"</span></li>`;
    }
    return `<li>${k}<span class="jn">${E(String(v))}</span></li>`;
  }
  const checksList = (checks) => checks.length ? `<ul class="checks">${checks.map((c) => `<li>${sevBadge(c.sev)} <span dir="auto">${E(c.msg)}</span></li>`).join('')}</ul>` : '';

  function renderSchema() {
    const S = R.schema;
    const typeChips = Object.entries(S.typeCounts).sort((a, b) => b[1] - a[1]).map(([t, c]) => chip(`${t}${c > 1 ? ' ×' + c : ''}`, 'type')).join('');
    const blocks = S.jsonld.map((j) => `
      <div class="card schema-card">
        <div class="schema-head">
          <div><b>JSON-LD #${j.index}</b> ${j.valid ? chip('valid JSON', 'ok') : chip('invalid JSON', 'bad')}
          ${j.valid ? `<span class="muted small">${j.entities.length} top-level entit${j.entities.length === 1 ? 'y' : 'ies'}</span>` : ''}
          ${j.className ? `<span class="muted small mono">class="${E(j.className)}"</span>` : ''}
          <span class="muted small">in &lt;${j.inHead ? 'head' : 'body'}&gt;</span></div>
          <div class="btn-row">${copyBtn('Copy JSON', () => j.valid ? JSON.stringify(j.data, null, 2) : j.raw, `Copy JSON-LD block ${j.index}`)}</div>
        </div>
        ${j.valid ? j.entities.map((e) => `<div class="entity">
            <div class="entity-head"><span class="jtype big">${E([].concat(e.type).join(', '))}</span> ${e.id ? `<span class="mono small muted break">${E(e.id)}</span>` : ''}</div>
            ${checksList(e.checks)}
            <ul class="jt root">${Object.entries(e.data).map(([k, v]) => jsonTree(v, k, 1)).join('')}</ul>
          </div>`).join('')
        : `<div class="err-box">Parse error: ${E(j.error)}</div><pre class="raw">${E(j.raw.slice(0, 20000))}</pre>`}
        <details class="raw-d"><summary>Raw JSON</summary><pre class="raw">${E(j.valid ? JSON.stringify(j.data, null, 2) : j.raw)}</pre></details>
      </div>`).join('');

    const micro = S.microdata.map((m, i) => `<div class="card schema-card"><div class="schema-head"><div><b>Microdata #${i + 1}</b> <span class="jtype big">${E(m.type)}</span></div>
      <div class="btn-row">${copyBtn('Copy JSON', () => JSON.stringify(m.data, null, 2))}</div></div>
      ${checksList(m.checks)}<ul class="jt root">${Object.entries(m.data).map(([k, v]) => jsonTree(v, k, 1)).join('')}</ul></div>`).join('');

    const rdfa = S.rdfa.length ? `<table class="data"><thead><tr><th>typeof</th><th>Properties</th></tr></thead><tbody>${S.rdfa.map((r) => `<tr><td class="mono">${E(r.type)}</td><td class="small break">${Object.entries(r.props).map(([k, v]) => `<b>${E(k)}</b>: ${E(String(v).slice(0, 200))}`).join('<br>')}</td></tr>`).join('')}</tbody></table>` : '';
    const testUrl = R.head.canonicals[0] || R.meta.baseUrl;
    const tools = `<div class="btn-row">
      ${testUrl ? `<a class="btn sm" target="_blank" rel="noopener noreferrer" href="https://search.google.com/test/rich-results?url=${encodeURIComponent(testUrl)}">Google Rich Results Test ↗</a>
      <a class="btn sm" target="_blank" rel="noopener noreferrer" href="https://validator.schema.org/#url=${encodeURIComponent(testUrl)}">Schema.org validator ↗</a>` : ''}
      ${S.jsonld.length ? copyBtn('Copy all JSON-LD', () => S.jsonld.map((j) => j.valid ? JSON.stringify(j.data, null, 2) : j.raw).join('\n\n')) : ''}</div>`;

    $('#pi-schema').innerHTML = (S.jsonld.length + S.microdata.length + S.rdfa.length) === 0
      ? section('Structured data', empty('No JSON-LD, Microdata or RDFa found on this page.') + tools)
      : `${section('Types found', `<div class="chips">${typeChips}</div><p class="small muted">Property checks use commonly recommended fields; they are guidance, not Google's exact eligibility rules.</p>`, tools)}
         ${S.jsonld.length ? section(`JSON-LD <span class="muted">(${S.jsonld.length} block${S.jsonld.length > 1 ? 's' : ''})</span>`, blocks) : ''}
         ${S.microdata.length ? section(`Microdata <span class="muted">(${S.microdata.length})</span>`, micro) : ''}
         ${S.rdfa.length ? section('RDFa', rdfa) : ''}`;
  }

  /* ---------------------------------------------------------------------
     HEADINGS
     --------------------------------------------------------------------- */
  function renderHeadings() {
    const list = R.headings.filter((h) => !ui.headings.mainOnly || h.region === 'main' || h.region === 'body');
    const counts = [1, 2, 3, 4, 5, 6].map((l) => R.headings.filter((h) => h.level === l).length);
    const outlineText = () => list.map((h) => `${'  '.repeat(h.level - 1)}H${h.level}: ${h.text}`).join('\n');
    $('#pi-headings').innerHTML = `
      ${section('Heading structure', `
        <div class="lvl-counts">${counts.map((c, i) => `<div class="lvl-c lv${i + 1}"><b>${c}</b><span>H${i + 1}</span></div>`).join('')}</div>
        <div class="toolbar">
          <label class="check"><input type="checkbox" id="h-main" ${ui.headings.mainOnly ? 'checked' : ''}> Main content only (hide header, nav, sidebar, footer headings)</label>
          <div class="btn-row">${copyBtn('Copy outline', outlineText)}${copyBtn('Copy as Markdown', () => list.map((h) => `${'#'.repeat(h.level)} ${h.text}`).join('\n'))}</div>
        </div>
        ${list.length ? `<ol class="outline">${list.map((h) => `<li class="ol-row" style="--lvl:${h.level - 1}">
            <span class="hbadge lv${h.level}">H${h.level}</span>
            <span class="ol-text ${h.text ? '' : 'missing'}" dir="auto">${h.text ? E(h.text) : '(empty heading)'}</span>
            <span class="ol-meta">${h.region !== 'main' && h.region !== 'body' ? regionChip(h.region) : ''}
            ${h.fromAlt ? chip('text from img alt') : ''}${h.hidden ? chip(h.hidden, 'hid') : ''}
            ${h.flags.map((f) => chip(f, 'warn')).join('')}<span class="muted small">${h.length} ch</span></span></li>`).join('')}</ol>` : empty('No headings found.')}`)}`;
    $('#h-main').addEventListener('change', (e) => { ui.headings.mainOnly = e.target.checked; renderHeadings(); });
  }

  /* ---------------------------------------------------------------------
     CONTENT
     --------------------------------------------------------------------- */
  const TAG_LABEL = { paragraph: 'P', text: 'TEXT', link: 'LINK', list: 'LIST', table: 'TABLE', image: 'IMG', quote: 'QUOTE',
    pre: 'CODE', embed: 'EMBED', button: 'BUTTON', field: 'FIELD', hr: 'HR', caption: 'CAPTION' };

  function blockHtml(b) {
    let tag = b.type === 'heading' ? 'H' + b.level : TAG_LABEL[b.type] || b.type.toUpperCase();
    if (b.type === 'list') tag = b.dl ? 'DL' : b.ordered ? 'OL' : 'UL';
    const sub = b.type === 'text' && b.tag && b.tag !== 'p' ? `<span class="tag-sub">${E(b.tag)}</span>` : '';
    let body;
    switch (b.type) {
      case 'heading': body = `<div class="b-h b-h${b.level}" dir="auto">${b.html || E(b.text)}</div>`; break;
      case 'list': {
        const T = b.ordered ? 'ol' : 'ul';
        body = `<${T} class="b-list" dir="auto">${b.items.map((it) => `<li style="--d:${it.depth}">${it.html}</li>`).join('')}</${T}>`; break;
      }
      case 'table': body = `<div class="scroll-x">${b.caption ? `<div class="small muted">${E(b.caption)}</div>` : ''}<table class="data b-table" dir="auto"><tbody>${b.rows.map((r) => `<tr>${r.map((c) => `<${c.th ? 'th' : 'td'}>${c.html}</${c.th ? 'th' : 'td'}>`).join('')}</tr>`).join('')}</tbody></table></div>`; break;
      case 'image': {
        const prev = ui.images.previews && /^https?:/.test(b.src) ? `<img class="b-thumb" src="${E(b.src)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '';
        body = `<div class="b-img">${prev}<div><div dir="auto">${b.alt === null ? chip('alt missing', 'bad') : b.alt === '' ? chip('empty alt', 'warn') : `<b>alt:</b> ${E(b.alt)}`}</div>
          <div class="small muted break">${linkOut(b.src, (b.src.split('/').pop() || b.src).split('?')[0])}${b.width ? ` · ${E(b.width)}×${E(b.height)}` : ''}</div></div></div>`; break;
      }
      case 'link': body = `<div dir="auto">${b.html}</div><div class="small muted break">${linkOut(b.href)}</div>`; break;
      case 'pre': body = `<pre class="raw">${b.html}</pre>`; break;
      case 'quote': body = `<blockquote dir="auto">${b.html}</blockquote>`; break;
      case 'embed': body = `<div>${E(b.kind)}${b.title ? ': ' + E(b.title) : ''}</div><div class="small break">${linkOut(b.src)}</div>`; break;
      case 'field': body = `<div class="muted" dir="auto">${E(b.kind)} field${b.text ? ': “' + E(b.text) + '”' : ''}${b.required ? ' (required)' : ''}</div>`; break;
      case 'button': body = `<div dir="auto"><span class="b-btn">${b.html}</span></div>`; break;
      case 'hr': body = '<hr>'; break;
      default: body = `<div dir="auto" class="b-p">${b.html}</div>`;
    }
    const tagCls = b.type === 'heading' ? 'tg-h' : 'tg-' + b.type;
    return `<div class="blk ${b.hidden ? 'is-hidden' : ''}">
      ${ui.content.showTags ? `<div class="blk-tag"><span class="tg ${tagCls}">${tag}</span>${sub}</div>` : ''}
      <div class="blk-body">${body}${b.hidden ? `<div>${chip('hidden: ' + b.hidden, 'hid')}</div>` : ''}</div></div>`;
  }

  const regionKey = (r) => (r === 'body' ? 'main' : r);
  function contentFiltered() {
    return R.content.blocks.filter((b) => ui.content.regions[regionKey(b.region)] && (ui.content.showHidden || !b.hidden));
  }
  function contentMd(blocks) { return blocks.map(Extractor.blockToMd).filter(Boolean).join('\n\n'); }
  function wordsIn(blocks) { return blocks.reduce((n, b) => n + ((Extractor.blockText(b).match(/[\p{L}\p{N}]+/gu) || []).length), 0); }

  function renderContent() {
    const c = ui.content;
    const blocks = contentFiltered();
    let body = '';
    if (!blocks.length) body = empty('No content blocks match these filters.');
    else if (c.view === 'grouped') {
      const groups = [['header', ['header']], ['nav', ['nav']], ['main', ['main', 'body']], ['aside', ['aside']], ['footer', ['footer']]];
      body = groups.map(([g, rs]) => {
        const bs = blocks.filter((b) => rs.includes(b.region));
        if (!bs.length) return '';
        return `<div class="region-group rg-${g}"><div class="rg-head"><h3>${REGION_LABEL[g]}</h3><span class="muted small">${bs.length} blocks · ${fmt(wordsIn(bs))} words</span>
          ${copyBtn('Copy section', () => contentMd(bs), `Copy ${REGION_LABEL[g]} as Markdown`)}</div>
          ${g === 'main' && !R.content.hasMain ? '<p class="small muted note">No &lt;main&gt; element on this page: everything outside the header, navigation, sidebar and footer is treated as main content.</p>' : ''}
          ${bs.map(blockHtml).join('')}</div>`;
      }).join('');
    } else {
      let prev = null;
      body = blocks.map((b) => {
        const rk = regionKey(b.region);
        const div = rk !== prev ? `<div class="region-div">${regionChip(rk)}</div>` : '';
        prev = rk;
        return div + blockHtml(b);
      }).join('');
    }
    const regionBox = (k) => `<label class="check"><input type="checkbox" data-region="${k}" ${c.regions[k] ? 'checked' : ''}> ${REGION_LABEL[k]} <span class="muted small">${R.content.blocks.filter((b) => regionKey(b.region) === k).length}</span></label>`;
    $('#pi-content').innerHTML = `
      <div class="toolbar content-toolbar">
        <div class="seg" role="group" aria-label="Content view">
          <button type="button" class="seg-btn" data-view="grouped" aria-pressed="${c.view === 'grouped'}">Grouped by section</button>
          <button type="button" class="seg-btn" data-view="order" aria-pressed="${c.view === 'order'}">Document order</button>
        </div>
        <div class="checks-row">${['header', 'nav', 'main', 'aside', 'footer'].map(regionBox).join('')}</div>
        <div class="checks-row">
          <label class="check"><input type="checkbox" id="c-hidden" ${c.showHidden ? 'checked' : ''}> Show hidden blocks</label>
          <label class="check"><input type="checkbox" id="c-tags" ${c.showTags ? 'checked' : ''}> Show tag labels</label>
        </div>
        <div class="btn-row">${copyBtn('Copy as Markdown', () => contentMd(contentFiltered()))}${copyBtn('Copy plain text', () => contentFiltered().map(Extractor.blockText).filter(Boolean).join('\n\n'))}</div>
      </div>
      <div class="content-meta small muted">${blocks.length} blocks · ${fmt(wordsIn(blocks))} words shown</div>
      <div class="content-list">${body}</div>`;

    $$('#pi-content [data-view]').forEach((b) => b.addEventListener('click', () => { c.view = b.dataset.view; renderContent(); }));
    $$('#pi-content [data-region]').forEach((b) => b.addEventListener('change', () => { c.regions[b.dataset.region] = b.checked; renderContent(); }));
    $('#c-hidden').addEventListener('change', (e) => { c.showHidden = e.target.checked; renderContent(); });
    $('#c-tags').addEventListener('change', (e) => { c.showTags = e.target.checked; renderContent(); });
  }

  /* ---------------------------------------------------------------------
     LINKS
     --------------------------------------------------------------------- */
  const TYPE_LABEL = { internal: 'Internal', external: 'External', anchor: '#Anchor', whatsapp: 'WhatsApp', phone: 'Phone', email: 'Email', javascript: 'JavaScript', empty: 'Empty', other: 'Other' };

  function linksFiltered() {
    const f = ui.links, q = f.q.toLowerCase();
    return R.links.items.filter((l) => (f.type === 'all' || l.type === f.type) &&
      (f.region === 'all' || regionKey(l.region) === f.region) && (!f.issuesOnly || l.flags.length) &&
      (!q || l.text.toLowerCase().includes(q) || l.abs.toLowerCase().includes(q)));
  }

  function renderLinks() {
    const S = R.links.summary;
    const types = Object.keys(TYPE_LABEL).filter((t) => R.links.items.some((l) => l.type === t));
    $('#pi-links').innerHTML = `
      <div class="stats small-stats">
        ${[['Total', S.total], ['Unique URLs', S.unique], ['Internal', S.internal], ['External', S.external], ['WhatsApp', S.whatsapp], ['Phone', S.phone], ['Email', S.email], ['Nofollow', S.nofollow], ['With issues', S.withIssues]]
          .map(([l, v]) => `<div class="stat"><span class="stat-v">${fmt(v)}</span><span class="stat-l">${l}</span></div>`).join('')}
      </div>
      ${section('All links', `
        <div class="toolbar">
          <label class="field inline">Type <select id="l-type"><option value="all">All types</option>${types.map((t) => `<option value="${t}" ${ui.links.type === t ? 'selected' : ''}>${TYPE_LABEL[t]}</option>`).join('')}</select></label>
          <label class="field inline">Section <select id="l-region"><option value="all">All sections</option>${['header', 'nav', 'main', 'aside', 'footer'].map((r) => `<option value="${r}" ${ui.links.region === r ? 'selected' : ''}>${REGION_LABEL[r]}</option>`).join('')}</select></label>
          <label class="field inline grow">Search <input type="search" id="l-q" value="${E(ui.links.q)}" placeholder="anchor text or URL"></label>
          <label class="check"><input type="checkbox" id="l-iss" ${ui.links.issuesOnly ? 'checked' : ''}> Only with issues</label>
          <div class="btn-row">${copyBtn('Copy URLs', () => [...new Set(linksFiltered().map((l) => l.abs))].join('\n'))}
            <button type="button" class="btn sm" id="l-csv">Download CSV</button></div>
        </div>
        <div id="links-table"></div>`)}
      ${S.uniqueExternalDomains.length ? section(`External domains <span class="muted">(${S.uniqueExternalDomains.length})</span>`, `<div class="chips">${S.uniqueExternalDomains.map((d) => chip(d)).join('')}</div>`) : ''}`;
    const rerender = () => renderLinksTable();
    $('#l-type').addEventListener('change', (e) => { ui.links.type = e.target.value; rerender(); });
    $('#l-region').addEventListener('change', (e) => { ui.links.region = e.target.value; rerender(); });
    $('#l-q').addEventListener('input', (e) => { ui.links.q = e.target.value; rerender(); });
    $('#l-iss').addEventListener('change', (e) => { ui.links.issuesOnly = e.target.checked; rerender(); });
    $('#l-csv').addEventListener('click', () => download(`${slugName()}-links.csv`, linksCsv(R.links.items), 'text/csv;charset=utf-8'));
    renderLinksTable();
  }

  function renderLinksTable() {
    const list = linksFiltered();
    $('#links-table').innerHTML = list.length ? `<div class="small muted">${list.length} links shown</div><div class="scroll-x"><table class="data links-t"><thead><tr>
      <th>#</th><th>Anchor text</th><th>URL</th><th>Type</th><th>rel / target</th><th>Section</th><th>Flags</th></tr></thead><tbody>
      ${list.map((l, i) => `<tr><td class="muted small">${i + 1}</td>
        <td dir="auto" class="anchor-c">${l.text ? E(l.text) : '<span class="missing">(none)</span>'}${l.source !== 'text' && l.source !== 'none' ? `<div class="small muted">from ${E(l.source)}</div>` : ''}</td>
        <td class="url-c">${linkOut(/^https?:/.test(l.abs) ? l.abs : '', l.abs || l.href)}${l.occurrences > 1 ? ` <span class="chip">×${l.occurrences}</span>` : ''}</td>
        <td><span class="chip lt-${l.type}">${TYPE_LABEL[l.type] || l.type}</span></td>
        <td class="small mono">${E([l.rel, l.target].filter(Boolean).join(' · ')) || '<span class="muted">—</span>'}</td>
        <td>${regionChip(regionKey(l.region))}</td>
        <td>${l.flags.map((f) => chip(f, 'warn')).join('')}</td></tr>`).join('')}</tbody></table></div>` : empty('No links match.');
  }
  const linksCsv = (items) => toCsv(['anchor_text', 'anchor_source', 'href', 'resolved_url', 'type', 'rel', 'target', 'section', 'occurrences', 'flags'],
    items.map((l) => [l.text, l.source, l.href, l.abs, l.type, l.rel, l.target, REGION_LABEL[l.region], l.occurrences, l.flags.join('; ')]));

  /* ---------------------------------------------------------------------
     IMAGES
     --------------------------------------------------------------------- */
  function imagesFiltered() {
    const f = ui.images.filter;
    return R.images.items.filter((i) => f === 'all' ? true : f === 'missing' ? i.kind === 'img' && i.alt === null :
      f === 'empty' ? i.alt === '' : f === 'nodims' ? i.kind === 'img' && (!i.width || !i.height) : f === 'bg' ? i.kind === 'background' :
      f === 'withalt' ? !!i.alt : true);
  }
  function renderImages() {
    const S = R.images.summary;
    const filters = [['all', 'All', R.images.items.length], ['withalt', 'Has alt', S.withAlt], ['missing', 'Alt missing', S.missingAlt], ['empty', 'Empty alt', S.emptyAlt], ['nodims', 'No width/height', S.noDims], ['bg', 'CSS backgrounds', S.backgrounds]];
    $('#pi-images').innerHTML = `
      <div class="stats small-stats">
        ${[['Images', S.total], ['With alt', S.withAlt], ['Alt missing', S.missingAlt], ['Empty alt', S.emptyAlt], ['No dimensions', S.noDims], ['Lazy loaded', S.lazy], ['Backgrounds', S.backgrounds]]
          .map(([l, v]) => `<div class="stat"><span class="stat-v">${fmt(v)}</span><span class="stat-l">${l}</span></div>`).join('')}
      </div>
      <p class="small muted">Formats: ${Object.entries(S.formats).map(([k, v]) => `${E(k)} ×${v}`).join(', ') || '—'}${R.images.ogImage ? ` · og:image: ${linkOut(R.images.ogImage, R.images.ogImage.split('/').pop())}` : ''}</p>
      ${section('All images', `
        <div class="toolbar">
          <div class="seg" role="group" aria-label="Filter images">${filters.map(([k, l, n]) => `<button type="button" class="seg-btn" data-imgf="${k}" aria-pressed="${ui.images.filter === k}">${l} <span class="muted">${n}</span></button>`).join('')}</div>
          <label class="check"><input type="checkbox" id="i-prev" ${ui.images.previews ? 'checked' : ''}> Show previews (loads images from the site)</label>
          <div class="btn-row">${copyBtn('Copy alt texts', () => imagesFiltered().filter((i) => i.alt).map((i) => `${i.file}\t${i.alt}`).join('\n'))}<button type="button" class="btn sm" id="i-csv">Download CSV</button></div>
        </div>
        <div id="img-table"></div>`)}`;
    $$('#pi-images [data-imgf]').forEach((b) => b.addEventListener('click', () => { ui.images.filter = b.dataset.imgf; renderImages(); }));
    $('#i-prev').addEventListener('change', (e) => { ui.images.previews = e.target.checked; renderImages(); renderContent(); });
    $('#i-csv').addEventListener('click', () => download(`${slugName()}-images.csv`, toCsv(['file', 'src', 'alt', 'title', 'width', 'height', 'loading', 'fetchpriority', 'section', 'links_to', 'type', 'flags'],
      R.images.items.map((i) => [i.file, i.src, i.alt ?? '(missing)', i.title, i.width, i.height, i.loading, i.fetchpriority, REGION_LABEL[i.region], i.linkTo, i.kind, i.flags.join('; ')])), 'text/csv;charset=utf-8'));
    const list = imagesFiltered();
    $('#img-table').innerHTML = list.length ? `<div class="scroll-x"><table class="data img-t"><thead><tr><th>#</th>${ui.images.previews ? '<th>Preview</th>' : ''}<th>File</th><th>Alt text</th><th>Size</th><th>Loading</th><th>Section</th><th>Flags</th></tr></thead><tbody>
      ${list.map((i, n) => `<tr><td class="muted small">${n + 1}</td>
        ${ui.images.previews ? `<td>${/^https?:/.test(i.src) ? `<a href="${E(i.src)}" target="_blank" rel="noopener noreferrer"><img class="thumb" src="${E(i.src)}" alt="" loading="lazy" referrerpolicy="no-referrer"></a>` : '<span class="muted small">n/a</span>'}</td>` : ''}
        <td class="url-c"><div class="mono small break">${E(i.file || i.src)}</div>${linkOut(/^https?:/.test(i.src) ? i.src : '', 'open')}${i.kind === 'background' ? ' ' + chip('CSS bg') : ''}${i.linkTo ? `<div class="small muted break">links to ${E(i.linkTo)}</div>` : ''}</td>
        <td dir="auto">${i.alt === null ? '<span class="missing">missing</span>' : i.alt === '' ? '<span class="muted">alt=""</span>' : E(i.alt)}${i.title ? `<div class="small muted">title: ${E(i.title)}</div>` : ''}</td>
        <td class="small nowrap">${i.width || '?'} × ${i.height || '?'}</td>
        <td class="small">${E([i.loading, i.fetchpriority && 'priority=' + i.fetchpriority].filter(Boolean).join(' · ')) || '—'}</td>
        <td>${regionChip(regionKey(i.region))}</td>
        <td>${i.flags.map((f) => chip(f, /missing|linked/.test(f) ? 'bad' : 'warn')).join('')}</td></tr>`).join('')}</tbody></table></div>` : empty('No images match.');
  }

  /* ---------------------------------------------------------------------
     KEYWORDS
     --------------------------------------------------------------------- */
  function gramTable(title, rows) {
    const max = rows[0] ? rows[0].count : 1;
    return `<div class="gram"><h3>${title}</h3>${rows.length ? `<table class="data gram-t"><thead><tr><th>Phrase</th><th>Count</th><th>Density</th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td dir="auto"><button type="button" class="linklike" data-kw="${E(r.phrase)}">${E(r.phrase)}</button><div class="bar"><span style="width:${Math.round(r.count / max * 100)}%"></span></div></td><td>${r.count}</td><td>${r.density}%</td></tr>`).join('')}
      </tbody></table>` : empty('Not enough repeated phrases.')}</div>`;
  }
  function renderKeywords() {
    const s = R.stats, K = R.keywords;
    $('#pi-keywords').innerHTML = `
      ${section('Focus keyword check', `
        <form id="kw-form" class="kw-form"><label class="field grow"><span>Target keyword or phrase (English or Arabic)</span>
          <input type="text" id="kw-in" placeholder="e.g. movers in dubai  /  نقل اثاث دبي" dir="auto"></label>
          <button class="btn primary" type="submit">Check</button></form>
        <div id="kw-out"></div>`)}
      ${section('Content statistics', `<div class="stats small-stats">
        ${[['Words (main)', fmt(s.mainWords)], ['Words (all)', fmt(s.allWords)], ['Unique words', fmt(K.uniqueWords)], ['Sentences', fmt(s.sentences)], ['Avg words / sentence', s.avgSentence], ['Sentences > 25 words', s.longSentences], ['Paragraphs (&lt;p&gt;)', s.paragraphs], ['Other text blocks', s.textBlocks], ['Reading time', s.readingMin + ' min'], ['Script', `${s.script}${s.arabicShare ? ` (${s.arabicShare}% Arabic)` : ''}`]]
          .map(([l, v]) => `<div class="stat"><span class="stat-v">${v}</span><span class="stat-l">${l}</span></div>`).join('')}</div>
        <p class="small muted">Keyword stats use the main content only (header, navigation, sidebar and footer excluded). Common English and Arabic stop words are skipped. Click a phrase to check it.</p>`)}
      <div class="grams">${gramTable('Single words', K.one)}${gramTable('2-word phrases', K.two)}${gramTable('3-word phrases', K.three)}</div>`;
    const check = (kw) => {
      const res = Extractor.keywordCheck(R, kw);
      if (!res) { $('#kw-out').innerHTML = ''; return; }
      $('#kw-out').innerHTML = `<div class="kw-res">
        <div class="kw-top"><div class="stat"><span class="stat-v">${res.occurrences}</span><span class="stat-l">times in main content</span></div>
        <div class="stat"><span class="stat-v">${res.density}%</span><span class="stat-l">density</span></div></div>
        <ul class="checks">${res.checks.map(([l, ok]) => `<li>${ok === null ? sevBadge('notice') : sevBadge(ok ? 'pass' : 'warning')} ${l}${ok === null ? ' <span class="muted small">(enter the page URL to check)</span>' : ''}</li>`).join('')}</ul></div>`;
    };
    $('#kw-form').addEventListener('submit', (e) => { e.preventDefault(); check($('#kw-in').value); });
    $$('#pi-keywords [data-kw]').forEach((b) => b.addEventListener('click', () => { $('#kw-in').value = b.dataset.kw; check(b.dataset.kw); $('#kw-form').scrollIntoView({ behavior: 'smooth', block: 'center' }); }));
  }

  /* ---------------------------------------------------------------------
     TECHNICAL
     --------------------------------------------------------------------- */
  function renderTechnical() {
    const h = R.head, T = R.tech;
    const ext = h.scripts.filter((s) => !s.inline), inl = h.scripts.filter((s) => s.inline);
    $('#pi-technical').innerHTML = `
      ${section('Detected platform, plugins and tracking', T.found.length ? `<table class="data"><thead><tr><th>Technology</th><th>Category</th><th>Evidence</th></tr></thead><tbody>
        ${T.found.map((t) => `<tr><td><b>${E(t.name)}</b></td><td>${chip(t.cat)}</td><td class="small mono break">${E(t.evidence)}</td></tr>`).join('')}</tbody></table>` : empty('Nothing recognised.'))}
      ${T.nextData ? section('Next.js __NEXT_DATA__', kvTable([['Page route', E(T.nextData.page)], ['Build ID', E(T.nextData.buildId)], ['Locale', val(T.nextData.locale)], ['Payload size', bytes(T.nextData.size)]])) : ''}
      ${section('&lt;html&gt; attributes', kvTable(h.htmlAttrs.map((a) => [`<span class="mono">${E(a.name)}</span>`, `<span class="mono break">${E(a.value)}</span>`])) || empty('None'))}
      ${section(`Scripts <span class="muted">(${ext.length} external, ${inl.length} inline)</span>`, `<div class="scroll-x"><table class="data"><thead><tr><th>Source / preview</th><th>Type</th><th>Loading</th><th>In</th></tr></thead><tbody>
        ${h.scripts.map((s) => `<tr><td class="break">${s.inline ? `<span class="small muted">inline ${bytes(s.size)}${s.id ? ' #' + E(s.id) : ''}:</span> <span class="mono small">${E(s.preview)}</span>` : linkOut(s.src)}</td>
          <td class="small mono">${E(s.type || 'js')}</td><td class="small">${[s.async && 'async', s.defer && 'defer'].filter(Boolean).join(' ') || (s.inline ? '—' : chip('blocking', 'warn'))}</td><td class="small">${s.inHead ? 'head' : 'body'}</td></tr>`).join('')}</tbody></table></div>`)}
      ${section(`Stylesheets <span class="muted">(${h.stylesheets.length})</span>`, h.stylesheets.length ? `<ul class="plain">${h.stylesheets.map((s) => `<li>${linkOut(s)}</li>`).join('')}</ul>` : empty('No external stylesheets.'))}
      ${section('Resource hints', h.hints.length ? `<table class="data"><tbody>${h.hints.map((l) => `<tr><td class="mono">${E(l.rel)}</td><td>${linkOut(l.abs)}</td><td class="small muted">${E(l.as)}</td></tr>`).join('')}</tbody></table>` : empty('No preload / preconnect hints.'))}
      ${T.comments.length ? section(`HTML comments <span class="muted">(${T.comments.length})</span>`, `<details><summary>Show comments (SEO plugins and caches often leave notes here)</summary><ul class="plain mono small">${T.comments.map((c) => `<li class="break">${E(c.slice(0, 400))}</li>`).join('')}</ul></details>`) : ''}`;
  }

  /* ---------------------------------------------------------------------
     EXPORT
     --------------------------------------------------------------------- */
  function fullReportMd() {
    const h = R.head, s = R.stats;
    const lines = [];
    lines.push(`# SEO Content Report: ${h.title || '(no title)'}`, '');
    lines.push(`- **URL:** ${h.canonicals[0] || R.meta.baseUrl || 'unknown'}`, `- **Generated:** ${new Date(R.meta.generatedAt).toLocaleString()}`, '');
    lines.push('## Meta', '', `- **Title** (${h.titleLen} chars): ${h.title || 'MISSING'}`, `- **Meta description** (${h.descLen} chars): ${h.description || 'MISSING'}`,
      `- **Canonical:** ${h.canonicals.join(', ') || 'MISSING'}`, `- **Robots:** ${h.robots.join(', ') || 'not set'}`, `- **Lang / dir:** ${h.lang || '-'} / ${h.dir || '-'}`, '');
    if (Object.keys(h.og).length) { lines.push('### Open Graph', ''); Object.entries(h.og).forEach(([k, v]) => v.forEach((x) => lines.push(`- ${k}: ${x}`))); lines.push(''); }
    if (h.hreflang.length) { lines.push('### Hreflang', ''); h.hreflang.forEach((x) => lines.push(`- ${x.lang}: ${x.href}`)); lines.push(''); }
    lines.push('## Checks', '');
    R.issues.filter((i) => i.sev !== 'pass').forEach((i) => lines.push(`- **${i.sev.toUpperCase()}** [${i.cat}] ${i.msg}${i.detail ? ` (${i.detail})` : ''}`));
    lines.push('', '## Content stats', '', `- Main content words: ${s.mainWords} (whole page: ${s.allWords})`, `- Sentences: ${s.sentences}, avg ${s.avgSentence} words`, `- Paragraphs: ${s.paragraphs}, lists: ${s.lists}, tables: ${s.tables}`, `- Reading time: ${s.readingMin} min`, '');
    lines.push('## Heading outline', '');
    R.headings.forEach((x) => lines.push(`${'  '.repeat(x.level - 1)}- H${x.level}: ${x.text || '(empty)'}${x.region !== 'main' && x.region !== 'body' ? ` _(${REGION_LABEL[x.region]})_` : ''}`));
    lines.push('', '## Structured data', '');
    R.schema.jsonld.forEach((j) => {
      lines.push(`### JSON-LD #${j.index} ${j.valid ? '' : '(INVALID)'}`, '');
      if (j.valid) j.entities.forEach((e) => lines.push(`- **${[].concat(e.type).join(', ')}**${e.id ? ` (${e.id})` : ''}${e.checks.filter((c) => c.sev !== 'pass').map((c) => `\n  - ${c.msg}`).join('')}`));
      lines.push('', '```json', j.valid ? JSON.stringify(j.data, null, 2) : j.raw, '```', '');
    });
    if (!R.schema.jsonld.length) lines.push('No JSON-LD found.', '');
    const sections = [['Header', ['header']], ['Navigation', ['nav']], ['Main content', ['main', 'body']], ['Sidebar', ['aside']], ['Footer', ['footer']]];
    lines.push('## Page content', '');
    sections.forEach(([name, rs]) => {
      const bs = R.content.blocks.filter((b) => rs.includes(b.region));
      if (!bs.length) return;
      lines.push(`### [${name}]`, '', contentMd(bs), '');
    });
    lines.push('## Links', '', '| Anchor text | URL | Type | rel | Section |', '| --- | --- | --- | --- | --- |');
    R.links.items.forEach((l) => lines.push(`| ${(l.text || '(none)').replace(/\|/g, '\\|')} | ${l.abs} | ${l.type} | ${l.rel || ''} | ${REGION_LABEL[l.region]} |`));
    lines.push('', '## Images', '', '| File | Alt | Size | Section |', '| --- | --- | --- | --- |');
    R.images.items.forEach((i) => lines.push(`| ${i.file || i.src} | ${i.alt === null ? '**MISSING**' : (i.alt || '""').replace(/\|/g, '\\|')} | ${i.width || '?'}×${i.height || '?'} | ${REGION_LABEL[i.region]} |`));
    return lines.join('\n');
  }

  function renderExport() {
    const mainBlocks = R.content.blocks.filter((b) => b.region === 'main' || b.region === 'body');
    const name = slugName();
    const jsonReport = () => JSON.stringify(R, null, 2);
    const item = (title, desc, actions) => `<div class="exp-item"><div><h3>${title}</h3><p class="small muted">${desc}</p></div><div class="btn-row">${actions}</div></div>`;
    $('#pi-export').innerHTML = `
      ${section('Export', `<div class="exp-grid">
        ${item('Main content as Markdown', 'Clean headings, paragraphs, lists, tables, links and images from the main content. Ready to paste into a doc or an AI tool.',
          `${copyBtn('Copy', () => contentMd(mainBlocks), 'Copy main content Markdown')}<button type="button" class="btn sm" data-dl="main-md">Download .md</button>`)}
        ${item('Full report as Markdown', 'Meta, checks, stats, heading outline, schema, content of every section, links and images in one file.',
          `${copyBtn('Copy', fullReportMd, 'Copy full report Markdown')}<button type="button" class="btn sm" data-dl="full-md">Download .md</button>`)}
        ${item('Full data as JSON', 'Every extracted field in structured form, for scripts, dashboards or comparing pages.',
          `${copyBtn('Copy', jsonReport, 'Copy JSON report')}<button type="button" class="btn sm" data-dl="json">Download .json</button>`)}
        ${item('Spreadsheets (CSV, opens in Excel / Google Sheets)', 'UTF-8 with BOM so Arabic text displays correctly in Excel.',
          `<button type="button" class="btn sm" data-dl="links">Links</button><button type="button" class="btn sm" data-dl="images">Images</button><button type="button" class="btn sm" data-dl="headings">Headings</button><button type="button" class="btn sm" data-dl="meta">Meta tags</button><button type="button" class="btn sm" data-dl="content">Content blocks</button>`)}
        ${item('Print or save as PDF', 'Prints every report section one after another.', '<button type="button" class="btn sm" id="print-btn">Print / PDF</button>')}
      </div>`)}
      ${section('Full report preview (Markdown)', '<textarea class="md-prev" id="md-prev" readonly aria-label="Markdown preview"></textarea><p class="small muted" id="md-prev-note"></p>')}`;
    const md = fullReportMd();
    const LIMIT = 150000;
    $('#md-prev').value = md.length > LIMIT ? md.slice(0, LIMIT) + '\n\n…' : md;
    $('#md-prev-note').textContent = md.length > LIMIT ? `Preview shows the first ${fmt(LIMIT)} of ${fmt(md.length)} characters. Copy or download for the full report.` : '';

    $('#print-btn').addEventListener('click', () => window.print());
    $$('#pi-export [data-dl]').forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.dl;
      const csv = 'text/csv;charset=utf-8';
      if (k === 'main-md') download(`${name}-content.md`, contentMd(mainBlocks), 'text/markdown;charset=utf-8');
      if (k === 'full-md') download(`${name}-seo-report.md`, fullReportMd(), 'text/markdown;charset=utf-8');
      if (k === 'json') download(`${name}-report.json`, jsonReport(), 'application/json');
      if (k === 'links') download(`${name}-links.csv`, linksCsv(R.links.items), csv);
      if (k === 'images') b.closest('section') && $('#i-csv').click();
      if (k === 'headings') download(`${name}-headings.csv`, toCsv(['order', 'level', 'text', 'characters', 'section', 'hidden', 'flags'], R.headings.map((h, i) => [i + 1, 'H' + h.level, h.text, h.length, REGION_LABEL[h.region], h.hidden, h.flags.join('; ')])), csv);
      if (k === 'meta') download(`${name}-meta.csv`, toCsv(['attribute', 'key', 'content', 'location'], R.head.metas.map((m) => [m.kind, m.key, m.content, m.inHead ? 'head' : 'body'])), csv);
      if (k === 'content') download(`${name}-content.csv`, toCsv(['order', 'section', 'type', 'level_or_tag', 'text', 'hidden'], R.content.blocks.map((b, i) => [i + 1, REGION_LABEL[b.region], b.type, b.type === 'heading' ? 'H' + b.level : (b.tag || ''), b.type === 'image' ? `${b.src} | alt: ${b.alt ?? '(missing)'}` : Extractor.blockText(b), b.hidden || ''])), csv);
    }));
  }

  /* ---------------------------------------------------------------------
     AI PROMPT (per page)
     --------------------------------------------------------------------- */
  const opt = (obj, sel) => Object.entries(obj).map(([k, v]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${E(v)}</option>`).join('');

  function similarTo(id) {
    if (S.pages.length < 2) return [];
    const B = getBulk();
    return B.sim.pairs.filter((p) => (p.a === id || p.b === id) && p.template >= 40).map((p) => {
      const other = p.a === id ? p.b : p.a;
      const it = B.items.find((x) => x.page.id === other);
      return { id: other, title: pageLabel(other, 90), url: it ? Bulk.pageUrl(it) : '', template: p.template };
    });
  }

  function renderAiPrompt() {
    const a = ui.ai;
    const kwDefault = Bulk.primaryPhrase(R) || (R.keywords.two[0] || {}).phrase || '';
    $('#pi-aiprompt').innerHTML = `
      ${section('AI prompt / content brief', `
        <p class="small muted">Builds a ready-to-paste prompt with this page's data (meta, outline, issues, content). Paste it into Claude or another AI tool.</p>
        <div class="ai-form">
          <label class="field">What do you want? <select id="ai-goal">${opt(Prompts.PAGE_GOALS, a.goal)}</select></label>
          <label class="field">Target keyword <input type="text" id="ai-kw" dir="auto" value="${E(a.keyword)}" placeholder="${E(kwDefault)}"></label>
          <label class="field">Output language <select id="ai-lang">${opt(Prompts.LANGS, a.lang)}</select></label>
          <label class="check"><input type="checkbox" id="ai-content" ${a.includeContent ? 'checked' : ''}> Include the page's full main content</label>
        </div>
        <p class="small note" id="ai-note" hidden></p>
        <textarea class="md-prev ai-out" id="ai-out" readonly aria-label="Generated prompt" dir="auto"></textarea>
        <div class="btn-row">${copyBtn('Copy prompt', () => $('#ai-out').value, 'Copy AI prompt')}
          <button type="button" class="btn sm" id="ai-dl">Download .md</button><span class="small muted" id="ai-count"></span></div>`)}`;
    const build = () => {
      a.goal = $('#ai-goal').value; a.keyword = $('#ai-kw').value.trim(); a.lang = $('#ai-lang').value; a.includeContent = $('#ai-content').checked;
      const similar = a.goal === 'unique' ? similarTo(P.id) : [];
      const note = $('#ai-note');
      note.hidden = a.goal !== 'unique';
      note.textContent = similar.length ? `Includes ${similar.length} similar page(s) from this project.` : 'No similar pages found in this project yet. Add the other location/service pages to make this prompt more specific.';
      const text = Prompts.pagePrompt(P, R, { goal: a.goal, keyword: a.keyword || kwDefault, lang: a.lang, includeContent: a.includeContent, similar });
      $('#ai-out').value = text;
      $('#ai-count').textContent = `${fmt(text.length)} characters`;
    };
    ['#ai-goal', '#ai-lang', '#ai-content'].forEach((s) => $(s).addEventListener('change', build));
    $('#ai-kw').addEventListener('input', build);
    $('#ai-dl').addEventListener('click', () => download(`${slugName()}-prompt-${a.goal}.md`, $('#ai-out').value, 'text/markdown;charset=utf-8'));
    build();
  }

  /* =====================================================================
     ALL PAGES (cross-page analysis)
     ===================================================================== */
  const pct = (v, warn, bad) => `<span class="pct ${v >= bad ? 'p-bad' : v >= warn ? 'p-warn' : 'p-ok'}">${v}%</span>`;

  function renderBulk() {
    const B = getBulk();
    $('#bulk-project-name').textContent = S.project.name;
    const words = B.rows.reduce((n, r) => n + r.words, 0);
    $('#bulk-meta').textContent = `${B.rows.length} pages · ${fmt(words)} words of main content · ${B.links.edges} internal links between them`;
    const dupCount = B.dups.titles.length + B.dups.descriptions.length + B.dups.h1s.length + B.dups.cannibal.filter((c) => c.level === 'high').length;
    const nearDup = B.sim.pairs.filter((p) => p.template >= 80).length;
    const orphans = B.links.nodes.filter((n) => n.orphan).length;
    const setCount = (id, n, bad) => { const el = $(id); el.textContent = n || ''; el.className = 'tcount' + (n && bad ? ' t-warn' : ''); };
    setCount('#btc-dups', dupCount, true); setCount('#btc-sim', nearDup, true); setCount('#btc-links', orphans, true);
    renderCompare(B); renderDups(B); renderSim(B); renderLinkMap(B); renderBulkAi(B);
    renderSidebar();
  }

  /* ---------- comparison (sortable table) ---------- */
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  function sortableTable(id, caption, cols, rows, rowAttrs = () => '') {
    return `<div class="scroll-x" role="region" aria-labelledby="${id}-cap" tabindex="0"><table class="data sortable" id="${id}">
      <caption id="${id}-cap" class="visually-hidden">${E(caption)}</caption>
      <thead><tr>${cols.map((c) => `<th scope="col" data-type="${c.type || 'text'}">${c.sort === false ? E(c.label) : `<button type="button" class="th-sort">${E(c.label)}<span class="sort-ico" aria-hidden="true"></span></button>`}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((r) => `<tr ${rowAttrs(r)}>${cols.map((c) => `<td data-value="${E(c.value ? c.value(r) : '')}" ${c.cls ? `class="${c.cls}"` : ''}>${c.html(r)}</td>`).join('')}</tr>`).join('')}</tbody>
    </table></div><span class="visually-hidden" role="status" id="${id}-status"></span>`;
  }
  // header buttons sort by moving the existing rows
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('table.sortable th > button.th-sort');
    if (!btn) return;
    const th = btn.closest('th'), table = th.closest('table'), tbody = table.tBodies[0];
    const dir = th.getAttribute('aria-sort') === 'ascending' ? 'descending' : 'ascending';
    for (const h of table.tHead.rows[0].cells) h.removeAttribute('aria-sort');
    th.setAttribute('aria-sort', dir);
    const idx = th.cellIndex, num = th.dataset.type === 'number', f = dir === 'ascending' ? 1 : -1;
    const rows = [...tbody.rows].map((r) => ({ r, v: r.cells[idx].dataset.value }));
    rows.sort((a, b) => f * (num ? (parseFloat(a.v) || 0) - (parseFloat(b.v) || 0) : collator.compare(a.v, b.v)));
    for (const { r } of rows) (tbody.moveBefore ? tbody.moveBefore(r, null) : tbody.append(r));
    const st = document.getElementById(table.id + '-status');
    if (st) st.textContent = `Sorted by ${btn.textContent.trim()}, ${dir}`;
  });

  function renderCompare(B) {
    const lenCell = (len, lo, hi) => `<span class="${!len ? 'p-bad' : len < lo || len > hi ? 'p-warn' : ''}">${len || '—'}</span>`;
    const cols = [
      { label: '#', type: 'number', value: (r) => r.n, html: (r) => `<span class="pnum">${r.n}</span>` },
      { label: 'Page', value: (r) => r.title || r.path, cls: 'cmp-page', html: (r) => `<button type="button" class="linklike" data-open-page="${r.id}" dir="auto">${E(r.title || '(no title)')}</button><div class="small muted break" dir="auto">${E(r.path || 'no URL')}</div>` },
      { label: 'Title chars', type: 'number', value: (r) => r.titleLen, html: (r) => lenCell(r.titleLen, 30, 60) },
      { label: 'Meta desc chars', type: 'number', value: (r) => r.descLen, html: (r) => lenCell(r.descLen, 70, 160) },
      { label: 'H1', value: (r) => r.h1, cls: 'cmp-h1', html: (r) => (r.h1Count === 1 ? `<span dir="auto">${E(r.h1)}</span>` : `<span class="p-${r.h1Count ? 'warn' : 'bad'}">${r.h1Count} H1</span>${r.h1 ? `<div class="small" dir="auto">${E(r.h1)}</div>` : ''}`) },
      { label: 'Words', type: 'number', value: (r) => r.words, html: (r) => `<span class="${r.words < 300 ? 'p-warn' : ''}">${fmt(r.words)}</span>` },
      { label: 'H2s', type: 'number', value: (r) => r.h2Count, html: (r) => r.h2Count },
      { label: 'Images', type: 'number', value: (r) => r.images, html: (r) => `${r.images}${r.missingAlt ? ` <span class="p-warn small">(${r.missingAlt} no alt)</span>` : ''}` },
      { label: 'Internal links', type: 'number', value: (r) => r.internal, html: (r) => r.internal },
      { label: 'External links', type: 'number', value: (r) => r.external, html: (r) => r.external },
      { label: 'Schema', value: (r) => r.schema.join(', '), cls: 'cmp-schema', html: (r) => (r.schema.length ? r.schema.map((t) => chip(t, 'type')).join('') : '<span class="p-warn">none</span>') },
      { label: 'Indexable', value: (r) => (r.indexable ? 'yes' : 'no'), html: (r) => (r.indexable ? '<span class="p-ok">yes</span>' : '<span class="p-bad">NOINDEX</span>') },
      { label: 'Canonical', value: (r) => r.canonState, html: (r) => `<span class="${r.canonState === 'self' ? 'p-ok' : r.canonState === 'missing' ? 'p-warn' : 'p-bad'}">${E(r.canonState)}</span>` },
      { label: 'Max similarity', type: 'number', value: (r) => B.sim.max[r.id] || 0, html: (r) => (B.sim.max[r.id] !== undefined ? pct(B.sim.max[r.id], 50, 80) : '—') },
      { label: 'Errors', type: 'number', value: (r) => r.errors, html: (r) => `<span class="${r.errors ? 'p-bad' : 'p-ok'}">${r.errors}</span>` },
      { label: 'Warnings', type: 'number', value: (r) => r.warnings, html: (r) => `<span class="${r.warnings ? 'p-warn' : 'p-ok'}">${r.warnings}</span>` },
    ];
    const csv = () => toCsv(['#', 'url', 'title', 'title_chars', 'meta_description', 'description_chars', 'h1', 'h1_count', 'words_main', 'h2_count', 'images', 'images_missing_alt', 'internal_links', 'external_links', 'schema_types', 'indexable', 'canonical', 'max_similarity_pct', 'errors', 'warnings'],
      B.rows.map((r) => [r.n, r.url, r.title, r.titleLen, r.desc, r.descLen, r.h1, r.h1Count, r.words, r.h2Count, r.images, r.missingAlt, r.internal, r.external, r.schema.join('; '), r.indexable ? 'yes' : 'no', r.canonState, B.sim.max[r.id] ?? '', r.errors, r.warnings]));
    $('#bpi-compare').innerHTML = section('Side-by-side comparison', `
      <div class="toolbar"><p class="small muted grow">Click a column name to sort. Click a page to open its full report. Amber = worth checking, red = problem.</p>
        <div class="btn-row">${copyBtn('Copy table', () => csv().slice(1).replace(/,/g, '\t'))}<button type="button" class="btn sm" id="cmp-csv">Download CSV</button></div></div>
      ${sortableTable('cmp-table', 'All pages compared', cols, B.rows)}`);
    $('#cmp-csv').addEventListener('click', () => download(`${S.project.name.replace(/[^\p{L}\p{N}]+/gu, '-')}-comparison.csv`, csv(), 'text/csv;charset=utf-8'));
  }

  /* ---------- duplicates & cannibalization ---------- */
  function renderDups(B) {
    const D = B.dups;
    const groupList = (groups, what) => groups.length ? `<div class="dup-groups">${groups.map((g) => `<div class="dup-g">
        <div class="dup-v" dir="auto">“${E(g.value)}”</div><div class="small muted">${g.ids.length} pages share this ${what}:</div>
        <ul class="plain">${g.ids.map((id) => `<li>${pageLink(id)}</li>`).join('')}</ul></div>`).join('')}</div>` : `<p class="ok-line">${sevBadge('pass')} No duplicate ${what}s.</p>`;
    const missing = [['title tag', D.missing.title], ['meta description', D.missing.description], ['H1', D.missing.h1], ['URL (needed for link map)', D.missing.url]].filter(([, ids]) => ids.length);
    const words = (arr) => arr.length ? arr.map((w) => `<span class="w" dir="auto">${E(w)}</span>`).join(' ') : '<span class="muted">—</span>';
    $('#bpi-dups').innerHTML = `
      <div class="stats small-stats">
        ${[['Duplicate titles', D.titles.length], ['Duplicate descriptions', D.descriptions.length], ['Duplicate H1s', D.h1s.length], ['Shared canonicals', D.canonicals.length],
          ['High-risk overlaps', D.cannibal.filter((c) => c.level === 'high').length], ['Overlaps to check', D.cannibal.filter((c) => c.level === 'medium').length]]
          .map(([l, v]) => `<div class="stat ${v ? 'st-warn' : ''}"><span class="stat-v">${v}</span><span class="stat-l">${l}</span></div>`).join('')}
      </div>
      ${section('Duplicate title tags', groupList(D.titles, 'title'))}
      ${section('Duplicate meta descriptions', groupList(D.descriptions, 'description'))}
      ${section('Duplicate H1 headings', groupList(D.h1s, 'H1'))}
      ${D.canonicals.length ? section('Pages with the same canonical URL', `<p class="small muted">Only one of these pages can be indexed; the others tell Google to use the canonical instead.</p>${groupList(D.canonicals, 'canonical')}`) : ''}
      ${missing.length ? section('Missing elements', missing.map(([what, ids]) => `<div class="miss-row"><b>No ${what}:</b> ${ids.map(pageLink).join(' ')}</div>`).join('')) : ''}
      ${section('Keyword cannibalization check', `
        <p class="small muted">Compares the important words in each page's title + H1. <b>High</b> = same main phrase, or one page's target words are all inside the other's (they likely compete). <b>Check</b> = very similar targets that still differ by a word or two, such as Dubai vs Sharjah: usually fine if the body content is unique, so check the near-duplicate tab.</p>
        ${D.cannibal.length ? `<div class="scroll-x"><table class="data cannibal"><thead><tr><th>Risk</th><th>Page A</th><th>Page B</th><th>Overlap</th><th>Shared words</th><th>Only in A</th><th>Only in B</th></tr></thead><tbody>
        ${D.cannibal.map((c) => `<tr><td>${chip(c.level === 'high' ? 'High' : 'Check', c.level === 'high' ? 'bad' : 'warn')}${c.samePrimary ? `<div class="small muted" dir="auto">same phrase: “${E(c.samePrimary)}”</div>` : c.level === 'high' ? '<div class="small muted">one target contains the other</div>' : '<div class="small muted">differ only by the words on the right</div>'}</td>
          <td>${pageLink(c.a)}</td><td>${pageLink(c.b)}</td><td>${c.score}%</td><td>${words(c.shared)}</td><td>${words(c.onlyA)}</td><td>${words(c.onlyB)}</td></tr>`).join('')}
        </tbody></table></div>` : `<p class="ok-line">${sevBadge('pass')} No pages with strongly overlapping title + H1 targets.</p>`}
        <h3 class="mt">Main phrase per page <span class="small muted">(longest phrase used in both title and H1)</span></h3>
        <ul class="plain">${B.items.map((it) => `<li>${pageLink(it.page.id)} → ${D.primaries[it.page.id] ? `<b dir="auto">${E(D.primaries[it.page.id])}</b>` : '<span class="muted">no shared phrase between title and H1</span>'}</li>`).join('')}</ul>`)}`;
  }

  /* ---------- near-duplicate content ---------- */
  function renderSim(B) {
    const pairs = B.sim.pairs;
    const ids = B.items.map((it) => it.page.id);
    const f = ui.bulk.simMin;
    const shown = pairs.filter((p) => p.template >= f);
    const lookup = new Map(pairs.map((p) => [p.a + '|' + p.b, p]));
    const get = (a, b) => lookup.get(a + '|' + b) || lookup.get(b + '|' + a);
    const heat = (v) => `background: color-mix(in srgb, var(--err) ${Math.round(v * 0.9)}%, var(--surface-2))`;
    const matrix = ids.length >= 2 && ids.length <= 25 ? `<div class="scroll-x"><table class="matrix"><thead><tr><th></th>${ids.map((id) => `<th scope="col" title="${E(pageLabel(id))}">${pageNum(id)}</th>`).join('')}</tr></thead><tbody>
      ${ids.map((a) => `<tr><th scope="row" title="${E(pageLabel(a))}">${pageNum(a)}</th>${ids.map((b) => {
        if (a === b) return '<td class="m-self">—</td>';
        const p = get(a, b);
        return `<td style="${heat(p.template)}" title="${E(pageLabel(a, 40))} ↔ ${E(pageLabel(b, 40))}: ${p.template}%">${p.template}</td>`;
      }).join('')}</tr>`).join('')}</tbody></table></div>
      <ul class="plain matrix-key small">${ids.map((id) => `<li>${pageLink(id)}</li>`).join('')}</ul>` : '';
    $('#bpi-sim').innerHTML = `
      ${section('How similar is the body content?', `
        <p class="small muted">Compares the <b>main content only</b> (header, menu, sidebar and footer are ignored, so shared navigation doesn't count). <b>Template similarity</b> hides the words that make each page different in its title, H1 and URL (usually the city or service), which catches location pages that are the same text with the city name swapped. Above 80% = near-duplicate; 50–80% = heavily templated.</p>
        ${pairs.length ? matrix : empty('Add at least 2 pages to compare their content.')}`)}
      ${pairs.length ? section('Page pairs', `
        <div class="toolbar"><div class="seg" role="group" aria-label="Minimum similarity">${[[0, 'All pairs'], [50, '50% and up'], [80, '80% and up']].map(([v, l]) => `<button type="button" class="seg-btn" data-simmin="${v}" aria-pressed="${f === v}">${l} <span class="muted">${pairs.filter((p) => p.template >= v).length}</span></button>`).join('')}</div></div>
        ${shown.length ? `<div class="pairs">${shown.slice(0, 300).map((p) => `<div class="pair">
          <div class="pair-pages">${pageLink(p.a)}<span class="muted">↔</span>${pageLink(p.b)}</div>
          <div class="pair-stats"><span class="small muted">Template</span> ${pct(p.template, 50, 80)}<div class="bar"><span style="width:${p.template}%"></span></div>
            <span class="small muted">Raw ${p.raw}% · ${p.sharedSentences.length} identical sentence${p.sharedSentences.length === 1 ? '' : 's'} · ${p.templatedSentences.length} identical apart from the hidden words (of ${Math.min(p.sentA, p.sentB)})</span></div>
          ${p.masked.length ? `<div class="small muted">Words hidden for template match: ${p.masked.map((w) => `<span class="w" dir="auto">${E(w)}</span>`).join(' ')}</div>` : ''}
          ${p.templatedSentences.length ? `<details><summary class="small">Show repeated sentences</summary><ul class="shared-s">${p.templatedSentences.slice(0, 40).map((s) => `<li dir="auto">${E(s)}</li>`).join('')}</ul></details>` : ''}
        </div>`).join('')}</div>` : empty('No pairs at this level.')}`) : ''}`;
    $$('#bpi-sim [data-simmin]').forEach((b) => b.addEventListener('click', () => { ui.bulk.simMin = +b.dataset.simmin; renderSim(B); }));
  }

  /* ---------- internal link map ---------- */
  function renderLinkMap(B) {
    const L = B.links;
    const nodes = L.nodes;
    const noUrl = nodes.filter((n) => !n.key);
    const status = (n) => !n.key ? chip('no URL', 'warn') : n.orphan ? chip('orphan', 'bad') : n.contentOrphan ? chip('nav/footer links only', 'warn') : chip('linked', 'ok');
    const matrix = nodes.length >= 2 && nodes.length <= 20 ? section('Link matrix', `<p class="small muted">Rows link to columns. Numbers are link counts (all sections).</p>
      <div class="scroll-x"><table class="matrix"><thead><tr><th>from \\ to</th>${nodes.map((n) => `<th scope="col" title="${E(pageLabel(n.id))}">${pageNum(n.id)}</th>`).join('')}</tr></thead><tbody>
      ${nodes.map((a) => `<tr><th scope="row" title="${E(pageLabel(a.id))}">${pageNum(a.id)}</th>${nodes.map((b) => {
        if (a.id === b.id) return '<td class="m-self">—</td>';
        const c = a.outgoing.filter((e) => e.to === b.id).length;
        return `<td class="${c ? 'm-link' : ''}">${c || ''}</td>`;
      }).join('')}</tr>`).join('')}</tbody></table></div>`) : '';
    const cols = [
      { label: '#', type: 'number', value: (n) => pageNum(n.id), html: (n) => `<span class="pnum">${pageNum(n.id)}</span>` },
      { label: 'Page', value: (n) => pageLabel(n.id), cls: 'cmp-page', html: (n) => `<button type="button" class="linklike" data-open-page="${n.id}" dir="auto">${E(pageLabel(n.id))}</button><div class="small muted" dir="auto">${E(Bulk.shortUrl(n.url) || 'no URL')}</div>` },
      { label: 'Linked from (pages)', type: 'number', value: (n) => n.inPages, html: (n) => n.inPages },
      { label: 'Links in body content', type: 'number', value: (n) => n.inContent, html: (n) => `<span class="${n.key && !n.inContent ? 'p-warn' : ''}">${n.inContent}</span>` },
      { label: 'Links in menu/footer', type: 'number', value: (n) => n.inNav, html: (n) => n.inNav },
      { label: 'Links out to (pages)', type: 'number', value: (n) => n.outPages, html: (n) => n.outPages },
      { label: 'Anchor texts used', sort: false, cls: 'cmp-anch', html: (n) => n.anchors.slice(0, 6).map(([a, c]) => `<span class="w" dir="auto">${E(a)}${c > 1 ? ` ×${c}` : ''}</span>`).join(' ') || '<span class="muted">—</span>' },
      { label: 'Status', value: (n) => (!n.key ? 'no url' : n.orphan ? 'orphan' : n.contentOrphan ? 'nav' : 'linked'), html: status },
    ];
    $('#bpi-links').innerHTML = `
      <div class="stats small-stats">
        ${[['Pages', nodes.length], ['Links between them', L.edges], ['Orphans (no links in)', nodes.filter((n) => n.orphan).length], ['No body-content links in', nodes.filter((n) => n.contentOrphan).length], ['Pages without URL', noUrl.length]]
          .map(([l, v], i) => `<div class="stat ${i >= 2 && v ? 'st-warn' : ''}"><span class="stat-v">${v}</span><span class="stat-l">${l}</span></div>`).join('')}
      </div>
      ${noUrl.length ? `<p class="note small">${noUrl.length} page(s) have no URL, so links to them can't be matched. Open the page → Replace HTML → enter its URL. Pages with a canonical tag are matched automatically.</p>` : ''}
      ${section('Links between the pages in this project', `<p class="small muted">Only links between pages you have added are counted. "Orphan" means no other page in this project links to it. Links inside body content pass more context than menu/footer links.</p>${sortableTable('lm-table', 'Internal links per page', cols, nodes)}`)}
      ${matrix}
      ${L.unknown.length ? section('Most-linked internal URLs not in this project', `<p class="small muted">Add these pages too for a complete link map.</p><div class="scroll-x"><table class="data"><thead><tr><th>URL</th><th>Links</th><th>From pages</th><th>Anchors</th></tr></thead><tbody>
        ${L.unknown.map((u) => `<tr><td>${linkOut(u.url, decodeURIsafe(u.url))}</td><td>${u.count}</td><td>${u.from.map((id) => `<span class="pnum" title="${E(pageLabel(id))}">${pageNum(id)}</span>`).join(' ')}</td><td class="small" dir="auto">${E(u.anchors.join(' · '))}</td></tr>`).join('')}
        </tbody></table></div>`) : ''}`;
  }
  const decodeURIsafe = (u) => { try { return decodeURI(u); } catch { return u; } };

  /* ---------- project AI prompts ---------- */
  function renderBulkAi(B) {
    const a = ui.bulkAi;
    $('#bpi-ai').innerHTML = section('AI prompt for all pages', `
      <p class="small muted">Builds one prompt with the data of every page in this project. Paste it into Claude.</p>
      <div class="ai-form">
        <label class="field">What do you want? <select id="bai-goal">${opt(Prompts.PROJECT_GOALS, a.goal)}</select></label>
        <label class="field">Output language <select id="bai-lang">${opt(Prompts.LANGS, a.lang)}</select></label>
      </div>
      <textarea class="md-prev ai-out" id="bai-out" readonly aria-label="Generated project prompt" dir="auto"></textarea>
      <div class="btn-row">${copyBtn('Copy prompt', () => $('#bai-out').value, 'Copy project AI prompt')}
        <button type="button" class="btn sm" id="bai-dl">Download .md</button><span class="small muted" id="bai-count"></span></div>`);
    const build = () => {
      a.goal = $('#bai-goal').value; a.lang = $('#bai-lang').value;
      const t = Prompts.projectPrompt(B, a, labelOf);
      $('#bai-out').value = t; $('#bai-count').textContent = `${fmt(t.length)} characters`;
    };
    ['#bai-goal', '#bai-lang'].forEach((s) => $(s).addEventListener('change', build));
    $('#bai-dl').addEventListener('click', () => download(`${S.project.name.replace(/[^\p{L}\p{N}]+/gu, '-')}-prompt-${a.goal}.md`, $('#bai-out').value, 'text/markdown;charset=utf-8'));
    build();
  }

  /* ---------------------------------------------------------------------
     Start
     --------------------------------------------------------------------- */
  (async () => {
    await Store.init();
    storageNote();
    await loadProjects();
  })();
})();
