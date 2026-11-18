// Screenshots used by README.md (fictional sample pages only). Output: docs/screenshots/
//   node readme-shots.mjs
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const out = path.join(root, 'docs', 'screenshots');
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel: 'msedge', headless: true });
async function open(scheme, density = 'comfortable') {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: scheme, locale: 'en-US', deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.addInitScript((d) => { try { localStorage.setItem('hce:density', d); } catch {} }, density);
  await page.goto(pathToFileURL(path.join(root, 'index.html')).href);
  await page.waitForSelector('#project-select option', { state: 'attached' });
  await page.waitForTimeout(300);
  return page;
}
const settle = async (page) => { await page.waitForFunction(() => !document.getElementById('toast').classList.contains('show'), null, { timeout: 8000 }); await page.waitForTimeout(500); };
const shot = async (page, name, opts = {}) => { await settle(page); await page.screenshot({ path: path.join(out, name + '.png'), ...opts }); };
const loadSamples = async (page) => { await page.locator('#sample-btn').click(); await page.waitForSelector('#bulk:not([hidden])'); };
const openPage = async (page, n) => { await page.locator('#page-list [data-page]').nth(n).click(); await page.waitForSelector('#report:not([hidden])'); };

let page = await open('light');
await shot(page, '01-add-page');
await loadSamples(page);
await shot(page, '06-compare');
await page.locator('#btab-dups').click(); await shot(page, '07-duplicates');
await page.locator('#btab-sim').click(); await shot(page, '08-near-duplicates');
await page.locator('#btab-links').click(); await shot(page, '09-link-map');
await openPage(page, 0);
await shot(page, '02-overview');
await page.locator('#tab-meta').click(); await shot(page, '03-meta');
await page.locator('#tab-schema').click(); await shot(page, '04-schema');
await page.locator('#tab-content').click(); await shot(page, '05-content');
await page.locator('#tab-export').click(); await shot(page, '10-export');
await page.locator('#tab-aiprompt').click(); await shot(page, '11-ai-prompt');
await page.context().close();

page = await open('dark');
await loadSamples(page); await openPage(page, 0);
await shot(page, '12-dark-mode');
await page.locator('#display-btn').click(); await shot(page, '13-display-menu', { clip: { x: 980, y: 0, width: 460, height: 260 } });
await page.context().close();

page = await open('light', 'compact');
await loadSamples(page); await openPage(page, 0);
await page.locator('#tab-links').click(); await shot(page, '14-links-compact');
await browser.close();
console.log(fs.readdirSync(out).map((f) => `${f} ${(fs.statSync(path.join(out, f)).size / 1024).toFixed(0)} KB`).join('\n'));
