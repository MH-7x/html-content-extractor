// Golden-master capture. Drives the real app (file://) in Edge and records everything
// data-bearing: exports, CSVs, prompts, table contents, counts, project actions.
//   node golden.mjs --root <app folder> --label <name>   -> tests/golden/<name> (baseline) or tests/out/<name>
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > -1 ? process.argv[i + 1] : d; };
const root = path.resolve(arg('root', path.join(here, '..')));
const label = arg('label', 'run');
const outDir = path.join(here, label === 'baseline' ? 'golden' : 'out', label);
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(path.join(outDir, 'files'), { recursive: true });

const F = { hooks: {}, steps: {}, problems: [], console: [] };
const slug = (s) => s.replace(/[^\w.-]+/g, '_');
// strip run-specific values (timestamps) so two runs can be compared byte for byte
const norm = (t) => String(t)
  .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g, '<ISO>')
  .replace(/(\*\*Generated:\*\*) .*/g, '$1 <DATE>')
  .replace(/added \d{1,2}\/\d{1,2}\/\d{2,4}/g, 'added <DATE>')
  .replace(/"(added|updated|order|created|parseMs)":\s*\d+/g, '"$1": <N>');
const put = (name, text) => fs.writeFileSync(path.join(outDir, 'files', slug(name)), norm(text), 'utf8');

const CONTRACT = ['#project-select', '#proj-new', '#proj-rename', '#proj-backup', '#proj-import', '#proj-delete', '#side-add', '#side-all', '#page-count', '#page-filter', '#page-list',
  '#storage-note', '#input-section', '#input-title', '#page-url', '#html-input', '#drop', '#analyze-btn', '#add-next-btn', '#file-input', '#sample-btn', '#clear-btn', '#cancel-edit-btn',
  '#input-size', '#input-error', '#summary-bar', '#sb-title', '#sb-meta', '#prev-btn', '#pos-label', '#next-btn', '#edit-btn', '#remove-btn', '#report', '#tablist',
  ...['overview', 'meta', 'schema', 'headings', 'content', 'links', 'images', 'keywords', 'technical', 'aiprompt', 'export'].flatMap((n) => [`#tab-${n}`, `#panel-${n}`, `#pi-${n}`]),
  '#tc-overview', '#tc-schema', '#tc-headings', '#tc-content', '#tc-links', '#tc-images',
  '#bulk', '#bulk-tablist', '#bulk-project-name', '#bulk-meta',
  ...['compare', 'dups', 'sim', 'links', 'ai'].flatMap((n) => [`#btab-${n}`, `#bpanel-${n}`, `#bpi-${n}`]), '#btc-dups', '#btc-sim', '#btc-links',
  '#dlg', '#dlg-title', '#dlg-msg', '#dlg-field', '#dlg-label', '#dlg-input', '#dlg-ok', '#dlg-cancel', '#toast'];
const TABS = ['overview', 'meta', 'schema', 'headings', 'content', 'links', 'images', 'keywords', 'technical', 'aiprompt', 'export'];
const BTABS = ['compare', 'dups', 'sim', 'links', 'ai'];

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 900 }, locale: 'en-US' });
try { await ctx.grantPermissions(['clipboard-read', 'clipboard-write']); } catch (e) { F.problems.push('clipboard permission: ' + e.message); }
const page = await ctx.newPage();
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) F.console.push(`${m.type()}: ${m.text()}`); });
page.on('pageerror', (e) => F.console.push('pageerror: ' + e.message));

