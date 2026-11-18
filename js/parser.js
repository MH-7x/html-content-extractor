/* =========================================================================
   HTML Content Extractor — parser engine
   Parses pasted HTML with DOMParser (scripts never run, images never load)
   and returns one plain JSON-safe report object.
   ========================================================================= */
'use strict';

const Extractor = (() => {

  /* ---------- constants ---------- */
  const SKIP = new Set(['script', 'style', 'noscript', 'template', 'link', 'meta', 'head', 'title',
    'svg', 'canvas', 'object', 'embed', 'param', 'source', 'track', 'map', 'area', 'option', 'datalist']);

  const INLINE = new Set(['a', 'abbr', 'acronym', 'b', 'bdi', 'bdo', 'big', 'br', 'cite', 'code', 'data',
    'dfn', 'del', 'em', 'font', 'i', 'ins', 'kbd', 'label', 'mark', 'nobr', 'q', 's', 'samp', 'small',
    'span', 'strike', 'strong', 'sub', 'sup', 'time', 'tt', 'u', 'var', 'wbr']);

  const BLOCK_SELECTOR = 'address,article,aside,blockquote,details,dialog,dd,div,dl,dt,fieldset,figcaption,' +
    'figure,footer,form,h1,h2,h3,h4,h5,h6,header,hr,li,main,nav,ol,p,pre,section,table,ul,img,picture,' +
    'video,iframe,audio,button,input,textarea,select';

  const LOCAL_BUSINESS_TYPES = new Set(['LocalBusiness', 'MovingCompany', 'HomeAndConstructionBusiness',
    'ProfessionalService', 'Store', 'FurnitureStore', 'AutoRental', 'AutomotiveBusiness', 'Restaurant',
    'FoodEstablishment', 'LodgingBusiness', 'Hotel', 'MedicalBusiness', 'Dentist', 'LegalService',
    'RealEstateAgent', 'TravelAgency', 'SelfStorage', 'Locksmith', 'Plumber', 'Electrician',
    'HousePainter', 'RoofingContractor', 'GeneralContractor', 'HVACBusiness', 'CleaningService',
    'EmploymentAgency', 'FinancialService', 'HealthAndBeautyBusiness', 'SportsActivityLocation',
    'EntertainmentBusiness', 'ShoppingCenter', 'AutoRepair', 'AutoDealer', 'ChildCare', 'DryCleaningOrLaundry']);

  // "a|b" = either property satisfies the check
  const SCHEMA_RULES = {
    LocalBusiness: ['name', 'address', 'telephone', 'url', 'image', 'openingHoursSpecification|openingHours',
      'geo', 'priceRange', 'areaServed', 'aggregateRating|review'],
    Organization: ['name', 'url', 'logo', 'sameAs', 'contactPoint|telephone'],
    Corporation: ['name', 'url', 'logo'],
    WebSite: ['name', 'url'],
    WebPage: ['name', 'url', 'description'],
    AboutPage: ['name', 'url'], ContactPage: ['name', 'url'], CollectionPage: ['name', 'url'],
    Article: ['headline', 'image', 'datePublished', 'dateModified', 'author', 'publisher'],
    BlogPosting: ['headline', 'image', 'datePublished', 'dateModified', 'author', 'publisher'],
    NewsArticle: ['headline', 'image', 'datePublished', 'dateModified', 'author', 'publisher'],
    BreadcrumbList: ['itemListElement'],
    FAQPage: ['mainEntity'],
    Product: ['name', 'image', 'description', 'offers', 'brand', 'aggregateRating|review'],
    Offer: ['price|priceSpecification', 'priceCurrency', 'availability'],
    Service: ['name', 'serviceType', 'provider', 'areaServed', 'description'],
    Person: ['name'],
    ImageObject: ['url|contentUrl'],
    VideoObject: ['name', 'description', 'thumbnailUrl', 'uploadDate'],
    Review: ['author', 'reviewRating'],
    AggregateRating: ['ratingValue', 'reviewCount|ratingCount'],
    Event: ['name', 'startDate', 'location'],
    HowTo: ['name', 'step'],
    PostalAddress: ['streetAddress', 'addressLocality', 'addressCountry'],
  };

  const GENERIC_ANCHORS = new Set(['click here', 'here', 'read more', 'learn more', 'more', 'link', 'this',
    'click', 'go', 'details', 'more info', 'continue', 'see more', 'view more', 'اضغط هنا', 'هنا',
    'اقرأ المزيد', 'المزيد', 'اعرف المزيد', 'التفاصيل']);

  const STOP_EN = new Set(('a about above after again against all am an and any are aren\'t as at be because been before ' +
    'being below between both but by can can\'t cannot could couldn\'t did didn\'t do does doesn\'t doing don\'t down during ' +
    'each few for from further had hadn\'t has hasn\'t have haven\'t having he her here hers herself him himself his how i if ' +
    'in into is isn\'t it it\'s its itself let\'s me more most my myself no nor not of off on once only or other ought our ours ' +
    'ourselves out over own same she should so some such than that that\'s the their theirs them themselves then there ' +
    'these they this those through to too under until up very was wasn\'t we were weren\'t what when where which while who ' +
    'whom why will with won\'t would you your yours yourself yourselves also just get got us via per etc may might must shall ' +
    'one two three every within without upon across like s t').split(' '));

  const STOP_AR = new Set(('في من على إلى الى عن مع هذا هذه ذلك تلك التي الذي الذين اللذين التى كان كانت يكون تكون ' +
    'أن ان إن لا لم لن ما ماذا هل قد كل بعض أو او ثم حتى إذا اذا لكن بل غير بين عند لدى منذ نحو هو هي هم هن نحن أنت ' +
    'انت أنا انا لنا لكم لهم له لها به بها فيه فيها منه منها عليه عليها و ف ب ل ك يا أي اي أيضا ايضا كما وقد وهو وهي ' +
    'ولا وفي ومن وعلى والى وإلى أكثر اكثر جدا فقط حيث كيف متى أين اين لماذا التي هناك هنا ذات دون عبر خلال تم').split(' '));

  /* ---------- small helpers ---------- */
  const norm = (s) => (s || '').replace(/[\s ​‎‏]+/g, ' ').trim();
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const mdEsc = (s) => s.replace(/([\\`*_[\]])/g, '\\$1');
  const attr = (el, name) => (el.hasAttribute(name) ? el.getAttribute(name) : null);
  const lower = (s) => (s || '').toLowerCase();
  const stripWww = (h) => (h || '').toLowerCase().replace(/^www\./, '');

  function makeResolver(base) {
    return (url) => {
      if (!url) return '';
      url = url.trim();
      if (!base) return url;
      try { return new URL(url, base).href; } catch { return url; }
    };
  }

  function hostOf(url) {
    try { return new URL(url).hostname; } catch { return ''; }
  }

  /* ---------- pixel width (Google SERP approximation) ---------- */
  let _ctx = null;
  function pixelWidth(text, font) {
    try {
      if (!_ctx) _ctx = document.createElement('canvas').getContext('2d');
      _ctx.font = font;
      return Math.round(_ctx.measureText(text || '').width);
    } catch { return 0; }
  }

  /* =======================================================================
     Main entry
     ======================================================================= */
  function analyze(html, opts = {}) {
    const t0 = performance.now();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const htmlEl = doc.documentElement;
    const body = doc.body || htmlEl;

    // ---- base URL & site host ----
    const canonicalEl = doc.querySelector('link[rel~="canonical" i]');
    const ogUrlEl = doc.querySelector('meta[property="og:url" i]');
    const baseEl = doc.querySelector('base[href]');
    let baseUrl = '', baseSource = '';
    const candidates = [
      [opts.pageUrl, 'URL you entered'],
      [canonicalEl && canonicalEl.getAttribute('href'), 'canonical tag'],
      [ogUrlEl && ogUrlEl.getAttribute('content'), 'og:url tag'],
      [baseEl && baseEl.getAttribute('href'), '<base> tag'],
    ];
    for (const [u, src] of candidates) {
      if (u && /^https?:\/\//i.test(u.trim())) { baseUrl = u.trim(); baseSource = src; break; }
    }
    const resolve = makeResolver(baseUrl);

    const ctx = { doc, resolve, baseUrl };

    const head = extractHead(doc, ctx);
    const schema = extractSchema(doc);
    const tech = detectTech(doc, html, head);
    const contentData = extractContent(body, ctx);
    const headings = extractHeadings(body, contentData.regionOf);

    // site host: base URL host, else most frequent absolute host among links
    let siteHost = stripWww(hostOf(baseUrl));
    if (!siteHost) {
      const counts = {};
      body.querySelectorAll('a[href^="http"]').forEach((a) => {
        const h = stripWww(hostOf(a.getAttribute('href')));
        if (h) counts[h] = (counts[h] || 0) + 1;
      });
      const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
      if (top) { siteHost = top[0]; baseSource = 'most-linked domain (guess)'; }
    }
    ctx.siteHost = siteHost;

    const links = extractLinks(body, ctx, contentData.regionOf);
    const images = extractImages(body, ctx, contentData.regionOf, head);

    const mainBlocks = contentData.blocks.filter((b) => b.region === 'main' || b.region === 'body');
    const allText = contentData.blocks.map(blockText).join('\n');
    const mainText = mainBlocks.map(blockText).join('\n');
    const stats = textStats(mainText, allText, html, contentData.blocks);
    const keywords = keywordStats(mainText);

    const report = {
      meta: { generatedAt: new Date().toISOString(), inputBytes: new Blob([html]).size, baseUrl, baseSource, siteHost,
        parseMs: 0 },
      head, schema, headings, content: { blocks: contentData.blocks, hasMain: contentData.hasMain },
      links, images, stats, keywords, tech,
    };
    schemaVisibilityChecks(report, allText);
    report.issues = runChecks(report);
    report.meta.parseMs = Math.round(performance.now() - t0);
    return report;
  }

  /* =======================================================================
     HEAD
     ======================================================================= */
  function extractHead(doc, ctx) {
    const { resolve } = ctx;
    const htmlEl = doc.documentElement;
    const titles = [...doc.querySelectorAll('title')].filter((t) => !t.closest('svg')).map((t) => norm(t.textContent));

    const metas = [...doc.querySelectorAll('meta')].map((m) => {
      let kind = '', key = '';
      for (const k of ['name', 'property', 'http-equiv', 'itemprop', 'charset']) {
        if (m.hasAttribute(k)) { kind = k; key = k === 'charset' ? 'charset' : m.getAttribute(k); break; }
      }
      return {
        kind, key: key || '(none)', keyLower: lower(key),
        content: kind === 'charset' ? m.getAttribute('charset') : (m.getAttribute('content') ?? ''),
        inHead: !!m.closest('head'),
      };
    });
    const metaGet = (key) => metas.filter((m) => m.keyLower === key && m.kind !== 'itemprop').map((m) => m.content);
    const metaOne = (key) => metaGet(key)[0] ?? null;

    const linkTags = [...doc.querySelectorAll('link')].filter((l) => !l.closest('noscript')).map((l) => ({
      rel: lower(l.getAttribute('rel') || ''), href: l.getAttribute('href') || '', abs: resolve(l.getAttribute('href') || ''),
      hreflang: l.getAttribute('hreflang') || '', type: l.getAttribute('type') || '', sizes: l.getAttribute('sizes') || '',
      media: l.getAttribute('media') || '', as: l.getAttribute('as') || '', inHead: !!l.closest('head'),
    }));
    const relHas = (l, r) => l.rel.split(/\s+/).includes(r);

    const canonicals = linkTags.filter((l) => relHas(l, 'canonical'));
    const hreflang = linkTags.filter((l) => relHas(l, 'alternate') && l.hreflang).map((l) => ({ lang: l.hreflang, href: l.abs }));
    const icons = linkTags.filter((l) => /(^|\s)(icon|shortcut|apple-touch-icon|mask-icon)(\s|$)/.test(l.rel));

    const og = {}, twitter = {}, verification = [];
    metas.forEach((m) => {
      if (m.keyLower.startsWith('og:') || m.keyLower.startsWith('article:') || m.keyLower.startsWith('product:') ||
          m.keyLower.startsWith('fb:')) (og[m.key] ||= []).push(m.content);
      else if (m.keyLower.startsWith('twitter:')) (twitter[m.key] ||= []).push(m.content);
      if (/verification|verify|validate|^p:domain_verify|^yandex|^norton/i.test(m.key)) verification.push({ key: m.key, content: m.content });
    });

    const charsetMeta = metas.find((m) => m.kind === 'charset');
    const httpCharset = metas.find((m) => m.kind === 'http-equiv' && m.keyLower === 'content-type');

    const scripts = [...doc.querySelectorAll('script')].map((s) => {
      const src = s.getAttribute('src') || '';
      const text = src ? '' : s.textContent;
      return {
        src: src ? resolve(src) : '', type: s.getAttribute('type') || '', id: s.id || '',
        async: s.hasAttribute('async'), defer: s.hasAttribute('defer'),
        inline: !src, size: text.length, inHead: !!s.closest('head'),
        preview: text ? norm(text).slice(0, 160) : '',
      };
    });

    const title = titles[0] ?? null;
    const description = metaOne('description');
    return {
      htmlAttrs: [...htmlEl.attributes].map((a) => ({ name: a.name, value: a.value })),
      lang: htmlEl.getAttribute('lang') || '', dir: htmlEl.getAttribute('dir') || '',
      titles, title,
      titleLen: title ? [...title].length : 0, titlePx: title ? pixelWidth(title, '20px Arial') : 0,
      descriptions: metaGet('description'), description,
      descLen: description ? [...description].length : 0, descPx: description ? pixelWidth(description, '14px Arial') : 0,
      keywordsMeta: metaOne('keywords'),
      robots: metaGet('robots'), googlebot: metaGet('googlebot'), bingbot: metaGet('bingbot'),
      viewport: metaOne('viewport'),
      charset: charsetMeta ? charsetMeta.content : (httpCharset ? httpCharset.content : null),
      canonicals: canonicals.map((c) => c.abs), canonicalRaw: canonicals.map((c) => c.href),
      hreflang, icons: icons.map((i) => ({ rel: i.rel, href: i.abs, sizes: i.sizes })),
      manifest: (linkTags.find((l) => relHas(l, 'manifest')) || {}).abs || null,
      prev: (linkTags.find((l) => relHas(l, 'prev')) || {}).abs || null,
      next: (linkTags.find((l) => relHas(l, 'next')) || {}).abs || null,
      amp: (linkTags.find((l) => relHas(l, 'amphtml')) || {}).abs || null,
      author: metaOne('author'), generator: metaGet('generator'), themeColor: metaOne('theme-color'),
      og, twitter, verification, metas, linkTags, scripts,
      stylesheets: linkTags.filter((l) => relHas(l, 'stylesheet')).map((l) => l.abs),
      hints: linkTags.filter((l) => /preload|preconnect|dns-prefetch|prefetch|modulepreload/.test(l.rel)),
    };
  }

  /* =======================================================================
     SCHEMA (JSON-LD, Microdata, RDFa)
     ======================================================================= */
  function extractSchema(doc) {
    const jsonld = [];
    const typeCounts = {};
    const countTypes = (node) => {
      if (Array.isArray(node)) return node.forEach(countTypes);
      if (node && typeof node === 'object') {
        const t = node['@type'];
        if (t) (Array.isArray(t) ? t : [t]).forEach((x) => { typeCounts[x] = (typeCounts[x] || 0) + 1; });
        Object.values(node).forEach(countTypes);
      }
    };

    doc.querySelectorAll('script[type]').forEach((s, i) => {
      if (lower(s.getAttribute('type')).trim() !== 'application/ld+json') return;
      let raw = s.textContent.trim();
      const cleaned = raw.replace(/^\s*<!--/, '').replace(/-->\s*$/, '')
        .replace(/^\s*\/\*\s*<!\[CDATA\[\s*\*\//, '').replace(/\/\*\s*\]\]>\s*\*\/\s*$/, '').trim();
      const entry = { index: jsonld.length + 1, raw, valid: false, error: null, data: null, entities: [],
        className: s.getAttribute('class') || '', id: s.id || '', inHead: !!s.closest('head') };
      try {
        entry.data = JSON.parse(cleaned);
        entry.valid = true;
        countTypes(entry.data);
        const pushEntities = (node) => {
          if (Array.isArray(node)) return node.forEach(pushEntities);
          if (!node || typeof node !== 'object') return;
          if (Array.isArray(node['@graph'])) return node['@graph'].forEach(pushEntities);
          entry.entities.push({ type: node['@type'] || '(no @type)', id: node['@id'] || '', data: node,
            checks: checkEntity(node) });
        };
        pushEntities(entry.data);
      } catch (e) {
        entry.error = e.message;
      }
      jsonld.push(entry);
    });

    // ---- Microdata ----
    const microValue = (el) => {
      const n = el.localName;
      if (el.hasAttribute('content')) return el.getAttribute('content');
      if (['a', 'area', 'link'].includes(n)) return el.getAttribute('href') || '';
      if (['img', 'audio', 'video', 'source', 'iframe', 'embed', 'track'].includes(n)) return el.getAttribute('src') || '';
      if (n === 'meta') return el.getAttribute('content') || '';
      if (n === 'time' && el.hasAttribute('datetime')) return el.getAttribute('datetime');
      if ((n === 'data' || n === 'meter') && el.hasAttribute('value')) return el.getAttribute('value');
      return norm(el.textContent);
    };
    const microItem = (el, depth = 0) => {
      const typeUrl = el.getAttribute('itemtype') || '';
      const obj = { '@type': typeUrl.split(/\s+/).map((t) => t.replace(/^https?:\/\/schema\.org\//i, '')).join(', ') || '(no itemtype)' };
      if (el.hasAttribute('itemid')) obj['@id'] = el.getAttribute('itemid');
      const walk = (node) => {
        for (const c of node.children) {
          if (c.hasAttribute('itemprop')) {
            const names = c.getAttribute('itemprop').trim().split(/\s+/);
            const v = c.hasAttribute('itemscope') ? (depth > 8 ? '[nested]' : microItem(c, depth + 1)) : microValue(c);
            names.forEach((nm) => {
              if (obj[nm] === undefined) obj[nm] = v;
              else if (Array.isArray(obj[nm])) obj[nm].push(v);
              else obj[nm] = [obj[nm], v];
            });
            if (c.hasAttribute('itemscope')) continue;
          } else if (c.hasAttribute('itemscope')) continue;
          walk(c);
        }
      };
      walk(el);
      return obj;
    };
    const microdata = [...doc.querySelectorAll('[itemscope]')]
      .filter((el) => !el.hasAttribute('itemprop'))
      .map((el) => { const d = microItem(el); return { type: d['@type'], data: d, checks: checkEntity(d) }; });
    microdata.forEach((m) => String(m.type).split(', ').forEach((t) => { typeCounts[t] = (typeCounts[t] || 0) + 1; }));

    // ---- RDFa (only real RDFa entities, not OG meta tags) ----
    const rdfa = [...doc.querySelectorAll('[typeof]')].map((el) => {
      const props = {};
      el.querySelectorAll('[property]').forEach((p) => {
        if (p.closest('[typeof]') !== el) return;
        const k = p.getAttribute('property');
        props[k] = p.getAttribute('content') || p.getAttribute('href') || p.getAttribute('src') || norm(p.textContent);
      });
      return { type: el.getAttribute('typeof'), vocab: el.getAttribute('vocab') || '', about: el.getAttribute('about') || '', props };
    });

    return { jsonld, microdata, rdfa, typeCounts };
  }

  function typesOf(node) {
    const t = node && node['@type'];
    return (Array.isArray(t) ? t : [t]).filter(Boolean).map(String);
  }

  function checkEntity(node) {
    const out = [];
    const types = typesOf(node);
    let rules = null, ruleName = '';
    for (const t of types) {
      if (SCHEMA_RULES[t]) { rules = SCHEMA_RULES[t]; ruleName = t; break; }
      if (LOCAL_BUSINESS_TYPES.has(t)) { rules = SCHEMA_RULES.LocalBusiness; ruleName = `${t} (LocalBusiness)`; break; }
    }
    if (rules) {
      const missing = rules.filter((r) => !r.split('|').some((p) => node[p] !== undefined && node[p] !== '' && node[p] !== null));
      if (missing.length) out.push({ sev: 'warning', msg: `Missing recommended ${ruleName} properties: ${missing.map((m) => m.replace('|', ' or ')).join(', ')}` });
      else out.push({ sev: 'pass', msg: `All commonly recommended ${ruleName} properties present` });
    }
    if (types.includes('FAQPage')) {
      const qs = [].concat(node.mainEntity || []);
      const bad = qs.filter((q) => !q || !q.name || !(q.acceptedAnswer && (q.acceptedAnswer.text || (Array.isArray(q.acceptedAnswer) && q.acceptedAnswer[0]?.text))));
      out.push({ sev: bad.length ? 'error' : 'pass', msg: bad.length ? `${bad.length} of ${qs.length} FAQ questions lack a name or acceptedAnswer.text` : `${qs.length} FAQ questions, all with answers` });
    }
    if (types.includes('BreadcrumbList')) {
      const items = [].concat(node.itemListElement || []);
      const bad = items.filter((it, i) => !it || it.position === undefined || !(it.name || it.item?.name) || (i < items.length - 1 && !it.item));
      out.push({ sev: bad.length ? 'warning' : 'pass', msg: bad.length ? `${bad.length} breadcrumb items missing position, name or item URL` : `${items.length} breadcrumb items look complete` });
    }
    const rating = node.aggregateRating;
    if (rating && typeof rating === 'object' && !Array.isArray(rating)) {
      if (rating.ratingValue === undefined) out.push({ sev: 'error', msg: 'aggregateRating has no ratingValue' });
      if (rating.reviewCount === undefined && rating.ratingCount === undefined) out.push({ sev: 'error', msg: 'aggregateRating needs reviewCount or ratingCount' });
    }
    if (!node['@context'] && !node['@id'] && types.length === 0) out.push({ sev: 'warning', msg: 'Entity has no @type' });
    return out;
  }

  // FAQ text in schema should also be visible on the page
  function schemaVisibilityChecks(report, allText) {
    const page = foldText(allText);
    report.schema.jsonld.forEach((j) => j.entities.forEach((e) => {
      if (!typesOf(e.data).includes('FAQPage')) return;
      const qs = [].concat(e.data.mainEntity || []).filter((q) => q && q.name);
      const missing = qs.filter((q) => !page.includes(foldText(stripTags(q.name)).slice(0, 60)));
      if (qs.length) e.checks.push(missing.length
        ? { sev: 'warning', msg: `${missing.length} FAQ question(s) in schema not found in visible page text: ${missing.slice(0, 3).map((q) => `"${stripTags(q.name)}"`).join(', ')}${missing.length > 3 ? '…' : ''}` }
        : { sev: 'pass', msg: 'All FAQ questions in schema also appear in page text' });
    }));
  }
  const stripTags = (s) => String(s).replace(/<[^>]*>/g, ' ');
  const foldText = (s) => norm(String(s)).toLowerCase().replace(/[ً-ٰٟ]/g, '').replace(/[أإآ]/g, 'ا');

  /* =======================================================================
     REGIONS + HIDDEN DETECTION
     ======================================================================= */
  function classTokens(el) { return (el.getAttribute('class') || '').toLowerCase().split(/\s+/); }

  function regionFor(el, cur) {
    const n = el.localName;
    const role = lower(el.getAttribute('role'));
    const id = lower(el.id);
    const cls = classTokens(el);
    const et = lower(el.getAttribute('data-elementor-type'));
    const topLevel = (cur === 'body' || cur === 'main') && !(el.parentElement && el.parentElement.closest('article,section,aside,blockquote,[role="article"]'));

    if (n === 'main' || role === 'main') return 'main';
    if (et === 'header' || cls.includes('elementor-location-header')) return 'header';
    if (et === 'footer' || cls.includes('elementor-location-footer')) return 'footer';
    const isHeader = n === 'header' || role === 'banner' || ['masthead', 'header', 'site-header'].includes(id) || cls.includes('site-header');
    const isFooter = n === 'footer' || role === 'contentinfo' || ['colophon', 'footer', 'site-footer'].includes(id) || cls.includes('site-footer');
    if (isHeader && topLevel) return 'header';
    if (isFooter && topLevel) return 'footer';
    if ((n === 'nav' || role === 'navigation') && (cur === 'body' || cur === 'main')) {
      const label = lower(el.getAttribute('aria-label')) + ' ' + cls.join(' ') + ' ' + id;
      if (/breadcrumb/.test(label)) return cur;
      return 'nav';
    }
    if ((n === 'aside' || role === 'complementary' || id === 'secondary' || cls.includes('sidebar') || cls.includes('widget-area')) &&
        (cur === 'body' || cur === 'main')) return 'aside';
    return cur;
  }

  function hiddenReason(el) {
    if (el.hasAttribute('hidden')) return 'hidden attribute';
    const st = lower(el.getAttribute('style'));
    if (st && /display\s*:\s*none/.test(st)) return 'display:none';
    if (st && /visibility\s*:\s*hidden/.test(st)) return 'visibility:hidden';
    const cls = classTokens(el);
    if (cls.some((c) => ['sr-only', 'screen-reader-text', 'visually-hidden', 'screen-reader-only'].includes(c))) return 'screen-reader only';
    const eh = cls.filter((c) => /^elementor-hidden-(desktop|tablet|mobile|widescreen|laptop|mobile_extra|tablet_extra)$/.test(c))
      .map((c) => c.replace('elementor-hidden-', ''));
    if (eh.length) return `hidden on ${eh.join('/')}`;
    if (cls.some((c) => /^(hidden|d-none|is-hidden)$/.test(c))) return 'hidden class';
    return '';
  }

  /* =======================================================================
     INLINE RENDERING  → { t: plain text, h: safe html, m: markdown }
     ======================================================================= */
  function wrapMd(s, mk) {
    const m = s.match(/^(\s*)([\s\S]*?)(\s*)$/);
    return m[2] ? `${m[1]}${mk}${m[2]}${mk}${m[3]}` : s;
  }

  function inline(nodes, ctx, exclude) {
    let t = '', h = '', m = '';
    for (const c of nodes) {
      if (c.nodeType === 3) {
        const s = c.data.replace(/[\s ]+/g, ' ');
        t += s; h += esc(s); m += mdEsc(s);
        continue;
      }
      if (c.nodeType !== 1) continue;
      const n = c.localName;
      if (SKIP.has(n) || (exclude && exclude.has(n))) continue;
      if (n === 'br') { t += '\n'; h += '<br>'; m += '  \n'; continue; }
      if (n === 'img') {
        const alt = norm(c.getAttribute('alt') || '');
        h += `<span class="inl-img" title="Inline image">🖼 ${esc(alt || 'no alt')}</span>`;
        m += `![${mdEsc(alt)}](${imgSrc(c, ctx.resolve)})`;
        continue;
      }
      if (n === 'input' || n === 'select' || n === 'textarea') continue;
      const r = inline(c.childNodes, ctx, exclude);
      if (n === 'a') {
        const raw = c.getAttribute('href');
        const href = raw ? ctx.resolve(raw) : '';
        const safe = href && !/^\s*javascript:/i.test(href);
        h += safe ? `<a class="il" href="${esc(href)}" target="_blank" rel="noopener noreferrer" title="${esc(href)}">${r.h}</a>` : `<span class="il">${r.h}</span>`;
        m += r.m.trim() && href ? `[${r.m.trim()}](${href})` : r.m;
        t += r.t;
      } else if (n === 'strong' || n === 'b') {
        h += `<strong>${r.h}</strong>`; m += wrapMd(r.m, '**'); t += r.t;
      } else if (n === 'em' || n === 'i' || n === 'cite' || n === 'dfn') {
        h += `<em>${r.h}</em>`; m += wrapMd(r.m, '*'); t += r.t;
      } else if (n === 'code' || n === 'kbd' || n === 'samp') {
        h += `<code>${r.h}</code>`; m += r.t.trim() ? wrapMd(r.t.replace(/`/g, ''), '`') : r.m; t += r.t;
      } else if (n === 'mark') {
        h += `<mark>${r.h}</mark>`; m += r.m; t += r.t;
      } else if (n === 'sup' || n === 'sub') {
        h += `<${n}>${r.h}</${n}>`; m += r.m; t += r.t;
      } else if (!INLINE.has(n)) {
        // block element inside an inline context: keep separation
        t += `\n${r.t}\n`; h += ` ${r.h} `; m += `\n${r.m}\n`;
      } else {
        t += r.t; h += r.h; m += r.m;
      }
    }
    return { t, h, m };
  }

  function finishInline(r) {
    return {
      text: r.t.replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim(),
      html: r.h.trim(),
      md: r.m.replace(/[ \t]+(?=\S)/g, ' ').replace(/\n /g, '\n').replace(/\n{3,}/g, '\n\n').trim(),
    };
  }

  function imgSrc(img, resolve) {
    const cands = [img.getAttribute('src'), img.getAttribute('data-src'), img.getAttribute('data-lazy-src'),
      img.getAttribute('data-original'), img.getAttribute('data-lazy'), img.getAttribute('data-url')];
    const real = cands.find((s) => s && !/^data:/i.test(s.trim()));
    if (real) return resolve(real);
    const srcset = img.getAttribute('srcset') || img.getAttribute('data-srcset') || img.getAttribute('data-lazy-srcset');
    if (srcset) return resolve(srcset.trim().split(/\s+/)[0]);
    return cands.find(Boolean) ? 'data:URI placeholder' : '';
  }

  /* =======================================================================
     CONTENT BLOCKS
     ======================================================================= */
  function extractContent(body, ctx) {
    const blocks = [];
    const regionMap = new WeakMap(); // element -> region (for headings/links/images)
    let hasMain = false;

    const emit = (b, st) => {
      b.region = st.region;
      if (st.hidden) b.hidden = st.hidden;
      blocks.push(b);
    };

    const imageBlock = (img, st) => {
      const src = imgSrc(img, ctx.resolve);
      emit({ type: 'image', src, alt: img.hasAttribute('alt') ? norm(img.getAttribute('alt')) : null,
        title: img.getAttribute('title') || '', width: img.getAttribute('width') || '', height: img.getAttribute('height') || '' }, st);
    };

    const listItems = (list, depth, out) => {
      for (const li of list.children) {
        if (li.localName !== 'li') {
          // some menus wrap li in divs
          if (li.localName === 'ul' || li.localName === 'ol') listItems(li, depth + 1, out);
          continue;
        }
        const r = finishInline(inline(li.childNodes, ctx, new Set(['ul', 'ol'])));
        if (r.text) out.push({ ...r, depth });
        li.querySelectorAll(':scope > ul, :scope > ol, :scope > div > ul, :scope > div > ol').forEach((sub) => listItems(sub, depth + 1, out));
      }
      return out;
    };

    const handleBlock = (el, st) => {
      const n = el.localName;
      if (/^h[1-6]$/.test(n)) {
        const r = finishInline(inline(el.childNodes, ctx));
        if (!r.text) {
          const img = el.querySelector('img[alt]');
          if (img && norm(img.getAttribute('alt'))) { r.text = norm(img.getAttribute('alt')); r.html = esc(r.text) + ' <span class="inl-img">(from image alt)</span>'; r.md = r.text; }
        }
        emit({ type: 'heading', level: +n[1], ...r }, st);
        el.querySelectorAll('img').forEach((img) => imageBlock(img, st));
        return;
      }
      switch (n) {
        case 'p': case 'address': case 'figcaption': case 'summary': case 'dt': case 'dd': case 'caption': case 'legend': {
          const r = finishInline(inline(el.childNodes, ctx));
          if (r.text) emit({ type: n === 'p' ? 'paragraph' : n === 'figcaption' ? 'caption' : 'text', tag: n, ...r }, st);
          el.querySelectorAll('img').forEach((img) => { if (!img.closest('noscript')) imageBlock(img, st); });
          return;
        }
        case 'ul': case 'ol': {
          const complex = el.querySelector('h1,h2,h3,h4,h5,h6,p,table,blockquote,figure,img,picture,iframe,video');
          if (complex) return walk(el, st);
          const items = listItems(el, 0, []);
          if (items.length) emit({ type: 'list', ordered: n === 'ol', items }, st);
          return;
        }
        case 'dl': {
          const items = [];
          el.querySelectorAll('dt, dd').forEach((d) => {
            const r = finishInline(inline(d.childNodes, ctx));
            if (r.text) items.push({ ...r, depth: d.localName === 'dd' ? 1 : 0 });
          });
          if (items.length) emit({ type: 'list', ordered: false, dl: true, items }, st);
          return;
        }
        case 'table': {
          const rows = [];
          for (const tr of el.rows) {
            const cells = [...tr.cells].map((c) => ({ ...finishInline(inline(c.childNodes, ctx)), th: c.localName === 'th' }));
            if (cells.some((c) => c.text)) rows.push(cells);
          }
          const cap = el.caption ? norm(el.caption.textContent) : '';
          if (rows.length) emit({ type: 'table', caption: cap, rows }, st);
          el.querySelectorAll('img').forEach((img) => imageBlock(img, st));
          return;
        }
        case 'blockquote': {
          const r = finishInline(inline(el.childNodes, ctx));
          if (r.text) emit({ type: 'quote', ...r }, st);
          return;
        }
        case 'pre': {
          const text = el.textContent.replace(/\s+$/, '');
          if (text.trim()) emit({ type: 'pre', text, html: esc(text), md: '```\n' + text + '\n```' }, st);
          return;
        }
        case 'img': return imageBlock(el, st);
        case 'picture': { const img = el.querySelector('img'); if (img) imageBlock(img, st); return; }
        case 'hr': return emit({ type: 'hr' }, st);
        case 'iframe': case 'video': case 'audio': {
          let src = el.getAttribute('src') || el.getAttribute('data-src') || el.getAttribute('data-lazy-src') || '';
          if (!src) { const s = el.querySelector('source[src]'); if (s) src = s.getAttribute('src'); }
          emit({ type: 'embed', kind: n, src: src ? ctx.resolve(src) : '', title: el.getAttribute('title') || el.getAttribute('aria-label') || '' }, st);
          return;
        }
        case 'button': {
          const r = finishInline(inline(el.childNodes, ctx));
          const label = r.text || el.getAttribute('aria-label') || el.getAttribute('title') || '';
          if (label) emit({ type: 'button', text: label, html: r.html || esc(label), md: label }, st);
          return;
        }
        case 'input': case 'textarea': case 'select': {
          const type = lower(el.getAttribute('type'));
          if (['hidden'].includes(type)) return;
          if (['submit', 'button', 'reset'].includes(type)) {
            const v = el.getAttribute('value') || type;
            emit({ type: 'button', text: v, html: esc(v), md: v }, st);
            return;
          }
          const label = el.getAttribute('placeholder') || el.getAttribute('aria-label') || el.getAttribute('name') || '';
          emit({ type: 'field', kind: n === 'input' ? (type || 'text') : n, text: label, html: esc(label), md: label,
            required: el.hasAttribute('required') }, st);
          return;
        }
        default:
          return walk(el, st);
      }
    };

    function walk(el, parentSt) {
      // compute state for this element
      const region = regionFor(el, parentSt.region);
      if (region === 'main') hasMain = true;
      const hr = hiddenReason(el);
      const st = { region, hidden: parentSt.hidden || hr };
      regionMap.set(el, region);

      let buf = [];
      const flush = () => {
        if (!buf.length) return;
        const nodes = buf; buf = [];
        const r = finishInline(inline(nodes, ctx));
        if (!r.text) return;
        const els = nodes.filter((x) => x.nodeType === 1);
        const onlyText = nodes.filter((x) => x.nodeType === 3).every((x) => !x.data.trim());
        if (els.length && onlyText && els.every((x) => x.localName === 'a')) {
          // one or more bare links side by side (CTA buttons, footer links): one block each
          els.forEach((a) => {
            const ar = finishInline(inline([a], ctx));
            if (ar.text) emit({ type: 'link', href: ctx.resolve(a.getAttribute('href') || ''), ...ar }, st);
          });
        } else {
          emit({ type: 'text', tag: el.localName, ...r }, st);
        }
      };

      for (const c of el.childNodes) {
        if (c.nodeType === 3) { buf.push(c); continue; }
        if (c.nodeType !== 1) continue;
        const n = c.localName;
        if (SKIP.has(n)) continue;
        if (INLINE.has(n) && !c.querySelector(BLOCK_SELECTOR)) {
          if (hiddenReason(c) && norm(c.textContent)) { // hidden inline span: separate block so it can be flagged
            flush();
            const r = finishInline(inline(c.childNodes, ctx));
            const cst = { region: st.region, hidden: st.hidden || hiddenReason(c) };
            if (r.text) emit({ type: 'text', tag: n, ...r }, cst);
            continue;
          }
          buf.push(c);
          continue;
        }
        flush();
        if (INLINE.has(n)) { walk(c, st); continue; }      // inline wrapping blocks (e.g. <a><div>)
        const cRegion = regionFor(c, st.region);
        const cHidden = st.hidden || hiddenReason(c);
        regionMap.set(c, cRegion);
        if (cRegion === 'main') hasMain = true;
        handleBlock(c, { region: cRegion, hidden: cHidden });
      }
      flush();
    }

    walk(body, { region: 'body', hidden: '' });

    // region lookup for any element (closest mapped ancestor)
    const regionOf = (el) => {
      let cur = el;
      while (cur) { const r = regionMap.get(cur); if (r) return r; cur = cur.parentElement; }
      return 'body';
    };
    return { blocks, hasMain, regionOf };
  }

  function blockText(b) {
    if (b.type === 'list') return b.items.map((i) => i.text).join('\n');
    if (b.type === 'table') return b.rows.map((r) => r.map((c) => c.text).join(' ')).join('\n');
    if (b.type === 'image' || b.type === 'hr' || b.type === 'embed' || b.type === 'field') return '';
    return b.text || '';
  }

  /* =======================================================================
     HEADINGS
     ======================================================================= */
  function extractHeadings(body, regionOf) {
    const list = [];
    let prev = 0;
    const seen = {};
    body.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach((h) => {
      if (h.closest('noscript,template,svg')) return;
      const level = +h.localName[1];
      let text = norm(h.textContent);
      let fromAlt = false;
      if (!text) {
        const img = h.querySelector('img[alt]');
        if (img && norm(img.getAttribute('alt'))) { text = norm(img.getAttribute('alt')); fromAlt = true; }
      }
      const flags = [];
      if (!text) flags.push('empty');
      if (prev && level > prev + 1) flags.push(`skipped H${prev + 1}`);
      if (!prev && level !== 1) flags.push('first heading is not H1');
      if (text.length > 70 && level === 1) flags.push('long H1');
      const key = level + '|' + text.toLowerCase();
      if (text && seen[key]) flags.push('duplicate');
      seen[key] = true;
      let hidden = '';
      for (let el = h; el && el !== body; el = el.parentElement) { hidden = hiddenReason(el); if (hidden) break; }
      list.push({ level, text, fromAlt, region: regionOf(h), flags, hidden, id: h.id || '', length: [...text].length });
      prev = level;
    });
    return list;
  }

  /* =======================================================================
     LINKS
     ======================================================================= */
  function linkType(href, abs, siteHost) {
    const h = (href || '').trim();
    if (!h) return 'empty';
    if (h.startsWith('#')) return 'anchor';
    if (/^mailto:/i.test(h)) return 'email';
    if (/^tel:/i.test(h)) return 'phone';
    if (/^(sms|fax):/i.test(h)) return 'other';
    if (/^javascript:/i.test(h)) return 'javascript';
    if (/^whatsapp:|^https?:\/\/(wa\.me|api\.whatsapp\.com|web\.whatsapp\.com|chat\.whatsapp\.com)/i.test(h)) return 'whatsapp';
    if (/^https?:\/\//i.test(abs) || /^\/\//.test(h)) {
      const host = stripWww(hostOf(abs.startsWith('//') ? 'https:' + abs : abs));
      if (siteHost && (host === siteHost || host.endsWith('.' + siteHost))) return 'internal';
      return siteHost ? 'external' : (/^https?:\/\//i.test(h) ? 'external' : 'internal');
    }
    return 'internal'; // relative URL
  }

  function extractLinks(body, ctx, regionOf) {
    const items = [];
    const counts = {};
    body.querySelectorAll('a').forEach((a) => {
      if (a.closest('noscript,template')) return;
      const href = a.getAttribute('href');
      if (href === null) return;
      const abs = ctx.resolve(href);
      let text = norm(finishInline(inline(a.childNodes, ctx)).text), source = 'text';
      if (!text) {
        const img = a.querySelector('img');
        if (img && norm(img.getAttribute('alt'))) { text = norm(img.getAttribute('alt')); source = 'image alt'; }
        else if (a.getAttribute('aria-label')) { text = norm(a.getAttribute('aria-label')); source = 'aria-label'; }
        else if (a.getAttribute('title')) { text = norm(a.getAttribute('title')); source = 'title'; }
        else source = 'none';
      }
      const rel = lower(a.getAttribute('rel'));
      const type = linkType(href, abs, ctx.siteHost);
      const flags = [];
      if (source === 'none') flags.push('no anchor text');
      if (GENERIC_ANCHORS.has(text.toLowerCase().replace(/[.!»›→…]+$/, '').trim())) flags.push('generic anchor');
      if (type === 'internal' && /\bnofollow\b/.test(rel)) flags.push('nofollow on internal');
      if (type === 'javascript') flags.push('javascript link');
      if (href.trim() === '#' || href.trim() === '') flags.push('empty/# href');
      if (a.getAttribute('target') === '_blank' && type === 'external' && !/noopener|noreferrer/.test(rel)) flags.push('no noopener');
      if (/^http:\/\//i.test(abs) && /^https:/i.test(ctx.baseUrl || '')) flags.push('http (not https)');
      counts[abs] = (counts[abs] || 0) + 1;
      items.push({ text, source, href, abs, type, rel, target: a.getAttribute('target') || '',
        region: regionOf(a), hasImage: !!a.querySelector('img'), flags, title: a.getAttribute('title') || '' });
    });
    items.forEach((l) => { l.occurrences = counts[l.abs]; });
    const by = (t) => items.filter((l) => l.type === t).length;
    return {
      items,
      summary: {
        total: items.length, unique: Object.keys(counts).length,
        internal: by('internal'), external: by('external'), anchor: by('anchor'), whatsapp: by('whatsapp'),
        phone: by('phone'), email: by('email'), javascript: by('javascript'),
        nofollow: items.filter((l) => /nofollow/.test(l.rel)).length,
        withIssues: items.filter((l) => l.flags.length).length,
        uniqueExternalDomains: [...new Set(items.filter((l) => l.type === 'external').map((l) => stripWww(hostOf(l.abs))))].filter(Boolean),
      },
    };
  }

  /* =======================================================================
     IMAGES
     ======================================================================= */
  function extractImages(body, ctx, regionOf, head) {
    const items = [];
    const genericName = /^(img|image|dsc|photo|pic|screenshot|untitled|whatsapp-image|wp-image|pexels|unsplash|shutterstock|depositphotos|\d+|[a-f0-9]{16,})[-_\s]?[\w-]*$/i;
    body.querySelectorAll('img').forEach((img) => {
      if (img.closest('noscript,template')) return;
      const src = imgSrc(img, ctx.resolve);
      const alt = img.hasAttribute('alt') ? norm(img.getAttribute('alt')) : null;
      const file = (src.split('?')[0].split('#')[0].split('/').pop() || '');
      const ext = (file.match(/\.([a-z0-9]+)$/i) || [, ''])[1].toLowerCase();
      const flags = [];
      const link = img.closest('a[href]');
      if (alt === null) flags.push('alt missing');
      else if (alt === '' && link) flags.push('empty alt on linked image');
      else if (alt === '') flags.push('empty alt (decorative)');
      else if (alt.length > 125) flags.push('alt > 125 chars');
      if (alt && /\.(jpe?g|png|webp|gif|svg|avif)$/i.test(alt)) flags.push('alt looks like a filename');
      if (!img.getAttribute('width') || !img.getAttribute('height')) flags.push('no width/height');
      if (src === 'data:URI placeholder') flags.push('lazy placeholder only');
      const base = file.replace(/\.[a-z0-9]+$/i, '');
      if (base && genericName.test(base)) flags.push('non-descriptive filename');
      if (['jpg', 'jpeg', 'png', 'gif', 'bmp'].includes(ext)) flags.push('legacy format (consider WebP/AVIF)');
      items.push({
        src, file, ext, alt, title: img.getAttribute('title') || '',
        width: img.getAttribute('width') || '', height: img.getAttribute('height') || '',
        loading: img.getAttribute('loading') || '', fetchpriority: img.getAttribute('fetchpriority') || '',
        srcset: img.getAttribute('srcset') || img.getAttribute('data-srcset') || '', sizes: img.getAttribute('sizes') || '',
        region: regionOf(img), linkTo: link ? ctx.resolve(link.getAttribute('href')) : '', flags, kind: 'img',
      });
    });
    // CSS background images set inline (common in Elementor / page builders)
    body.querySelectorAll('[style*="url("]').forEach((el) => {
      const st = el.getAttribute('style') || '';
      const re = /url\((['"]?)(.*?)\1\)/g; let mm;
      while ((mm = re.exec(st))) {
        if (/^data:/i.test(mm[2])) continue;
        const src = ctx.resolve(mm[2]);
        const file = src.split('?')[0].split('/').pop();
        items.push({ src, file, ext: (file.match(/\.([a-z0-9]+)$/i) || [, ''])[1].toLowerCase(), alt: null, title: '',
          width: '', height: '', loading: '', fetchpriority: '', srcset: '', sizes: '', region: regionOf(el), linkTo: '',
          flags: ['CSS background (no alt possible)'], kind: 'background' });
      }
    });
    const imgs = items.filter((i) => i.kind === 'img');
    return {
      items,
      ogImage: (head.og['og:image'] || [])[0] || null,
      summary: {
        total: imgs.length, backgrounds: items.length - imgs.length,
        missingAlt: imgs.filter((i) => i.alt === null).length,
        emptyAlt: imgs.filter((i) => i.alt === '').length,
        withAlt: imgs.filter((i) => i.alt).length,
        noDims: imgs.filter((i) => !i.width || !i.height).length,
        lazy: imgs.filter((i) => i.loading === 'lazy').length,
        formats: imgs.reduce((o, i) => { const k = i.ext || 'unknown'; o[k] = (o[k] || 0) + 1; return o; }, {}),
      },
    };
  }

  /* =======================================================================
     TEXT STATS + KEYWORDS
     ======================================================================= */
  const WORD_RE = /[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu;
  const foldWord = (w) => w.toLowerCase().replace(/[ً-ٰٟـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/’/g, "'");

  function words(text) { return (text.match(WORD_RE) || []); }

  function textStats(mainText, allText, html, blocks) {
    const mw = words(mainText), aw = words(allText);
    const sentences = mainText.split(/(?<=[.!?؟。])\s+|\n+/).map((s) => s.trim()).filter((s) => words(s).length >= 3);
    const arabic = (mainText.match(/[؀-ۿ]/g) || []).length;
    const latin = (mainText.match(/[A-Za-z]/g) || []).length;
    const visibleLen = norm(allText).length;
    return {
      mainWords: mw.length, allWords: aw.length,
      mainChars: norm(mainText).length,
      sentences: sentences.length,
      avgSentence: sentences.length ? Math.round(mw.length / sentences.length * 10) / 10 : 0,
      longSentences: sentences.filter((s) => words(s).length > 25).length,
      paragraphs: blocks.filter((b) => b.type === 'paragraph').length,
      textBlocks: blocks.filter((b) => b.type === 'text').length,
      lists: blocks.filter((b) => b.type === 'list').length,
      tables: blocks.filter((b) => b.type === 'table').length,
      readingMin: Math.max(1, Math.round(mw.length / 200)),
      textRatio: html.length ? Math.round(visibleLen / html.length * 1000) / 10 : 0,
      script: arabic + latin === 0 ? 'unknown' : arabic > latin * 2 ? 'Arabic' : latin > arabic * 2 ? 'Latin (English)' : 'Mixed Arabic + Latin',
      arabicShare: arabic + latin ? Math.round(arabic / (arabic + latin) * 100) : 0,
    };
  }

  function keywordStats(text) {
    const toks = words(text).map((w) => ({ raw: w, k: foldWord(w) }));
    const total = toks.length;
    const isStop = (k) => STOP_EN.has(k) || STOP_AR.has(k) || /^\d+$/.test(k) || k.length < 2;
    const grams = (n) => {
      const map = new Map();
      const lines = text.split(/[\n.!?؟,;:|()"“”«»]+/);
      for (const line of lines) {
        const lt = words(line).map(foldWord);
        for (let i = 0; i + n <= lt.length; i++) {
          const g = lt.slice(i, i + n);
          if (isStop(g[0]) || isStop(g[n - 1])) continue;
          if (n === 1 && isStop(g[0])) continue;
          const key = g.join(' ');
          map.set(key, (map.get(key) || 0) + 1);
        }
      }
      return [...map.entries()].filter(([, c]) => n === 1 || c > 1).sort((a, b) => b[1] - a[1]).slice(0, 30)
        .map(([phrase, count]) => ({ phrase, count, density: total ? Math.round(count * n / total * 1000) / 10 : 0 }));
    };
    return { totalWords: total, uniqueWords: new Set(toks.map((t) => t.k)).size, one: grams(1), two: grams(2), three: grams(3) };
  }

  function keywordCheck(report, keyword) {
    const kw = foldText(keyword);
    if (!kw) return null;
    const re = new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
    const count = (s) => (foldText(s || '').match(re) || []).length;
    const main = report.content.blocks.filter((b) => b.region === 'main' || b.region === 'body');
    const mainText = main.map(blockText).join('\n');
    const firstPara = (main.find((b) => (b.type === 'paragraph' || b.type === 'text') && words(b.text || '').length > 8) || {}).text || '';
    const occ = count(mainText);
    const kwWords = words(keyword).length || 1;
    const h1s = report.headings.filter((h) => h.level === 1).map((h) => h.text).join(' ');
    const subs = report.headings.filter((h) => h.level > 1);
    let url = report.meta.baseUrl || '';
    try { url = decodeURIComponent(url); } catch {}
    const slugKw = kw.replace(/\s+/g, '-');
    return {
      keyword, occurrences: occ,
      density: report.stats.mainWords ? Math.round(occ * kwWords / report.stats.mainWords * 1000) / 10 : 0,
      checks: [
        ['Title tag', count(report.head.title) > 0],
        ['Meta description', count(report.head.description) > 0],
        ['H1', count(h1s) > 0],
        [`Subheadings (H2–H6): ${subs.filter((h) => count(h.text)).length} of ${subs.length}`, subs.some((h) => count(h.text))],
        ['First paragraph', count(firstPara) > 0],
        ['URL / slug', url ? foldText(url).includes(slugKw) || foldText(url).includes(kw) : null],
        [`Image alt text: ${report.images.items.filter((i) => count(i.alt)).length} images`, report.images.items.some((i) => count(i.alt))],
        ['Open Graph title', count((report.head.og['og:title'] || [])[0]) > 0],
        ['Internal link anchors', report.links.items.some((l) => l.type === 'internal' && count(l.text))],
      ],
    };
  }

  /* =======================================================================
     TECHNOLOGY / TRACKING DETECTION
     ======================================================================= */
  function detectTech(doc, html, head) {
    const found = [];
    const add = (name, cat, evidence) => { if (!found.some((f) => f.name === name)) found.push({ name, cat, evidence }); };
    const gen = head.generator.join(' | ');
    const srcs = head.scripts.map((s) => s.src).join('\n') + '\n' + head.stylesheets.join('\n');
    const inlineJs = [...doc.querySelectorAll('script:not([src])')].map((s) => s.textContent).join('\n');
    const comments = [];
    const tw = doc.createTreeWalker(doc, NodeFilter.SHOW_COMMENT);
    while (tw.nextNode()) { const c = norm(tw.currentNode.data); if (c) comments.push(c); }
    const allComments = comments.join('\n');

    if (/wordpress/i.test(gen) || /\/wp-(content|includes)\//.test(html)) add('WordPress', 'CMS', /wordpress/i.test(gen) ? `generator: ${gen}` : '/wp-content/ paths');
    if (/yoast/i.test(allComments) || doc.querySelector('.yoast-schema-graph')) add('Yoast SEO', 'SEO plugin', 'Yoast comment / schema class');
    if (/rank math/i.test(allComments) || doc.querySelector('.rank-math-schema, .rank-math-schema-pro')) add('Rank Math', 'SEO plugin', 'Rank Math comment / schema class');
    if (/all in one seo|aioseo/i.test(allComments + html.slice(0, 200000))) add('All in One SEO', 'SEO plugin', 'AIOSEO markers');
    if (/seopress/i.test(allComments)) add('SEOPress', 'SEO plugin', 'comment');
    if (/elementor/i.test(gen) || doc.querySelector('[data-elementor-type], .elementor')) add('Elementor', 'Page builder', 'elementor classes');
    if (doc.querySelector('.et_pb_section, #et-boc')) add('Divi', 'Page builder', 'et_pb classes');
    if (doc.querySelector('.vc_row, .wpb_row')) add('WPBakery', 'Page builder', 'vc_row classes');
    if (/woocommerce/i.test(gen) || doc.querySelector('.woocommerce')) add('WooCommerce', 'E-commerce', 'woocommerce classes');
    if (/astra/i.test(srcs)) add('Astra theme', 'Theme', 'astra assets');
    if (/litespeed/i.test(allComments + srcs)) add('LiteSpeed Cache', 'Performance', 'LiteSpeed markers');
    if (/wp-rocket|WP Rocket/i.test(allComments + srcs)) add('WP Rocket', 'Performance', 'WP Rocket markers');
    if (doc.getElementById('__next') || /\/_next\/static\//.test(srcs) || doc.getElementById('__NEXT_DATA__')) add('Next.js', 'Framework', doc.getElementById('__NEXT_DATA__') ? '__NEXT_DATA__ (Pages Router)' : '/_next/static/ assets');
    if (/self\.__next_f/.test(inlineJs)) add('Next.js App Router (RSC)', 'Framework', 'self.__next_f payload');
    if (doc.getElementById('__nuxt') || /\/_nuxt\//.test(srcs)) add('Nuxt', 'Framework', '__nuxt');
    if (doc.getElementById('___gatsby')) add('Gatsby', 'Framework', '___gatsby');
    if (/astro-island|data-astro/i.test(html.slice(0, 500000))) add('Astro', 'Framework', 'astro markers');
    if (/cdn\.shopify\.com|Shopify\.theme/i.test(srcs + inlineJs)) add('Shopify', 'CMS', 'Shopify assets');
    if (/wix\.com|wixstatic/i.test(srcs)) add('Wix', 'CMS', 'wixstatic');
    if (/webflow/i.test(gen + srcs) || doc.documentElement.hasAttribute('data-wf-page')) add('Webflow', 'CMS', 'webflow markers');
    if (/squarespace/i.test(srcs + gen)) add('Squarespace', 'CMS', 'squarespace assets');
    if (/tailwind/i.test(srcs) || doc.querySelector('[class*="md:"], [class*="lg:"]')) add('Tailwind CSS (likely)', 'CSS', 'responsive utility classes');
    if (/bootstrap/i.test(srcs)) add('Bootstrap', 'CSS', 'bootstrap assets');
    if (/jquery/i.test(srcs)) add('jQuery', 'JS library', 'jquery script');
    if (/cloudflare|cdn-cgi/i.test(srcs + html.slice(0, 300000))) add('Cloudflare', 'CDN', 'cdn-cgi / cloudflare');

    const blob = srcs + '\n' + inlineJs;
    const gtm = blob.match(/GTM-[A-Z0-9]{4,10}/g);
    if (gtm) add('Google Tag Manager', 'Tracking', [...new Set(gtm)].join(', '));
    const ga4 = blob.match(/\bG-[A-Z0-9]{6,12}\b/g);
    if (ga4) add('Google Analytics 4', 'Tracking', [...new Set(ga4)].join(', '));
    const ua = blob.match(/\bUA-\d{4,10}-\d{1,4}\b/g);
    if (ua) add('Universal Analytics (retired)', 'Tracking', [...new Set(ua)].join(', '));
    const aw = blob.match(/\bAW-\d{6,12}\b/g);
    if (aw) add('Google Ads tag', 'Tracking', [...new Set(aw)].join(', '));
    if (/connect\.facebook\.net\/.*fbevents|fbq\(/.test(blob)) add('Meta Pixel', 'Tracking', (blob.match(/fbq\(\s*['"]init['"]\s*,\s*['"](\d+)/) || [, 'fbevents.js'])[1]);
    if (/analytics\.tiktok\.com|ttq\.load/.test(blob)) add('TikTok Pixel', 'Tracking', 'ttq');
    if (/snap\.licdn|_linkedin_partner_id/.test(blob)) add('LinkedIn Insight', 'Tracking', 'linkedin partner id');
    if (/sc-static\.net\/scevent|snaptr\(/.test(blob)) add('Snap Pixel', 'Tracking', 'snaptr');
    if (/clarity\.ms/.test(blob)) add('Microsoft Clarity', 'Tracking', 'clarity.ms');
    if (/hotjar/.test(blob)) add('Hotjar', 'Tracking', 'hotjar');
    if (/bat\.bing\.com/.test(blob)) add('Microsoft Ads UET', 'Tracking', 'bat.bing.com');
    if (/recaptcha/.test(blob)) add('Google reCAPTCHA', 'Security', 'recaptcha');
    if (/tawk\.to|tidio|crisp\.chat|livechatinc|intercom/i.test(blob)) add('Live chat widget', 'Chat', 'chat script');
    if (/googleapis\.com\/maps|maps\.google/.test(blob + html.slice(0, 500000))) add('Google Maps', 'Embed', 'maps');

    const nextDataEl = doc.getElementById('__NEXT_DATA__');
    let nextData = null;
    if (nextDataEl) { try { const d = JSON.parse(nextDataEl.textContent); nextData = { page: d.page, buildId: d.buildId, locale: d.locale, size: nextDataEl.textContent.length }; } catch {} }

    return { found, comments: comments.slice(0, 200), nextData };
  }

  /* =======================================================================
     SEO CHECKS
     ======================================================================= */
  function runChecks(r) {
    const out = [];
    const add = (sev, cat, msg, detail = '') => out.push({ sev, cat, msg, detail });
    const h = r.head;

    // Title
    if (!h.title) add('error', 'Meta', 'Missing <title> tag');
    else {
      if (h.titles.length > 1) add('warning', 'Meta', `${h.titles.length} <title> tags found`, h.titles.join(' | '));
      if (h.titleLen < 30) add('warning', 'Meta', `Title is short (${h.titleLen} chars)`, 'Aim for roughly 30–60 characters.');
      else if (h.titlePx > 580 || h.titleLen > 60) add('warning', 'Meta', `Title may be truncated in Google (${h.titleLen} chars, ~${h.titlePx}px)`, 'Google desktop shows about 580–600px.');
      else add('pass', 'Meta', `Title length OK (${h.titleLen} chars, ~${h.titlePx}px)`);
    }
    // Description
    if (!h.description) add('error', 'Meta', 'Missing meta description');
    else {
      if (h.descriptions.length > 1) add('warning', 'Meta', `${h.descriptions.length} meta descriptions found`);
      if (h.descLen < 70) add('warning', 'Meta', `Meta description is short (${h.descLen} chars)`, 'Aim for roughly 120–160 characters.');
      else if (h.descLen > 160 || h.descPx > 920) add('notice', 'Meta', `Meta description may be truncated (${h.descLen} chars, ~${h.descPx}px)`);
      else add('pass', 'Meta', `Meta description length OK (${h.descLen} chars)`);
    }
    // Canonical
    if (!h.canonicals.length) add('warning', 'Indexing', 'No canonical tag');
    else if (h.canonicals.length > 1) add('error', 'Indexing', `${h.canonicals.length} canonical tags (Google may ignore all)`, h.canonicals.join(' | '));
    else {
      add('pass', 'Indexing', 'Canonical tag present', h.canonicals[0]);
      if (!/^https?:\/\//i.test(h.canonicalRaw[0])) add('notice', 'Indexing', 'Canonical URL is relative; absolute URLs are safer');
      const ogu = (h.og['og:url'] || [])[0];
      if (ogu && ogu.replace(/\/$/, '') !== h.canonicals[0].replace(/\/$/, '')) add('notice', 'Social', 'og:url differs from canonical', `og:url: ${ogu}`);
      if (r.meta.baseSource === 'URL you entered' && r.meta.baseUrl && r.meta.baseUrl.replace(/[?#].*$/, '').replace(/\/$/, '') !== h.canonicals[0].replace(/\/$/, ''))
        add('notice', 'Indexing', 'Canonical points to a different URL than the one you entered', h.canonicals[0]);
    }
    // Robots
    const robots = [...h.robots, ...h.googlebot].join(', ').toLowerCase();
    if (/noindex/.test(robots)) add('error', 'Indexing', 'Page is set to NOINDEX', robots);
    if (/nofollow/.test(robots)) add('warning', 'Indexing', 'Meta robots NOFOLLOW', robots);
    if (/none/.test(robots)) add('error', 'Indexing', 'Meta robots "none" (noindex, nofollow)');
    if (!/noindex|none/.test(robots)) add('pass', 'Indexing', robots ? `Indexable (robots: ${robots})` : 'Indexable (no robots restrictions)');
    // Basics
    if (!h.lang) add('warning', 'Technical', 'No lang attribute on <html>');
    else add('pass', 'Technical', `Language declared: ${h.lang}${h.dir ? ` (dir=${h.dir})` : ''}`);
    if (r.stats.script === 'Arabic' && h.dir !== 'rtl') add('warning', 'Technical', 'Arabic content but <html> has no dir="rtl"');
    if (r.stats.script === 'Arabic' && h.lang && !/^ar/i.test(h.lang)) add('warning', 'Technical', `Content is mostly Arabic but lang="${h.lang}"`);
    if (!h.viewport) add('error', 'Technical', 'No viewport meta tag (not mobile-friendly)');
    if (!h.charset) add('notice', 'Technical', 'No charset declaration found');
    if (!h.icons.length) add('notice', 'Technical', 'No favicon link tag');
    // Hreflang
    if (h.hreflang.length) {
      const langs = h.hreflang.map((x) => x.lang.toLowerCase());
      if (!langs.includes('x-default')) add('notice', 'International', 'hreflang set without x-default');
      if (h.canonicals[0] && !h.hreflang.some((x) => x.href.replace(/\/$/, '') === h.canonicals[0].replace(/\/$/, ''))) add('warning', 'International', 'hreflang has no self-referencing entry for the canonical URL');
      const dup = langs.filter((l, i) => langs.indexOf(l) !== i);
      if (dup.length) add('warning', 'International', `Duplicate hreflang values: ${[...new Set(dup)].join(', ')}`);
      add('pass', 'International', `${h.hreflang.length} hreflang alternates`);
    }
    // Headings
    const h1 = r.headings.filter((x) => x.level === 1);
    if (!h1.length) add('error', 'Headings', 'No H1 heading');
    else if (h1.length > 1) add('warning', 'Headings', `${h1.length} H1 headings`, h1.map((x) => x.text).join(' | '));
    else add('pass', 'Headings', 'Exactly one H1', h1[0].text);
    if (h1.some((x) => !x.text)) add('error', 'Headings', 'Empty H1');
    const skipped = r.headings.filter((x) => x.flags.some((f) => f.startsWith('skipped')));
    if (skipped.length) add('notice', 'Headings', `${skipped.length} heading level skip(s)`, skipped.slice(0, 5).map((x) => `H${x.level}: ${x.text}`).join(' | '));
    const empty = r.headings.filter((x) => !x.text);
    if (empty.length) add('warning', 'Headings', `${empty.length} empty heading(s)`);
    const hidH = r.headings.filter((x) => x.hidden);
    if (hidH.length) add('notice', 'Headings', `${hidH.length} heading(s) inside hidden elements`, hidH.slice(0, 5).map((x) => `H${x.level}: ${x.text} (${x.hidden})`).join(' | '));
    const dupH = r.headings.filter((x) => x.flags.includes('duplicate'));
    if (dupH.length) add('notice', 'Headings', `${dupH.length} duplicate heading(s)`, [...new Set(dupH.map((x) => x.text))].slice(0, 5).join(' | '));
    if (h1.length && h.title && h1[0].text.toLowerCase() === h.title.toLowerCase()) add('notice', 'Headings', 'H1 is identical to the title tag (fine, but a variation can target more queries)');
    // Content
    if (r.stats.mainWords < 300) add('warning', 'Content', `Thin main content: ${r.stats.mainWords} words`);
    else add('pass', 'Content', `${r.stats.mainWords} words of main content`);
    if (r.stats.longSentences > 5) add('notice', 'Content', `${r.stats.longSentences} sentences longer than 25 words`);
    if (r.stats.textRatio < 10) add('notice', 'Content', `Low text-to-HTML ratio (${r.stats.textRatio}%)`);
    const hiddenBlocks = r.content.blocks.filter((b) => b.hidden && blockText(b));
    if (hiddenBlocks.length) add('notice', 'Content', `${hiddenBlocks.length} content block(s) are hidden (display:none, device-hidden, etc.)`);
    // Images
    const im = r.images.summary;
    if (im.missingAlt) add('warning', 'Images', `${im.missingAlt} of ${im.total} images have no alt attribute`);
    else if (im.total) add('pass', 'Images', 'All images have an alt attribute');
    const linkedEmpty = r.images.items.filter((i) => i.flags.includes('empty alt on linked image')).length;
    if (linkedEmpty) add('warning', 'Images', `${linkedEmpty} linked image(s) with empty alt (link has no text)`);
    if (im.noDims) add('notice', 'Images', `${im.noDims} image(s) without width/height (layout shift risk)`);
    const legacy = r.images.items.filter((i) => i.flags.some((f) => f.startsWith('legacy'))).length;
    if (legacy) add('notice', 'Images', `${legacy} image(s) in JPG/PNG/GIF; WebP or AVIF is lighter`);
    // Links
    const L = r.links.summary;
    if (!L.internal) add('warning', 'Links', 'No internal links found');
    else add('pass', 'Links', `${L.internal} internal links, ${L.external} external`);
    const noText = r.links.items.filter((l) => l.flags.includes('no anchor text')).length;
    if (noText) add('warning', 'Links', `${noText} link(s) without any anchor text`);
    const generic = r.links.items.filter((l) => l.flags.includes('generic anchor')).length;
    if (generic) add('notice', 'Links', `${generic} link(s) with generic anchor text ("read more", "click here"…)`);
    const nfInt = r.links.items.filter((l) => l.flags.includes('nofollow on internal')).length;
    if (nfInt) add('warning', 'Links', `${nfInt} internal link(s) are nofollow`);
    const http = r.links.items.filter((l) => l.flags.includes('http (not https)')).length;
    if (http) add('notice', 'Links', `${http} link(s) use http://`);
    // Social
    const ogNeed = ['og:title', 'og:description', 'og:image', 'og:url', 'og:type'];
    const ogMiss = ogNeed.filter((k) => !h.og[k]);
    if (ogMiss.length === ogNeed.length) add('warning', 'Social', 'No Open Graph tags');
    else if (ogMiss.length) add('notice', 'Social', `Missing Open Graph: ${ogMiss.join(', ')}`);
    else add('pass', 'Social', 'Core Open Graph tags present');
    if (!h.twitter['twitter:card']) add('notice', 'Social', 'No twitter:card tag');
    // Schema
    const sc = r.schema;
    if (!sc.jsonld.length && !sc.microdata.length && !sc.rdfa.length) add('warning', 'Schema', 'No structured data found');
    else add('pass', 'Schema', `Structured data types: ${Object.keys(sc.typeCounts).slice(0, 12).join(', ')}`);
    sc.jsonld.filter((j) => !j.valid).forEach((j) => add('error', 'Schema', `JSON-LD block #${j.index} is invalid JSON`, j.error));
    sc.jsonld.forEach((j) => j.entities.forEach((e) => e.checks.filter((c) => c.sev !== 'pass')
      .forEach((c) => add(c.sev, 'Schema', `${[].concat(e.type).join(', ')}: ${c.msg}`))));
    // Mixed content
    if (/^https:/i.test(r.meta.baseUrl)) {
      const mixed = [...r.images.items.map((i) => i.src), ...h.scripts.map((s) => s.src), ...h.stylesheets].filter((u) => /^http:\/\//i.test(u));
      if (mixed.length) add('warning', 'Technical', `${mixed.length} resource(s) loaded over http:// (mixed content)`, mixed.slice(0, 5).join(' | '));
    }
    if (h.keywordsMeta) add('notice', 'Meta', 'meta keywords tag present (ignored by Google)');
    if (r.tech.found.some((t) => t.name.startsWith('Universal Analytics'))) add('notice', 'Technical', 'Universal Analytics (UA-) code found; it stopped processing data in 2023');

    const order = { error: 0, warning: 1, notice: 2, pass: 3 };
    return out.sort((a, b) => order[a.sev] - order[b.sev]);
  }

  /* =======================================================================
     MARKDOWN
     ======================================================================= */
  function blockToMd(b) {
    switch (b.type) {
      case 'heading': return `${'#'.repeat(b.level)} ${b.md || b.text}`;
      case 'paragraph': case 'text': case 'caption': return b.md || b.text;
      case 'link': return b.md || `[${b.text}](${b.href})`;
      case 'quote': return (b.md || b.text).split('\n').map((l) => `> ${l}`).join('\n');
      case 'pre': return b.md;
      case 'list': return b.items.map((it, i) => `${'  '.repeat(it.depth)}${b.ordered ? `${i + 1}.` : '-'} ${it.md || it.text}`).join('\n');
      case 'table': {
        const rows = b.rows.map((r) => r.map((c) => (c.md || c.text).replace(/\|/g, '\\|').replace(/\n/g, ' ')));
        const w = Math.max(...rows.map((r) => r.length));
        const pad = (r) => [...r, ...Array(w - r.length).fill('')];
        const lines = [`| ${pad(rows[0]).join(' | ')} |`, `| ${Array(w).fill('---').join(' | ')} |`, ...rows.slice(1).map((r) => `| ${pad(r).join(' | ')} |`)];
        return (b.caption ? `**${b.caption}**\n\n` : '') + lines.join('\n');
      }
      case 'image': return `![${b.alt ?? ''}](${b.src})`;
      case 'embed': return `[Embedded ${b.kind}${b.title ? `: ${b.title}` : ''}](${b.src})`;
      case 'button': return `**[Button: ${b.text}]**`;
      case 'field': return `_[Form field (${b.kind}): ${b.text}]_`;
      case 'hr': return '---';
      default: return b.text || '';
    }
  }

  const isStopWord = (k) => STOP_EN.has(k) || STOP_AR.has(k) || /^\d+$/.test(k) || k.length < 2;
  return { analyze, keywordCheck, blockToMd, blockText, esc, foldText, foldWord, words, isStopWord };
})();
