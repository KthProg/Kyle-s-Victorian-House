#!/usr/bin/env node
// Lists upcoming events (and recent roundup posts) for the links on detroit-events.htm.
//
// Usage: node scripts/list-events.mjs [--days N] [--limit N] [--agenda] [--json]
//   --days N   how many days ahead to look (default 14)
//   --limit N  max events per source (default 10)
//   --agenda   one combined day-by-day list instead of grouping by source
//   --json     print JSON instead of Markdown
//
// Save as a file: node scripts/list-events.mjs > events.md
//
// Every venue publishes its calendar differently, so each link is matched to a
// "source type" in SOURCES below. Links not listed there are tried generically:
// schema.org Event data embedded in the page, then an RSS feed. Links that are
// Google searches are skipped.

import {
  TZ, decode, fmtDate, get, getJSON, loadFeed, mapLimit, md, mdWarning, parseArgs, readLinksPage,
} from './lib/common.mjs';

const opts = parseArgs({ days: 14, limit: 10, agenda: false });
const NOW = Date.now();
const START_OF_TODAY = detroitTime(...todayParts());
const END = NOW + opts.days * 864e5;
// Roundup posts (news sites, newsletters) are shown if published in the last week.
const ARTICLE_DAYS = 7;

// ---------- where each link's events come from ----------
// Keys must match the href on detroit-events.htm exactly.
const SOURCES = {
  // Weekly Roundups: these publish articles, not events, so recent posts are listed.
  'https://outliermedia.org/newsletters/': { type: 'feed' },
  'https://detroitshows.org/': { type: 'feed', feed: 'https://buttondown.com/detroitshows/rss' },
  'https://gandernewsroom.com/': { type: 'feed' },
  'https://www.dailydetroit.com/': { type: 'feed' },
  'https://www.metrotimes.com/': { type: 'unsupported', reason: 'Metro Times blocks automated requests' },
  'https://www.axios.com/local/detroit': {
    type: 'unsupported', reason: 'Axios blocks automated requests and has no Detroit-only feed',
  },
  'https://www.freep.com/': { type: 'unsupported', reason: 'The Free Press has no public feed' },

  // Venues
  'https://www.313presents.com/': { type: 'jsonld', page: 'https://www.313presents.com/events' },
  'https://www.thefillmoredetroit.com/': { type: 'jsonld', page: 'https://www.thefillmoredetroit.com/shows' },
  'https://themasonic.com/': { type: 'aeg', json: 'https://aegwebprod.blob.core.windows.net/json/events/151/events.json' },
  'https://detroitopera.org/': { type: 'wpShows', api: 'https://detroitopera.org/wp-json/wp/v2/show?per_page=100' },
  'https://detroitriverfront.org/': { type: 'riverfront' },
  'https://redfordtheatre.com': { type: 'redford' },
  'https://thecongregationdetroit.com/': {
    type: 'tribe', api: 'https://thecongregationdetroit.com/wp-json/tribe/events/v1/events',
  },
  'https://vanderdetroit.com/': { type: 'squarespace', page: 'https://vanderdetroit.com/events' },
  'https://michigancentral.com/': { type: 'unsupported', reason: 'event dates are loaded by JavaScript' },
  'https://dia.org/': { type: 'unsupported', reason: 'the DIA blocks automated requests' },
  'https://www.dso.org/': { type: 'unsupported', reason: 'the calendar is loaded by JavaScript' },
  'https://paxahau.com/': { type: 'unsupported', reason: 'shows link out to ticket sites without dates' },
  'https://www.thehenryford.org/visit/venues/greenfield-village': {
    type: 'unsupported', reason: 'the calendar has no machine-readable dates',
  },
  'https://detroithistorical.org/': { type: 'unsupported', reason: 'the events page has no machine-readable dates' },
  'https://27thletterbooks.com/': { type: 'unsupported', reason: 'the events page is free-form text' },

  // Sports Schedules, via ESPN's public schedule API.
  'https://www.nba.com/pistons/schedule': { type: 'espn', path: 'basketball/nba/teams/det' },
  'https://www.nhl.com/redwings/schedule': { type: 'espn', path: 'hockey/nhl/teams/det' },
  'https://www.mlb.com/tigers/schedule': { type: 'espn', path: 'baseball/mlb/teams/det' },
  'https://www.nfl.com/schedules/2026/by-team/detroit-lions': { type: 'espn', path: 'football/nfl/teams/det' },
};

// ---------- time helpers (all venue times are Detroit local time) ----------
function todayParts() {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: 'numeric', day: 'numeric' })
      .formatToParts(new Date()).map((x) => [x.type, Number(x.value)])
  );
  return [p.year, p.month, p.day];
}

