const authStatusEl = document.getElementById('auth-status');
const tabPaste = document.getElementById('tab-paste');
const tabImage = document.getElementById('tab-image');
const pastePanel = document.getElementById('paste-panel');
const imagePanel = document.getElementById('image-panel');
const lineupTextEl = document.getElementById('lineup-text');
const lineupImageEl = document.getElementById('lineup-image');
const extractBtn = document.getElementById('extract-btn');
const findBtn = document.getElementById('find-btn');
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

tabPaste.onclick = () => switchTab('paste');
tabImage.onclick = () => switchTab('image');

function switchTab(which) {
  const isPaste = which === 'paste';
  tabPaste.classList.toggle('active', isPaste);
  tabImage.classList.toggle('active', !isPaste);
  pastePanel.classList.toggle('hidden', !isPaste);
  imagePanel.classList.toggle('hidden', isPaste);
}

extractBtn.onclick = async () => {
  const file = lineupImageEl.files[0];
  if (!file) {
    showResult('Choose an image first.', true);
    return;
  }

  setLoading(extractBtn, true, 'Reading image...');
  try {
    const formData = new FormData();
    formData.append('image', file);

    const res = await fetch('/api/extract-image', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    // Prefill the paste textarea with what OCR found, and switch to it so
    // the user can review/correct before matching.
    lineupTextEl.value = data.artists.join('\n');
    switchTab('paste');
    showResult(
      `Extracted ${data.artists.length} possible artist names — review and edit the list above before continuing.`,
      false
    );
  } catch (err) {
    showResult(err.message, true);
  } finally {
    setLoading(extractBtn, false, 'Extract text from image');
  }
};

findBtn.onclick = async () => {
  const artists = lineupTextEl.value
    .split(/[\n,]/)
    .map((a) => a.trim())
    .filter(Boolean);

  if (artists.length === 0) {
    showResult('Add at least one artist name first.', true);
    return;
  }

  setLoading(findBtn, true, 'Matching artists on SoundCloud...');
  lineupEl.classList.add('hidden');
  playlistActionsEl.classList.add('hidden');
  resultEl.classList.add('hidden');

  try {
    const matchRes = await fetch('/api/match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ artists }),
    });
    const matchData = await matchRes.json();
    if (!matchRes.ok) throw new Error(matchData.error);

    currentMatches = matchData.matches;
    renderLineup(artists, currentMatches);

    playlistTitleInput.value = 'RTD Playlist';
    playlistActionsEl.classList.remove('hidden');
  } catch (err) {
    showResult(err.message, true);
  } finally {
    setLoading(findBtn, false, 'Find artists on SoundCloud');
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
