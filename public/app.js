const eventQueryEl = document.getElementById('event-query');
const searchEventBtn = document.getElementById('search-event-btn');
const searchMessageEl = document.getElementById('search-message');
const candidatesEl = document.getElementById('candidates');

const loadingEl = document.getElementById('loading');
const loadingTextEl = document.getElementById('loading-text');
const matchMessageEl = document.getElementById('match-message');
const lineupEl = document.getElementById('lineup');
const lineupCountLabelEl = document.getElementById('lineup-count-label');
const toggleViewBtn = document.getElementById('toggle-view-btn');
const bubbleViewEl = document.getElementById('bubble-view');
const listViewEl = document.getElementById('list-view');

const playlistActionsEl = document.getElementById('playlist-actions');
const tracksPerArtistEl = document.getElementById('tracks-per-artist');
const includeDjSetsEl = document.getElementById('include-dj-sets');
const coverImageEl = document.getElementById('cover-image');
const coverFilenameEl = document.getElementById('cover-filename');
const playlistTitleInput = document.getElementById('playlist-title');
const createPlaylistBtn = document.getElementById('create-playlist-btn');
const createRequirementsEl = document.getElementById('create-requirements');
const playlistMessageEl = document.getElementById('playlist-message');

const PENDING_KEY = 'rtd_pending_playlist';

coverImageEl.addEventListener('change', () => {
  coverFilenameEl.textContent = coverImageEl.files[0]?.name || 'No file chosen';
});

let currentMatches = {}; // { artistName: { matchedUser, tracks } }
let excludedArtists = new Set();
let currentEventTitle = '';

// --- Mode picker gating (only gates playlist creation now) --------------

function getSelectedMode() {
  const checked = document.querySelector('input[name="mode"]:checked');
  return checked ? checked.value : null;
}

function updateCreateButtonState() {
  const mode = getSelectedMode();
  createPlaylistBtn.disabled = !mode;
  if (!mode) {
    createRequirementsEl.textContent = 'Pick a vibe above to continue.';
    createRequirementsEl.classList.remove('hidden');
  } else {
    createRequirementsEl.classList.add('hidden');
  }
}

document.querySelectorAll('input[name="mode"]').forEach((radio) => {
  radio.addEventListener('change', updateCreateButtonState);
});

// --- Event search (AI agent) ---------------------------------------------

searchEventBtn.onclick = async () => {
  const query = eventQueryEl.value.trim();
  hideMessage(searchMessageEl);
  candidatesEl.classList.add('hidden');
  candidatesEl.innerHTML = '';
  lineupEl.classList.add('hidden');
  playlistActionsEl.classList.add('hidden');

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
  hideMessage(matchMessageEl);
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

    currentEventTitle = data.eventTitle || candidate.title;
    await matchArtists(data.artists);
  } catch (err) {
    candidatesEl.classList.remove('hidden');
    showMessage(searchMessageEl, err.message, 'error');
    hideLoading();
    setLoading(searchEventBtn, false, 'Search');
  }
}

// --- Matching artists on SoundCloud (now automatic, no manual step) -----

async function matchArtists(artists) {
  showLoading('Searching SoundCloud for each artist...');

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

    playlistTitleInput.value = `RTD — ${currentEventTitle}`;
    playlistActionsEl.classList.remove('hidden');
    updateCreateButtonState();
  } catch (err) {
    showMessage(matchMessageEl, err.message, 'error');
  } finally {
    hideLoading();
    setLoading(searchEventBtn, false, 'Search');
  }
}

const BUBBLE_PREVIEW_LIMIT = 8;
let currentView = 'bubble';

function renderLineup(artists, matches) {
  currentView = 'bubble';
  toggleViewBtn.textContent = '☰ List view';
  bubbleViewEl.classList.remove('hidden');
  listViewEl.classList.add('hidden');

  lineupCountLabelEl.textContent = `${artists.length} artist${artists.length === 1 ? '' : 's'} found`;

  renderBubbleView(artists, matches);
  renderListView(artists, matches);

  lineupEl.classList.remove('hidden');
}

function artistAvatarHtml(matchedUser) {
  return matchedUser?.avatar_url
    ? `<img class="avatar" src="${matchedUser.avatar_url}" alt="" />`
    : `<span class="avatar avatar-placeholder"></span>`;
}

function renderBubbleView(artists, matches) {
  bubbleViewEl.innerHTML = '';

  const shown = artists.slice(0, BUBBLE_PREVIEW_LIMIT);
  const remaining = artists.length - shown.length;

  shown.forEach((artist, i) => {
    const data = matches[artist] || { matchedUser: null, tracks: [] };
    const hasMatch = (data.tracks || []).length > 0;

    const bubble = document.createElement('div');
    bubble.className = 'bubble' + (hasMatch ? '' : ' no-match');
    bubble.style.animationDelay = `${(i % 5) * 0.3}s`;
    bubble.innerHTML = `
      ${artistAvatarHtml(data.matchedUser)}
      <span class="bubble-name">${artist}</span>
    `;
    bubbleViewEl.appendChild(bubble);
  });

  if (remaining > 0) {
    const more = document.createElement('button');
    more.className = 'bubble bubble-more';
    more.style.animationDelay = `${(shown.length % 5) * 0.3}s`;
    more.innerHTML = `
      <span class="avatar-placeholder">+${remaining}</span>
      <span class="bubble-name">See all</span>
    `;
    more.onclick = () => switchView('list');
    bubbleViewEl.appendChild(more);
  }
}

