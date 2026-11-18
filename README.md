# HTML Content Extractor

A local SEO and content analysis tool. Paste a page's full HTML and it pulls out every piece of content: head and meta tags, Open Graph, schema, headings, body content in order, links and images. It also runs SEO checks.

Plain HTML, CSS and JavaScript. No install, no build step and no server. It works offline, and your HTML never leaves your computer.

## How to run

1. Unzip the folder anywhere on your PC.
2. Double-click `index.html` to open it in Chrome, Edge or Firefox.

## Projects and bulk extraction

- **Projects:** use the bar at the top to create one project per client or website, and switch, rename or delete them. Pages are saved in this browser (IndexedDB), so they are still there next time you open the app. **Backup** downloads the whole project as one `.json` file and **Import** restores it, on this PC or another.
- **Add pages one by one:** paste the HTML, enter the page URL and click **Add & paste next** (Ctrl + Shift + Enter) to queue the next page, or **Add & open page** (Ctrl + Enter) to review it right away. Adding a URL that is already in the project replaces that page.
- **Review each page:** click a page in the sidebar to see its full report, with every tab and every export. The ← → buttons step through pages, and the tab you are on stays open, so you can check the same thing on each page quickly. Use **Replace HTML** to update a page, or **Remove page** to delete it.
- **All pages · compare:**
  - **Comparison:** one sortable table covering every page (title and description length, H1, words, H2s, images without alt, links, schema, indexable, canonical, maximum similarity, errors, warnings). Download it as CSV.
  - **Duplicates & cannibalization:** duplicate titles, meta descriptions, H1s and canonicals, missing elements, and pairs of pages whose title + H1 target the same words, with the shared and different words shown.
  - **Near-duplicate content:** a similarity matrix and page pairs, using the main content only. *Template similarity* hides the words that make each page different (city or service), so it catches location pages that are the same text with the city name swapped, and lists the repeated sentences.
  - **Internal link map:** links between the pages in the project, split into body content vs menu/footer, with orphan pages, anchor texts, a link matrix and the most-linked internal URLs you haven't added yet.
  - **AI prompts:** one prompt covering all pages, to differentiate near-duplicates, write unique titles and metas, plan internal links or resolve cannibalization.
- **AI prompt tab (per page):** builds a ready-to-paste prompt for rewriting, a content brief, an audit, meta options, FAQ + schema, translation and localization, or making the page unique against similar pages in the project.

## How to get the HTML

Open the page in Chrome, then:

1. Right-click the page and choose **Inspect**.
2. In the Elements panel, right-click the `<html>` tag.
3. Choose **Copy → Copy element**.
4. Paste it into the tool and press **Analyze page** (or Ctrl + Enter).

You can also drop or open a saved `.html` file. Entering the page URL is optional. It helps resolve relative links and tell internal links from external ones. If you leave it empty, the tool uses the canonical or og:url tag instead.

## What you get

| Tab | Contents |
| --- | --- |
| Overview | Google search preview (title/description truncated by pixel width), key stats, every check sorted by severity |
| Meta & Head | Title and description with length and pixel meters, canonical, robots, viewport, lang/dir, favicon, Open Graph preview card, Twitter, hreflang, verification tags, every meta tag and link tag |
| Schema | Every JSON-LD block as a collapsible tree (Yoast/Rank Math `@graph` split into entities), recommended-property checks (LocalBusiness/MovingCompany, Organization, FAQPage, BreadcrumbList, Article, Product, Service…), FAQ text checked against the visible page, Microdata, RDFa, links to Google's Rich Results Test |
| Headings | H1–H6 outline with indentation, skipped levels, empty, duplicate and hidden headings, and section labels |
| Content | Every block in valid form (headings, paragraphs, lists, tables, images, links, buttons, embeds, form fields), grouped by Header / Navigation / Main / Sidebar / Footer or shown in document order. Text inside Elementor and Next.js `div`s is captured too. Hidden blocks (display:none, Elementor "hidden on desktop/mobile", screen-reader only, accordions) are flagged |
| Links | Anchor text, resolved URL, type (internal, external, WhatsApp, phone, email, #anchor), rel and target, section, occurrences, and issues (empty anchor, "read more", nofollow on internal links…) |
| Images | Preview, file, alt (missing vs empty), dimensions, lazy loading, section, lazy-load placeholders resolved to their real `data-src`, inline CSS background images |
| Keywords | Focus keyword check (title, description, H1, subheadings, first paragraph, URL, alt, OG title, anchors), word, sentence and reading stats, top 1-, 2- and 3-word phrases with density. Arabic and English stop words are skipped |
| Technical | Platform and plugin detection (WordPress, Yoast, Rank Math, Elementor, Next.js, Shopify…), tracking IDs (GTM, GA4, Google Ads, Meta Pixel, TikTok…), scripts, stylesheets, resource hints, HTML comments |
| AI prompt | Prompt / content brief built from this page's data, with goal, target keyword and output language |
| Export | Main content as Markdown, full report as Markdown, full JSON, CSV for links, images, headings, meta and content (UTF-8 BOM, so Arabic displays correctly in Excel), and print / save as PDF |

## Files

```
index.html     page layout
styles.css     styles (light + dark mode, print layout)
js/parser.js   extraction engine (DOMParser; scripts in the pasted HTML never run)
js/bulk.js     cross-page analysis: comparison, duplicates, similarity, link map
js/prompts.js  AI prompt / content brief templates
js/app.js      interface, projects and storage, tabs, copy and exports
js/sample.js   fictional sample pages for "Load sample pages"
```

## Notes

- Pixel widths, length ranges and schema "recommended" fields are guidelines. They don't guarantee rankings or rich results.
- Browser storage belongs to this browser on this PC. Clearing site data or browsing history can delete it, so use **Backup** for anything important. If your browser blocks storage for files opened from disk, the sidebar says so and pages only last until you close the tab.
- Image previews load images from the live site. Untick "Show previews" if you want to stay fully offline.
- To reuse the parser in the Next.js dashboard, `js/parser.js` has no dependencies. `Extractor.analyze(html, { pageUrl })` runs in any browser or client component and returns plain JSON.
