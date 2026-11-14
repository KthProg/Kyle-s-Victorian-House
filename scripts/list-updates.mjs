#!/usr/bin/env node
// Lists recent articles, posts and videos for every link on links.htm.
//
// Usage: node scripts/list-updates.mjs [--limit N] [--days N] [--json]
//   --limit N  max items per source (default 5)
//   --days N   only include items published in the last N days
//   --json     print JSON instead of Markdown
//
// Save as a file: node scripts/list-updates.mjs > updates.md
//
// Each link is resolved to an RSS/Atom feed: first from FEED_OVERRIDES, then by
// feed autodiscovery (<link rel="alternate" type="application/rss+xml">) on the
// linked page. Sites without a feed can get a custom scraper in SCRAPERS.

import { decode, fmtDate, get, loadFeed, md, mdWarning, parseArgs, readLinksPage } from './lib/common.mjs';

// Links whose feed can't be autodiscovered from the linked page.
const FEED_OVERRIDES = {
  // The homepage advertises a feed of the homepage itself, not articles.
  'https://www.quantamagazine.org/': 'https://www.quantamagazine.org/feed/',
  'https://www.esa.int/news-media/news': 'https://www.esa.int/rssfeed/TopNews',
  'https://learngerman.dw.com/de/langsam-gesprochene-nachrichten/s-60040332':
    'https://rss.dw.com/xml/DKpodcast_lgn_de',
  'https://lyra.horse/': 'https://lyra.horse/blog/posts/index.xml',
  'https://css-weekly.com': 'https://css-weekly.com/feed/',
};

// Sites without any feed: return [{title, link, date}] from the page HTML.
const SCRAPERS = {
  'https://www.nachrichtenleicht.de/': (html) => {
    const seen = new Set();
    const items = [];
    for (const m of html.matchAll(
      /<a href="(https:\/\/www\.nachrichtenleicht\.de\/[a-z0-9-]+-100\.html)" title="([^"]+)"/g
    )) {
      if (seen.has(m[1])) continue;
      seen.add(m[1]);
      items.push({ title: decode(m[2]), link: m[1], date: null });
    }
    return items;
  },
};

// Sites that block automated requests; listed as unsupported instead of erroring.
const UNSUPPORTED = {
  'https://www.imdb.com/calendar/': 'IMDb blocks automated requests and has no feed',
};

const opts = parseArgs({ limit: 5, days: 0 });

async function loadSource(src) {
  if (UNSUPPORTED[src.url]) return { ...src, error: UNSUPPORTED[src.url], items: [] };
  let items;
  if (SCRAPERS[src.url]) {
    items = SCRAPERS[src.url]((await get(src.url)).text);
  } else {
    items = await loadFeed(src.url, FEED_OVERRIDES[src.url]).catch((e) => {
      if (e.message === 'no feed found') e.message += '; add one to FEED_OVERRIDES or SCRAPERS';
      throw e;
    });
  }
  if (opts.days) {
    const cutoff = Date.now() - opts.days * 864e5;
    items = items.filter((i) => !i.date || i.date.getTime() >= cutoff);
  }
  return { ...src, items: items.slice(0, opts.limit) };
}

const sources = readLinksPage('links.htm').filter((s) => !s.url.includes('chatgpt.com'));
const results = await Promise.all(
  sources.map((s) => loadSource(s).catch((e) => ({ ...s, error: e.message, items: [] })))
);

if (opts.json) {
  console.log(JSON.stringify(results, null, 2));
} else {
  const out = [`# Latest Updates`, '', `_Generated ${fmtDate(new Date())}_`];
  let section = null;
  for (const r of results) {
    if (r.section !== section) {
      section = r.section;
      out.push('', `## ${section}`);
    }
    out.push('', `### [${md(r.name)}](${r.url})`, '');
    if (r.error) out.push(mdWarning(r.error));
    else if (!r.items.length) out.push(opts.days ? `_Nothing in the last ${opts.days} days._` : '_No items._');
    for (const i of r.items) {
      const title = i.link ? `[${md(i.title)}](${i.link})` : md(i.title);
      out.push(`- ${title}${i.date ? ` — _${fmtDate(i.date)}_` : ''}`);
    }
  }
  console.log(out.join('\n'));
}
