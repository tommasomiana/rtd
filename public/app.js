const authBannerEl = document.getElementById('auth-banner');
const authIconEl = document.getElementById('auth-icon');
const authTextEl = document.getElementById('auth-text');
const authActionEl = document.getElementById('auth-action');

const tabPaste = document.getElementById('tab-paste');
const tabImage = document.getElementById('tab-image');
const tabLink = document.getElementById('tab-link');
const pastePanel = document.getElementById('paste-panel');
const imagePanel = document.getElementById('image-panel');
const linkPanel = document.getElementById('link-panel');
const lineupTextEl = document.getElementById('lineup-text');
const lineupImageEl = document.getElementById('lineup-image');
const extractBtn = document.getElementById('extract-btn');
const imageMessageEl = document.getElementById('image-message');
const pasteMessageEl = document.getElementById('paste-message');
const lineupLinkEl = document.getElementById('lineup-link');
const fetchLinkBtn = document.getElementById('fetch-link-btn');
const linkMessageEl = document.getElementById('link-message');

const findBtn = document.getElementById('find-btn');
const findRequirementsEl = document.getElementById('find-requirements');
const matchMessageEl = document.getElementById('match-message');

const loadingEl = document.getElementById('loading');
const loadingTextEl = document.getElementById('loading-text');

const lineupEl = document.getElementById('lineup');
const playlistActionsEl = document.getElementById('playlist-actions');
const tracksPerArtistEl = document.getElementById('tracks-per-artist');
const includeDjSetsEl = document.getElementById('include-dj-sets');
const playlistTitleInput = document.getElementById('playlist-title');
const createPlaylistBtn = document.getElementById('create-playlist-btn');
const playlistMessageEl = document.getElementById('playlist-message');

let currentMatches = {}; // { artistName: [tracks] }
let excludedArtists = new Set();
let isLoggedIn = false;

// --- Auth ------------------------------------------------------------

async function refreshAuthStatus() {
  const res = await fetch('/auth/me');
  const data = await res.json();
  isLoggedIn = data.loggedIn;

  if (isLoggedIn) {
    authBannerEl.classList.add('connected');
    authIconEl.textContent = '●';
    authTextEl.textContent = 'Connected';
    authActionEl.textContent = 'Disconnect';
    authActionEl.href = '#';
    authActionEl.onclick = async (e) => {
      e.preventDefault();
      await fetch('/auth/logout', { method: 'POST' });
      refreshAuthStatus();
    };
  } else {
    authBannerEl.classList.remove('connected');
    authIconEl.textContent = '●';
    authTextEl.textContent = 'Connect SoundCloud';
    authActionEl.textContent = 'Connect';
    authActionEl.href = '/auth/login';
    authActionEl.onclick = null;
  }

  updateFindButtonState();
}

// --- Find button gating (needs login + a selected mode) --------------

function getSelectedMode() {
  const checked = document.querySelector('input[name="mode"]:checked');
  return checked ? checked.value : null;
}

function updateFindButtonState() {
  const mode = getSelectedMode();
  const missing = [];
  if (!isLoggedIn) missing.push('connect your SoundCloud account');
  if (!mode) missing.push('pick a track selection mode above');

  findBtn.disabled = missing.length > 0;

  if (missing.length > 0) {
    findRequirementsEl.textContent = `Connect SoundCloud and pick a vibe to continue.`;
    findRequirementsEl.classList.remove('hidden');
  } else {
    findRequirementsEl.classList.add('hidden');
  }
}

document.querySelectorAll('input[name="mode"]').forEach((radio) => {
  radio.addEventListener('change', updateFindButtonState);
});

// --- Tabs --------------------------------------------------------------

tabPaste.onclick = () => switchTab('paste');
tabImage.onclick = () => switchTab('image');
tabLink.onclick = () => switchTab('link');

function switchTab(which) {
  tabPaste.classList.toggle('active', which === 'paste');
  tabImage.classList.toggle('active', which === 'image');
  tabLink.classList.toggle('active', which === 'link');
  pastePanel.classList.toggle('hidden', which !== 'paste');
  imagePanel.classList.toggle('hidden', which !== 'image');
  linkPanel.classList.toggle('hidden', which !== 'link');
}

// --- Image OCR extraction ----------------------------------------------

