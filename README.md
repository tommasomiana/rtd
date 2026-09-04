# RTD — Ready to Dance 🕺

Search for an event, confirm the match, and get a SoundCloud playlist of the lineup.

## What's here

- `server.js` — Express app entry point
- `src/routes/auth.js` — SoundCloud login (OAuth 2.1 + PKCE)
- `src/routes/api.js` — event search, artist matching, playlist creation
- `src/lib/agent.js` — Claude + web search: finds candidate events, then the
  full lineup for a confirmed one
- `src/lib/soundcloud.js` — SoundCloud API client (artist profile lookup,
  track search, playlist creation)
- `public/` — the frontend (plain HTML/CSS/JS, no build step)

## Setup

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Configure environment variables**
   ```bash
   cp .env.example .env
   ```
   Fill in:
   - `SOUNDCLOUD_CLIENT_ID` / `SOUNDCLOUD_CLIENT_SECRET` — from your app at
     developers.soundcloud.com (requires Artist Pro to register)
   - `SOUNDCLOUD_REDIRECT_URI` — must match exactly what's set as the
     redirect URI in the SoundCloud app settings
   - `ANTHROPIC_API_KEY` — from console.anthropic.com (Settings → API Keys).
     Needs a small amount of credit added to the account; usage for this
     app costs a few cents per search, not a subscription.
   - `SESSION_SECRET` — any long random string

3. **In the SoundCloud app's "Users" settings**, add the SoundCloud account
   email of everyone who should be able to use the app (Development Mode
   caps this at 5 authorized users).

4. **Run it**
   ```bash
   npm start
   ```
   Visit http://127.0.0.1:3000

## How it works

1. Type an event name/description (e.g. "Brunch Electronik 2026 Barcelona").
   `/api/agent/find-event` asks Claude (with web search) to find up to 3
   candidate matches.
2. Pick the right one. `/api/agent/lineup` asks Claude to find that specific
   event's full artist lineup, which lands in an editable text box —
   review/correct before continuing (the agent can get this wrong,
   especially for smaller or ambiguous events).
3. "Find artists" (`/api/match`) looks up each artist's actual SoundCloud
   profile and pulls tracks from their own uploads (falling back to a
   filtered keyword search for label-distributed artists whose profile
   doesn't expose tracks directly).
4. Connect SoundCloud, pick a track-selection vibe, set tracks-per-artist
   and whether to include DJ sets/mixes, then create the playlist on your
   account.

## Known rough edges

- **The agent can misidentify events or lineups.** It's a web search, not
  a database — always double-check the confirmed event and the resulting
  artist list before matching.
- **Artist matching prefers exact name matches by follower count** (to
  avoid picking an obscure same-named account), then falls back to a
  keyword search filtered by uploader name, with diacritics ignored in
  both comparisons (so "Bohmer" matches "Böhmer"). It can still pick the
  wrong account if multiple similarly-popular accounts share a name.
- **SoundCloud's Development Mode caps the app at 5 authorized users.**
- Sessions are stored in a signed cookie — logging in on a new device is a
  fresh session, there's no shared user database.

## Deploying (Render, free tier)

1. Push this project to a GitHub repo.
2. Create a free Render account at render.com.
3. New → Web Service, connect the repo. Render detects `render.yaml` and
   pre-fills the build/start commands.
4. Fill in the environment variables (see Setup above) — for
   `SOUNDCLOUD_REDIRECT_URI`, use a placeholder until you have the real
   deployed URL, then come back and update it (and the SoundCloud app's
   own redirect URI setting) to match.
5. Share the URL with your up-to-5 authorized friends.

Free tier notes: Render's free web services spin down after inactivity and
take ~30-60 seconds to wake up on the first request after a while.
