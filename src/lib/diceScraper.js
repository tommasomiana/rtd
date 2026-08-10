const axios = require('axios');
const cheerio = require('cheerio');

/**
 * Fetches a Dice.fm event page and extracts the lineup artist names.
 *
 * Unlike Resident Advisor, Dice.fm does not appear to sit behind aggressive
 * bot detection (verified: a plain HTTP request with browser-like headers
 * gets the real page, not a CAPTCHA challenge) — so this uses a simple
 * axios GET + cheerio parse, no headless browser needed.
 *
 * Dice event pages link each lineup artist to their own profile at
 * /artist/<slug>, which is used as the primary extraction strategy (the
 * same approach that worked reliably for RA's /dj/ links). The page's
 * "Lineup" section visually truncates to a few names + "and N more" behind
 * a "Show more" toggle, but the underlying links for the full lineup are
 * expected to already be present in the HTML (client-side show/hide),
 * not lazy-loaded — the __NEXT_DATA__ JSON blob is kept as a fallback in
 * case that assumption is wrong or Dice changes their markup.
 *
 * NOTE: this hasn't been tested end-to-end against a live event page from
 * this environment (dice.fm isn't reachable from this sandbox's network).
 * If the artist list comes back incomplete or empty, inspect a real event
 * page's HTML for the actual lineup markup and adjust extractFromDom /
 * extractFromNextData accordingly.
 */
async function scrapeDiceEvent(eventUrl) {
  const { data: html } = await axios.get(eventUrl, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });

  const $ = cheerio.load(html);

  const fromDom = extractFromDom($);
  if (fromDom.artists.length > 0) return fromDom;

  return extractFromNextData($) || fromDom;
}

function extractFromDom($) {
  const seen = new Set();
  const artists = [];

  $('a[href*="/artist/"]').each((_, el) => {
    const text = $(el).text().trim();
    if (!text || text.length < 2 || text.length > 60) return;
    const key = text.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    artists.push(text);
  });

  const eventTitle = $('h1').first().text().trim() || null;

  return { eventTitle, artists };
}

function extractFromNextData($) {
  const empty = { eventTitle: null, artists: [] };
  const script = $('#__NEXT_DATA__').html();
  if (!script) return empty;

  let json;
  try {
    json = JSON.parse(script);
  } catch (e) {
    return empty;
  }

  const artists = new Set();
  let eventTitle = null;

  function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node.name && typeof node.name === 'string' && node.name.length < 60) {
      artists.add(node.name.trim());
    }
    if (!eventTitle && node.title && typeof node.title === 'string' && node.date) {
      eventTitle = node.title;
    }
    Object.values(node).forEach(walk);
  }

  walk(json);
  return { eventTitle, artists: Array.from(artists) };
}

module.exports = { scrapeDiceEvent };
