const axios = require('axios');
const crypto = require('crypto');

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
  const res = await axios.post(
    TOKEN_URL,
    new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
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
  return res.data; // { access_token, refresh_token, expires_in, ... }
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
// still match accented usernames); otherwise picks the candidate with the
// most followers rather than just the first search result — SoundCloud's
// own search ranking doesn't reliably put the well-known artist first,
// which can otherwise surface an obscure same-named account instead of
// e.g. the actual Ben Böhmer.
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

// Gets a pool of tracks that genuinely belong to an artist, rather than
// just any track whose title/description happens to mention their name.
// Looks up their actual SoundCloud profile first and pulls from their own
// uploads; only falls back to a keyword search (filtered to require the
// artist's name in the uploader's username) if no matching profile exists.
// Returns both the matched profile (for the UI to show as confirmation)
// and the track pool.
async function searchArtistTracks(artistName, token, poolSize = 15) {
  const user = await findArtistUser(artistName, token);

  if (user) {
    const tracks = await getUserTracks(user.id, token, poolSize);
    if (tracks.length > 0) {
      return { matchedUser: user, tracks };
    }
  }

  // Fallback: no clear profile match, or that profile has no public
  // tracks. Use keyword search, but filter out results that only mention
  // the artist's name in the title rather than actually being uploaded
  // by them — this is the check that was missing before.
  const res = await axios.get(`${API_BASE}/tracks`, {
    headers: { Authorization: `OAuth ${token}` },
    params: { q: artistName, limit: poolSize * 2 },
  });
  const allTracks = res.data || [];
  const needle = artistName.toLowerCase();
  const tracks = allTracks
    .filter((t) => t.user?.username && t.user.username.toLowerCase().includes(needle))
    .slice(0, poolSize);

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

module.exports = {
  generatePkcePair,
  generateState,
  getAppToken,
  buildAuthorizeUrl,
  exchangeCodeForToken,
  refreshToken,
  searchArtistTracks,
  createPlaylist,
};
