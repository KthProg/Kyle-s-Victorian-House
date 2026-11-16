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
  'https://michigancentral.com/': { type: 'michiganCentral' },
  'https://paxahau.com/': { type: 'paxahau' },
  // Unsupported venues: `page` is the events page to check by hand, shown in the warning.
  'https://dia.org/': {
    type: 'unsupported', reason: 'dia.org returns 403 to scripts', page: 'https://dia.org/events',
  },
  'https://www.dso.org/': { type: 'dso', json: 'https://www.dso.org/events-and-tickets/json/9/24797/1' },
  'https://www.thehenryford.org/visit/venues/greenfield-village': {
    type: 'henryFord', page: 'https://www.thehenryford.org/visit/things-to-do/calendar',
  },
  'https://detroithistorical.org/': { type: 'detroitHistorical', page: 'https://www.detroithistorical.org/events' },
  'https://27thletterbooks.com/': { type: 'letter27', page: 'https://27thletterbooks.com/pages/events' },

  'https://www.detroitriverfront.org/plan-your-visit/things-to-do/dequindre-cut-freight-yard-seasonal': {
    type: 'noEvents', // seasonal; its events show up under Detroit Riverfront Conservancy
  },

  // Shops & Hangouts
  'https://www.johnkingbooksdetroit.com/': { type: 'feed', feed: 'https://www.johnkingbooksdetroit.com/blog-feed.xml' },
  'https://purrfiction.com/': { type: 'purrfiction' },
  'https://www.wiseguyschessclub.com/': { type: 'jsonld', page: 'https://www.wiseguyschessclub.com/events' },

  // Places that don't publish events on a website. They're listed together in one
  // line per section, linking to `instagram` if given (Instagram can't be read by
  // scripts without logging in, so it's a link to check by hand).
  'https://www.detroiturbanartifacts.com/': {
    type: 'noEvents', instagram: 'https://www.instagram.com/detroiturbanartifacts/',
  },
  'https://detroitchinatownvision.godaddysites.com/': {
    type: 'noEvents', instagram: 'https://www.instagram.com/det313chinatownvision/',
  },
  'https://www.instagram.com/little.asian.bites/': { type: 'noEvents' },
  'https://www.instagram.com/goodknightsocial/': { type: 'noEvents' },
  'https://www.instagram.com/strongtownsdetroit/': { type: 'noEvents' },
  'https://www.instagram.com/cafeclarkdetroit/': { type: 'noEvents' },
  'https://www.casscafe.org/': { type: 'noEvents', instagram: 'https://www.instagram.com/casscafedetroit/' },
  'https://www.yellowlightdetroit.com/': { type: 'noEvents', instagram: 'https://www.instagram.com/yellowlightdetroit/' },

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
      .formatToParts(NOW).map((x) => [x.type, Number(x.value)])
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

/** "Nov", "SEPT", "November" -> 11/9/11; null if not a month. */
function monthNum(s) {
  const i = MONTHS.findIndex((m) => m.startsWith(String(s).slice(0, 3).toLowerCase()));
  return i < 0 ? null : i + 1;
}
const MONTH_RE = '(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?';

/**
 * Start time from text like "7 PM", "6:30 PM", "2 - 5 PM", "11:00am - 12:00pm" or
 * "9:30 a.m.-5 p.m.": the first number, with the first AM/PM after it. Null if none.
 */
function parseClock(text) {
  // Only a dash or "to" may sit between the two times of a range, so a stray number
  // like the "26" in "11/28/26 from 10am" isn't mistaken for the start time.
  const t = String(text).match(/(\d{1,2})(?::(\d\d))?\s*(?:(?:[-–]|to)\s*\d{1,2}(?::\d\d)?\s*)?([ap])\.?m\b/i);
  if (!t) return null;
  return { h: (Number(t[1]) % 12) + (t[3].toLowerCase() === 'p' ? 12 : 0), mi: t[2] ? Number(t[2]) : 0 };
}

/** An event at `clock` (from parseClock) on the given day, or all-day if no clock. */
function eventOn(y, mo, d, clock) {
  return { start: detroitTime(y, mo, d, clock?.h ?? 0, clock?.mi ?? 0), allDay: !clock };
}

/**
 * Date or date range like "Nov 16, 2026", "Oct 9-Nov 30, 2026", "Dec 5-6, 2026" or
 * "October 18, 2026-January 3, 2027". Returns {start, end?} as all-day Dates, or null.
 */
