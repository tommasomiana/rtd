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

// Splits raw free-form text (pasted or OCR'd) into a clean artist list.
// Handles one-per-line and comma-separated input, and common lineup poster
// noise (b2b / live / DJ set labels, empty lines, stray punctuation).
function parseArtistsFromText(rawText) {
  if (!rawText) return [];

  const noiseWords = new Set(['b2b', 'live', 'dj set', 'dj', 'presents', 'w/']);

  return rawText
    .split(/[\n,]/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !noiseWords.has(line.toLowerCase()))
    .filter((line) => line.length >= 2 && line.length <= 60)
    // de-dupe, case-insensitive, keep first-seen casing
    .filter((line, idx, arr) => {
      const lower = line.toLowerCase();
      return arr.findIndex((l) => l.toLowerCase() === lower) === idx;
    });
}

// POST /api/extract-image  (multipart form, field name "image")
// Runs OCR on an uploaded lineup screenshot and returns the raw text plus
// a best-effort parsed artist list, for the user to review/edit before matching.
router.post('/extract-image', upload.single('image'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No image uploaded.' });
  }

  try {
    const rawText = await extractTextFromImage(req.file.buffer);
    const artists = parseArtistsFromText(rawText);
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
        const tracks = await sc.searchArtistTracks(artist, token, 5);
        results[artist] = tracks.map((t) => ({
          id: t.id,
          title: t.title,
          permalink_url: t.permalink_url,
          artwork_url: t.artwork_url,
          user: t.user?.username,
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
