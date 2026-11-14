# Kyle's Victorian House

My personal site, live at <https://kyle-s-victorian-house.vercel.app>.

It's a preserved copy of **Seventh Column**, a site I built in Microsoft FrontPage 4.0 in 2005–2006 when I was 11–12 years old. It was originally hosted at 7thcolumn.net by my mom's web design company, Foxxcomm, Inc. The original images, styling and old-fashioned HTML (table layouts, `<font>` tags and all) are kept as they were. The text has been updated with information about my house in Detroit and the things I'm into.

## Pages

| Page | What's on it |
| --- | --- |
| [index.htm](index.htm) | Home page |
| [house.htm](house.htm) | The house |
| [parking.htm](parking.htm) | Parking |
| [events.htm](events.htm) | Events |
| [detroit-events.htm](detroit-events.htm) | Events around Detroit |
| [cafes.htm](cafes.htm) | Detroit cafes |
| [links.htm](links.htm) | Blogs & Updates: sites, newsletters and YouTube channels I follow |
| [blog.htm](blog.htm) | Tech blog index; the posts themselves are in [posts/](posts/) (moved over from WordPress) |
| [about.htm](about.htm) | About the site |

Other folders:

- [assets/](assets/): images, fonts, stylesheets and the original JavaScript.
- [sections/](sections/): the shared footer, loaded into pages with an `<iframe>`.
- [scripts/](scripts/): local tools that aren't part of the published site.

The site is plain static HTML with no build step; Vercel serves the files as they are.

## Scripts

Two local scripts read the link pages and pull in what's new from each site:

| Script | Page it reads | What it lists |
| --- | --- | --- |
| [scripts/list-updates.mjs](scripts/list-updates.mjs) | [links.htm](links.htm) | Newest articles, posts and videos |
| [scripts/list-events.mjs](scripts/list-events.mjs) | [detroit-events.htm](detroit-events.htm) | Upcoming events, games and meetups, plus recent roundup posts |

### Quick digest

To run both at once and save the results:

```sh
scripts/digest.sh
```

This writes two files to `digest/`, which git ignores:

- `digest/updates.md`: everything from `links.htm` posted in the last 2 days
- `digest/events.md`: everything from `detroit-events.htm` happening in the next 2 weeks

Pass a folder to write somewhere else, e.g. `scripts/digest.sh ~/Desktop`. Each run overwrites the previous files.

### Details