function tzOffsetMinutes(ts) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', second: 'numeric',
    }).formatToParts(ts).map((x) => [x.type, Number(x.value)])
  );
  return (Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - ts) / 60000;
}

/** A Date for a wall-clock time in Detroit. */
function detroitTime(y, mo, d, h = 0, mi = 0) {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  let ts = guess - tzOffsetMinutes(guess) * 60000;
  ts = guess - tzOffsetMinutes(ts) * 60000; // correct across DST changes
  return new Date(ts);
}

/** Parses "2026-11-14", "2026-11-14T19:00", or a full ISO timestamp. */
function parseWhen(s) {
  const m = String(s).match(/^(\d{4})-(\d\d)-(\d\d)(?:[T ](\d\d):(\d\d))?/);
  if (!m) return null;
  const hasZone = /[zZ]|[+-]\d\d:?\d\d$/.test(s);
  if (hasZone) return { start: new Date(s), allDay: false };
  if (!m[4]) return { start: detroitTime(+m[1], +m[2], +m[3]), allDay: true };
  return { start: detroitTime(+m[1], +m[2], +m[3], +m[4], +m[5]), allDay: false };
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
  'september', 'october', 'november', 'december'];

/** Guess the year for a "November 21" with no year: the next occurrence, allowing recent past. */
function inferYear(month, day) {
  const [y] = todayParts();
  return detroitTime(y, month, day).getTime() < NOW - 60 * 864e5 ? y + 1 : y;
}