extractBtn.onclick = async () => {
  const file = lineupImageEl.files[0];
  if (!file) {
    showMessage(imageMessageEl, 'Choose an image first.', 'error');
    return;
  }

  setLoading(extractBtn, true, 'Reading...');
  showLoading('Reading text from the image...');
  hideMessage(imageMessageEl);
  hideMessage(pasteMessageEl);

  try {
    const formData = new FormData();
    formData.append('image', file);

    const res = await fetch('/api/extract-image', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    if (data.artists.length > 0) {
      lineupTextEl.value = data.artists.join('\n');
      switchTab('paste');
      showMessage(
        pasteMessageEl,
        `Found ${data.artists.length} possible artist name${data.artists.length === 1 ? '' : 's'} — double-check the list below (OCR isn't perfect on busy posters).`,
        'success'
      );
    } else if (data.rawText.trim()) {
      lineupTextEl.value = data.rawText.trim();
      switchTab('paste');
      showMessage(
        pasteMessageEl,
        `Couldn't isolate artist names — here's the raw text instead. Clean it up below.`,
        'error'
      );
    } else {
      showMessage(
        imageMessageEl,
        `No readable text found in that image — try a clearer screenshot, or paste the lineup as text.`,
        'error'
      );
    }
  } catch (err) {
    showMessage(imageMessageEl, err.message, 'error');
  } finally {
    hideLoading();
    setLoading(extractBtn, false, 'Extract text');
  }
};

// --- Dice event link fetch ----------------------------------------------

fetchLinkBtn.onclick = async () => {
  const eventUrl = lineupLinkEl.value.trim();
  if (!eventUrl) {
    showMessage(linkMessageEl, 'Paste a Dice.fm event link first.', 'error');
    return;
  }

  setLoading(fetchLinkBtn, true, 'Fetching...');
  showLoading('Fetching the lineup...');
  hideMessage(linkMessageEl);
  hideMessage(pasteMessageEl);

  try {
    const res = await fetch('/api/lineup-from-link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventUrl }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    lineupTextEl.value = data.artists.join('\n');
    switchTab('paste');
    showMessage(
      pasteMessageEl,
      `Found ${data.artists.length} artist${data.artists.length === 1 ? '' : 's'}${data.eventTitle ? ` for "${data.eventTitle}"` : ''} — double-check the list below.`,
      'success'
    );
  } catch (err) {
    showMessage(linkMessageEl, err.message, 'error');
  } finally {
    hideLoading();
    setLoading(fetchLinkBtn, false, 'Fetch lineup');
  }
};

// --- Matching artists on SoundCloud -------------------------------------

findBtn.onclick = async () => {
  const artists = lineupTextEl.value
    .split(/[\n,]/)
    .map((a) => a.trim())
    .filter(Boolean);

  hideMessage(matchMessageEl);

  if (artists.length === 0) {
    showMessage(matchMessageEl, 'Add at least one artist first.', 'error');
    return;
  }

  setLoading(findBtn, true, 'Matching...');
  showLoading('Searching SoundCloud...');
  lineupEl.classList.add('hidden');
  playlistActionsEl.classList.add('hidden');

  try {
    const matchRes = await fetch('/api/match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ artists }),
    });
    const matchData = await matchRes.json();
    if (!matchRes.ok) throw new Error(matchData.error);

    currentMatches = matchData.matches;
    excludedArtists = new Set();
    renderLineup(artists, currentMatches);

    playlistTitleInput.value = 'RTD Playlist';
    playlistActionsEl.classList.remove('hidden');
  } catch (err) {
    showMessage(matchMessageEl, err.message, 'error');
  } finally {
    hideLoading();
    setLoading(findBtn, false, 'Find artists');
  }
};

function renderLineup(artists, matches) {
  lineupEl.innerHTML = '';
  artists.forEach((artist) => {
    const data = matches[artist] || { matchedUser: null, tracks: [] };
    const tracks = data.tracks || [];
    const matchedUser = data.matchedUser;
    const hasMatch = tracks.length > 0;

    const card = document.createElement('div');
    card.className = 'artist-card' + (hasMatch ? '' : ' no-match');

    const avatarHtml = matchedUser?.avatar_url
      ? `<img class="avatar" src="${matchedUser.avatar_url}" alt="" />`
      : `<span class="avatar avatar-placeholder"></span>`;

    const matchedAsHtml = matchedUser
      ? `<span class="matched-as">as ${matchedUser.username}</span>`
      : '';

    const checkboxId = `include-${artist.replace(/\W+/g, '-')}`;
    card.innerHTML = `
      <input type="checkbox" id="${checkboxId}" ${hasMatch ? 'checked' : 'disabled'} />
      ${avatarHtml}
      <label class="info" for="${checkboxId}">
        <span class="name-block">
          <span class="name">${artist}</span>
          ${matchedAsHtml}
        </span>
        <span class="match"><span class="status-dot"></span>${hasMatch ? 'matched' : 'no match'}</span>
      </label>
    `;

    const checkbox = card.querySelector('input');
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) {
        excludedArtists.delete(artist);
        card.classList.remove('excluded');
      } else {
        excludedArtists.add(artist);
        card.classList.add('excluded');
      }
    });

    if (!hasMatch) excludedArtists.add(artist);

    lineupEl.appendChild(card);
  });
  lineupEl.classList.remove('hidden');
}

