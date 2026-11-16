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
// Items are kept in page order (not re-sorted by date).
const SCRAPERS = {
  // Movies in theaters, most popular first. Each tile has the title, scores and
  // "Opened Nov 13, 2026". Opening dates are in the text rather than `date`, so
  // --days doesn't hide movies that opened a while ago.
  'https://www.rottentomatoes.com/browse/movies_in_theaters/sort:popular': (html) => {
    const items = [];
    for (const tile of html.split('data-qa="discovery-media-list-item"').slice(1, 11)) {
      const text = (re) => decode((tile.match(re) || [])[1] || '');
      const title = text(/data-qa="discovery-media-list-item-title"[^>]*>([\s\S]*?)<\/rt-text>/);
      const href = (tile.match(/href="(\/m\/[^"]+)"/) || [])[1];
      if (!title || !href) continue;
      const critics = text(/slot="criticsScore"[^>]*>([\s\S]*?)<\/rt-text>/);
      const audience = text(/slot="audienceScore"[^>]*>([\s\S]*?)<\/rt-text>/);
      const opened = text(/data-qa="discovery-media-list-item-start-date"[^>]*>([\s\S]*?)<\/rt-text>/);
      const scores = [critics && `critics ${critics}`, audience && `audience ${audience}`].filter(Boolean).join(', ');
      items.push({
        title: [title, scores && `(${scores})`, opened && `— ${opened}`].filter(Boolean).join(' '),
        link: `https://www.rottentomatoes.com${href}`,
        date: null,
      });
    }
    return items;
  },

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
const UNSUPPORTED = {};

// YouTube's RSS endpoint sometimes returns 404 for a channel for minutes at a time,
// longer than the retries in get() last. When that happens, read the channel's
// /videos page instead: its embedded data lists recent uploads (not Shorts) with
// relative dates like "5 days ago", which become approximate dates.
const AGO_UNITS = { second: 1e3, minute: 6e4, hour: 36e5, day: 864e5, week: 6048e5, month: 2592e6, year: 31536e6 };

async function youtubeVideos(channelUrl) {
  const url = new URL(channelUrl);
  url.pathname = url.pathname.replace(/\/(videos|featured|shorts|streams)?\/?$/, '') + '/videos';
  const { text } = await get(url.href);
  const data = text.match(/var ytInitialData = (\{[\s\S]*?\});<\/script>/);
  if (!data) throw new Error('YouTube page format changed (no ytInitialData)');
  const lockups = [];
  const walk = (o) => {
    if (Array.isArray(o)) return o.forEach(walk);
    if (!o || typeof o !== 'object') return;
    if (o.lockupViewModel) lockups.push(o.lockupViewModel);
    Object.values(o).forEach(walk);
  };
  walk(JSON.parse(data[1]));
  return lockups.map((l) => {
    const ago = JSON.stringify(l.metadata).match(/"accessibilityLabel":"(\d+) (second|minute|hour|day|week|month|year)s? ago"/);
    return {
      title: l.metadata?.lockupMetadataViewModel?.title?.content || '(untitled)',
      link: `https://www.youtube.com/watch?v=${l.contentId}`,
      date: ago ? new Date(Date.now() - Number(ago[1]) * AGO_UNITS[ago[2]]) : null,
    };
  });
}

const opts = parseArgs({ limit: 5, days: 0 });

async function loadSource(src) {
  if (UNSUPPORTED[src.url]) return { ...src, error: UNSUPPORTED[src.url], items: [] };
  let items;
  if (SCRAPERS[src.url]) {
    items = SCRAPERS[src.url]((await get(src.url)).text);
  } else {
    items = await loadFeed(src.url, FEED_OVERRIDES[src.url]).catch((e) => {
      if (new URL(src.url).hostname.endsWith('youtube.com')) return youtubeVideos(src.url);
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