function renderListView(artists, matches) {
  listViewEl.innerHTML = '';
  artists.forEach((artist) => {
    const data = matches[artist] || { matchedUser: null, tracks: [] };
    const tracks = data.tracks || [];
    const matchedUser = data.matchedUser;
    const hasMatch = tracks.length > 0;

    const card = document.createElement('div');
    card.className = 'artist-card' + (hasMatch ? '' : ' no-match');

    const matchedAsHtml = matchedUser ? `<span class="matched-as">as ${matchedUser.username}</span>` : '';

    const checkboxId = `include-${artist.replace(/\W+/g, '-')}`;
    card.innerHTML = `
      <input type="checkbox" id="${checkboxId}" ${hasMatch ? 'checked' : 'disabled'} />
      ${artistAvatarHtml(matchedUser)}
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

    listViewEl.appendChild(card);
  });
}

function switchView(view) {
  currentView = view;
  const isBubble = view === 'bubble';
  bubbleViewEl.classList.toggle('hidden', !isBubble);
  listViewEl.classList.toggle('hidden', isBubble);
  toggleViewBtn.textContent = isBubble ? '☰ List view' : '🫧 Bubble view';
}

toggleViewBtn.onclick = () => switchView(currentView === 'bubble' ? 'list' : 'bubble');

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
    default:
      return byPlaysDesc.slice(0, count);
  }
}

// --- Playlist creation (auth checked here, not upfront) -------------------

async function isLoggedIn() {
  const res = await fetch('/auth/me');
  const data = await res.json();
  return data.loggedIn;
}

function savePendingState(mode) {
  const state = {
    currentMatches,
    excludedArtists: [...excludedArtists],
    currentEventTitle,
    mode,
    tracksPerArtist: tracksPerArtistEl.value,
    includeDjSets: includeDjSetsEl.checked,
    playlistTitle: playlistTitleInput.value,
  };
  sessionStorage.setItem(PENDING_KEY, JSON.stringify(state));
}

function restorePendingStateIfAny() {
  const raw = sessionStorage.getItem(PENDING_KEY);
  if (!raw) return;
  sessionStorage.removeItem(PENDING_KEY);

  try {
    const state = JSON.parse(raw);
    currentMatches = state.currentMatches || {};
    excludedArtists = new Set(state.excludedArtists || []);
    currentEventTitle = state.currentEventTitle || '';

    const artists = Object.keys(currentMatches);
    if (artists.length > 0) {
      renderLineup(artists, currentMatches);
      // renderLineup resets exclusions based on match status only —
      // re-apply the previously excluded (but matched) artists.
      excludedArtists.forEach((artist) => {
        const checkbox = document.getElementById(`include-${artist.replace(/\W+/g, '-')}`);
        if (checkbox && !checkbox.disabled) {
          checkbox.checked = false;
          checkbox.dispatchEvent(new Event('change'));
        }
      });
      playlistActionsEl.classList.remove('hidden');
    }

    if (state.mode) {
      const radio = document.querySelector(`input[name="mode"][value="${state.mode}"]`);
      if (radio) radio.checked = true;
    }
    tracksPerArtistEl.value = state.tracksPerArtist || 5;
    includeDjSetsEl.checked = !!state.includeDjSets;
    playlistTitleInput.value = state.playlistTitle || '';
    updateCreateButtonState();

    showMessage(playlistMessageEl, 'Welcome back — connected! Review and hit "Create playlist" to finish.', 'success');
  } catch (e) {
    console.error('Failed to restore pending playlist state:', e);
  }
}

createPlaylistBtn.onclick = async () => {
  const title = playlistTitleInput.value.trim();
  hideMessage(playlistMessageEl);

  if (!title) {
    showMessage(playlistMessageEl, 'Give the playlist a name first.', 'error');
    return;
  }

  const mode = getSelectedMode();

  setLoading(createPlaylistBtn, true, 'Checking...');
  const loggedIn = await isLoggedIn();
  if (!loggedIn) {
    savePendingState(mode);
    window.location.href = '/auth/login';
    return;
  }

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
    setLoading(createPlaylistBtn, false, 'Create playlist');
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

    let artworkNote = '';
    const coverFile = coverImageEl.files[0];
    if (coverFile && data.id) {
      const formData = new FormData();
      formData.append('image', coverFile);
      const artRes = await fetch(`/api/playlist/${data.id}/artwork`, { method: 'PUT', body: formData });
      if (!artRes.ok) {
        artworkNote = ' (cover image upload failed, but the playlist itself is fine)';
      }
    }

    sessionStorage.removeItem(PENDING_KEY);
    showMessage(
      playlistMessageEl,
      `Playlist created${artworkNote} — <a href="${data.playlist_url}" target="_blank">open on SoundCloud</a>`,
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

restorePendingStateIfAny();
