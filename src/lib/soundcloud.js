const axios = require('axios');
const crypto = require('crypto');
const FormData = require('form-data');

const TOKEN_URL = 'https://secure.soundcloud.com/oauth/token';
const AUTHORIZE_URL = 'https://secure.soundcloud.com/authorize';
const API_BASE = 'https://api.soundcloud.com';

const CLIENT_ID = process.env.SOUNDCLOUD_CLIENT_ID;
const CLIENT_SECRET = process.env.SOUNDCLOUD_CLIENT_SECRET;
const REDIRECT_URI = process.env.SOUNDCLOUD_REDIRECT_URI;

// --- PKCE helpers -----------------------------------------------------

function base64url(buffer) {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

function generatePkcePair() {
  const codeVerifier = base64url(crypto.randomBytes(32));
  const codeChallenge = base64url(
    crypto.createHash('sha256').update(codeVerifier).digest()
  );
  return { codeVerifier, codeChallenge };
}

function generateState() {
  return base64url(crypto.randomBytes(16));
}

// --- App-level (Client Credentials) token, used for public search ----

let appToken = null; // { access_token, expires_at }

async function getAppToken() {
  if (appToken && appToken.expires_at > Date.now() + 5000) {
    return appToken.access_token;
  }
  // SoundCloud's client_credentials flow requires the client_id/secret as
  // an HTTP Basic Auth header, not as body params (which is what the
  // Authorization Code flow above still uses successfully) — sending them
  // in the body here returns a misleading "invalid_client" error instead
  // of a clearer auth-format error.
  const basicAuth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  const res = await axios.post(
    TOKEN_URL,
    new URLSearchParams({ grant_type: 'client_credentials' }),
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${basicAuth}`,
        Accept: 'application/json; charset=utf-8',
      },
    }
  );
  appToken = {
    access_token: res.data.access_token,
    expires_at: Date.now() + res.data.expires_in * 1000,
  };
  return appToken.access_token;
}

// --- User-level (Authorization Code + PKCE) -----------------------------

function buildAuthorizeUrl({ state, codeChallenge }) {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

async function exchangeCodeForToken({ code, codeVerifier }) {
  const res = await axios.post(
    TOKEN_URL,
    new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      code_verifier: codeVerifier,
      code,
    }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );
  return res.data;
}

async function refreshToken(refresh_token) {
  const res = await axios.post(
    TOKEN_URL,
    new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token,
    }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );
  return res.data;
}

// --- API calls ----------------------------------------------------------

// Strips diacritics for comparison, so a plainly-typed "Bohmer" matches a
// SoundCloud username spelled "Böhmer".
function normalizeForCompare(str) {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

// Finds the SoundCloud user profile that best matches an artist name.
// Prefers an exact match (diacritic-insensitive, so typed-ASCII names
// still match accented usernames) — and among MULTIPLE exact matches
// (common: a popular real account plus several tiny copycat/fan accounts
// with the same normalized name), picks the one with the most followers.
// Falls back to the highest-follower candidate overall if there's no
// exact match at all.
async function findArtistUser(artistName, token) {
  const res = await axios.get(`${API_BASE}/users`, {
    headers: { Authorization: `OAuth ${token}` },
    params: { q: artistName, limit: 20 },
  });

  const data = res.data;
  const users = Array.isArray(data) ? data : Array.isArray(data?.collection) ? data.collection : [];

  console.log(
    `[artist-match] "${artistName}" candidates:`,
    users.map((u) => `${u.username} (id=${u.id}, followers=${u.followers_count || 0})`)
  );

  if (users.length === 0) return null;

  const normalizedQuery = normalizeForCompare(artistName);
  const exactMatches = users.filter(
    (u) => u.username && normalizeForCompare(u.username) === normalizedQuery
  );
  if (exactMatches.length > 0) {
    const best = [...exactMatches].sort((a, b) => (b.followers_count || 0) - (a.followers_count || 0))[0];
    console.log(
      `[artist-match] "${artistName}" -> ${exactMatches.length} exact match(es), picked by followers: ${best.username} (${best.followers_count || 0} followers)`
    );
    return best;
  }

  const byFollowers = [...users].sort((a, b) => (b.followers_count || 0) - (a.followers_count || 0))[0];
  console.log(`[artist-match] "${artistName}" -> no exact match, picked by followers: ${byFollowers.username}`);
  return byFollowers;
}

async function getUserTracks(userId, token, limit) {
  const res = await axios.get(`${API_BASE}/users/${userId}/tracks`, {
    headers: { Authorization: `OAuth ${token}` },
    params: { limit },
  });
  const data = res.data;
  console.log(
    `[user-tracks] user ${userId}: type=${Array.isArray(data) ? 'array' : typeof data}, ` +
      `${Array.isArray(data) ? `length=${data.length}` : `keys=${data && typeof data === 'object' ? Object.keys(data).join(',') : 'n/a'}`}`
  );
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.collection)) return data.collection;
  return [];
}

// Tracks a user REPOSTED to their own profile — e.g. a DJ set actually
// recorded/uploaded by a promoter or radio show account, which the artist
// then reposted themselves. A repost is the artist's own endorsement that
// the track is genuinely theirs, which is more reliable than matching on
// title text alone.
//
// This endpoint has a messy history: SoundCloud's public API had no way
// to fetch a user's reposts for years (long-standing, publicly tracked
// gaps), so this may or may not actually work depending on the current
// state of their API. Failing gracefully here (treat any error as "no
// reposts available") means trying it costs nothing if it's unavailable.
async function getUserReposts(userId, token, limit) {
  try {
    const res = await axios.get(`${API_BASE}/users/${userId}/reposts/tracks`, {
      headers: { Authorization: `OAuth ${token}` },
      params: { limit },
    });
    const data = res.data;
    const items = Array.isArray(data) ? data : Array.isArray(data?.collection) ? data.collection : [];
    // Repost items may wrap the actual track under a `track` key, or just
    // be the track itself depending on the response shape — handle both.
    const tracks = items.map((item) => item.track || item).filter(Boolean);
    console.log(`[user-reposts] user ${userId}: found ${tracks.length} reposted tracks`);
    return tracks;
  } catch (err) {
    console.log(
      `[user-reposts] user ${userId}: endpoint unavailable (${err.response?.status || err.message}) — skipping`
    );
    return [];
  }
}

// Gets a pool of tracks that genuinely belong to an artist, rather than
// just any track whose title/description happens to mention their name.
// Looks up their actual SoundCloud profile first and pulls from their own
// uploads; only falls back to a keyword search (filtered to require the
// artist's name in the uploader's username) if no matching profile exists
// or that profile's own-uploads endpoint returns nothing (common for
// label-distributed artists — their catalog often isn't exposed there
// even though it's publicly playable). Returns both the matched profile
// (for the UI to show as confirmation) and the track pool.
async function searchArtistTracks(artistName, token, poolSize = 15) {
  const user = await findArtistUser(artistName, token);

  if (user) {
    const [ownTracks, repostedTracks] = await Promise.all([
      getUserTracks(user.id, token, poolSize),
      getUserReposts(user.id, token, poolSize),
    ]);

    const seenIds = new Set();
    const combined = [...ownTracks, ...repostedTracks].filter((t) => {
      if (!t.id || seenIds.has(t.id)) return false;
      seenIds.add(t.id);
      return true;
    });

    if (combined.length > 0) {
      return { matchedUser: user, tracks: combined.slice(0, poolSize) };
    }
  }

  const res = await axios.get(`${API_BASE}/tracks`, {
    headers: { Authorization: `OAuth ${token}` },
    params: { q: artistName, limit: poolSize * 4 },
  });
  const allTracks = res.data || [];
  const needle = normalizeForCompare(artistName);
  const tracks = allTracks
    .filter(
      (t) =>
        (t.user?.username && normalizeForCompare(t.user.username).includes(needle)) ||
        (user && t.user?.id === user.id)
    )
    .slice(0, poolSize);

  console.log(
    `[artist-match] "${artistName}" fallback keyword search: ${allTracks.length} raw results, ${tracks.length} kept after uploader-name filter`
  );

  if (tracks.length === 0 && allTracks.length > 0) {
    console.log(
      `[artist-match] "${artistName}" raw result uploaders:`,
      allTracks.slice(0, 15).map((t) => `"${t.title}" by ${t.user?.username || 'unknown'}`)
    );
  }

  return { matchedUser: user || null, tracks };
}

async function createPlaylist({ token, title, trackIds, isPublic = false }) {
  const payload = JSON.stringify({
    playlist: {
      title,
      sharing: isPublic ? 'public' : 'private',
      tracks: trackIds.map((id) => ({ id: String(id) })),
    },
  });

  const res = await axios.post(`${API_BASE}/playlists`, payload, {
    headers: {
      Authorization: `OAuth ${token}`,
      Accept: 'application/json; charset=utf-8',
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
  return res.data;
}

// Attempts to set a custom cover image on an existing playlist. SoundCloud's
// help docs confirm playlists support custom artwork via their web UI
// ("Replace image"), but the exact API parameter isn't publicly documented —
// this mirrors the pattern used for track artwork (multipart artwork_data).
// Unverified: if this doesn't work, the caller should treat it as a
// non-fatal failure (the playlist itself is already created either way).
async function updatePlaylistArtwork(playlistId, token, imageBuffer, filename, mimeType) {
  const form = new FormData();
  form.append('playlist[artwork_data]', imageBuffer, { filename, contentType: mimeType });

  const res = await axios.put(`${API_BASE}/playlists/${playlistId}`, form, {
    headers: {
      Authorization: `OAuth ${token}`,
      ...form.getHeaders(),
    },
  });
  return res.data;
}

module.exports = {
  generatePkcePair,
  generateState,
  getAppToken,
  buildAuthorizeUrl,
  exchangeCodeForToken,
  refreshToken,
  searchArtistTracks,
  createPlaylist,
  updatePlaylistArtwork,
};