// ---------- source types ----------
const LOADERS = {
  async feed(src, cfg) {
    const cutoff = NOW - ARTICLE_DAYS * 864e5;
    const items = await loadFeed(src.url, cfg.feed);
    return { kind: 'articles', items: items.filter((i) => !i.date || i.date.getTime() >= cutoff) };
  },

  // schema.org Event objects in <script type="application/ld+json">.
  async jsonld(src, cfg) {
    const { text, url } = await get(cfg.page || src.url, { browser: true });
    return { kind: 'events', items: jsonLdEvents(text, url) };
  },

  // The Events Calendar (WordPress plugin) REST API.
  async tribe(src, cfg) {
    const [y, m, d] = todayParts();
    const today = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const j = await getJSON(`${cfg.api}?per_page=50&start_date=${today}`, { browser: true });
    return {
      kind: 'events',
      items: j.events.map((e) => ({
        title: decode(e.title),
        link: e.url,
        start: e.all_day ? parseWhen(e.start_date.slice(0, 10)).start : new Date(e.utc_start_date.replace(' ', 'T') + 'Z'),
        allDay: !!e.all_day,
      })),
    };
  },

  // AEG Presents venue feed (Masonic Temple).
  async aeg(src, cfg) {
    const j = await getJSON(cfg.json, { browser: true });
    return {
      kind: 'events',
      items: j.events.map((e) => ({
        title: decode(e.title.eventTitleText || e.title.headlinersText),
        link: e.ticketing?.eventUrl || e.ticketing?.url || src.url,
        start: new Date(e.eventDateTimeISO),
        allDay: false,
      })),
    };
  },

  // Detroit Opera's WordPress "show" posts, with performance dates in custom fields.
  async wpShows(src, cfg) {
    const shows = await getJSON(cfg.api, { browser: true });
    const items = [];
    for (const s of shows) {
      for (const p of s.acf?.performance_info || []) {
        const dm = String(p.performance_date).match(/^(\d{4})(\d\d)(\d\d)$/);
        if (!dm) continue;
        const [h, mi] = (p.performance_start_time || '').split(':').map(Number);
        const hasTime = Number.isFinite(h);
        items.push({
          title: decode(s.title.rendered),
          link: s.link,
          start: detroitTime(+dm[1], +dm[2], +dm[3], hasTime ? h : 0, hasTime ? mi : 0),
          allDay: !hasTime,
        });
      }
    }
    return { kind: 'events', items };
  },

  // Squarespace event collections expose JSON at ?format=json.
  async squarespace(src, cfg) {
    const j = await getJSON(`${cfg.page}?format=json`, { browser: true });
    return {
      kind: 'events',
      items: (j.upcoming || []).map((e) => ({
        title: decode(e.title),
        link: new URL(e.fullUrl, cfg.page).href,
        start: new Date(e.startDate),
        allDay: false,
      })),
    };
  },

  async espn(src, cfg) {
    const j = await getJSON(`https://site.api.espn.com/apis/site/v2/sports/${cfg.path}/schedule`);
    return {
      kind: 'events',
      items: (j.events || []).map((e) => ({
        title: e.name,
        link: e.links?.[0]?.href || src.url,
        start: new Date(e.date),
        allDay: false,
      })),
    };
  },

  // Meetup group pages embed their events in Next.js page data.
  async meetup(src) {
    const { text } = await get(new URL('events/', src.url).href, { browser: true });
    const data = text.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!data) throw new Error('Meetup page format changed (no __NEXT_DATA__)');
    const state = JSON.parse(data[1]).props?.pageProps?.__APOLLO_STATE__ || {};
    return {
      kind: 'events',
      items: Object.entries(state)
        .filter(([k, v]) => k.startsWith('Event:') && v.dateTime)
        .map(([, e]) => ({ title: e.title, link: e.eventUrl, start: new Date(e.dateTime), allDay: false })),
    };
  },

  // Riverfront Conservancy: event URLs contain the date, e.g. events/calendar/2026/11/17/two-mile-tuesdays.
  async riverfront(src) {
    const base = 'https://detroitriverfront.org/';
    const { text } = await get(`${base}events/calendar`, { browser: true });
    const seen = new Set();
    const items = [];
    for (const m of text.matchAll(/href="\/?(events\/calendar\/(\d{4})\/(\d\d)\/(\d\d)\/[^"]+)"[^>]*>([^<]+)</g)) {
      if (seen.has(m[1])) continue;
      seen.add(m[1]);
      items.push({ title: decode(m[5]), link: base + m[1], start: detroitTime(+m[2], +m[3], +m[4]), allDay: true });
    }
    return { kind: 'events', items };
  },

  // Redford Theatre: <h3>Title</h3><p>Friday, November 13 and Saturday, November 14, 2026 at 8:00 PM</p>
  async redford(src) {
    const { text } = await get('https://redfordtheatre.com/events/', { browser: true });
    const items = [];
    const re = /<a href="([^"]+)">\s*<div class="featureBottom">\s*<h3>([\s\S]*?)<\/h3>\s*<p>([\s\S]*?)<\/p>/g;
    for (const m of text.matchAll(re)) {
      const when = decode(m[3]);
      const year = (when.match(/\b(20\d\d)\b/) || [])[1];
      const t = when.match(/\b(\d{1,2})(?::(\d\d))?\s*([AP])\.?M\b/i);
      let h = t ? Number(t[1]) % 12 + (t[3].toUpperCase() === 'P' ? 12 : 0) : 0;
      for (const d of when.matchAll(new RegExp(`\\b(${MONTHS.join('|')})\\s+(\\d{1,2})\\b`, 'gi'))) {
        const mo = MONTHS.indexOf(d[1].toLowerCase()) + 1;
        const y = year ? Number(year) : inferYear(mo, Number(d[2]));
        items.push({
          title: decode(m[2]),
          link: m[1],
          start: detroitTime(y, mo, Number(d[2]), h, t?.[2] ? Number(t[2]) : 0),
          allDay: !t,
        });
      }
    }
    return { kind: 'events', items };
  },
};

function jsonLdEvents(html, pageUrl) {
  const items = [];
  const walk = (o) => {
    if (Array.isArray(o)) return o.forEach(walk);
    if (!o || typeof o !== 'object') return;
    const types = [].concat(o['@type'] || []);
    if (types.some((t) => /Event$/.test(t)) && o.startDate) {
      const when = parseWhen(o.startDate);
      if (when) {
        items.push({
          title: decode(o.name || '(untitled)'),
          link: o.url ? new URL(o.url, pageUrl).href : pageUrl,
          ...when,
        });
      }
    }
    Object.values(o).forEach(walk);
  };
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try { walk(JSON.parse(m[1])); } catch { /* ignore malformed blocks */ }
  }
  return items;
}

// Links not in SOURCES: try schema.org events, then an RSS feed.
async function loadGeneric(src) {
  const events = await LOADERS.jsonld(src, {}).catch(() => null);
  if (events?.items.length) return events;
  try {
    return await LOADERS.feed(src, {});
  } catch {
    throw new Error('no events or feed found; add an entry for this link to SOURCES');
  }
}

