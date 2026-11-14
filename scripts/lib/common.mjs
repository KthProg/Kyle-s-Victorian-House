// Helpers shared by list-updates.mjs and list-events.mjs.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const TZ = 'America/Detroit';

const UA = 'Mozilla/5.0 (compatible; KylesVictorianHouse-link-reader/1.0)';
// Some sites (venue pages, Meetup) refuse non-browser user agents.
export const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';
const TIMEOUT_MS = 20000;

// ---------- command-line options ----------
export function parseArgs(defaults) {
  const args = process.argv.slice(2);
  const opts = { ...defaults, json: args.includes('--json') };
  for (const [key, def] of Object.entries(defaults)) {
    const i = args.indexOf(`--${key}`);
    if (i < 0) continue;
    if (typeof def === 'boolean') opts[key] = true;
    else opts[key] = Number(args[i + 1]);
  }
  return opts;
}

// ---------- text ----------
export function decode(s) {
  return String(s)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&hellip;/g, '…')
    .replace(/&[lr]squo;/g, "'")
    .replace(/&[lr]dquo;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Escape text for Markdown. */
export const md = (s) => String(s).replace(/([\\[\]*_`<>|])/g, '\\$1');

/** Markdown for a warning: escapes the prose but leaves URLs clickable. */
export function mdWarning(text) {
  const parts = String(text).split(/(https?:\/\/\S+)/);
  return `> ⚠️ ${parts.map((p, i) => (i % 2 ? `<${p}>` : md(p))).join('')}`;
}

export const fmtDate = (d, opts = {}) =>
  d.toLocaleDateString('en-US', { timeZone: TZ, month: 'short', day: 'numeric', year: 'numeric', ...opts });

// ---------- network ----------
// YouTube's feed endpoint (among others) randomly returns 404/5xx for valid
// URLs, so transient-looking failures are retried with backoff.
const RETRY_STATUSES = new Set([404, 429, 500, 502, 503, 504]);
const RETRIES = 5;

export async function get(url, { browser = false } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 500 * 2 ** (attempt - 1)));
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': browser ? BROWSER_UA : UA, accept: '*/*' },
        redirect: 'follow',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.ok) return { text: await res.text(), url: res.url };
      lastErr = new Error(`HTTP ${res.status} for ${url}`);
      if (!RETRY_STATUSES.has(res.status)) break;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

export const getJSON = async (url, opts) => JSON.parse((await get(url, opts)).text);

/** Runs fn over items with at most `limit` in flight, preserving order. */
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// ---------- pages on this site ----------
/** Reads a page like links.htm and returns [{section, name, url, note}]. */
export function readLinksPage(file) {
  const html = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const sources = [];
  let section = 'Other';
  const re =
    /<p class="section-header">([\s\S]*?)<\/p>|<td class="name"[^>]*><a href="([^"]+)"[^>]*>([\s\S]*?)<\/a><\/td>\s*<td>([\s\S]*?)<\/td>/g;
  for (const m of html.matchAll(re)) {
    if (m[1] !== undefined) section = decode(m[1]).replace(/^[—\s]+|[—\s]+$/g, '');
    else sources.push({ section, name: decode(m[3]), url: decode(m[2]), note: decode(m[4]) });
  }
  return sources;
}

// ---------- RSS / Atom ----------
export function discoverFeed(html, baseUrl) {
  for (const tag of html.match(/<link\b[^>]*>/gi) || []) {
    if (!/type=["']application\/(rss|atom)\+xml["']/i.test(tag)) continue;
    if (/comments/i.test(tag)) continue;
    const href = (tag.match(/href=["']([^"']+)["']/i) || [])[1];
    if (!href) continue;
    const feedUrl = new URL(decode(href), baseUrl).href;
    // Some sites (e.g. nachrichtenleicht.de) point the "feed" at their own homepage.
    if (feedUrl.replace(/\/$/, '') === baseUrl.replace(/\/$/, '')) continue;
    return feedUrl;
  }
  return null;
}

function tagText(block, ...names) {
  for (const n of names) {
    const m = block.match(new RegExp(`<${n}\\b[^>]*>([\\s\\S]*?)</${n}>`, 'i'));
    if (m) return decode(m[1]);
  }
  return null;
}

/** Parses RSS or Atom into [{title, link, date}]. */
export function parseFeed(xml) {
  const isAtom = /<feed\b/i.test(xml) && !/<rss\b/i.test(xml);
  const blocks = xml.match(isAtom ? /<entry\b[\s\S]*?<\/entry>/gi : /<item\b[\s\S]*?<\/item>/gi) || [];
  return blocks.map((b) => {
    let link;
    if (isAtom) {
      const alt = b.match(/<link\b[^>]*rel=["']alternate["'][^>]*>/i) || b.match(/<link\b[^>]*>/i);
      link = alt && (alt[0].match(/href=["']([^"']+)["']/i) || [])[1];
    } else {
      link = tagText(b, 'link') || tagText(b, 'guid');
    }
    const dateStr = tagText(b, 'pubDate', 'published', 'updated', 'dc:date');
    const date = dateStr ? new Date(dateStr) : null;
    return {
      title: tagText(b, 'title') || '(untitled)',
      link: link ? decode(link) : null,
      date: date && !isNaN(date) ? date : null,
    };
  });
}

/** Fetches `feedUrl` (or autodiscovers it from `pageUrl`) and returns newest-first items. */
export async function loadFeed(pageUrl, feedUrl) {
  let feed = feedUrl;
  if (!feed) {
    const page = await get(pageUrl);
    feed = discoverFeed(page.text, page.url);
    if (!feed) throw new Error('no feed found');
  }
  const items = parseFeed((await get(feed)).text);
  items.sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0));
  return items;
}
