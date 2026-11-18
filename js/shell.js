/* =========================================================================
   HTML Content Extractor: app shell (display settings, menus, sidebar).
   Presentation only. It never touches projects, pages, reports or storage
   of page data. Display preferences live in localStorage ("hce:*" keys).
   ========================================================================= */
'use strict';

(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const root = document.documentElement;
  const meta = $('meta[name="color-scheme"]');
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage blocked: setting still applies for this session */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
  };

  /* ---------- theme: System / Light / Dark ---------- */
  const dark = matchMedia('(prefers-color-scheme: dark)');
  function applyScheme(value) { // value: 'system' | 'light' | 'dark'
    meta.content = value === 'system' ? 'light dark' : value;
    const r = $(`input[name="scheme"][value="${value}"]`); if (r) r.checked = true;
    schemeHint();
  }
  function schemeHint() {
    const el = $('#scheme-now'); if (!el) return;
    const saved = store.get('hce:scheme');
    el.textContent = saved === 'light' || saved === 'dark' ? '' : `System is currently ${dark.matches ? 'dark' : 'light'}.`;
  }
  const savedScheme = store.get('hce:scheme');
  applyScheme(savedScheme === 'light' || savedScheme === 'dark' ? savedScheme : 'system');
  dark.addEventListener('change', schemeHint);
  $$('input[name="scheme"]').forEach((r) => r.addEventListener('change', () => {
    if (r.value === 'system') store.del('hce:scheme'); else store.set('hce:scheme', r.value);
    applyScheme(r.value);
  }));

  /* ---------- density ---------- */
  function applyDensity(value) {
    if (value === 'compact') root.dataset.density = 'compact'; else delete root.dataset.density;
    const r = $(`input[name="density"][value="${value}"]`); if (r) r.checked = true;
  }
  applyDensity(store.get('hce:density') === 'compact' ? 'compact' : 'comfortable');
  $$('input[name="density"]').forEach((r) => r.addEventListener('change', () => {
    if (r.value === 'compact') store.set('hce:density', 'compact'); else store.del('hce:density');
    applyDensity(r.value);
  }));

  /* ---------- sidebar collapse ---------- */
  const toggle = $('#side-toggle');
  function applySide(collapsed) {
    if (collapsed) root.dataset.side = 'collapsed'; else delete root.dataset.side;
    toggle.setAttribute('aria-expanded', String(!collapsed));
    const label = collapsed ? 'Expand pages sidebar' : 'Collapse pages sidebar';
    toggle.setAttribute('aria-label', label); toggle.title = label;
  }
  applySide(store.get('hce:side') === 'collapsed');
  toggle.addEventListener('click', () => {
    const collapsed = root.dataset.side !== 'collapsed';
    if (collapsed) store.set('hce:side', 'collapsed'); else store.del('hce:side');
    applySide(collapsed);
  });

  /* keep settings in sync across browser tabs */
  addEventListener('storage', (e) => {
    if (e.key === 'hce:scheme') { const v = e.newValue === 'light' || e.newValue === 'dark' ? e.newValue : 'system'; applyScheme(v); }
    if (e.key === 'hce:density') applyDensity(e.newValue === 'compact' ? 'compact' : 'comfortable');
    if (e.key === 'hce:side') applySide(e.newValue === 'collapsed');
  });

  /* ---------- popover menus: position under the button, close after an action ---------- */
  $$('[popover].menu').forEach((menu) => {
    const btn = $(`[popovertarget="${menu.id}"]`);
    menu.addEventListener('toggle', (e) => {
      if (e.newState !== 'open' || !btn) return;
      const r = btn.getBoundingClientRect();
      const w = menu.offsetWidth;
      menu.style.top = `${Math.round(r.bottom + 6)}px`;
      menu.style.left = `${Math.round(Math.max(8, Math.min(r.right - w, innerWidth - w - 8)))}px`;
      const first = $('button, input:checked, label.menu-item', menu); if (first) first.focus({ preventScroll: true });
    });
    // buttons close the menu once their own handler ran; the import label closes after a file is chosen
    menu.addEventListener('click', (e) => { if (e.target.closest('button.menu-item')) menu.hidePopover(); });
    menu.addEventListener('change', (e) => { if (e.target.type === 'file') menu.hidePopover(); });
  });

  /* ---------- small helpers ---------- */
  // <button data-click="#id"> forwards a click to another control (used by the first-run callout)
  document.addEventListener('click', (e) => { const b = e.target.closest('[data-click]'); if (b) { const t = $(b.dataset.click); if (t) t.click(); } });

  // first-run state: flag the page when the project has no pages, so the add panel can show a hint
  const count = $('#page-count');
  const flagEmpty = () => { root.dataset.empty = String(count.textContent.trim() === '0'); };
  new MutationObserver(flagEmpty).observe(count, { childList: true, characterData: true, subtree: true });
  flagEmpty();

  // the report rail is vertical on wide screens and a horizontal strip on narrower ones
  const narrow = matchMedia('(max-width: 1199px)');
  const orient = () => $('#tablist').setAttribute('aria-orientation', narrow.matches ? 'horizontal' : 'vertical');
  narrow.addEventListener('change', orient); orient();
})();
