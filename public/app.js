const authBannerEl = document.getElementById('auth-banner');
const authIconEl = document.getElementById('auth-icon');
const authTextEl = document.getElementById('auth-text');
const authActionEl = document.getElementById('auth-action');

const eventQueryEl = document.getElementById('event-query');
const searchEventBtn = document.getElementById('search-event-btn');
const searchMessageEl = document.getElementById('search-message');
const candidatesEl = document.getElementById('candidates');
const lineupReviewEl = document.getElementById('lineup-review');
const lineupTextEl = document.getElementById('lineup-text');
const lineupMessageEl = document.getElementById('lineup-message');

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

let currentMatches = {}; // { artistName: { matchedUser, tracks } }
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
  const missing = !isLoggedIn || !mode;
  findBtn.disabled = missing;

  if (missing) {
    findRequirementsEl.textContent = `Connect SoundCloud and pick a vibe to continue.`;
    findRequirementsEl.classList.remove('hidden');
  } else {
    findRequirementsEl.classList.add('hidden');
  }
}

document.querySelectorAll('input[name="mode"]').forEach((radio) => {
  radio.addEventListener('change', updateFindButtonState);
});

// --- Event search (AI agent) ---------------------------------------------

searchEventBtn.onclick = async () => {
  const query = eventQueryEl.value.trim();
  hideMessage(searchMessageEl);
  candidatesEl.classList.add('hidden');
  candidatesEl.innerHTML = '';
  lineupReviewEl.classList.add('hidden');

  if (!query) {
    showMessage(searchMessageEl, 'Type an event name first.', 'error');
    return;
  }

  setLoading(searchEventBtn, true, 'Searching...');
  showLoading('Searching for that event...');

  try {
    const res = await fetch('/api/agent/find-event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    renderCandidates(data.candidates || []);
  } catch (err) {
    showMessage(searchMessageEl, err.message, 'error');
  } finally {
    hideLoading();
    setLoading(searchEventBtn, false, 'Search');
  }
};

function renderCandidates(candidates) {
  candidatesEl.innerHTML = '';

  if (candidates.length === 0) {
    candidatesEl.innerHTML = `<div class="candidate-card candidates-none">No confident matches found — try adding a city or date to your search.</div>`;
    candidatesEl.classList.remove('hidden');
    return;
  }

  candidates.forEach((candidate) => {
    const card = document.createElement('div');
    card.className = 'candidate-card';
    card.innerHTML = `
      <span class="candidate-title">${candidate.title || 'Untitled event'}</span>
      <span class="candidate-meta">${[candidate.date, candidate.venue].filter(Boolean).join(' · ')}</span>
      <span class="candidate-source">${candidate.source || ''}</span>
      <button class="secondary">Use this event</button>
    `;
    card.querySelector('button').onclick = () => confirmCandidate(candidate);
    candidatesEl.appendChild(card);
  });

  candidatesEl.classList.remove('hidden');
}

async function confirmCandidate(candidate) {
  candidatesEl.classList.add('hidden');
  hideMessage(lineupMessageEl);
  setLoading(searchEventBtn, true, 'Searching...');
  showLoading('Finding the lineup...');

  try {
    const res = await fetch('/api/agent/lineup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ candidate }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    lineupTextEl.value = data.artists.join('\n');
    lineupReviewEl.classList.remove('hidden');
    showMessage(
      lineupMessageEl,
      `Found ${data.artists.length} artist${data.artists.length === 1 ? '' : 's'} for "${data.eventTitle}" — double-check the list before continuing.`,
      'success'
    );
  } catch (err) {
    candidatesEl.classList.remove('hidden');
    showMessage(searchMessageEl, err.message, 'error');
  } finally {
    hideLoading();
    setLoading(searchEventBtn, false, 'Search');
  }
}

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

    const matchedAsHtml = matchedUser ? `<span class="matched-as">as ${matchedUser.username}</span>` : '';

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

const DJ_SET_THRESHOLD_MS = 15 * 60 * 1000;

function pickTracks(tracks, mode, count, includeDjSets) {
  const eligible = includeDjSets ? tracks : tracks.filter((t) => t.duration < DJ_SET_THRESHOLD_MS);
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