// --- Track selection modes ----------------------------------------------

// Tracks longer than this are almost always a DJ set/mix rather than a
// single track — real singles rarely run past this even in house/techno.
const DJ_SET_THRESHOLD_MS = 15 * 60 * 1000;

// Given an artist's full pool of matched tracks, picks `count` of them
// according to the chosen mode. `includeDjSets` controls whether long
// mixes/sets are eligible at all before the mode's own logic runs.
function pickTracks(tracks, mode, count, includeDjSets) {
  const eligible = includeDjSets
    ? tracks
    : tracks.filter((t) => t.duration < DJ_SET_THRESHOLD_MS);

  if (eligible.length === 0) return [];

  const byPlaysDesc = [...eligible].sort((a, b) => b.playback_count - a.playback_count);
  const byPlaysAsc = [...eligible].sort((a, b) => a.playback_count - b.playback_count);
  const byNewest = [...eligible].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

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
      return shuffled(eligible).slice(0, count);
    case 'mixed': {
      const topCount = Math.ceil(count / 2);
      const top = byPlaysDesc.slice(0, topCount);
      const topIds = new Set(top.map((t) => t.id));
      const rest = shuffled(eligible.filter((t) => !topIds.has(t.id)));
      return [...top, ...rest.slice(0, count - top.length)];
    }
    default:
      return byPlaysDesc.slice(0, count);
  }
}

// --- Playlist creation ----------------------------------------------------

createPlaylistBtn.onclick = async () => {
  const title = playlistTitleInput.value.trim();
  hideMessage(playlistMessageEl);

  if (!title) {
    showMessage(playlistMessageEl, 'Give the playlist a name first.', 'error');
    return;
  }

  const mode = getSelectedMode();
  const countPerArtist = Math.min(15, Math.max(1, parseInt(tracksPerArtistEl.value, 10) || 5));
  const includeDjSets = includeDjSetsEl.checked;

  const trackIds = Object.entries(currentMatches)
    .filter(([artist]) => !excludedArtists.has(artist))
    .flatMap(([, data]) => pickTracks(data.tracks, mode, countPerArtist, includeDjSets))
    .map((t) => t.id);

  if (trackIds.length === 0) {
    showMessage(
      playlistMessageEl,
      'No tracks selected — check at least one artist, or enable "Include DJ sets / long mixes" above.',
      'error'
    );
    return;
  }

  setLoading(createPlaylistBtn, true, 'Creating...');
  showLoading('Creating your playlist...');
  try {
    const res = await fetch('/api/playlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, trackIds }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    showMessage(
      playlistMessageEl,
      `Playlist created — <a href="${data.playlist_url}" target="_blank">open on SoundCloud</a>`,
      'success'
    );
  } catch (err) {
    showMessage(playlistMessageEl, err.message, 'error');
  } finally {
    hideLoading();
    setLoading(createPlaylistBtn, false, 'Create playlist');
  }
};

// --- Small helpers ----------------------------------------------------

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

function showMessage(el, html, kind) {
  el.innerHTML = html;
  el.classList.remove('hidden', 'error', 'success');
  el.classList.add(kind);
}

function hideMessage(el) {
  el.classList.add('hidden');
}

refreshAuthStatus();
