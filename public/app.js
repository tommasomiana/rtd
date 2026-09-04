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
const durationSliderEl = document.getElementById('duration-slider');
const durationValueEl = document.getElementById('duration-value');
const durationLabelEl = document.getElementById('duration-label');
const tracksEstimateEl = document.getElementById('tracks-estimate');
const includeDjSetsEl = document.getElementById('include-dj-sets');
const coverImageEl = document.getElementById('cover-image');
const coverFilenameEl = document.getElementById('cover-filename');
const playlistTitleInput = document.getElementById('playlist-title');
const createPlaylistBtn = document.getElementById('create-playlist-btn');
const createRequirementsEl = document.getElementById('create-requirements');
const playlistMessageEl = document.getElementById('playlist-message');

const successModalEl = document.getElementById('success-modal');
const modalCloseBtn = document.getElementById('modal-close-btn');
const modalCoverImgEl = document.getElementById('modal-cover-img');
const modalCoverPlaceholderEl = document.getElementById('modal-cover-placeholder');
const modalPlaylistNameEl = document.getElementById('modal-playlist-name');
const modalBubblesEl = document.getElementById('modal-bubbles');
const modalOpenLinkEl = document.getElementById('modal-open-link');

const PENDING_KEY = 'rtd_pending_playlist';

coverImageEl.addEventListener('change', () => {
  coverFilenameEl.textContent = coverImageEl.files[0]?.name || 'No file chosen';
});

// --- Duration slider: translates a "how many hours" choice into a
// tracks-per-artist count, since that's what actually determines playlist
// length. Assumes an average track length — a rough estimate, not exact,
// since real track lengths vary (and DJ sets vary a lot more).
const AVG_TRACK_MINUTES = 5;

function labelForHours(hours) {
  if (hours <= 2) return '⚡ Quick pre-game';
  if (hours <= 4) return '🍹 Warm-up session';
  if (hours <= 6) return '🎉 Full night out';
  if (hours <= 8) return '🌙 All-nighter';
  if (hours <= 10) return '🔭 Deep dive';
  return '🕵️ Deep investigation';
}

function includedArtistCount() {
  return Object.entries(currentMatches).filter(
    ([artist, data]) => !excludedArtists.has(artist) && (data.tracks || []).length > 0
  ).length;
}

function tracksPerArtistForDuration(hours) {
  const count = includedArtistCount();
  if (count === 0) return 1;
  const totalTracks = (hours * 60) / AVG_TRACK_MINUTES;
  return Math.min(15, Math.max(1, Math.round(totalTracks / count)));
}

function updateDurationDisplay() {
  const hours = parseInt(durationSliderEl.value, 10);
  durationValueEl.textContent = `${hours}h`;
  durationLabelEl.textContent = labelForHours(hours);

  const count = includedArtistCount();
  if (count > 0) {
    const perArtist = tracksPerArtistForDuration(hours);
    tracksEstimateEl.textContent = `≈ ${perArtist} track${perArtist === 1 ? '' : 's'} per artist across ${count} artist${count === 1 ? '' : 's'} (assumes ~${AVG_TRACK_MINUTES} min/track)`;
  } else {
    tracksEstimateEl.textContent = '';
  }
}

durationSliderEl.addEventListener('input', updateDurationDisplay);

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
    updateDurationDisplay();
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