async function loadSource(src) {
  const cfg = SOURCES[src.url] || (new URL(src.url).hostname.endsWith('meetup.com') ? { type: 'meetup' } : null);
  if (cfg?.type === 'unsupported') return { ...src, error: `Not supported: ${cfg.reason}`, kind: 'events', items: [] };
  const res = cfg ? await LOADERS[cfg.type](src, cfg) : await loadGeneric(src);
  let items = res.items;
  if (res.kind === 'events') {
    // Dedupe, keep events in the window (all-day events count for all of today), sort by time.
    const seen = new Set();
    items = items
      .filter((e) => e.start && !isNaN(e.start))
      .filter((e) => (e.allDay ? e.start.getTime() >= START_OF_TODAY.getTime() : e.start.getTime() >= NOW))
      .filter((e) => e.start.getTime() <= END)
      .filter((e) => {
        const key = `${e.title}|${e.start.toISOString()}`;
        return seen.has(key) ? false : seen.add(key);
      })
      .sort((a, b) => a.start - b.start);
  }
  return { ...src, kind: res.kind, items: items.slice(0, opts.limit) };
}

// ---------- main ----------
const all = readLinksPage('detroit-events.htm');
const searches = all.filter((s) => s.url.includes('google.com/search'));
const sources = all.filter((s) => !s.url.includes('google.com/search'));
const results = await mapLimit(sources, 8, (s) =>
  loadSource(s).catch((e) => ({ ...s, error: e.message, kind: 'events', items: [] }))
);

const fmtWhen = (e) => {
  const day = fmtDate(e.start, { weekday: 'short', year: undefined });
  if (e.allDay) return day;
  const time = e.start.toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
  return `${day} · ${time}`;
};
const eventLine = (e, extra = '') => `- **${fmtWhen(e)}** — ${e.link ? `[${md(e.title)}](${e.link})` : md(e.title)}${extra}`;
const articleLine = (i) =>
  `- ${i.link ? `[${md(i.title)}](${i.link})` : md(i.title)}${i.date ? ` — _${fmtDate(i.date)}_` : ''}`;

if (opts.json) {
  console.log(JSON.stringify({ generated: new Date(), days: opts.days, results, skipped: searches }, null, 2));
  process.exit(0);
}

const out = [
  '# Detroit Events',
  '',
  `_Next ${opts.days} days · generated ${fmtDate(new Date(), { weekday: 'short' })}_`,
];

if (opts.agenda) {
  const events = results
    .filter((r) => r.kind === 'events')
    .flatMap((r) => r.items.map((e) => ({ ...e, source: r.name })))
    .sort((a, b) => a.start - b.start);
  let day = null;
  for (const e of events) {
    const d = fmtDate(e.start, { weekday: 'long', month: 'long', year: undefined });
    if (d !== day) {
      day = d;
      out.push('', `## ${d}`, '');
    }
    const time = e.allDay ? 'All day' : e.start.toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
    out.push(`- **${time}** — ${e.link ? `[${md(e.title)}](${e.link})` : md(e.title)} · _${md(e.source)}_`);
  }
  if (!events.length) out.push('', '_No events found._');
  const articles = results.filter((r) => r.kind === 'articles' && r.items.length);
  if (articles.length) {
    out.push('', `## Recent roundups (last ${ARTICLE_DAYS} days)`);
    for (const r of articles) out.push('', `### [${md(r.name)}](${r.url})`, '', ...r.items.map(articleLine));
  }
} else {
  const link = (r) => `[${md(r.name)}](${r.url})`;
  for (const section of [...new Set(results.map((r) => r.section))]) {
    const inSection = results.filter((r) => r.section === section);
    out.push('', `## ${section}`);
    for (const r of inSection.filter((r) => r.error || r.items.length)) {
      out.push('', `### ${link(r)}`, '');
      if (r.error) out.push(mdWarning(r.error));
      else out.push(...r.items.map(r.kind === 'articles' ? articleLine : (e) => eventLine(e)));
    }
    // Sources that worked but had nothing are collapsed into one line.
    const quietEvents = inSection.filter((r) => !r.error && !r.items.length && r.kind === 'events');
    const quietPosts = inSection.filter((r) => !r.error && !r.items.length && r.kind === 'articles');
    if (quietEvents.length) out.push('', `_No events in the next ${opts.days} days: ${quietEvents.map(link).join(', ')}_`);
    if (quietPosts.length) out.push('', `_No posts in the last ${ARTICLE_DAYS} days: ${quietPosts.map(link).join(', ')}_`);
  }
}

out.push('', '---', '');
const errors = results.filter((r) => r.error);
if (opts.agenda && errors.length) {
  out.push(`_Couldn't check: ${errors.map((r) => md(r.name)).join(', ')}._`, '');
}
if (searches.length) {
  out.push(`_Not checked (these links are Google searches): ${searches.map((s) => md(s.name)).join(', ')}._`);
}
console.log(out.join('\n'));
