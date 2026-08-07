const express = require('express');
const sc = require('../lib/soundcloud');

const router = express.Router();

// Step 1: send the user to SoundCloud to log in and approve access
router.get('/login', (req, res) => {
  const { codeVerifier, codeChallenge } = sc.generatePkcePair();
  const state = sc.generateState();

  // Stash these in the session so /callback can complete the exchange
  req.session.pkceVerifier = codeVerifier;
  req.session.oauthState = state;

  const url = sc.buildAuthorizeUrl({ state, codeChallenge });
  res.redirect(url);
});

// Step 2: SoundCloud redirects back here with a `code`
router.get('/callback', async (req, res) => {
  const { code, state } = req.query;

  if (!code) {
    return res.status(400).send('Missing authorization code from SoundCloud.');
  }
  if (!state || state !== req.session.oauthState) {
    return res.status(400).send('State mismatch — possible CSRF, please try logging in again.');
  }

  try {
    const tokenData = await sc.exchangeCodeForToken({
      code,
      codeVerifier: req.session.pkceVerifier,
    });

    req.session.soundcloud = {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_at: Date.now() + tokenData.expires_in * 1000,
    };

    delete req.session.pkceVerifier;
    delete req.session.oauthState;

    res.redirect('/'); // back to the app, now logged in
  } catch (err) {
    console.error('Token exchange failed:', err.response?.data || err.message);
    res.status(500).send('Login failed — check server logs.');
  }
});

router.post('/logout', (req, res) => {
  req.session.soundcloud = null;
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  res.json({ loggedIn: !!req.session.soundcloud });
});

module.exports = router;