Both scripts print Markdown. You need [Node.js](https://nodejs.org/) 18 or newer, and there's nothing to install. Helpers they share (fetching with retries, reading the link pages, parsing feeds) live in [scripts/lib/common.mjs](scripts/lib/common.mjs).

Both scripts read the links straight from the page, so links you add to a page are picked up automatically. Some sites need a one-time entry in the script, which the sections below explain.

## Listing the latest updates from links.htm

[scripts/list-updates.mjs](scripts/list-updates.mjs) gathers the newest articles, posts and videos from every link on the Blogs & Updates page.

### Running it

From the project folder:

```sh
node scripts/list-updates.mjs
```

| Option | What it does |
| --- | --- |
| `--limit N` | Show up to `N` items per site (default 5) |
| `--days N` | Only show items from the last `N` days |
| `--json` | Print JSON instead of Markdown |

The options can be combined. For example, to see everything from the last two days:

```sh
node scripts/list-updates.mjs --days 2 --limit 20
```

The output is easiest to read rendered. To save it and preview it in VS Code (Cmd+Shift+V):

```sh
node scripts/list-updates.mjs > updates.md
```

A run takes a few seconds because the script fetches every feed.

### How it works

1. It reads the section headings and links straight from `links.htm`.
2. For each link, it finds the site's RSS or Atom feed from the `<link rel="alternate">` tag on the linked page. YouTube channel pages advertise their video feed the same way.
3. It downloads each feed and lists the newest items, grouped by the same sections as the page.

YouTube's feed URLs sometimes return 404 for channels that are fine, so the script retries failed requests a few times with increasing waits.

### When a new link doesn't work

If a site shows a ⚠️ warning such as `no feed found`, open `scripts/list-updates.mjs` and use one of the three lists near the top:

- **`FEED_OVERRIDES`**: the site has a feed, but the linked page doesn't advertise it, or advertises the wrong one. Map the link to the feed URL. Try `/feed`, `/rss`, `/feed.xml` or `/index.xml` on the site, or look for an RSS icon.
- **`SCRAPERS`**: the site has no feed at all. Add a function that pulls titles and links out of the page HTML (see the Nachrichtenleicht entry for an example).
- **`UNSUPPORTED`**: the site blocks automated requests (like IMDb). Add a short reason and it's listed with a note instead of an error.

Each key must exactly match the `href` used in `links.htm`.

## Listing upcoming Detroit events

[scripts/list-events.mjs](scripts/list-events.mjs) checks the venues, team schedules and Meetup groups on the Detroit Events page and lists what's coming up, with times in Detroit time. For the Weekly Roundups section (news sites and newsletters), it lists posts from the last 7 days instead.

### Running it

```sh
node scripts/list-events.mjs
```

| Option | What it does |
| --- | --- |
| `--days N` | How many days ahead to look (default 14) |
| `--limit N` | Show up to `N` events per site (default 10) |
| `--agenda` | One combined day-by-day list of everything, instead of grouping by site |
| `--json` | Print JSON instead of Markdown |

For example, everything happening this weekend as a single schedule:

```sh
node scripts/list-events.mjs --agenda --days 3
```

To save it and preview it in VS Code:

```sh
node scripts/list-events.mjs --agenda > events.md
```

A run takes about 5–10 seconds.

In the default view, sites that were checked but have nothing coming up are collapsed into one line per section. Links that are Google searches (shops, community groups, cafes without a website) are listed at the end as not checked.

### Where the events come from

Venues don't publish calendars in a standard way, so each link is matched to a source type in the `SOURCES` list at the top of the script:

| Source type | Used for | How it works |
| --- | --- | --- |
| `feed` | Weekly Roundups | Recent posts from the site's RSS feed |
| `jsonld` | Fox Theatre (313 Presents), The Fillmore | Standard schema.org event data embedded in the venue's page |
| `aeg` | Masonic Temple | The events file that AEG Presents' venue sites load |
| `wpShows` | Detroit Opera | Performance dates on the site's WordPress "show" posts |
| `tribe` | The Congregation | The WordPress "The Events Calendar" plugin's API |
| `squarespace` | Vander Cafe | Squarespace's JSON view of an events page |
| `espn` | Pistons, Red Wings, Tigers, Lions | ESPN's public team schedule API |
| `riverfront` | Detroit Riverfront Conservancy | Reads dates from the event URLs |
| `redford` | Redford Theatre | Reads the titles and dates from the events page |
| `meetup` | Every meetup.com link (automatic) | Event data embedded in the group's events page |
| `unsupported` | See below | Shown with a note instead of events |

Links that aren't in `SOURCES` and aren't on Meetup are tried two ways: first schema.org event data on the linked page, then an RSS feed.

**Currently unsupported:** Metro Times and Axios Detroit (block automated requests), the Detroit Free Press (no public feed), the DIA (blocks automated requests), Michigan Central, the DSO (calendars built with JavaScript), Paxahau, Greenfield Village, the Detroit Historical Society and 27th Letter Books (no machine-readable dates).

### Adding a new link

- **Meetup group:** nothing to do; it's detected automatically.
- **Venue that uses a supported platform:** if the site is built on WordPress with The Events Calendar, Squarespace or an AEG Presents venue site, add an entry with that source type (copy an existing one). For WordPress with The Events Calendar, check that `<site>/wp-json/tribe/events/v1/events` returns JSON.
- **Anything else:** run the script first, since the generic fallback may already work. If the link shows `no events or feed found`, either add a new loader to `LOADERS` (the `riverfront` and `redford` loaders are short examples of reading a page) or mark it `unsupported` with a reason.

Keys in `SOURCES` must exactly match the `href` used in `detroit-events.htm`.

If a site redesigns its page, its loader may stop finding events. It will then show "no events" or a warning; the fix is usually to update that loader's pattern.
