require('dotenv').config();
const express = require('express');
const cookieSession = require('cookie-session');
const path = require('path');

const authRoutes = require('./src/routes/auth');
const apiRoutes = require('./src/routes/api');

const app = express();
const PORT = process.env.PORT || 3000;

const required = ['SOUNDCLOUD_CLIENT_ID', 'SOUNDCLOUD_CLIENT_SECRET', 'SOUNDCLOUD_REDIRECT_URI', 'SESSION_SECRET'];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) {
  console.warn(
    `⚠️  Missing env vars: ${missing.join(', ')}. Copy .env.example to .env and fill these in.`
  );
}

app.use(express.json());
app.use(
  cookieSession({
    name: 'rtd_session',
    keys: [process.env.SESSION_SECRET || 'dev-secret-change-me'],
    maxAge: 24 * 60 * 60 * 1000, // 24h
  })
);

app.use('/auth', authRoutes);
app.use('/api', apiRoutes);
app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
  console.log(`🕺 RTD (Ready to Dance) running at http://127.0.0.1:${PORT}`);
});
