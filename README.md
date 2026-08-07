# RTD — Ready to Dance 🕺

Paste a lineup — or upload a screenshot of one — and get a SoundCloud playlist of the artists.

## What's here

- `server.js` — Express app entry point
- `src/routes/auth.js` — SoundCloud login (OAuth 2.1 + PKCE, "Connect with SoundCloud")
- `src/routes/api.js` — the actual app logic: OCR/text parsing → match artists → create playlist
- `src/lib/soundcloud.js` — SoundCloud API client (Client Credentials + Authorization Code flows)
- `src/lib/ocr.js` — runs OCR (Tesseract.js) on an uploaded lineup screenshot
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
   - `SOUNDCLOUD_REDIRECT_URI` — must match **exactly** what you set as the
     redirect URI in the SoundCloud app settings, e.g.
     `http://127.0.0.1:3000/auth/callback` for local dev
   - `SESSION_SECRET` — any long random string

3. **In the SoundCloud app's "Users" settings**, add the SoundCloud account
   email of everyone who should be able to log in and use the app while it's
   in Development Mode (this is a SoundCloud requirement, separate from
   anything in this codebase).

4. **Run it**
   ```bash
   npm start
   ```
   Visit http://127.0.0.1:3000

## How it works

1. Either paste the lineup as text (one artist per line, or comma-separated),
   or upload a screenshot of a lineup poster — `/api/extract-image` runs OCR
   on it and pre-fills the text box with what it found, so you can review
   and correct it before continuing (OCR accuracy varies a lot depending on
   the poster's font/layout, hence the review step rather than trusting it
   blindly).
2. "Find artists on SoundCloud" (`/api/match`) searches SoundCloud for
   tracks matching each artist name — works even if you're not logged in,
   using the app's own Client Credentials token for public data.
3. Click "Connect with SoundCloud" to log in with your own account
   (Authorization Code + PKCE flow).
4. "Create SoundCloud playlist" builds a playlist on **your** account from
   the matched tracks (takes up to 2 tracks per artist by default — tweak
   that in `public/app.js`).

## Known rough edges

- **OCR quality depends heavily on the image.** A clean, cropped screenshot
  of just the lineup text works best. Stylised festival poster fonts,
  low-resolution images, or busy backgrounds will produce messier results —
  that's exactly why the extracted text lands in an editable box instead of
  being used directly.
- **Artist matching is a simple text search**, so a common artist name (or
  one with a sparse SoundCloud presence) may return an unrelated or empty
  result. The lineup screen shows a "no match" tag for anything with zero
  hits so you can spot these before creating the playlist.
- **SoundCloud's Development Mode caps the app at 5 authorized users** —
  add the emails of everyone who should be able to log in via the app's
  dashboard settings, or they'll hit an authorization error.
- Sessions are stored in a signed cookie (`cookie-session`), which is fine
  for a small personal app but means logging in on a new device is a fresh
  session — there's no shared user database.

## Deploying (Render, free tier)

This is a plain Node/Express app, so it deploys easily. Steps for Render
(free tier, no credit card needed for this plan):

1. **Push this project to a GitHub repo** (if you haven't already):
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   ```
   Then create an empty repo on github.com and follow the "push an existing
   repository" instructions it shows you.

2. **Create a free Render account** at render.com (you can sign up with
   GitHub directly).

3. **New → Web Service**, connect your GitHub repo. Render will detect
   `render.yaml` in this project and pre-fill most settings (build command
   `npm install`, start command `npm start`).

4. **Fill in the environment variables** it asks for:
   - `SOUNDCLOUD_CLIENT_ID` / `SOUNDCLOUD_CLIENT_SECRET` — from your
     SoundCloud app
   - `SOUNDCLOUD_REDIRECT_URI` — you won't know this until step 5, so put
     a placeholder for now and come back to it
   - `SESSION_SECRET` — Render can auto-generate this for you (already
     configured in `render.yaml`)

5. **Deploy.** Render gives you a URL like
   `https://rtd-ready-to-dance.onrender.com`. Once you have it:
   - Go back to Render's environment variables and set
     `SOUNDCLOUD_REDIRECT_URI` to
     `https://rtd-ready-to-dance.onrender.com/auth/callback`
   - Go to your app's settings on developers.soundcloud.com and update its
     redirect URI to that same exact URL
   - Redeploy (Render usually does this automatically when you change env vars)

6. **Share the URL** with your up-to-5 authorized friends. They open it on
   their phone or laptop like any website — no install needed.

Free tier notes: Render's free web services spin down after inactivity and
take ~30-60 seconds to wake up on the first request after a while — normal
for a small personal project, not a bug.
