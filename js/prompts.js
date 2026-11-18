/* =========================================================================
   HTML Content Extractor — AI prompt / content brief builder
   ========================================================================= */
'use strict';

const Prompts = (() => {
  const X = Extractor;

  const PAGE_GOALS = {
    rewrite: 'Rewrite & improve the content (SEO)',
    brief: 'Content brief for a writer',
    audit: 'SEO audit summary & action plan',
    meta: 'New title, meta description & H1 options',
    faq: 'FAQ section + FAQPage schema',
    localize: 'Translate / localize (Arabic ↔ English)',
    unique: 'Make this page unique vs similar pages',
  };
  const PROJECT_GOALS = {
    differentiate: 'Differentiate near-duplicate pages',
    metas: 'Unique titles & meta descriptions for all pages',
    linking: 'Internal linking plan',
    cannibal: 'Resolve keyword cannibalization',
  };
  const LANGS = { same: 'Same language as the page', en: 'English', ar: 'Arabic (Modern Standard, UAE audience)' };

  const outline = (r) => r.headings.map((h) => `${'  '.repeat(h.level - 1)}- H${h.level}: ${h.text || '(empty)'}`).join('\n') || '(no headings)';
  const issues = (r) => r.issues.filter((i) => i.sev === 'error' || i.sev === 'warning').map((i) => `- [${i.sev}] ${i.msg}${i.detail ? ` (${i.detail.slice(0, 160)})` : ''}`).join('\n') || '- none';
  const schemaTypes = (r) => Object.keys(r.schema.typeCounts).join(', ') || 'none';
  const mainMd = (r, limit) => {
    const md = r.content.blocks.filter((b) => b.region === 'main' || b.region === 'body').map(X.blockToMd).filter(Boolean).join('\n\n');
    return md.length > limit ? md.slice(0, limit) + '\n\n[…content truncated…]' : md;
  };
  const langLine = (lang, r) => lang === 'same'
    ? `Write the output in the same language as the page (${r.stats.script}${r.head.lang ? `, lang="${r.head.lang}"` : ''}).`
    : `Write the output in ${LANGS[lang]}.`;

  const RULES = `Rules:
- Use only facts found in the page (services, prices, areas, phone numbers, brand names). Never invent numbers, prices, guarantees, awards or reviews.
- Where a real detail is needed but missing, insert a placeholder like [ADD: real detail] instead of making one up.
- Write naturally for people first; no keyword stuffing, no filler, no clichés like "look no further" or "in today's fast-paced world".
- Keep the brand name exactly as written on the page.`;

  function pageContext(page, r, opts) {
    const url = Bulk.pageUrl({ page, report: r });
    return `## Page data
- URL: ${url || 'unknown'}
- Title tag (${r.head.titleLen} chars): ${r.head.title || 'MISSING'}
- Meta description (${r.head.descLen} chars): ${r.head.description || 'MISSING'}
- H1: ${r.headings.filter((h) => h.level === 1).map((h) => h.text).join(' | ') || 'MISSING'}
- Main content: ${r.stats.mainWords} words, ${r.stats.paragraphs} paragraphs, ${r.stats.lists} lists, ${r.stats.tables} tables
- Language / script: ${r.head.lang || '?'} / ${r.stats.script}
- Structured data types: ${schemaTypes(r)}
- Top 2-word phrases in content: ${r.keywords.two.slice(0, 8).map((g) => `${g.phrase} (${g.count})`).join(', ') || '—'}
${opts.keyword ? `- Target keyword: "${opts.keyword}"\n` : ''}
### Heading outline
${outline(r)}

### SEO issues detected
${issues(r)}
${opts.includeContent ? `\n### Current main content (Markdown)\n${mainMd(r, opts.limit || 40000)}\n` : ''}`;
  }

  function pagePrompt(page, r, opts) {
    const kw = opts.keyword ? `"${opts.keyword}"` : 'the main topic of the page';
    const head = `You are a senior SEO content strategist who writes for local service businesses in the UAE.\n\n`;
    let task = '';
    switch (opts.goal) {
      case 'rewrite':
        task = `## Task
Rewrite and improve this page's main content so it ranks better for ${kw} and converts more visitors.
1. Keep every true fact, service and contact detail from the current content.
2. Give a clear structure: one H1, logical H2/H3 sections, short paragraphs, lists where useful.
3. Cover what searchers need: services, areas served, process, pricing factors, why choose us, and a FAQ (4–6 questions).
4. Use the target keyword and close variations naturally in the H1, first paragraph, a few subheadings and the conclusion.
5. Add a clear call to action (call / WhatsApp) using the contact details on the page.

## Output
1. Title tag (max 60 characters) and meta description (max 155 characters)
2. The full rewritten content in Markdown (H1, H2, H3, paragraphs, lists)
3. A short list of what you changed and why
4. 3–5 internal link suggestions (anchor text + what kind of page it should link to)`;
        break;
      case 'brief':
        task = `## Task
Create a content brief a writer can follow to produce the best page on the web for ${kw}.

## Output
1. Search intent and the reader's main questions
2. Recommended title tag, meta description and H1
3. Full outline (H2/H3) with 1–2 lines on what each section must cover
4. Target length and the entities, terms and local details to include
5. FAQ questions to answer
6. Gaps in the current page versus what the outline needs
7. Internal links and CTAs to include`;
        break;
      case 'audit':
        task = `## Task
Review this page as an SEO and content expert. Use the data above.

## Output
1. A 3-sentence summary of the page's current state
2. Prioritized action list (High / Medium / Low) with the exact fix for each item: meta tags, headings, content depth, internal links, images/alt text, schema, technical issues
3. Quick wins that take under 10 minutes
4. What content is missing for ${kw}`;
        break;
      case 'meta':
        task = `## Task
Write 5 alternative title tags (max 60 characters), 5 meta descriptions (max 155 characters) and 3 H1 options for this page, targeting ${kw}.
Each title must be different in angle (price, speed, trust, location, service range). Put the keyword near the start. Add the character count after each option.`;
        break;
      case 'faq':
        task = `## Task
Write 6–8 frequently asked questions with clear 2–4 sentence answers for ${kw}, based only on the information in the page.
Then output valid JSON-LD for FAQPage containing exactly the same questions and answers, so the visible FAQ and the schema match.`;
        break;
      case 'localize':
        task = `## Task
Translate and localize this page's content for the UAE market. If the page is Arabic, produce English; if it is English, produce Arabic (Modern Standard Arabic that reads naturally to UAE residents).
Do not translate word for word: adapt headings and phrasing to how people in the UAE actually search (for example Arabic searches like "نقل اثاث" or "شركة نقل اثاث" and English searches like "movers in Dubai").
Keep the same structure (H1, H2, lists, FAQ). Also give a localized title tag (max 60 chars) and meta description (max 155 chars).`;
        break;
      case 'unique': {
        const sims = (opts.similar || []).slice(0, 5);
        task = `## Task
This page is too similar to other pages on the same website${sims.length ? ':\n' + sims.map((s) => `- ${s.title} (${s.url}) — ${s.template}% similar text`).join('\n') : '.'}
Rewrite the main content so it is clearly unique and specific to this page's topic/location, while keeping all true facts.
Add sections that only make sense for this page (local areas and neighbourhoods served, local access/parking/building rules, typical property types, distances), using [ADD: …] placeholders where a real local fact is needed.
Change the structure and wording, not just the city name.

## Output
1. New H1, title tag (max 60 chars) and meta description (max 155 chars)
2. Full unique content in Markdown
3. A list of the [ADD: …] details the business owner should supply`;
        break;
      }
    }
    return `${head}${pageContext(page, r, opts)}\n${task}\n\n${RULES}\n${langLine(opts.lang, r)}\n`;
  }

  /* ---------- project-level ---------- */
  function projectPrompt(B, opts, labelOf) {
    const items = B.items;
    const rowLine = (row) => `- [${row.n}] ${row.url || '(no URL)'}\n  - Title: ${row.title || 'MISSING'}\n  - Meta description: ${row.desc || 'MISSING'}\n  - H1: ${row.h1 || 'MISSING'}\n  - Main words: ${row.words}`;
    const pagesBlock = `## Pages (${items.length})\n${B.rows.map(rowLine).join('\n')}`;
    const head = 'You are a senior SEO strategist for local service businesses in the UAE.\n\n';
    const lang = opts.lang === 'same' ? 'Write in the same language as each page.' : `Write the output in ${LANGS[opts.lang]}.`;
    let task = '', extra = '';
    if (opts.goal === 'differentiate') {
      const pairs = B.sim.pairs.filter((p) => p.template >= 50).slice(0, 20);
      extra = `## Near-duplicate pairs (text similarity after masking city/service words)\n${pairs.map((p) => `- ${labelOf(p.a)} ↔ ${labelOf(p.b)}: ${p.template}% (raw ${p.raw}%, ${p.templatedSentences.length} sentences repeated apart from city/service words)`).join('\n') || '- none above 50%'}\n\n## Heading outlines\n${items.map((it) => `### ${labelOf(it.page.id)}\n${outline(it.report)}`).join('\n\n')}`;
      task = `## Task
These pages share too much text, which risks Google treating them as duplicates or doorway pages.
For each page in the pairs above, propose how to make it unique: a new H1, a distinct angle, 3–5 new section ideas specific to that page's location/service, and which current paragraphs to rewrite or remove. Use [ADD: …] placeholders for local facts the owner must supply.`;
    } else if (opts.goal === 'metas') {
      const d = B.dups;
      extra = `## Duplicates found\n- Duplicate titles: ${d.titles.length} groups\n- Duplicate meta descriptions: ${d.descriptions.length} groups\n- Duplicate H1s: ${d.h1s.length} groups`;
      task = `## Task
Write a unique title tag (max 60 characters), meta description (max 155 characters) and H1 for EVERY page listed, so no two pages compete.
Each must reflect that page's specific service/location and include a reason to click. Output a table: page number, URL, new title (with char count), new meta description (with char count), new H1.`;
    } else if (opts.goal === 'linking') {
      const L = B.links;
      extra = `## Current internal links between these pages\n${L.nodes.map((n) => `- ${labelOf(n.id)}: links in from ${n.inPages} page(s) (${n.inContent} in body content), links out to ${n.outPages}${n.orphan ? ' — ORPHAN within this set' : ''}`).join('\n')}`;
      task = `## Task
Create an internal linking plan for these pages.
For each page, list 3–6 links it should add to other pages in the list: target page, exact anchor text (natural, varied, not all exact-match), and the sentence or section where the link fits. Prioritize orphan pages and pages with no links from body content. Avoid linking every page to every page.`;
    } else if (opts.goal === 'cannibal') {
      const c = B.dups.cannibal.slice(0, 25);
      extra = `## Possible cannibalization (overlap of title + H1 words)\n${c.map((x) => `- ${labelOf(x.a)} ↔ ${labelOf(x.b)}: ${x.score}% overlap${x.samePrimary ? `, same main phrase "${x.samePrimary}"` : ''}; shared: ${x.shared.join(', ')}; only in first: ${x.onlyA.join(', ') || '—'}; only in second: ${x.onlyB.join(', ') || '—'}`).join('\n') || '- none detected'}`;
      task = `## Task
Decide for each pair whether the pages truly compete for the same search intent.
For real conflicts, recommend one fix: merge (and 301 redirect), re-target one page to a different keyword (give the new keyword, title and H1), or differentiate the content. Explain each decision in 1–2 sentences.`;
    }
    return `${head}${pagesBlock}\n\n${extra}\n\n${task}\n\n${RULES}\n${lang}\n`;
  }

  return { PAGE_GOALS, PROJECT_GOALS, LANGS, pagePrompt, projectPrompt };
})();
