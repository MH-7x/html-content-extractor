// Screenshots for visual review.
//   node shots.mjs --root <app> --out <dir> [--w 1440] [--h 900] [--scheme light|dark] [--density compact] [--views a,b,c] [--full]
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > -1 ? process.argv[i + 1] : d; };
const root = path.resolve(arg('root', path.join(here, '..')));
const out = path.resolve(arg('out', path.join(here, 'out', 'shots')));
const W = +arg('w', 1440), H = +arg('h', 900), scheme = arg('scheme', 'light'), density = arg('density', 'comfortable');
const full = process.argv.includes('--full');
const ALL = ['add', 'overview', 'meta', 'schema', 'headings', 'content', 'links', 'images', 'keywords', 'technical', 'aiprompt', 'export', 'b-compare', 'b-dups', 'b-sim', 'b-links', 'b-ai', 'menu', 'display'];
const views = arg('views', ALL.join(',')).split(',');
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, colorScheme: scheme, locale: 'en-US', deviceScaleFactor: 1 });
const page = await ctx.newPage();
await page.addInitScript((d) => { try { localStorage.setItem('hce:density', d); } catch {} }, density);
await page.goto(pathToFileURL(path.join(root, 'index.html')).href);
await page.waitForSelector('#project-select option', { state: 'attached' });
await page.waitForTimeout(400);
const tag = `${W}-${scheme}${density === 'compact' ? '-compact' : ''}`;
const shot = async (name) => { await page.waitForTimeout(450); await page.screenshot({ path: path.join(out, `${name}-${tag}.png`), fullPage: full }); };

if (views.includes('add')) await shot('add');
await page.locator('#sample-btn').click(); await page.waitForSelector('#bulk:not([hidden])');
for (const v of views.filter((x) => x.startsWith('b-'))) { await page.locator(`#btab-${v.slice(2)}`).click(); await shot(v); }
await page.locator('#page-list [data-page]').first().click(); await page.waitForSelector('#report:not([hidden])');
for (const v of views.filter((x) => !x.startsWith('b-') && !['add', 'menu', 'display'].includes(x))) { await page.locator(`#tab-${v}`).click(); await shot(v); }
await page.locator('#tab-overview').click();
if (views.includes('menu')) { await page.locator('#proj-menu-btn').click(); await shot('menu'); await page.keyboard.press('Escape'); }
if (views.includes('display')) { await page.locator('#display-btn').click(); await shot('display'); await page.keyboard.press('Escape'); }
await browser.close();
console.log('shots ->', out, tag);