function shuffled(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// Picks which artists to show as bubbles: randomized order each time, and
// artists with a real profile photo are preferred over ones without (a
// placeholder icon reads as less interesting/trustworthy in a compact
// preview), only falling back to no-photo artists if there aren't enough
// with photos to fill the preview.
function pickBubbleArtists(artists, matches, limit) {
  const withPhoto = [];
  const withoutPhoto = [];
  artists.forEach((artist) => {
    const data = matches[artist] || {};
    if (data.matchedUser?.avatar_url) withPhoto.push(artist);
    else withoutPhoto.push(artist);
  });
  return [...shuffled(withPhoto), ...shuffled(withoutPhoto)].slice(0, limit);
}

function randomBetween(min, max) {
  return Math.random() * (max - min) + min;
}

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

// Shared by the lineup bubble view and the success modal — builds one
// floating bubble element with randomized size/drift so both places get
// the same lively look without duplicating the randomization logic.
function makeBubbleElement(artist, data, { minSize = 48, maxSize = 76 } = {}) {
  const hasMatch = (data.tracks || []).length > 0;
  const size = Math.round(randomBetween(minSize, maxSize));

  const bubble = document.createElement('div');
  bubble.className = 'bubble' + (hasMatch ? '' : ' no-match');
  bubble.style.setProperty('--bubble-size', `${size}px`);
  bubble.style.setProperty('--dx1', `${randomBetween(-18, 18).toFixed(0)}px`);
  bubble.style.setProperty('--dy1', `${randomBetween(-14, 14).toFixed(0)}px`);
  bubble.style.setProperty('--dx2', `${randomBetween(-18, 18).toFixed(0)}px`);
  bubble.style.setProperty('--dy2', `${randomBetween(-14, 14).toFixed(0)}px`);
  bubble.style.setProperty('--dx3', `${randomBetween(-18, 18).toFixed(0)}px`);
  bubble.style.setProperty('--dy3', `${randomBetween(-14, 14).toFixed(0)}px`);
  bubble.style.animationDuration = `${randomBetween(5, 10).toFixed(1)}s`;
  bubble.style.animationDelay = `-${randomBetween(0, 5).toFixed(1)}s`; // negative = starts mid-cycle, desyncs bubbles immediately
  bubble.innerHTML = `
    ${artistAvatarHtml(data.matchedUser)}
    <span class="bubble-name">${artist}</span>
  `;
  return bubble;
}

function renderBubbleView(artists, matches) {
  bubbleViewEl.innerHTML = '';

  const shown = pickBubbleArtists(artists, matches, BUBBLE_PREVIEW_LIMIT);
  const remaining = artists.length - shown.length;

  shown.forEach((artist) => {
    const data = matches[artist] || { matchedUser: null, tracks: [] };
    bubbleViewEl.appendChild(makeBubbleElement(artist, data));
  });

  if (remaining > 0) {
    const more = document.createElement('button');
    more.className = 'bubble bubble-more';
    more.style.setProperty('--bubble-size', '64px');
    more.style.animationDuration = '7s';
    more.style.animationDelay = `-${randomBetween(0, 5).toFixed(1)}s`;
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
      updateDurationDisplay();
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
    durationHours: durationSliderEl.value,
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
    durationSliderEl.value = state.durationHours || 4;
    includeDjSetsEl.checked = !!state.includeDjSets;
    playlistTitleInput.value = state.playlistTitle || '';
    updateDurationDisplay();
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

  const countPerArtist = tracksPerArtistForDuration(parseInt(durationSliderEl.value, 10));
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

    let artworkFailed = false;
    const coverFile = coverImageEl.files[0];
    if (coverFile && data.id) {
      const formData = new FormData();
      formData.append('image', coverFile);
      const artRes = await fetch(`/api/playlist/${data.id}/artwork`, { method: 'PUT', body: formData });
      artworkFailed = !artRes.ok;
    }

    sessionStorage.removeItem(PENDING_KEY);
    showSuccessModal({ title, coverFile, playlistUrl: data.playlist_url });
    if (artworkFailed) {
      showMessage(playlistMessageEl, 'The playlist was created, but the cover image upload failed.', 'error');
    }
  } catch (err) {
    showMessage(playlistMessageEl, err.message, 'error');
  } finally {
    hideLoading();
    setLoading(createPlaylistBtn, false, 'Create playlist');
  }
};

// --- Success modal + confetti --------------------------------------------

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function showSuccessModal({ title, coverFile, playlistUrl }) {
  modalPlaylistNameEl.textContent = title;
  modalOpenLinkEl.href = playlistUrl;

  if (coverFile) {
    modalCoverImgEl.src = URL.createObjectURL(coverFile);
    modalCoverImgEl.classList.remove('hidden');
    modalCoverPlaceholderEl.classList.add('hidden');
  } else {
    modalCoverImgEl.classList.add('hidden');
    modalCoverPlaceholderEl.classList.remove('hidden');
  }

  const includedArtists = Object.keys(currentMatches).filter(
    (a) => !excludedArtists.has(a) && (currentMatches[a].tracks || []).length > 0
  );
  const shown = pickBubbleArtists(includedArtists, currentMatches, 5);
  modalBubblesEl.innerHTML = '';
  shown.forEach((artist) => {
    const data = currentMatches[artist];
    modalBubblesEl.appendChild(makeBubbleElement(artist, data, { minSize: 44, maxSize: 60 }));
  });

  successModalEl.classList.remove('hidden');
  launchConfetti();
}

function closeSuccessModal() {
  successModalEl.classList.add('hidden');
}

modalCloseBtn.onclick = closeSuccessModal;
successModalEl.addEventListener('click', (e) => {
  if (e.target === successModalEl) closeSuccessModal();
});

function launchConfetti() {
  if (prefersReducedMotion) return;

  const container = document.createElement('div');
  container.className = 'confetti-container';
  document.body.appendChild(container);

  const colors = ['#ff3d1a', '#7c3aed', '#22d3a0', '#ffce45', '#f3f1f7'];

  for (let i = 0; i < 70; i++) {
    const piece = document.createElement('div');
    piece.className = 'confetti-piece';
    piece.style.left = `${randomBetween(0, 100)}vw`;
    piece.style.background = colors[Math.floor(Math.random() * colors.length)];
    piece.style.width = `${Math.round(randomBetween(6, 10))}px`;
    piece.style.height = `${Math.round(randomBetween(10, 16))}px`;
    piece.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
    piece.style.animationDuration = `${randomBetween(2.5, 4.5).toFixed(2)}s`;
    piece.style.animationDelay = `${randomBetween(0, 0.6).toFixed(2)}s`;
    piece.addEventListener('animationend', () => piece.remove());
    container.appendChild(piece);
  }

  setTimeout(() => container.remove(), 6000);
}

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
