const express = require('express');
const sc = require('../lib/soundcloud');
const { scrapeRAEvent } = require('../lib/raScraper');

const router = express.Router();

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

// POST /api/lineup { eventUrl }
router.post('/lineup', async (req, res) => {
  const { eventUrl } = req.body;
  if (!eventUrl || !eventUrl.includes('ra.co')) {
    return res.status(400).json({ error: 'Please provide a valid ra.co event URL.' });
  }

  try {
    const result = await scrapeRAEvent(eventUrl);
    if (!result.artists.length) {
      return res.status(422).json({
        error:
          'Could not find any artists on that page. RA may have changed their markup — see raScraper.js for where to adjust it.',
      });
    }
    res.json(result);
  } catch (err) {
    console.error('Scrape failed:', err.message);
    res.status(500).json({ error: 'Failed to fetch or parse that event page.' });
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
