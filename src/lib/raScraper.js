const cheerio = require('cheerio');
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Puppeteer's default headless mode relies on a separate
 * `chrome-headless-shell` download, distinct from the full Chrome binary.
 * On some macOS setups, freshly-downloaded Chromium binaries also hit
 * Gatekeeper's code-signing checks before they've ever been manually opened
 * once, which can surface as a cryptic "spawn Unknown system error -88"
 * even though the architecture is correct.
 *
 * To sidestep both issues, this prefers the user's own system-installed
 * Google Chrome (already signed/notarized by Apple, so Gatekeeper never
 * blocks it) if present, and only falls back to Puppeteer's bundled
 * download otherwise.
 */
function findChromeExecutable() {
  const systemChromePaths = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ];
  for (const p of systemChromePaths) {
    if (fs.existsSync(p)) return p;
  }

  return findPuppeteerChromeExecutable();
}

function findPuppeteerChromeExecutable() {
  const cacheDir = path.join(os.homedir(), '.cache', 'puppeteer', 'chrome');
  if (!fs.existsSync(cacheDir)) return null;

  const versions = fs.readdirSync(cacheDir);
  for (const version of versions) {
    // macOS arm64 layout: chrome/mac_arm-<version>/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing
    const macArmPath = path.join(
      cacheDir,
      version,
      'chrome-mac-arm64',
      'Google Chrome for Testing.app',
      'Contents',
      'MacOS',
      'Google Chrome for Testing'
    );
    if (fs.existsSync(macArmPath)) return macArmPath;

    // macOS intel layout, in case this ever runs on an Intel Mac
    const macIntelPath = path.join(
      cacheDir,
      version,
      'chrome-mac-x64',
      'Google Chrome for Testing.app',
      'Contents',
      'MacOS',
      'Google Chrome for Testing'
    );
    if (fs.existsSync(macIntelPath)) return macIntelPath;
  }
  return null;
}

/**
 * Fetches a Resident Advisor event page and extracts the lineup artist names.
 *
 * RA has no public API, so this scrapes the rendered page. A plain HTTP
 * request (axios/curl) gets blocked with a 403 — RA sits behind bot
 * detection (Cloudflare-style) that a simple request, even with browser-like
 * headers, doesn't get past. Puppeteer drives a real headless Chromium
 * instance instead, which executes JS and behaves like an actual browser,
 * which is enough to get through.
 *
 * Verified against a real event page (a Brunch Electronik Festival listing,
 * Aug 2026): every lineup artist is rendered as a link matching
 * `/dj/<slug>`, e.g. `it.ra.co/dj/acidarab` — that pattern correctly picked
 * up all 52 artists on that page, including b2b/live billing text sitting
 * outside the links. That's used as the primary parsing strategy. The
 * __NEXT_DATA__ JSON blob (common on Next.js sites) is kept as a fallback
 * in case RA changes their markup.
 */
async function scrapeRAEvent(eventUrl) {
  const executablePath = findChromeExecutable();

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    ...(executablePath ? { executablePath } : {}),
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36'
    );
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9,it;q=0.8',
    });

    await page.goto(eventUrl, { waitUntil: 'networkidle2', timeout: 30000 });

    // Give any Cloudflare JS challenge a moment to resolve, and make sure
    // the lineup section (client-rendered) has actually appeared.
    await page
      .waitForSelector('a[href*="/dj/"]', { timeout: 8000 })
      .catch(() => {}); // fall through — extractFromDom below will just find nothing

    const html = await page.content();
    const $ = cheerio.load(html);

    const fromDom = extractFromDom($, eventUrl);
    if (fromDom.artists.length > 0) {
      return fromDom;
    }

    return extractFromNextData($) || fromDom;
  } finally {
    await browser.close();
  }
}

function extractFromNextData($) {
  const empty = { eventTitle: null, eventDate: null, artists: [] };
  const script = $('#__NEXT_DATA__').html();
  if (!script) return empty;

  let json;
  try {
    json = JSON.parse(script);
  } catch (e) {
    return empty;
  }

  // The exact path inside __NEXT_DATA__ can change between RA deploys.
  // We search recursively for anything that looks like a lineup/artist list
  // rather than hardcoding one brittle path.
  const artists = new Set();
  let eventTitle = null;
  let eventDate = null;

  function walk(node) {
    if (!node || typeof node !== 'object') return;

    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }

    // Heuristic: an object with a `name` (or `title`) field inside
    // something keyed like "artists" / "djs" / "lineup"
    if (
      (node.name && typeof node.name === 'string') ||
      (node.title && typeof node.title === 'string' && node.contentUrl)
    ) {
      const label = node.name || node.title;
      if (looksLikeArtistName(label)) artists.add(label.trim());
    }

    if (!eventTitle && node.title && typeof node.title === 'string' && node.date) {
      eventTitle = node.title;
    }
    if (!eventDate && node.date && typeof node.date === 'string') {
      eventDate = node.date;
    }

    Object.values(node).forEach(walk);
  }

  walk(json);

  return { eventTitle, eventDate, artists: Array.from(artists) };
}

function extractFromDom($, eventUrl) {
  const seen = new Set(); // lowercase, for de-duping
  const artists = [];

  // Confirmed against a live RA event page: every lineup artist is a link
  // matching /dj/<slug>. b2b/live/DJ-set labels sit as plain text next to
  // the links, not inside them, so they're naturally excluded.
  $('a[href*="/dj/"], a[href*="/artist/"]').each((_, el) => {
    const text = $(el).text().trim();
    if (!looksLikeArtistName(text)) return;
    const key = text.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    artists.push(text);
  });

  const eventTitle = $('h1').first().text().trim() || null;

  return { eventTitle, eventDate: null, artists };
}

function looksLikeArtistName(text) {
  if (!text) return false;
  const trimmed = text.trim();
  if (trimmed.length < 2 || trimmed.length > 60) return false;
  // Filter out obvious non-artist junk (nav links, generic labels, etc.)
  const blacklist = [
    'tickets',
    'lineup',
    'venue',
    'about',
    'share',
    'login',
    'sign up',
    'resident advisor',
  ];
  if (blacklist.includes(trimmed.toLowerCase())) return false;
  return true;
}

module.exports = { scrapeRAEvent };