const step = async (name, fn) => { try { F.steps[name] = await fn(); } catch (e) { F.problems.push(`${name}: ${e.message.split('\n')[0]}`); } };
const txt = (sel) => page.$$eval(sel, (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
const count = (sel) => page.locator(sel).count();
// project actions may live in an overflow menu in the redesign: open it when needed
async function act(sel) {
  const loc = page.locator(sel);
  if (!(await loc.isVisible())) { const m = page.locator('#proj-menu-btn'); if (await m.count()) await m.click(); }
  await loc.click();
}
async function download(clickFn) {
  const [d] = await Promise.all([page.waitForEvent('download', { timeout: 8000 }), clickFn()]);
  const tmp = path.join(outDir, '_dl'); await d.saveAs(tmp);
  const text = fs.readFileSync(tmp, 'utf8'); fs.rmSync(tmp);
  return { name: d.suggestedFilename(), text };
}
const readClipboard = () => page.evaluate(() => navigator.clipboard.readText());
async function copyAll(prefix, scope) {
  const btns = page.locator(`${scope} [data-copy]`); const n = await btns.count(); const out = [];
  for (let i = 0; i < n; i++) {
    const b = btns.nth(i); const label = (await b.getAttribute('aria-label')) || (await b.textContent());
    await b.scrollIntoViewIfNeeded(); await b.click();
    await page.waitForTimeout(60);
    let text; try { text = await readClipboard(); } catch (e) { text = '<clipboard unreadable>'; }
    const tip = await b.evaluate((el) => el.nextElementSibling && el.nextElementSibling.textContent.trim());
    out.push({ label: label.trim(), tip });
    put(`${prefix}__copy_${i}_${label.trim()}`, text);
  }
  return out;
}
const tab = (n) => page.locator(`#tab-${n}`).click();
const btab = (n) => page.locator(`#btab-${n}`).click();

// ---------------------------------------------------------------- load
await page.goto(pathToFileURL(path.join(root, 'index.html')).href);
await page.waitForSelector('#project-select option', { state: 'attached' });
await step('hooks', async () => { for (const s of CONTRACT) F.hooks[s] = (await count(s)) > 0; return null; });
await step('initial', async () => ({ projects: await txt('#project-select option'), addVisible: await page.locator('#input-section').isVisible(), storageNote: await txt('#storage-note'), sideEmpty: await txt('#page-list') }));

// ---------------------------------------------------------------- add-page validation + add flows (empty project)
await step('input-validation', async () => {
  const r = {};
  await page.locator('#analyze-btn').click(); r.empty = await txt('#input-error');
  await page.fill('#html-input', 'just some text'); await page.locator('#analyze-btn').click(); r.notHtml = await txt('#input-error');
  await page.fill('#html-input', '<html><head><title>T</title></head><body><h1>x</h1></body></html>'); await page.fill('#page-url', 'example.com/x'); await page.locator('#analyze-btn').click(); r.badUrl = await txt('#input-error');
  r.size = await txt('#input-size');
  await page.locator('#clear-btn').click(); r.cleared = [await page.inputValue('#html-input'), await page.inputValue('#page-url')];
  return r;
});
const SAMPLES = await page.evaluate(() => window.SAMPLE_PAGES.map((s) => ({ url: s.url, html: s.html })));
await step('add-next', async () => {
  await page.fill('#page-url', SAMPLES[0].url); await page.fill('#html-input', SAMPLES[0].html);
  await page.locator('#add-next-btn').click(); await page.waitForTimeout(200);
  return { count: await txt('#page-count'), formCleared: await page.inputValue('#html-input') === '', stillAdd: await page.locator('#input-section').isVisible(), toast: await txt('#toast') };
});
await step('add-open-shortcut', async () => {
  await page.fill('#page-url', SAMPLES[1].url); await page.fill('#html-input', SAMPLES[1].html);
  await page.locator('#html-input').press('Control+Enter'); await page.waitForSelector('#report:not([hidden])');
  return { count: await txt('#page-count'), title: await txt('#sb-title'), pos: await txt('#pos-label') };
});
await step('add-same-url-replaces', async () => {
  await page.locator('#side-add').click();
  await page.fill('#page-url', SAMPLES[1].url); await page.fill('#html-input', SAMPLES[1].html);
  await page.locator('#html-input').press('Control+Enter'); await page.waitForSelector('#report:not([hidden])');
  return { count: await txt('#page-count'), toast: await txt('#toast') };
});
await step('remove-all-then-samples', async () => {
  for (let i = 0; i < 2; i++) { await page.locator('#remove-btn').click(); await page.locator('#dlg-ok').click(); await page.waitForTimeout(150); if (!(await page.locator('#remove-btn').isVisible())) break; }
  const r = { count: await txt('#page-count'), addVisible: await page.locator('#input-section').isVisible() };
  await page.locator('#sample-btn').click(); await page.waitForSelector('#bulk:not([hidden])');
  r.afterSamples = await txt('#page-count'); r.sidebar = await page.$$eval('#page-list [data-page]', (els) => els.map((e) => ({ t: e.querySelector('.si-title').textContent.replace(/\s+/g, ' ').trim(), p: e.querySelector('.si-path').textContent.trim(), b: e.querySelector('.si-badges').textContent.replace(/\s+/g, ' ').trim() })));
  return r;
});

// ---------------------------------------------------------------- bulk views
await step('bulk-header', async () => ({ name: await txt('#bulk-project-name'), meta: await txt('#bulk-meta'), counts: await txt('#bulk-tablist .tcount') }));
await step('bulk-compare', async () => {
  await btab('compare');
  const r = { cols: await txt('#cmp-table thead th'), rows: await page.$$eval('#cmp-table tbody tr', (rs) => rs.map((tr) => [...tr.cells].map((c) => c.dataset.value)) ) };
  r.sorts = {};
  const n = await count('#cmp-table thead th .th-sort');
  for (let i = 0; i < n; i++) {
    const b = page.locator('#cmp-table thead th .th-sort').nth(i); const name = (await b.textContent()).trim();
    const order = async () => page.$$eval('#cmp-table tbody tr', (rs) => rs.map((tr) => tr.cells[0].dataset.value).join(','));
    await b.click(); const asc = await order(); await b.click(); const desc = await order();
    r.sorts[name] = [asc, desc, await page.locator('#cmp-table thead th').nth(await b.evaluate((el) => el.closest('th').cellIndex)).getAttribute('aria-sort')];
  }
  const csv = await download(() => page.locator('#cmp-csv').click()); put('bulk__comparison.csv', csv.text); r.csvName = csv.name.replace(/\d{4}-\d{2}-\d{2}/, '<D>');
  r.copy = await copyAll('bulk__compare', '#bpi-compare');
  // page link opens that page's report, then come back
  await page.locator('#cmp-table tbody tr').first().locator('[data-open-page]').click(); await page.waitForSelector('#report:not([hidden])'); r.openedPage = await txt('#sb-title');
  await page.locator('#side-all').click(); await page.waitForSelector('#bulk:not([hidden])');
  return r;
});
await step('bulk-dups', async () => { await btab('dups'); return { stats: await txt('#bpi-dups .stat'), groups: await count('#bpi-dups .dup-g'), cannibalRows: await count('#bpi-dups .cannibal tbody tr'), cannibal: await txt('#bpi-dups .cannibal tbody tr'), sections: await txt('#bpi-dups .sec-head h2') }; });
await step('bulk-sim', async () => {
  await btab('sim'); const r = { matrix: await txt('#bpi-sim .matrix td'), pairs: {} };
  for (const v of [0, 50, 80]) { await page.locator(`[data-simmin="${v}"]`).click(); r.pairs[v] = await txt('#bpi-sim .pair'); }
  await page.locator('[data-simmin="0"]').click();
  return r;
});
await step('bulk-links', async () => {
  await btab('links');
  return { stats: await txt('#bpi-links .stat'), rows: await page.$$eval('#lm-table tbody tr', (rs) => rs.map((tr) => [...tr.cells].map((c) => c.dataset.value))), matrix: await txt('#bpi-links .matrix td'), unknown: await txt('#bpi-links .sec:last-child tbody tr') };
});
await step('bulk-ai', async () => {
  await btab('ai'); const goals = await page.$$eval('#bai-goal option', (o) => o.map((x) => x.value)); const langs = await page.$$eval('#bai-lang option', (o) => o.map((x) => x.value));
  const r = { goals, langs };
  for (const g of goals) for (const l of langs) { await page.selectOption('#bai-goal', g); await page.selectOption('#bai-lang', l); put(`bulk__ai_${g}_${l}.md`, await page.inputValue('#bai-out')); }
  r.count = await txt('#bai-count');
  const dl = await download(() => page.locator('#bai-dl').click()); put('bulk__ai_download.md', dl.text); r.dlName = dl.name.replace(/\d{4}-\d{2}-\d{2}/, '<D>');
  r.copy = await copyAll('bulk__ai', '#bpi-ai');
  return r;
});

// ---------------------------------------------------------------- per-page views
const pageCount = Number(F.steps['remove-all-then-samples']?.afterSamples?.[0] || 4);
for (let p = 0; p < pageCount; p++) {
  const P = `p${p + 1}`;
  await step(`${P}-open`, async () => {
    await page.locator('#side-all').click(); await page.locator('#page-list [data-page]').nth(p).click(); await page.waitForSelector('#report:not([hidden])');
    return { title: await txt('#sb-title'), meta: (await txt('#sb-meta'))[0].replace(/added .*/, ''), pos: await txt('#pos-label'), prevDisabled: await page.locator('#prev-btn').isDisabled(), nextDisabled: await page.locator('#next-btn').isDisabled(), tcounts: await page.$$eval('#tablist .tcount', (els) => Object.fromEntries(els.map((e) => [e.id, e.textContent.trim()]))) };
  });
  await step(`${P}-overview`, async () => {
    await tab('overview'); const r = { stats: await page.$$eval('#pi-overview .stat', (els) => els.map((e) => [e.querySelector('.stat-v')?.textContent, e.querySelector('.stat-l')?.textContent, e.querySelector('.stat-s')?.textContent])), cards: await txt('#pi-overview .sev-card'), filters: {} };
    for (const k of ['all', 'error', 'warning', 'notice', 'pass']) { await page.locator(`#pi-overview .seg-btn[data-issues="${k}"]`).click(); r.filters[k] = await txt('#issue-list .issue'); }
    await page.locator('#pi-overview .seg-btn[data-issues="all"]').click();
    const g = await count('#pi-overview .stat[data-goto]'); r.gotoTiles = g;
    return r;
  });
  await step(`${P}-meta`, async () => { await tab('meta'); return { kv: await txt('#pi-meta .kv tr'), tables: await page.$$eval('#pi-meta table.data', (ts) => ts.map((t) => t.tBodies[0].rows.length)), sections: await txt('#pi-meta .sec-head h2') }; });
  await step(`${P}-schema`, async () => { await tab('schema'); return { cards: await count('#pi-schema .schema-card'), entities: await count('#pi-schema .entity'), types: await txt('#pi-schema .jtype.big'), checks: await txt('#pi-schema .checks li'), sections: await txt('#pi-schema .sec-head h2') }; });
  await step(`${P}-headings`, async () => {
    await tab('headings'); const r = { lvl: await txt('#pi-headings .lvl-c'), rows: await txt('#pi-headings .ol-row') };
    await page.locator('#h-main').check(); r.mainOnly = await txt('#pi-headings .ol-row'); await page.locator('#h-main').uncheck();
    return r;
  });
  await step(`${P}-content`, async () => {
    await tab('content'); const r = { grouped: { meta: await txt('#pi-content .content-meta'), blocks: await count('#pi-content .blk'), groups: await txt('#pi-content .rg-head h3') } };
    put(`${P}__content_grouped.txt`, (await txt('#pi-content .blk-body')).join('\n'));
    await page.locator('[data-view="order"]').click(); r.order = { meta: await txt('#pi-content .content-meta'), blocks: await count('#pi-content .blk'), dividers: await count('#pi-content .region-div') };
    put(`${P}__content_order.txt`, (await txt('#pi-content .blk-body')).join('\n'));
    for (const reg of ['header', 'nav', 'main', 'aside', 'footer']) { const cb = page.locator(`[data-region="${reg}"]`); await cb.uncheck(); r['no_' + reg] = await count('#pi-content .blk'); await cb.check(); }
    await page.locator('#c-hidden').uncheck(); r.noHidden = await count('#pi-content .blk'); await page.locator('#c-hidden').check();
    await page.locator('#c-tags').uncheck(); r.noTags = await count('#pi-content .blk-tag'); await page.locator('#c-tags').check();
    await page.locator('[data-view="grouped"]').click();
    return r;
  });
  await step(`${P}-links`, async () => {
    await tab('links'); const r = { stats: await txt('#pi-links .small-stats .stat'), types: {}, regions: {} };
    const rows = () => count('#links-table tbody tr');
    r.all = await rows(); r.allRows = await page.$$eval('#links-table tbody tr', (rs) => rs.map((tr) => [...tr.cells].slice(1).map((c) => c.textContent.replace(/\s+/g, ' ').trim()).join(' | ')));
    for (const t of await page.$$eval('#l-type option', (o) => o.map((x) => x.value))) { await page.selectOption('#l-type', t); r.types[t] = await rows(); } await page.selectOption('#l-type', 'all');
    for (const t of await page.$$eval('#l-region option', (o) => o.map((x) => x.value))) { await page.selectOption('#l-region', t); r.regions[t] = await rows(); } await page.selectOption('#l-region', 'all');
    await page.fill('#l-q', 'dubai'); r.q = await rows(); await page.fill('#l-q', '');
    await page.locator('#l-iss').check(); r.issuesOnly = await rows(); await page.locator('#l-iss').uncheck();
    r.domains = await txt('#pi-links .chips .chip');
    const csv = await download(() => page.locator('#l-csv').click()); put(`${P}__links_btn.csv`, csv.text);
    return r;
  });
  await step(`${P}-images`, async () => {
    await tab('images'); const r = { stats: await txt('#pi-images .small-stats .stat'), filters: {} };
    for (const k of await page.$$eval('#pi-images [data-imgf]', (b) => b.map((x) => x.dataset.imgf))) { await page.locator(`[data-imgf="${k}"]`).click(); r.filters[k] = await count('#img-table tbody tr'); }
    await page.locator('[data-imgf="all"]').click();
    await page.locator('#i-prev').uncheck(); r.noPrevCols = await txt('#img-table thead th'); await page.locator('#i-prev').check();
    const csv = await download(() => page.locator('#i-csv').click()); put(`${P}__images_btn.csv`, csv.text);
    return r;
  });
  await step(`${P}-keywords`, async () => {
    await tab('keywords'); const r = { grams: await txt('#pi-keywords .gram tbody tr'), stats: await txt('#pi-keywords .small-stats .stat') };
    await page.fill('#kw-in', 'movers'); await page.locator('#kw-form button[type=submit]').click(); r.check = await txt('#kw-out');
    const first = page.locator('[data-kw]').first(); await first.click(); r.clicked = [await page.inputValue('#kw-in'), await txt('#kw-out')];
    return r;
  });
  await step(`${P}-technical`, async () => { await tab('technical'); return { sections: await txt('#pi-technical .sec-head h2'), rows: await txt('#pi-technical table.data tbody tr') }; });
  await step(`${P}-aiprompt`, async () => {
    await tab('aiprompt'); const goals = await page.$$eval('#ai-goal option', (o) => o.map((x) => x.value)); const langs = await page.$$eval('#ai-lang option', (o) => o.map((x) => x.value));
    const r = { goals, langs, notes: {} };
    for (const g of goals) for (const l of langs) { await page.selectOption('#ai-goal', g); await page.selectOption('#ai-lang', l); put(`${P}__ai_${g}_${l}.md`, await page.inputValue('#ai-out')); if (g === 'unique') r.notes[l] = await txt('#ai-note'); }
    await page.selectOption('#ai-goal', 'rewrite'); await page.selectOption('#ai-lang', 'same'); await page.fill('#ai-kw', 'test keyword'); put(`${P}__ai_kw.md`, await page.inputValue('#ai-out'));
    await page.locator('#ai-content').uncheck(); put(`${P}__ai_nocontent.md`, await page.inputValue('#ai-out')); await page.locator('#ai-content').check(); await page.fill('#ai-kw', '');
    r.count = await txt('#ai-count');
    const dl = await download(() => page.locator('#ai-dl').click()); put(`${P}__ai_download.md`, dl.text); r.dlName = dl.name;
    return r;
  });
  await step(`${P}-export`, async () => {
    await tab('export'); const r = { names: {} };
    for (const k of ['main-md', 'full-md', 'json', 'links', 'images', 'headings', 'meta', 'content']) {
      const d = await download(() => page.locator(`#pi-export [data-dl="${k}"]`).click()); put(`${P}__export_${k}_${d.name}`, d.text); r.names[k] = d.name;
    }
    put(`${P}__md_preview.md`, await page.inputValue('#md-prev')); r.previewNote = await txt('#md-prev-note');
    r.printBtn = await count('#print-btn');
    return r;
  });
  if (p === 0 || p === pageCount - 1) {
    await step(`${P}-copy`, async () => {
      const r = {};
      for (const n of ['meta', 'schema', 'headings', 'content', 'links', 'images', 'export', 'aiprompt']) { await tab(n); r[n] = await copyAll(`${P}__${n}`, `#pi-${n}`); }
      return r;
    });
  }
}

// ---------------------------------------------------------------- navigation + filter
await step('nav', async () => {
  const r = {};
  await page.locator('#page-list [data-page]').first().click();
  await page.locator('#next-btn').click(); r.afterNext = await txt('#pos-label');
  await page.locator('#prev-btn').click(); r.afterPrev = await txt('#pos-label');
  await tab('links'); await page.locator('#next-btn').click(); r.tabKept = await page.locator('#tab-links').getAttribute('aria-selected');
  await page.locator('#tab-links').focus(); await page.keyboard.press('ArrowRight'); r.arrowRight = await page.evaluate(() => document.querySelector('#tablist [aria-selected=true]').id);
  await page.keyboard.press('ArrowLeft'); r.arrowLeft = await page.evaluate(() => document.querySelector('#tablist [aria-selected=true]').id);
  await page.keyboard.press('End'); r.end = await page.evaluate(() => document.querySelector('#tablist [aria-selected=true]').id);
  await page.keyboard.press('Home'); r.home = await page.evaluate(() => document.querySelector('#tablist [aria-selected=true]').id);
  await page.fill('#page-filter', 'sharjah'); r.filter = await txt('#page-list [data-page] .si-title'); await page.fill('#page-filter', 'zzzz'); r.filterNone = await txt('#page-list'); await page.fill('#page-filter', '');
  // goto links from overview stat tile + severity card
  await tab('overview'); await page.locator('#pi-overview .stat[data-goto="links"]').click(); r.gotoLinks = await page.locator('#tab-links').getAttribute('aria-selected');
  await tab('overview'); await page.locator('#pi-overview .sev-card[data-issues="error"]').click(); r.sevCardFilter = await page.locator('#pi-overview .seg-btn[aria-pressed="true"]').getAttribute('data-issues');
  return r;
});
await step('find-in-page-sync', async () => {
  // a hidden="until-found" panel revealed by find-in-page must switch its tab (beforematch)
  await page.locator('#tab-overview').click();
  const r = await page.evaluate(() => { const p = document.getElementById('panel-technical'); p.dispatchEvent(new Event('beforematch', { bubbles: true })); return document.getElementById('tab-technical').getAttribute('aria-selected'); });
  return r;
});

// ---------------------------------------------------------------- replace / cancel / edit
await step('replace-flow', async () => {
  const r = {};
  await page.locator('#page-list [data-page]').first().click(); await page.locator('#edit-btn').click();
  r.title = await txt('#input-title'); r.btn = await txt('#analyze-btn'); r.nextHidden = await page.locator('#add-next-btn').isHidden(); r.cancelVisible = await page.locator('#cancel-edit-btn').isVisible();
  r.prefilled = [(await page.inputValue('#html-input')).length > 100, await page.inputValue('#page-url')];
  await page.locator('#cancel-edit-btn').click(); await page.waitForSelector('#report:not([hidden])'); r.afterCancel = await txt('#sb-title');
  await page.locator('#edit-btn').click(); await page.locator('#analyze-btn').click(); await page.waitForSelector('#report:not([hidden])'); r.afterUpdate = [await txt('#page-count'), await txt('#toast')];
  return r;
});

// ---------------------------------------------------------------- projects: backup / rename / new / import / delete / persistence
let backupText = '';
await step('projects', async () => {
  const r = {};
  const bk = await download(() => act('#proj-backup')); backupText = bk.text; put('project__backup.json', bk.text); r.backupName = bk.name.replace(/\d{4}-\d{2}-\d{2}/, '<D>');
  const b = JSON.parse(bk.text); r.backup = { app: b.app, version: b.version, project: b.project, pages: b.pages.length, keys: Object.keys(b.pages[0]) };
  await act('#proj-rename'); r.renameDialog = [await txt('#dlg-title'), await page.inputValue('#dlg-input')]; await page.fill('#dlg-input', 'Client A'); await page.locator('#dlg-ok').click(); await page.waitForTimeout(100);
  r.afterRename = await txt('#project-select option');
  await act('#proj-new'); r.newDialog = await txt('#dlg-title'); await page.fill('#dlg-input', 'Client B'); await page.locator('#dlg-ok').click(); await page.waitForSelector('#input-section:not([hidden])');
  r.afterNew = { options: await txt('#project-select option'), count: await txt('#page-count'), addVisible: true, sideEmpty: await txt('#page-list'), allDisabled: await page.locator('#side-all').isDisabled() };
  // cancel on dialog does nothing
  await act('#proj-new'); await page.locator('#dlg-cancel').click(); r.afterCancel = await txt('#project-select option');
  // import the backup
  const tmp = path.join(outDir, '_backup.json'); fs.writeFileSync(tmp, backupText);
  await page.setInputFiles('#proj-import', tmp); await page.waitForTimeout(600); fs.rmSync(tmp);
  r.afterImport = { options: await txt('#project-select option'), count: await txt('#page-count'), toast: await txt('#toast') };
  // bad import
  const bad = path.join(outDir, '_bad.json'); fs.writeFileSync(bad, '{"nope":1}'); await page.setInputFiles('#proj-import', bad); await page.waitForTimeout(300); fs.rmSync(bad); r.badImportToast = await txt('#toast');
  // switch project
  await page.selectOption('#project-select', { label: 'Client B' }); await page.waitForTimeout(200); r.switchB = [await txt('#page-count'), await page.locator('#input-section').isVisible()];
  // delete cancel then confirm
  await act('#proj-delete'); r.deleteDialog = [await txt('#dlg-title'), await txt('#dlg-msg')]; await page.locator('#dlg-cancel').click();
  await act('#proj-delete'); await page.locator('#dlg-ok').click(); await page.waitForTimeout(400);
  r.afterDelete = { options: await txt('#project-select option'), count: await txt('#page-count') };
  return r;
});
await step('persistence', async () => {
  await page.reload(); await page.waitForSelector('#project-select option', { state: 'attached' }); await page.waitForTimeout(800);
  return { options: await txt('#project-select option'), count: await txt('#page-count'), view: await page.evaluate(() => ({ bulk: !document.getElementById('bulk').hidden, report: !document.getElementById('report').hidden, add: !document.getElementById('input-section').hidden })), storageNote: await txt('#storage-note') };
});
await step('file-input-and-drop', async () => {
  await page.locator('#side-add').click();
  const f = path.join(outDir, '_s.html'); fs.writeFileSync(f, SAMPLES[2].html); await page.setInputFiles('#file-input', f); fs.rmSync(f);
  return { size: await txt('#input-size'), len: (await page.inputValue('#html-input')).length };
});

F.console = [...new Set(F.console)];
fs.writeFileSync(path.join(outDir, 'facts.json'), norm(JSON.stringify(F, null, 1)), 'utf8');
await browser.close();
const nFiles = fs.readdirSync(path.join(outDir, 'files')).length;
console.log(`[${label}] steps: ${Object.keys(F.steps).length}, files: ${nFiles}, problems: ${F.problems.length}, console msgs: ${F.console.length}`);
for (const p of F.problems) console.log('  PROBLEM', p);
for (const c of F.console) console.log('  CONSOLE', c);
