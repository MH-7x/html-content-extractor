// Compare two golden captures. Exit 1 if anything differs.
//   node compare.mjs <baselineDir> <newDir> [--allow <file with one ignored fact-path/file-name per line>]
import fs from 'node:fs';
import path from 'node:path';

const [, , a, b, ...rest] = process.argv;
const allow = new Set();
const ai = rest.indexOf('--allow');
if (ai > -1) for (const l of fs.readFileSync(rest[ai + 1], 'utf8').split(/\r?\n/)) if (l.trim() && !l.startsWith('#')) allow.add(l.trim());

const diffs = [];
const walk = (x, y, p) => {
  if (allow.has(p)) return;
  if (JSON.stringify(x) === JSON.stringify(y)) return;
  if (x && y && typeof x === 'object' && typeof y === 'object' && Array.isArray(x) === Array.isArray(y)) {
    const keys = new Set([...Object.keys(x), ...Object.keys(y)]);
    for (const k of keys) walk(x[k], y[k], p ? `${p}.${k}` : k);
  } else diffs.push(`${p}\n    baseline: ${JSON.stringify(x)?.slice(0, 300)}\n    new:      ${JSON.stringify(y)?.slice(0, 300)}`);
};
const fa = JSON.parse(fs.readFileSync(path.join(a, 'facts.json'), 'utf8'));
const fb = JSON.parse(fs.readFileSync(path.join(b, 'facts.json'), 'utf8'));
walk(fa, fb, '');

const da = path.join(a, 'files'), db = path.join(b, 'files');
const la = new Set(fs.readdirSync(da)), lb = new Set(fs.readdirSync(db));
for (const f of la) if (!lb.has(f)) { if (!allow.has(f)) diffs.push(`file missing in new: ${f}`); }
for (const f of lb) if (!la.has(f)) { if (!allow.has(f)) diffs.push(`file only in new: ${f}`); }
let same = 0;
for (const f of la) if (lb.has(f)) {
  if (allow.has(f)) continue;
  if (fs.readFileSync(path.join(da, f), 'utf8') === fs.readFileSync(path.join(db, f), 'utf8')) same++;
  else diffs.push(`file differs: ${f}`);
}
console.log(`identical files: ${same}/${la.size}`);
if (diffs.length) { console.log(`\n${diffs.length} DIFFERENCE(S):`); for (const d of diffs) console.log(' - ' + d); process.exit(1); }
console.log('NO DIFFERENCES: behaviour and exports match the baseline.');
