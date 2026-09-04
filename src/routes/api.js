const express = require('express');
const sc = require('../lib/soundcloud');
const agent = require('../lib/agent');

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

// POST /api/agent/find-event { query }
// Uses Claude + web search to find candidate events matching a free-text
// query. Returns up to 3 candidates for the user to confirm before we
// spend a second agent call looking for the actual lineup.
router.post('/agent/find-event', async (req, res) => {
  const { query } = req.body;
  if (!query || !query.trim()) {
    return res.status(400).json({ error: 'Please enter an event name or description.' });
  }

  try {
    const candidates = await agent.findEventCandidates(query.trim());
    res.json({ candidates });
  } catch (err) {
    console.error('Event search failed:', err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to search for that event.' });
  }
});

// POST /api/agent/lineup { candidate }
// Given a confirmed event candidate, finds its full artist lineup.
router.post('/agent/lineup', async (req, res) => {
  const { candidate } = req.body;
  if (!candidate || !candidate.title) {
    return res.status(400).json({ error: 'Missing event details.' });
  }

  try {
    const result = await agent.findLineupForEvent(candidate);
    console.log(`Agent lineup for "${candidate.title}": found ${result.artists.length} artists`);
    if (result.artists.length === 0) {
      return res.status(422).json({
        error: 'Could not find a lineup for that event — try a different search or check the source directly.',
      });
    }
    res.json(result);
  } catch (err) {
    console.error('Lineup search failed:', err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to search for the lineup.' });
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
    const token = (await ensureFreshToken(req)) || (await sc.getAppToken());

    const results = {};
    for (const artist of artists) {
      try {
        const { matchedUser, tracks } = await sc.searchArtistTracks(artist, token, 20);
        results[artist] = {
          matchedUser: matchedUser
            ? {
                username: matchedUser.username,
                avatar_url: matchedUser.avatar_url,
                permalink_url: matchedUser.permalink_url,
              }
            : null,
          tracks: tracks.map((t) => ({
            id: t.id,
            title: t.title,
            permalink_url: t.permalink_url,
            artwork_url: t.artwork_url,
            user: t.user?.username,
            playback_count: t.playback_count || 0,
            created_at: t.created_at || null,
            duration: t.duration || 0, // milliseconds
          })),
        };
      } catch (err) {
        console.error(`Search failed for "${artist}":`, err.response?.data || err.message);
        results[artist] = { matchedUser: null, tracks: [] };
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