function parseDateRange(text) {
  const part = (s) => {
    const m = s.match(new RegExp(`^\\s*(?:${MONTH_RE}\\s+)?(\\d{1,2})(?:,?\\s*(\\d{4}))?\\s*$`, 'i'));
    return m && { mo: m[1] ? monthNum(m[1]) : null, d: Number(m[2]), y: m[3] ? Number(m[3]) : null };
  };
  const [a, b] = String(text).split(/\s*[-–]\s*/);
  const start = part(a);
  if (!start?.mo) return null;
  const end = b ? part(b) : null;
  if (b && !end) return null;
  if (end) {
    end.mo ??= start.mo;
    end.y ??= start.y ?? inferYear(end.mo, end.d);
    start.y ??= start.mo > end.mo ? end.y - 1 : end.y;
  } else {
    start.y ??= inferYear(start.mo, start.d);
  }
  return {
    start: detroitTime(start.y, start.mo, start.d),
    end: end ? detroitTime(end.y, end.mo, end.d) : undefined,
  };
}

/**
 * Guess the year for a "November 21" with no year: whichever year puts it closest to
 * today. So in November, "January 5" is next year, but a stale "September 4" left on a
 * page is this year (and gets filtered out as past) rather than next September.
 */
function inferYear(month, day) {
  const [y] = todayParts();
  return [y - 1, y, y + 1].reduce((best, cand) =>
    Math.abs(detroitTime(cand, month, day) - NOW) < Math.abs(detroitTime(best, month, day) - NOW) ? cand : best
  );
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

  // Michigan Central's events page loads one month at a time from WordPress's
  // admin-ajax.php. Each card has <h4>November 22, 2026</h4><h5>Title</h5>,
  // an optional time like "2 - 5 PM" in <b>, and a ticket link.
  async michiganCentral() {
    const months = [];
    const [y, m] = todayParts();
    for (let d = new Date(Date.UTC(y, m - 1, 1)); d.getTime() <= END; d.setUTCMonth(d.getUTCMonth() + 1)) {
      months.push([d.getUTCFullYear(), d.getUTCMonth() + 1]);
    }
    const pages = await Promise.all(
      months.map(([year, month]) =>
        get('https://michigancentral.com/wp-admin/admin-ajax.php', {
          browser: true,
          form: { action: 'load_monthly_events', year, month },
        })
      )
    );
    const items = [];
    for (const { text } of pages) {
      for (const block of text.split('<div class="events_blk">').slice(1)) {
        const field = (re) => decode((block.match(re) || [])[1] || '');
        const date = field(/<h4>([\s\S]*?)<\/h4>/).match(new RegExp(`(${MONTHS.join('|')})\\s+(\\d{1,2}),?\\s+(\\d{4})`, 'i'));
        if (!date) continue;
        // "11 AM", "2 - 5 PM", "11 AM - 12 PM", "6:30 PM": the start is the first
        // number, using the first AM/PM that follows it.
        const time = field(/<b>([\s\S]*?)<\/b>/).match(/(\d{1,2})(?::(\d\d))?[^AP\d]*?(?:\d{1,2}(?::\d\d)?\s*)?([AP])\.?M/i);
        const h = time ? (Number(time[1]) % 12) + (time[3].toUpperCase() === 'P' ? 12 : 0) : 0;
        items.push({
          title: field(/<h5>([\s\S]*?)<\/h5>/) || '(untitled)',
          link: (block.match(/<a [^>]*href="([^"]+)"/) || [])[1] || 'https://michigancentral.com/events/',
          start: detroitTime(
            Number(date[3]), MONTHS.indexOf(date[1].toLowerCase()) + 1, Number(date[2]),
            h, time?.[2] ? Number(time[2]) : 0
          ),
          allDay: !time,
        });
      }
    }
    return { kind: 'events', items };
  },

  // DSO's calendar JSON (a Tessitura ticketing feed). URL parts: /json/{mode of
  // sale}/{promo source}/{only listed}. 9 is their web channel; the source code
  // doesn't change the results; 1 hides unlisted performances. Returns the whole season.
  async dso(src, cfg) {
    const perfs = await getJSON(cfg.json, { browser: true });
    return {
      kind: 'events',
      items: perfs
        .filter((p) => !p.disable_in_listings)
        .map((p) => ({
          title: decode(p.title + (p.suffix ? ` ${p.suffix}` : '')),
          link: p.event_url || p.book_url || src.url,
          start: new Date(p.perf_date),
          allDay: false,
        })),
    };
  },

  // The Henry Ford calendar (Henry Ford Museum + Greenfield Village). Each card has a
  // title, then icon rows: calendar ("Nov 16, 2026", "Oct 9-Nov 30, 2026") and time
  // ("6-9 p.m."). Permanent attractions ("Daily", "Now Open") are skipped.
  async henryFord(src, cfg) {
    const { text } = await get(cfg.page, { browser: true });
    const items = [];
    for (const card of text.split(/class="[^"]*image-card__title[^"]*"/).slice(1)) {
      const title = decode(card.slice(card.indexOf('>') + 1, card.indexOf('<')));
      const row = (icon) =>
        decode((card.match(new RegExp(`svg--${icon}[\\s\\S]*?image-card__list-text">([^<]*)<`)) || [])[1] || '');
      const range = parseDateRange(row('calendar'));
      if (!title || !range) continue;
      const href = (card.match(/href="(\/visit\/things-to-do\/calendar\/[^"]+)"/) || [])[1];
      const link = href ? new URL(href, cfg.page).href : cfg.page;
      if (range.end) {
        // Multi-day exhibits: the time row is daily opening hours, so show the dates only.
        items.push({ title, link, start: range.start, end: range.end, allDay: true });
      } else {
        const s = range.start;
        const [y, mo, d] = s.toLocaleDateString('en-CA', { timeZone: TZ }).split('-').map(Number);
        items.push({ title, link, ...eventOn(y, mo, d, parseClock(row('time'))) });
      }
    }
    return { kind: 'events', items };
  },

  // 27th Letter Books: <strong>12 SEPT 7 PM:</strong> EVENT NAME<br/>. The bold part
  // can also say "7 PM DOORS", "6 PM AT DETROIT PUBLIC LIBRARY" or "EVENING".
  async letter27(src, cfg) {
    const { text } = await get(cfg.page, { browser: true });
    const items = [];
    const re = /<strong>([^<]*)<\/strong>([\s\S]*?)(?=<br|<strong>|<\/p>)/g;
    for (const m of text.matchAll(re)) {
      const head = decode(m[1]).replace(/:\s*$/, '');
      const when = head.match(new RegExp(`^(\\d{1,2})\\s+${MONTH_RE}\\s*(.*)$`, 'i'));
      const title = decode(m[2]);
      if (!when || !title) continue;
      const mo = monthNum(when[2]);
      const clock = parseClock(when[3]);
      // Keep any extra detail, e.g. "AT DETROIT PUBLIC LIBRARY" or "DOORS".
      const extra = when[3].replace(/^\s*\d{1,2}(?::\d\d)?\s*[ap]\.?m\.?\s*/i, '').trim();
      items.push({
        title: extra ? `${title} (${extra.toLowerCase()})` : title,
        link: cfg.page,
        ...eventOn(inferYear(mo, Number(when[1])), mo, Number(when[1]), clock),
      });
    }
    return { kind: 'events', items };
  },

  // Detroit Historical Society (Drupal): <h3 class="post-title"><a href="/events/...">
  // and <p class="post-date">November 17, 2026, 7:00 - 8:00pm</p>.
  async detroitHistorical(src, cfg) {
    const { text } = await get(cfg.page, { browser: true });
    const items = [];
    const re = /<h3 class="post-title">\s*<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="post-date[^"]*">([^<]*)</g;
    for (const m of text.matchAll(re)) {
      const when = decode(m[3]).match(new RegExp(`${MONTH_RE}\\s+(\\d{1,2}),\\s*(\\d{4}),?\\s*(.*)`, 'i'));
      if (!when) continue;
      items.push({
        title: decode(m[2]),
        link: new URL(m[1], cfg.page).href,
        ...eventOn(Number(when[3]), monthNum(when[1]), Number(when[2]), parseClock(when[4])),
      });
    }
    return { kind: 'events', items };
  },

  // PurrFiction's events page (an Ecwid/Square-style tile list): each tile has
  // class="ins-tile__location-title"><p>Title</p> and
  // class="ins-tile__subheading"><p>Saturday, 11/28/26 from 10am-4pm</p>.
  async purrfiction() {
    const page = 'https://purrfiction.com/events';
    const { text } = await get(page, { browser: true });
    const items = [];
    const re = /ins-tile__location-title[^>]*>([\s\S]*?)<\/div>[\s\S]*?ins-tile__subheading[^>]*>([\s\S]*?)<\/div>/g;
    for (const m of text.matchAll(re)) {
      const when = decode(m[2]);
      const d = when.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\b/);
      if (!d) continue;
      const y = d[3].length === 2 ? 2000 + Number(d[3]) : Number(d[3]);
      items.push({ title: decode(m[1]), link: page, ...eventOn(y, Number(d[1]), Number(d[2]), parseClock(when)) });
    }
    return { kind: 'events', items };
  },

  // Paxahau's homepage is its event list: each card has
  // <div class="event-date">November 21, 2026</div> and <a href="/events/..." class="events-title">.
  async paxahau() {
    const { text } = await get('https://paxahau.com/', { browser: true });
    const items = [];
    for (const card of text.split('class="events-collection-item').slice(1)) {
      const date = decode((card.match(/class="event-date">([^<]+)</) || [])[1] || '')
        .match(new RegExp(`(${MONTHS.join('|')})\\s+(\\d{1,2}),?\\s+(\\d{4})`, 'i'));
      const title = card.match(/<a href="([^"]+)" class="events-title">([\s\S]*?)<\/a>/);
      if (!date || !title) continue;
      items.push({
        title: decode(title[2]),
        link: new URL(title[1], 'https://paxahau.com/').href,
        start: detroitTime(Number(date[3]), MONTHS.indexOf(date[1].toLowerCase()) + 1, Number(date[2])),
        allDay: true,
      });
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
    // Sites often leave raw tabs/newlines inside JSON strings, which JSON.parse
    // rejects but browsers tolerate; replacing them with spaces is harmless.
    try { walk(JSON.parse(m[1].replace(/[\u0000-\u001f]+/g, ' '))); } catch { /* ignore malformed blocks */ }
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

/** Sort by start time, treating runs that already started as "today" and ordering those by end date. */
function byWhen(a, b) {
  const key = (e) => Math.max(e.start.getTime(), e.end ? START_OF_TODAY.getTime() : -Infinity);
  return key(a) - key(b) || (a.end?.getTime() ?? 0) - (b.end?.getTime() ?? 0);
}

async function loadSource(src) {
  const cfg = SOURCES[src.url] || (new URL(src.url).hostname.endsWith('meetup.com') ? { type: 'meetup' } : null);
  if (cfg?.type === 'noEvents') return { ...src, kind: 'none', instagram: cfg.instagram, items: [] };
  if (cfg?.type === 'unsupported') {
    const error = `Not supported: ${cfg.reason}.` + (cfg.page ? ` Check the events page: ${cfg.page}` : '');
    return { ...src, eventsPage: cfg.page, error, kind: 'events', items: [] };
  }
  const res = cfg ? await LOADERS[cfg.type](src, cfg) : await loadGeneric(src);
  let items = res.items;
  if (res.kind === 'events') {
    // Dedupe, keep events in the window (all-day events count for all of today; multi-day
    // events count until their last day), sort by time.
    const seen = new Set();
    items = items
      .filter((e) => e.start && !isNaN(e.start))
      .filter((e) => {
        const last = (e.end ?? e.start).getTime();
        return e.allDay ? last >= START_OF_TODAY.getTime() : last >= NOW;
      })
      .filter((e) => e.start.getTime() <= END)
      .filter((e) => {
        const key = `${e.title}|${e.start.toISOString()}`;
        return seen.has(key) ? false : seen.add(key);
      })
      .sort(byWhen);
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

const isOngoing = (e) => e.end && e.start.getTime() < START_OF_TODAY.getTime();
const fmtShort = (d) => fmtDate(d, { year: undefined });
const fmtWhen = (e) => {
  if (e.end) return isOngoing(e) ? `Now through ${fmtShort(e.end)}` : `${fmtShort(e.start)} – ${fmtShort(e.end)}`;
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
    .sort(byWhen);
  const titleOf = (e) => `${e.link ? `[${md(e.title)}](${e.link})` : md(e.title)} · _${md(e.source)}_`;
  // Exhibits and other runs that have already started go in their own section up top.
  const ongoing = events.filter(isOngoing);
  if (ongoing.length) {
    out.push('', '## Ongoing', '');
    for (const e of ongoing) out.push(`- **Through ${fmtShort(e.end)}** — ${titleOf(e)}`);
  }
  let day = null;
  for (const e of events.filter((e) => !isOngoing(e))) {
    const d = fmtDate(e.start, { weekday: 'long', month: 'long', year: undefined });
    if (d !== day) {
      day = d;
      out.push('', `## ${d}`, '');
    }
    const time = e.end
      ? `Through ${fmtShort(e.end)}`
      : e.allDay ? 'All day' : e.start.toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
    out.push(`- **${time}** — ${titleOf(e)}`);
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
    const offline = inSection.filter((r) => r.kind === 'none');
    if (offline.length) {
      const ig = (r) => `[${md(r.name)}](${r.instagram || r.url})`;
      out.push('', `_No event listings online, check by hand: ${offline.map(ig).join(', ')}_`);
    }
  }
}

const footer = [];
const errors = results.filter((r) => r.error);
if (opts.agenda && errors.length) {
  footer.push(`_Couldn't check: ${errors.map((r) => md(r.name)).join(', ')}._`);
}
if (searches.length) {
  footer.push(`_Not checked (these links are Google searches): ${searches.map((s) => md(s.name)).join(', ')}._`);
}
if (footer.length) out.push('', '---', '', footer.join('\n\n'));
console.log(out.join('\n'));
