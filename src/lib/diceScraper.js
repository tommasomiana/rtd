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
 * /artist/<slug>, which is the (only) extraction strategy — verified
 * against a real event page. There is deliberately no JSON-blob fallback:
 * an earlier naive scan for any field named "name" anywhere in the page's
 * embedded JSON picked up unrelated content (e.g. a partner widget
 * configurator's form labels) when a link ended up somewhere other than
 * a real event page, which is worse than honestly reporting no lineup found.
 *
 * NOTE: link.dice.fm short links redirect somewhere before landing on the
 * final page — axios follows redirects by default (maxRedirects: 10 here),
 * and the resolved URL is logged for diagnosis. If a short link doesn't
 * resolve to a normal /event/... page, this will correctly find 0 artists.
 */
async function scrapeDiceEvent(eventUrl) {
  const response = await axios.get(eventUrl, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    maxRedirects: 10,
  });

  const finalUrl = response.request?.res?.responseUrl || response.request?.responseURL || eventUrl;
  console.log(`[dice-scrape] "${eventUrl}" resolved to: ${finalUrl}`);

  const $ = cheerio.load(response.data);

  const fromDom = extractFromDom($);
  console.log(`[dice-scrape] DOM /artist/ links found: ${fromDom.artists.length}`);
  if (fromDom.artists.length > 0) return fromDom;

  // No __NEXT_DATA__ fallback here (deliberately removed): a naive scan for
  // any JSON field named "name" turned out to pick up unrelated page
  // content (e.g. a partner widget configurator's form labels) when the
  // DOM strategy found nothing — which is worse than just reporting no
  // lineup found. If /artist/ links aren't present, treat as no lineup.
  return fromDom;
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

module.exports = { scrapeDiceEvent };
