/* =========================================================================
   HTML Content Extractor — cross-page analysis
   Works on a list of { page, report } items and returns plain data.
   ========================================================================= */
'use strict';

const Bulk = (() => {
  const X = Extractor;
  const tokens = (s) => X.words(s || '').map(X.foldWord);
  const meaningful = (s) => tokens(s).filter((w) => !X.isStopWord(w));
  const normSpace = (s) => X.foldText(s || '').replace(/[|\-–—:·•,]+/g, ' ').replace(/\s+/g, ' ').trim();

  /* ---------- URLs ---------- */
  function urlKey(u) {
    try {
      const x = new URL(u);
      if (!/^https?:$/.test(x.protocol)) return '';
      let path = x.pathname.replace(/\/+$/, '') || '/';
      try { path = decodeURIComponent(path); } catch {}
      return (x.hostname.replace(/^www\./, '') + path).toLowerCase();
    } catch { return ''; }
  }
  function pageUrl(item) {
    const r = item.report;
    return item.page.url || r.head.canonicals[0] || (r.head.og['og:url'] || [])[0] || r.meta.baseUrl || '';
  }
  function shortUrl(u) {
    try { const x = new URL(u); let p = x.pathname; try { p = decodeURIComponent(p); } catch {} return p === '/' ? x.hostname : p; } catch { return u || ''; }
  }

  const mainBlocks = (r) => r.content.blocks.filter((b) => b.region === 'main' || b.region === 'body');
  const mainText = (r) => mainBlocks(r).map(X.blockText).filter(Boolean).join('\n');

  /* =======================================================================
     1. Comparison rows
     ======================================================================= */
  function compareRows(items) {
    return items.map((it, i) => {
      const r = it.report, h = r.head;
      const h1 = r.headings.filter((x) => x.level === 1);
      const url = pageUrl(it);
      const canon = h.canonicals[0] || '';
      let canonState = 'missing';
      if (h.canonicals.length > 1) canonState = 'multiple';
      else if (canon) canonState = (it.page.url && urlKey(canon) !== urlKey(it.page.url)) ? 'other URL' : 'self';
      const robots = [...h.robots, ...h.googlebot].join(', ').toLowerCase();
      const count = (sev) => r.issues.filter((x) => x.sev === sev).length;
      return {
        id: it.page.id, n: i + 1, url, path: shortUrl(url),
        title: h.title || '', titleLen: h.titleLen,
        desc: h.description || '', descLen: h.descLen,
        h1: h1.map((x) => x.text).join(' | '), h1Count: h1.length,
        h2Count: r.headings.filter((x) => x.level === 2).length, headings: r.headings.length,
        words: r.stats.mainWords, allWords: r.stats.allWords,
        images: r.images.summary.total, missingAlt: r.images.summary.missingAlt,
        internal: r.links.summary.internal, external: r.links.summary.external,
        schema: Object.keys(r.schema.typeCounts).filter((t) => !['ListItem', 'PostalAddress', 'Answer', 'Question', 'ImageObject', 'GeoCoordinates', 'OpeningHoursSpecification', 'EntryPoint', 'ReadAction', 'SearchAction', 'PropertyValueSpecification'].includes(t)),
        indexable: !/noindex|none/.test(robots), canonState, lang: h.lang,
        errors: count('error'), warnings: count('warning'), notices: count('notice'),
      };
    });
  }

  /* =======================================================================
     2. Duplicates & cannibalization
     ======================================================================= */
  function groupBy(items, getter) {
    const map = new Map();
    items.forEach((it) => {
      const raw = getter(it);
      const k = normSpace(raw);
      if (!k) return;
      if (!map.has(k)) map.set(k, { value: raw, ids: [] });
      map.get(k).ids.push(it.page.id);
    });
    return [...map.values()].filter((g) => g.ids.length > 1).sort((a, b) => b.ids.length - a.ids.length);
  }

  // longest phrase (up to 5 words) appearing in both title and H1
  function primaryPhrase(r) {
    const t = tokens(r.head.title || '');
    const h1 = tokens((r.headings.find((x) => x.level === 1) || {}).text || '');
    if (!t.length || !h1.length) return '';
    const hs = ' ' + h1.join(' ') + ' ';
    for (let n = Math.min(5, t.length); n >= 2; n--) {
      for (let i = 0; i + n <= t.length; i++) {
        const g = t.slice(i, i + n);
        if (X.isStopWord(g[0]) || X.isStopWord(g[n - 1])) continue;
        if (hs.includes(' ' + g.join(' ') + ' ')) return g.join(' ');
      }
    }
    return '';
  }

  function duplicates(items) {
    const byId = Object.fromEntries(items.map((it) => [it.page.id, it]));
    const titles = groupBy(items, (it) => it.report.head.title);
    const descriptions = groupBy(items, (it) => it.report.head.description);
    const h1s = groupBy(items, (it) => (it.report.headings.find((x) => x.level === 1) || {}).text);
    const canonicals = groupBy(items, (it) => it.report.head.canonicals[0] ? urlKey(it.report.head.canonicals[0]) : '');
    const missing = {
      title: items.filter((it) => !it.report.head.title).map((it) => it.page.id),
      description: items.filter((it) => !it.report.head.description).map((it) => it.page.id),
      h1: items.filter((it) => !it.report.headings.some((x) => x.level === 1)).map((it) => it.page.id),
      url: items.filter((it) => !urlKey(pageUrl(it))).map((it) => it.page.id),
    };

    // cannibalization: overlap of the meaningful words in title + H1
    const sets = items.map((it) => {
      const r = it.report;
      const words = new Set(meaningful(`${r.head.title || ''} ${(r.headings.find((x) => x.level === 1) || {}).text || ''}`));
      return { id: it.page.id, words, primary: primaryPhrase(r) };
    });
    const cannibal = [];
    for (let i = 0; i < sets.length; i++) {
      for (let j = i + 1; j < sets.length; j++) {
        const A = sets[i], B = sets[j];
        if (!A.words.size || !B.words.size) continue;
        const shared = [...A.words].filter((w) => B.words.has(w));
        const union = new Set([...A.words, ...B.words]).size;
        const score = shared.length / union;
        const samePrimary = A.primary && A.primary === B.primary;
        const onlyA = [...A.words].filter((w) => !B.words.has(w)), onlyB = [...B.words].filter((w) => !A.words.has(w));
        // high: same main phrase, or one page's target words are fully contained in the other's
        const contained = score >= 0.5 && (!onlyA.length || !onlyB.length);
        let level = '';
        if (samePrimary || contained) level = 'high';
        else if (score >= 0.6) level = 'medium'; // both pages still have their own words (e.g. different city)
        if (!level) continue;
        cannibal.push({ a: A.id, b: B.id, score: Math.round(score * 100), samePrimary: samePrimary ? A.primary : '', level, shared, onlyA, onlyB });
      }
    }
    cannibal.sort((x, y) => (y.level === 'high') - (x.level === 'high') || y.score - x.score);
    const primaries = Object.fromEntries(sets.map((s) => [s.id, s.primary]));
    return { titles, descriptions, h1s, canonicals, missing, cannibal, primaries, byId };
  }

  /* =======================================================================
     3. Near-duplicate content (shingles + "template" similarity)
     ======================================================================= */
  const K = 4;
  function shingles(toks) {
    const s = new Set();
    for (let i = 0; i + K <= toks.length; i++) s.add(toks.slice(i, i + K).join(' '));
    if (!s.size && toks.length) s.add(toks.join(' '));
    return s;
  }
  function jaccard(a, b) {
    if (!a.size || !b.size) return 0;
    let inter = 0;
    const [small, big] = a.size < b.size ? [a, b] : [b, a];
    for (const x of small) if (big.has(x)) inter++;
    return inter / (a.size + b.size - inter);
  }
  function sentences(text) {
    return text.split(/(?<=[.!?؟。])\s+|\n+/).map((s) => s.trim()).filter((s) => X.words(s).length >= 6);
  }

  function similarity(items) {
    const data = items.map((it) => {
      const text = mainText(it.report);
      const toks = tokens(text);
      const r = it.report;
      const label = new Set(meaningful(`${r.head.title || ''} ${(r.headings.find((x) => x.level === 1) || {}).text || ''} ${shortUrl(pageUrl(it)).replace(/[-_/]/g, ' ')}`));
      const sents = sentences(text);
      return { id: it.page.id, toks, sh: shingles(toks), label, sents, sentKeys: new Map(sents.map((s) => [X.foldText(s), s])) };
    });
    const pairs = [];
    for (let i = 0; i < data.length; i++) {
      for (let j = i + 1; j < data.length; j++) {
        const A = data[i], B = data[j];
        const raw = jaccard(A.sh, B.sh);
        // mask the words that make each page different in title/H1/URL (usually the city or service name)
        const mask = new Set([...A.label].filter((w) => !B.label.has(w)).concat([...B.label].filter((w) => !A.label.has(w))));
        let tmpl = raw;
        if (mask.size) {
          const m = (t) => t.map((w) => (mask.has(w) ? '◆' : w));
          tmpl = Math.max(raw, jaccard(shingles(m(A.toks)), shingles(m(B.toks))));
        }
        const shared = [];
        for (const [k, s] of A.sentKeys) if (B.sentKeys.has(k)) shared.push(s);
        // sentences that are the same once the differing words are hidden (city-swapped copy)
        const mk = (s) => tokens(s).map((w) => (mask.has(w) ? '◆' : w)).join(' ');
        const bMasked = new Set(B.sents.map(mk));
        const templated = A.sents.filter((s) => bMasked.has(mk(s)));
        pairs.push({ a: A.id, b: B.id, raw: Math.round(raw * 100), template: Math.round(tmpl * 100), masked: [...mask].slice(0, 8),
          sharedSentences: shared, templatedSentences: templated, sentA: A.sents.length, sentB: B.sents.length, wordsA: A.toks.length, wordsB: B.toks.length });
      }
    }
    pairs.sort((x, y) => y.template - x.template || y.raw - x.raw);
    const max = {};
    pairs.forEach((p) => { max[p.a] = Math.max(max[p.a] || 0, p.template); max[p.b] = Math.max(max[p.b] || 0, p.template); });
    return { pairs, max };
  }

  /* =======================================================================
     4. Internal link map
     ======================================================================= */
  function linkMap(items) {
    const keyOf = new Map(); // urlKey -> page id
    const nodes = items.map((it) => {
      const url = pageUrl(it);
      const key = urlKey(url);
      if (key && !keyOf.has(key)) keyOf.set(key, it.page.id);
      // canonical may differ from the URL typed: map both
      const ck = it.report.head.canonicals[0] ? urlKey(it.report.head.canonicals[0]) : '';
      if (ck && !keyOf.has(ck)) keyOf.set(ck, it.page.id);
      return { id: it.page.id, url, key, incoming: [], outgoing: [], selfLinks: 0 };
    });
    const nodeById = Object.fromEntries(nodes.map((n) => [n.id, n]));
    const unknown = new Map();
    items.forEach((it) => {
      const from = nodeById[it.page.id];
      it.report.links.items.forEach((l) => {
        if (l.type !== 'internal') return;
        const tk = urlKey(l.abs);
        if (!tk) return;
        const to = keyOf.get(tk);
        if (to === it.page.id) { from.selfLinks++; return; }
        const content = l.region === 'main' || l.region === 'body';
        if (to) {
          const e = { from: it.page.id, to, anchor: l.text, region: l.region, content };
          from.outgoing.push(e); nodeById[to].incoming.push(e);
        } else {
          if (!unknown.has(tk)) unknown.set(tk, { url: l.abs, count: 0, from: new Set(), anchors: new Set() });
          const u = unknown.get(tk); u.count++; u.from.add(it.page.id); if (l.text) u.anchors.add(l.text);
        }
      });
    });
    nodes.forEach((n) => {
      n.inPages = new Set(n.incoming.map((e) => e.from)).size;
      n.inContent = n.incoming.filter((e) => e.content).length;
      n.inNav = n.incoming.length - n.inContent;
      n.outPages = new Set(n.outgoing.map((e) => e.to)).size;
      n.anchors = [...n.incoming.reduce((m, e) => { if (e.anchor) m.set(e.anchor, (m.get(e.anchor) || 0) + 1); return m; }, new Map())]
        .sort((a, b) => b[1] - a[1]);
      n.orphan = n.key && n.inPages === 0;
      n.contentOrphan = n.key && n.inContent === 0;
    });
    const unknownList = [...unknown.values()].map((u) => ({ ...u, from: [...u.from], anchors: [...u.anchors].slice(0, 5) }))
      .sort((a, b) => b.from.length - a.from.length || b.count - a.count).slice(0, 40);
    const edges = nodes.reduce((n, x) => n + x.outgoing.length, 0);
    return { nodes, nodeById, unknown: unknownList, edges };
  }

  /* =======================================================================
     All together
     ======================================================================= */
  function analyzeAll(items) {
    return { rows: compareRows(items), dups: duplicates(items), sim: similarity(items), links: linkMap(items), items };
  }

  return { primaryPhrase, analyzeAll, compareRows, duplicates, similarity, linkMap, pageUrl, shortUrl, urlKey, mainText };
})();
