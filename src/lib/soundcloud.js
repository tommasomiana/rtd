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

async function searchArtistTracks(artistName, token, limit = 5) {
  const res = await axios.get(`${API_BASE}/tracks`, {
    headers: { Authorization: `OAuth ${token}` },
    params: { q: artistName, limit },
  });
  return res.data; // array of track objects
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
