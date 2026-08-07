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
const loadingEl = document.getElementById('loading');
const loadingTextEl = document.getElementById('loading-text');
const playlistActionsEl = document.getElementById('playlist-actions');
const playlistTitleInput = document.getElementById('playlist-title');
const createPlaylistBtn = document.getElementById('create-playlist-btn');
const resultEl = document.getElementById('result');

let currentMatches = {}; // { artistName: [tracks] }

async function refreshAuthStatus() {
  const res = await fetch('/auth/me');
  const { loggedIn } = await res.json();
  authStatusEl.innerHTML = loggedIn
    ? `✅ Connected to SoundCloud · <button id="logout-btn">Disconnect</button>`
    : `🔗 <a href="/auth/login">Connect with SoundCloud</a> to save playlists to your account`;

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
    showResult('📸 Choose an image first.', true);
    return;
  }

  setLoading(extractBtn, true, '🔍 Reading...');
  showLoading('🔍 Reading text from the image...');
  try {
    const formData = new FormData();
    formData.append('image', file);

    const res = await fetch('/api/extract-image', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    // Prefill the paste textarea with what OCR found, and switch to it so
    // the user can review/correct before matching. If the cleaned-up parse
    // came back empty, fall back to showing the raw OCR text so there's
    // still something to work with instead of a blank box.
    const hasParsedArtists = data.artists.length > 0;
    lineupTextEl.value = hasParsedArtists ? data.artists.join('\n') : data.rawText.trim();
    switchTab('paste');

    if (hasParsedArtists) {
      showResult(
        `✨ Extracted ${data.artists.length} possible artist names — review and edit the list above before continuing.`,
        false
      );
    } else if (data.rawText.trim()) {
      showResult(
        `🤔 Couldn't confidently pick out artist names, but here's the raw text found in the image — clean it up above before continuing.`,
        true
      );
    } else {
      showResult(
        `😕 No readable text found in that image at all — try a clearer or more cropped screenshot, or paste the lineup as text instead.`,
        true
      );
    }
  } catch (err) {
    showResult(err.message, true);
  } finally {
    hideLoading();
    setLoading(extractBtn, false, '🔍 Extract text from image');
  }
};

findBtn.onclick = async () => {
  const artists = lineupTextEl.value
    .split(/[\n,]/)
    .map((a) => a.trim())
    .filter(Boolean);

  if (artists.length === 0) {
    showResult('✍️ Add at least one artist name first.', true);
    return;
  }

  setLoading(findBtn, true, '🔎 Matching...');
  showLoading('🎧 Searching SoundCloud for each artist...');
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
    hideLoading();
    setLoading(findBtn, false, '🔎 Find artists on SoundCloud');
  }
};

function formatPlayCount(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${n}`;
}

function renderLineup(artists, matches) {
  lineupEl.innerHTML = '';
  artists.forEach((artist) => {
    const tracks = matches[artist] || [];
    const card = document.createElement('div');
    card.className = 'artist-card' + (tracks.length === 0 ? ' no-match' : '');

    let matchLabel;
    if (tracks.length === 0) {
      matchLabel = '❌ no match';
    } else {
      const mostPlayed = [...tracks].sort((a, b) => b.playback_count - a.playback_count)[0];
      matchLabel = `🔥 ${tracks.length} tracks found · top one has ${formatPlayCount(mostPlayed.playback_count)} plays`;
    }

    card.innerHTML = `
      <span class="name">🎤 ${artist}</span>
      <span class="match">${matchLabel}</span>
    `;
    lineupEl.appendChild(card);
  });
  lineupEl.classList.remove('hidden');
}

// Given an artist's full pool of matched tracks, picks `count` of them
// according to the chosen mode.
function pickTracks(tracks, mode, count) {
  if (tracks.length === 0) return [];

  const byPlaysDesc = [...tracks].sort((a, b) => b.playback_count - a.playback_count);
  const byPlaysAsc = [...tracks].sort((a, b) => a.playback_count - b.playback_count);
  const byNewest = [...tracks].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  function shuffled(arr) {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  switch (mode) {
    case 'hottest':
      return byPlaysDesc.slice(0, count);
    case 'hidden':
      return byPlaysAsc.slice(0, count);
    case 'fresh':
      return byNewest.slice(0, count);
    case 'random':
      return shuffled(tracks).slice(0, count);
    case 'mixed': {
      // Half the picks are the most-played (a safe anchor), the rest random
      // from what's left, so the playlist isn't purely predictable.
      const topCount = Math.ceil(count / 2);
      const top = byPlaysDesc.slice(0, topCount);
      const topIds = new Set(top.map((t) => t.id));
      const rest = shuffled(tracks.filter((t) => !topIds.has(t.id)));
      return [...top, ...rest.slice(0, count - top.length)];
    }
    default:
      return byPlaysDesc.slice(0, count);
  }
}

createPlaylistBtn.onclick = async () => {
  const title = playlistTitleInput.value.trim();
  if (!title) return;

  const mode = document.querySelector('input[name="mode"]:checked').value;

  // Take up to 2 tracks per matched artist, chosen according to the
  // selected mode, for a reasonably sized playlist.
  const trackIds = Object.values(currentMatches)
    .flatMap((tracks) => pickTracks(tracks, mode, 2))
    .map((t) => t.id);

  if (trackIds.length === 0) {
    showResult('😕 No tracks matched — nothing to add to a playlist.', true);
    return;
  }

  setLoading(createPlaylistBtn, true, '🎶 Creating...');
  showLoading('🎶 Creating your playlist on SoundCloud...');
  try {
    const res = await fetch('/api/playlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, trackIds }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    showResult(`🎉 Playlist created! <a href="${data.playlist_url}" target="_blank">${data.playlist_url}</a>`, false);
  } catch (err) {
    showResult(err.message, true);
  } finally {
    hideLoading();
    setLoading(createPlaylistBtn, false, '🎶 Create SoundCloud playlist');
  }
};

function setLoading(button, isLoading, label) {
  button.disabled = isLoading;
  button.textContent = label;
}

function showLoading(text) {
  loadingTextEl.textContent = text;
  loadingEl.classList.remove('hidden');
}

function hideLoading() {
  loadingEl.classList.add('hidden');
}

function showResult(message, isError) {
  resultEl.innerHTML = message;
  resultEl.style.borderColor = isError ? '#c25b4a' : 'var(--border)';
  resultEl.classList.remove('hidden');
}

refreshAuthStatus();
