const authStatusEl = document.getElementById('auth-status');
const fetchBtn = document.getElementById('fetch-btn');
const raUrlInput = document.getElementById('ra-url');
const eventInfoEl = document.getElementById('event-info');
const lineupEl = document.getElementById('lineup');
const playlistActionsEl = document.getElementById('playlist-actions');
const playlistTitleInput = document.getElementById('playlist-title');
const createPlaylistBtn = document.getElementById('create-playlist-btn');
const resultEl = document.getElementById('result');

let currentMatches = {}; // { artistName: [tracks] }

async function refreshAuthStatus() {
  const res = await fetch('/auth/me');
  const { loggedIn } = await res.json();
  authStatusEl.innerHTML = loggedIn
    ? `Connected to SoundCloud · <button id="logout-btn">Disconnect</button>`
    : `<a href="/auth/login">Connect with SoundCloud</a> to save playlists to your account`;

  if (loggedIn) {
    document.getElementById('logout-btn').onclick = async () => {
      await fetch('/auth/logout', { method: 'POST' });
      refreshAuthStatus();
    };
  }
}

fetchBtn.onclick = async () => {
  const eventUrl = raUrlInput.value.trim();
  if (!eventUrl) return;

  setLoading(fetchBtn, true, 'Finding lineup...');
  eventInfoEl.classList.add('hidden');
  lineupEl.classList.add('hidden');
  playlistActionsEl.classList.add('hidden');
  resultEl.classList.add('hidden');

  try {
    const lineupRes = await fetch('/api/lineup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventUrl }),
    });
    const lineupData = await lineupRes.json();
    if (!lineupRes.ok) throw new Error(lineupData.error);

    eventInfoEl.innerHTML = `<h2>${lineupData.eventTitle || 'Event'}</h2>
      <p>${lineupData.artists.length} artists found</p>`;
    eventInfoEl.classList.remove('hidden');

    setLoading(fetchBtn, true, 'Matching artists on SoundCloud...');

    const matchRes = await fetch('/api/match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ artists: lineupData.artists }),
    });
    const matchData = await matchRes.json();
    if (!matchRes.ok) throw new Error(matchData.error);

    currentMatches = matchData.matches;
    renderLineup(lineupData.artists, currentMatches);

    playlistTitleInput.value = lineupData.eventTitle || 'RTD Playlist';
    playlistActionsEl.classList.remove('hidden');
  } catch (err) {
    showResult(err.message, true);
  } finally {
    setLoading(fetchBtn, false, 'Find lineup');
  }
};

function renderLineup(artists, matches) {
  lineupEl.innerHTML = '';
  artists.forEach((artist) => {
    const tracks = matches[artist] || [];
    const card = document.createElement('div');
    card.className = 'artist-card' + (tracks.length === 0 ? ' no-match' : '');
    card.innerHTML = `
      <span class="name">${artist}</span>
      <span class="match">${tracks.length ? `${tracks.length} tracks found` : 'no match'}</span>
    `;
    lineupEl.appendChild(card);
  });
  lineupEl.classList.remove('hidden');
}

createPlaylistBtn.onclick = async () => {
  const title = playlistTitleInput.value.trim();
  if (!title) return;

  // Take up to 2 tracks per matched artist for a reasonably sized playlist
  const trackIds = Object.values(currentMatches)
    .flatMap((tracks) => tracks.slice(0, 2))
    .map((t) => t.id);

  if (trackIds.length === 0) {
    showResult('No tracks matched — nothing to add to a playlist.', true);
    return;
  }

  setLoading(createPlaylistBtn, true, 'Creating playlist...');
  try {
    const res = await fetch('/api/playlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, trackIds }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    showResult(`Playlist created: <a href="${data.playlist_url}" target="_blank">${data.playlist_url}</a>`, false);
  } catch (err) {
    showResult(err.message, true);
  } finally {
    setLoading(createPlaylistBtn, false, 'Create SoundCloud playlist');
  }
};

function setLoading(button, isLoading, label) {
  button.disabled = isLoading;
  button.textContent = label;
}

function showResult(message, isError) {
  resultEl.innerHTML = message;
  resultEl.style.borderColor = isError ? '#c25b4a' : 'var(--border)';
  resultEl.classList.remove('hidden');
}

refreshAuthStatus();
