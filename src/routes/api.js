const express = require('express');
const multer = require('multer');
const sc = require('../lib/soundcloud');
const { extractTextFromImage } = require('../lib/ocr');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 }, // 8MB
});

// Makes sure req.session.soundcloud.access_token is valid, refreshing if needed
async function ensureFreshToken(req) {
  const session = req.session.soundcloud;
  if (!session) return null;

  if (session.expires_at > Date.now() + 5000) {
    return session.access_token;
  }

  const refreshed = await sc.refreshToken(session.refresh_token);
  req.session.soundcloud = {
    access_token: refreshed.access_token,
    refresh_token: refreshed.refresh_token, // refresh tokens are single-use
    expires_at: Date.now() + refreshed.expires_in * 1000,
  };
  return req.session.soundcloud.access_token;
}

// Whole lines matching these are poster headers/dates/venue info, not
// artist names — dropped before splitting into individual artist tokens.
// Month/day patterns require an adjacent digit (real dates always pair a
// month with a day or year number) — otherwise an artist name that merely
// starts with those letters (e.g. "MARRØN") would false-positive on "mar".
const NOISE_LINE_PATTERNS = [
  /lineup/i,
  /\b(mon|tue|wed|thu|fri|sat|sun)(day)?\b/i,
  /\d{1,2}(st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i,
  /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{4}\b/i,
  /\d{1,2}\s*(am|pm)\b/i,
  // Instagram/social-post chrome that sometimes gets OCR'd along with a
  // screenshotted lineup graphic
  /^\d+\s*posts?$/i,
  /liked by/i,
  /see translation/i,
  /\d+\s*(days?|hours?|weeks?)\s*ago/i,
];

// Noise words/labels that sometimes appear attached directly to an artist
// name with no separator (e.g. OCR reading "CASSIUS Live" as one chunk) —
// stripped from the end of a token rather than only matched as a whole token.
const TRAILING_NOISE_SUFFIX = /\s*\b(live|b2b|dj set|presents)\b\s*$/i;

// A schedule-grid style poster (e.g. an Instagram post with a timetable)
// mixes times in with names — these patterns catch that noise at the
// token level, after splitting, since times often end up on their own
// line/segment rather than a whole noise line.
function looksLikeTimeOrJunk(token) {
  if (/^\d{1,2}:\d{2}/.test(token)) return true; // "16:00", "17:00-18:00"
  if (/^\d+([-–]\d+)?$/.test(token)) return true; // bare numbers/ranges
  const digitCount = (token.match(/\d/g) || []).length;
  // Mostly-digits tokens are almost always OCR noise (times, IDs) rather
  // than an artist name — except the rare fully-numeric stage name, which
  // tends to be long (e.g. "999999999"), so that's exempted.
  if (digitCount / token.length > 0.4 && !/^\d+$/.test(token)) return true;
  return false;
}

// Splits raw free-form text (pasted or OCR'd) into a clean artist list.
// Handles one-per-line, comma-separated, and bullet-separated input (lineup
// posters commonly use "·", "•", or "|" between names on the same line),
// plus common noise (date/venue header lines, b2b/live/DJ-set labels, and
// schedule-grid/social-media chrome for messier screenshot sources).
function parseArtistsFromText(rawText) {
  if (!rawText) return [];

  const noiseWords = new Set([
    'b2b', 'live', 'dj set', 'dj', 'presents', 'w/',
    'posts', 'more', 'ago', 'others', 'and others',
  ]);

  const lines = rawText
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !NOISE_LINE_PATTERNS.some((pattern) => pattern.test(line)));

  return lines
    .flatMap((line) => line.split(/[·•|,]/))
    .map((token) => token.trim().replace(TRAILING_NOISE_SUFFIX, '').trim())
    .filter(Boolean)
    .filter((token) => !noiseWords.has(token.toLowerCase()))
    .filter((token) => token.length >= 2 && token.length <= 60)
    .filter((token) => !looksLikeTimeOrJunk(token))
    // de-dupe, case-insensitive, keep first-seen casing
    .filter((token, idx, arr) => arr.findIndex((t) => t.toLowerCase() === token.toLowerCase()) === idx);
}

// POST /api/extract-image  (multipart form, field name "image")
// Runs OCR on an uploaded lineup screenshot and returns the raw text plus
// a best-effort parsed artist list, for the user to review/edit before matching.
router.post('/extract-image', upload.single('image'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No image uploaded.' });
  }

  try {
    const rawText = await extractTextFromImage(req.file.buffer, req.file.mimetype);
    const artists = parseArtistsFromText(rawText);
    console.log(
      `OCR on "${req.file.originalname}": extracted ${rawText.length} chars, parsed ${artists.length} artist candidates`
    );
    console.log('OCR raw text snippet:\n' + rawText.slice(0, 1000));
    res.json({ rawText, artists });
  } catch (err) {
    console.error('OCR failed:', err.message);
    res.status(500).json({ error: 'Failed to read text from that image.' });
  }
});

// POST /api/match { artists: string[] }
// For each artist, find a few candidate tracks on SoundCloud.
router.post('/match', async (req, res) => {
  const { artists } = req.body;
  if (!Array.isArray(artists) || artists.length === 0) {
    return res.status(400).json({ error: 'artists must be a non-empty array.' });
  }

  try {
    // Public search data — app-level Client Credentials token is enough here,
    // but a logged-in user's token also works if present.
    const token = (await ensureFreshToken(req)) || (await sc.getAppToken());

    const results = {};
    for (const artist of artists) {
      try {
        const tracks = await sc.searchArtistTracks(artist, token, 20);
        results[artist] = tracks.map((t) => ({
          id: t.id,
          title: t.title,
          permalink_url: t.permalink_url,
          artwork_url: t.artwork_url,
          user: t.user?.username,
          playback_count: t.playback_count || 0,
          created_at: t.created_at || null,
          duration: t.duration || 0, // milliseconds
        }));
      } catch (err) {
        console.error(`Search failed for "${artist}":`, err.response?.data || err.message);
        results[artist] = [];
      }
    }

    res.json({ matches: results });
  } catch (err) {
    console.error('Matching failed:', err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to search SoundCloud for the lineup artists.' });
  }
});

// POST /api/playlist { title, trackIds: number[] }
// Requires the user to be logged in — creates the playlist on THEIR account.
router.post('/playlist', async (req, res) => {
  const { title, trackIds } = req.body;

  if (!req.session.soundcloud) {
    return res.status(401).json({ error: 'Connect your SoundCloud account first.' });
  }
  if (!title || !Array.isArray(trackIds) || trackIds.length === 0) {
    return res.status(400).json({ error: 'title and a non-empty trackIds array are required.' });
  }

  try {
    const token = await ensureFreshToken(req);
    const playlist = await sc.createPlaylist({ token, title, trackIds });
    res.json({ playlist_url: playlist.permalink_url });
  } catch (err) {
    console.error('Playlist creation failed:', err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to create the playlist on SoundCloud.' });
  }
});

module.exports = router;
