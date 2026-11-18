require('dotenv').config();
const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_USERS = {
  emerieco: { username: 'emerieco', displayName: 'Emerieco' },
  jayclerr: { username: 'jayclerr', displayName: 'Jayclerr' }
};

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, key] = stored.split(':');
  const derived = crypto.scryptSync(password, salt, 64);
  const keyBuf = Buffer.from(key, 'hex');
  if (derived.length !== keyBuf.length) return false;
  return crypto.timingSafeEqual(derived, keyBuf);
}
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const SKIP_PRICE_CENTS = parseInt(process.env.SKIP_PRICE_CENTS || '500', 10);
const SUPER_SKIP_PRICE_CENTS = parseInt(process.env.SUPER_SKIP_PRICE_CENTS || '1500', 10);

let stripe = null;
if (STRIPE_SECRET_KEY) {
  try {
    stripe = require('stripe')(STRIPE_SECRET_KEY);
  } catch (err) {
    console.warn('Stripe SDK could not initialize:', err.message);
  }
}

const DATA_DIR = path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'db.json');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const GENRE_CRITERIA = {
  'Hip-hop / Rap': ['Bars & Delivery', 'Beat / Bounce', 'Mix & 808s', 'Replay Value'],
  'R&B': ['Vocals & Harmonies', 'Mood & Production', 'Songwriting', 'Replay Value'],
  'Pop': ['Hook & Melody', 'Production Polish', 'Vocal Performance', 'Replay Value'],
  'Alternative': ['Atmosphere & Edge', 'Instrumentation', 'Originality', 'Replay Value'],
  'Electronic': ['Sound Design', 'Drop & Groove', 'Mix & Energy', 'Replay Value'],
  'Rock': ['Riffs & Instrumentation', 'Vocal Grit', 'Energy & Dynamics', 'Replay Value'],
  'Other': ['Production', 'Performance', 'Originality', 'Replay Value']
};

function readDB() {
  if (!fs.existsSync(DB_FILE)) {
    const initial = {
      nextId: 1,
      nowPlaying: null,
      lastWheelSpin: null,
      adminProfiles: {
        emerieco: {
          username: 'emerieco',
          name: 'Emerieco',
          role: 'Host & Head Curator',
          bio: 'Independent tastemaker, live music reviewer, and producer spotlighting underground heat. Submit your best tracks to get heard live on stream.',
          avatar_url: '',
          socials: {
            instagram: 'https://instagram.com',
            tiktok: 'https://tiktok.com',
            twitch: 'https://twitch.tv',
            youtube: 'https://youtube.com',
            spotify: 'https://spotify.com'
          }
        },
        jayclerr: {
          username: 'jayclerr',
          name: 'Jayclerr',
          role: 'Co-Host & Curator',
          bio: 'Co-host, A&R ear, and live stream reviewer breaking new waves and rating submissions alongside Emerieco.',
          avatar_url: '',
          socials: {
            instagram: 'https://instagram.com',
            tiktok: 'https://tiktok.com',
            twitch: 'https://twitch.tv',
            youtube: 'https://youtube.com',
            spotify: 'https://spotify.com'
          }
        }
      },
      adminPasswords: {
        emerieco: process.env.ADMIN_PASSWORD_EMERIECO ? hashPassword(process.env.ADMIN_PASSWORD_EMERIECO) : null,
        jayclerr: process.env.ADMIN_PASSWORD_JAYCLERR ? hashPassword(process.env.ADMIN_PASSWORD_JAYCLERR) : null
      },
      topArtists: [],
      topTracks: [],
      submissions: []
    };
          score: null,
          review: null,
          communityRatings: [],
          created_at: new Date().toISOString()
        }
      ]
    };
    fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2));
    return initial;
  }
  const parsed = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  if (!parsed.nowPlaying) parsed.nowPlaying = null;
  if (!parsed.lastWheelSpin) parsed.lastWheelSpin = null;
  if (!Array.isArray(parsed.topArtists)) parsed.topArtists = [];
  if (!Array.isArray(parsed.topTracks)) parsed.topTracks = [];
  if (!parsed.adminPasswords || typeof parsed.adminPasswords !== 'object') {
    parsed.adminPasswords = {
      emerieco: process.env.ADMIN_PASSWORD_EMERIECO ? hashPassword(process.env.ADMIN_PASSWORD_EMERIECO) : null,
      jayclerr: process.env.ADMIN_PASSWORD_JAYCLERR ? hashPassword(process.env.ADMIN_PASSWORD_JAYCLERR) : null
    };
  }
  if (!parsed.adminProfiles || typeof parsed.adminProfiles !== 'object') {
    const legacy = parsed.adminProfile || {};
    parsed.adminProfiles = {
      emerieco: {
        username: 'emerieco',
        name: legacy.name || 'Emerieco',
        role: legacy.role || 'Host & Head Curator',
        bio: legacy.bio || 'Independent tastemaker, live music reviewer, and producer spotlighting underground heat.',
        avatar_url: legacy.avatar_url || '',
        socials: legacy.socials || {}
      },
      jayclerr: {
        username: 'jayclerr',
        name: 'Jayclerr',
        role: 'Co-Host & Curator',
        bio: 'Co-host, A&R ear, and live stream reviewer breaking new waves and rating submissions.',
        avatar_url: '',
        socials: {}
      }
    };
  }
  parsed.submissions.forEach(s => {
    if (!Array.isArray(s.communityRatings)) s.communityRatings = [];
  });
  return parsed;
}

function writeDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function summarizeCommunity(sub) {
  const ratings = Array.isArray(sub.communityRatings) ? sub.communityRatings : [];
  if (!ratings.length) {
    return { count: 0, average: null, breakdown: {} };
  }
  const sum = ratings.reduce((acc, r) => acc + Number(r.overall || 0), 0);
  const breakdownSums = {};
  const breakdownCounts = {};
  ratings.forEach(r => {
    if (r.breakdown && typeof r.breakdown === 'object') {
      for (const [k, v] of Object.entries(r.breakdown)) {
        breakdownSums[k] = (breakdownSums[k] || 0) + Number(v || 0);
        breakdownCounts[k] = (breakdownCounts[k] || 0) + 1;
      }
    }
  });
  const breakdown = {};
  for (const k of Object.keys(breakdownSums)) {
    breakdown[k] = Math.round((breakdownSums[k] / breakdownCounts[k]) * 10) / 10;
  }
  return {
    count: ratings.length,
    average: Math.round((sum / ratings.length) * 10) / 10,
    breakdown
  };
}

const allowedExts = new Set(['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac', '.png', '.jpg', '.jpeg', '.webp', '.gif']);
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safeExt = allowedExts.has(ext) ? ext : '.bin';
    cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${safeExt}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 30 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedExts.has(ext) || (file.mimetype && (file.mimetype.startsWith('audio/') || file.mimetype.startsWith('image/')))) {
      return cb(null, true);
    }
    cb(new Error('Only MP3, WAV, M4A, AAC, OGG, or FLAC audio files are allowed.'));
  }
});

// Stripe webhook
app.post('/api/webhook/stripe', express.raw({ type: 'application/json' }), (req, res) => {
  if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET) {
    return res.status(400).send('Webhook not configured');
  }
  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      req.headers['stripe-signature'],
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const subId = parseInt(session.metadata?.submissionId, 10);
    const tier = session.metadata?.tier;
    if (subId && (tier === 'skip' || tier === 'super_skip')) {
      const db = readDB();
      const item = db.submissions.find(s => s.id === subId);
      if (item) {
        item.priority = tier === 'super_skip' ? 2 : 1;
        writeDB(db);
      }
    }
  }
  res.json({ received: true });
});

app.use(express.json());
app.use('/uploads', express.static(UPLOADS_DIR));
app.use(express.static(path.join(__dirname, 'public')));

const adminTokens = new Map(); // token -> 'emerieco' | 'jayclerr'
function parseCookies(req) {
  const list = {};
  const header = req.headers?.cookie;
  if (!header) return list;
  header.split(';').forEach(cookie => {
    const parts = cookie.split('=');
    const key = parts.shift().trim();
    if (key) list[key] = decodeURIComponent(parts.join('='));
  });
  return list;
}
function requireAdmin(req, res, next) {
  const cookies = parseCookies(req);
  const user = cookies.emerieco_admin && adminTokens.get(cookies.emerieco_admin);
  if (user && ADMIN_USERS[user]) {
    req.adminUser = user;
    return next();
  }
  return res.status(401).json({ error: 'Unauthorized' });
}

// Public API: Pricing, Stripe status & Genre Rating Rubrics
app.get('/api/config', (_req, res) => {
  res.json({
    stripeEnabled: Boolean(stripe),
    skipPrice: `$${(SKIP_PRICE_CENTS / 100).toFixed(2)}`,
    superPrice: `$${(SUPER_SKIP_PRICE_CENTS / 100).toFixed(2)}`,
    genreCriteria: GENRE_CRITERIA
  });
});

// Public API: Published Reviews with Community Rating Summaries
app.get('/api/reviews', (_req, res) => {
  const db = readDB();
  const reviews = db.submissions
    .filter(s => s.status === 'published')
    .sort((a, b) => b.id - a.id)
    .map(s => ({
      id: s.id,
      artist: s.artist,
      track: s.track,
      genre: s.genre,
      score: s.score,
      dualScores: s.dualScores || {},
      badge: s.badge || null,
      review: s.review,
      audio_url: s.audio_url,
      song_url: s.song_url,
      created_at: s.created_at,
      community: summarizeCommunity(s)
    }));
  res.json(reviews);
});

// Public API: Pending Queue
app.get('/api/queue', (_req, res) => {
  const db = readDB();
  const queue = db.submissions
    .filter(s => s.status !== 'published')
    .sort((a, b) => (b.priority - a.priority) || (a.id - b.id))
    .map(s => ({
      id: s.id,
      artist: s.artist,
      track: s.track,
      genre: s.genre,
      priority: s.priority,
      status: s.status,
      audio_url: s.audio_url,
      community: summarizeCommunity(s)
    }));
  res.json(queue);
});

// Public API: Live Now-Playing & Stream Widget State (includes lastWheelSpin for OBS Wheel Widget!)
app.get('/api/now-playing', (_req, res) => {
  const db = readDB();
  const queue = db.submissions
    .filter(s => s.status !== 'published')
    .sort((a, b) => (b.priority - a.priority) || (a.id - b.id));

  let active = null;
  if (db.nowPlaying && db.nowPlaying.id) {
    const found = db.submissions.find(s => s.id === db.nowPlaying.id);
    if (found) {
      active = {
        id: found.id,
        artist: found.artist,
        track: found.track,
        genre: found.genre,
        priority: found.priority,
        status: found.status,
        score: found.score,
        review: found.review,
        audio_url: found.audio_url,
        song_url: found.song_url,
        community: summarizeCommunity(found),
        criteria: GENRE_CRITERIA[found.genre] || GENRE_CRITERIA.Other
      };
    }
  }
  if (!active && queue.length) {
    const first = queue[0];
    active = {
      id: first.id,
      artist: first.artist,
      track: first.track,
      genre: first.genre,
      priority: first.priority,
      status: first.status,
      score: first.score,
      review: first.review,
      audio_url: first.audio_url,
      song_url: first.song_url,
      community: summarizeCommunity(first),
      criteria: GENRE_CRITERIA[first.genre] || GENRE_CRITERIA.Other
    };
  }

  res.json({
    nowPlaying: active,
    upNext: queue.slice(0, 5).map(q => ({
      id: q.id,
      artist: q.artist,
      track: q.track,
      genre: q.genre,
      priority: q.priority
    })),
    queueParticipants: queue.map(q => ({
      id: q.id,
      artist: q.artist,
      track: q.track,
      genre: q.genre,
      priority: q.priority
    })),
    lastWheelSpin: db.lastWheelSpin,
    queueCount: queue.length,
    publishedCount: db.submissions.filter(s => s.status === 'published').length
  });
});

// Public API: Set Now-Playing track when played in browser or stream
app.post('/api/now-playing', requireAdmin, (req, res) => {
  const id = parseInt(req.body.id, 10);
  if (!id) return res.status(400).json({ error: 'Track ID required.' });
  const db = readDB();
  const sub = db.submissions.find(s => s.id === id);
  if (!sub) return res.status(404).json({ error: 'Track not found.' });
  db.nowPlaying = {
    id: sub.id,
    artist: sub.artist,
    track: sub.track,
    genre: sub.genre,
    priority: sub.priority,
    audio_url: sub.audio_url,
    song_url: sub.song_url,
    updated_at: new Date().toISOString()
  };
  writeDB(db);
  res.json({ ok: true, nowPlaying: db.nowPlaying });
});

// Public/Stream API: Spin the Wheel for a Free Skip among people in queue
app.post('/api/wheel/spin', requireAdmin, (req, res) => {
  const db = readDB();
  const onlyStandard = req.body?.onlyStandard !== false;
  let candidates = db.submissions
    .filter(s => s.status !== 'published')
    .sort((a, b) => (b.priority - a.priority) || (a.id - b.id));

  if (onlyStandard) {
    const standardOnly = candidates.filter(s => s.priority === 0);
    if (standardOnly.length > 0) {
      candidates = standardOnly;
    }
  }

  if (!candidates.length) {
    return res.status(400).json({ error: 'No tracks in the queue to spin for!' });
  }

  const winnerIndex = crypto.randomInt(0, candidates.length);
  const winner = candidates[winnerIndex];
  const upgradeTier = req.body?.tier === 'super_skip' ? 2 : 1;

  // Upgrade the winning submission in the queue
  const target = db.submissions.find(s => s.id === winner.id);
  if (target && target.priority < upgradeTier) {
    target.priority = upgradeTier;
  }

  const spinEvent = {
    spinId: `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
    winnerId: winner.id,
    winnerArtist: winner.artist,
    winnerTrack: winner.track,
    winnerGenre: winner.genre,
    winnerIndex,
    tier: upgradeTier === 2 ? 'SUPER SKIP ♣' : 'FREE SKIP',
    participants: candidates.map(c => ({
      id: c.id,
      artist: c.artist,
      track: c.track,
      genre: c.genre
    })),
    spunAt: new Date().toISOString()
  };

  db.lastWheelSpin = spinEvent;
  writeDB(db);

  res.json({ ok: true, spin: spinEvent });
});

// Public API: Submit a Genre-Specific Rating while a track is playing
app.post('/api/submissions/:id/rate', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const breakdown = req.body.breakdown;
  const vibe = String(req.body.vibe || '').trim().slice(0, 60);

  if (!breakdown || typeof breakdown !== 'object') {
    return res.status(400).json({ error: 'Rating breakdown is required.' });
  }

  const values = Object.values(breakdown).map(Number).filter(n => !Number.isNaN(n) && n >= 0 && n <= 10);
  if (!values.length) {
    return res.status(400).json({ error: 'Provide valid 0–10 ratings.' });
  }

  const db = readDB();
  const sub = db.submissions.find(s => s.id === id);
  if (!sub) return res.status(404).json({ error: 'Track not found.' });

  const overall = Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;
  sub.communityRatings.push({
    overall,
    breakdown,
    vibe: vibe || null,
    created_at: new Date().toISOString()
  });

  writeDB(db);
  res.status(201).json({
    ok: true,
    overall,
    community: summarizeCommunity(sub)
  });
});

// Public API: Submit a track
app.post('/api/submissions', upload.single('audio'), (req, res) => {
  const artist = String(req.body.artist || '').trim().slice(0, 80);
  const track = String(req.body.track || '').trim().slice(0, 100);
  const songUrl = String(req.body.songUrl || '').trim().slice(0, 500);
  const genre = String(req.body.genre || 'Other').trim().slice(0, 50);
  const contact = String(req.body.contact || '').trim().slice(0, 120);
  const note = String(req.body.note || '').trim().slice(0, 1000);

  if (!artist || !track) {
    return res.status(400).json({ error: 'Artist name and track title are required.' });
  }
  if (!songUrl && !req.file) {
    return res.status(400).json({ error: 'Provide a song link or upload an audio file.' });
  }

  const db = readDB();
  const id = db.nextId++;
  const entry = {
    id,
    artist,
    track,
    song_url: songUrl || null,
    audio_url: req.file ? `/uploads/${req.file.filename}` : null,
    genre,
    contact: contact || null,
    note: note || null,
    priority: 0,
    status: 'queued',
    score: null,
    review: null,
    communityRatings: [],
    created_at: new Date().toISOString()
  };

  db.submissions.push(entry);
  writeDB(db);

  res.status(201).json({
    id,
    message: 'Track added to the listening queue!'
  });
});

// Public API: Priority Checkout
app.post('/api/checkout', async (req, res) => {
  const submissionId = parseInt(req.body.submissionId, 10);
  const tier = req.body.tier;

  if (!submissionId || (tier !== 'skip' && tier !== 'super_skip')) {
    return res.status(400).json({ error: 'Invalid priority selection.' });
  }

  const db = readDB();
  const sub = db.submissions.find(s => s.id === submissionId);
  if (!sub) {
    return res.status(404).json({ error: 'Submission not found.' });
  }

  if (!stripe) {
    return res.status(503).json({
      error: 'Priority payments are not configured yet. Add STRIPE_SECRET_KEY in .env to enable checkout.'
    });
  }

  try {
    const origin = `${req.protocol}://${req.get('host')}`;
    const isSuper = tier === 'super_skip';
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: isSuper ? `Super Skip Priority — ${sub.track}` : `Skip Priority — ${sub.track}`,
              description: `Queue priority upgrade for ${sub.artist} (#${sub.id})`
            },
            unit_amount: isSuper ? SUPER_SKIP_PRICE_CENTS : SKIP_PRICE_CENTS
          },
          quantity: 1
        }
      ],
      metadata: {
        submissionId: String(sub.id),
        tier
      },
      success_url: `${origin}/?payment=success`,
      cancel_url: `${origin}/?payment=cancelled`
    });
    res.json({ url: session.url });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Checkout session failed.' });
  }
});

// Stream Widgets Page (Studio requires admin; individual ?widget=...&clean=1 OBS sources stay accessible for OBS)
app.get('/widgets', (req, res) => {
  const isObsSource = Boolean(req.query.widget) || req.query.clean === '1';
  if (!isObsSource) {
    const cookies = parseCookies(req);
    const user = cookies.emerieco_admin && adminTokens.get(cookies.emerieco_admin);
    if (!user || !ADMIN_USERS[user]) {
      return res.redirect('/admin');
    }
  }
  res.sendFile(path.join(__dirname, 'public', 'widgets.html'));
});

// Public API: Host / Admin Profiles (returns both emerieco & jayclerr)
app.get('/api/profile', (_req, res) => {
  const db = readDB();
  res.json(db.adminProfiles);
});

// Admin API: Upload Profile Picture for the logged-in admin
app.post('/api/admin/profile/avatar', requireAdmin, upload.single('avatar'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Please select an image file (PNG, JPG, WEBP, GIF).' });
  }
  const db = readDB();
  const user = req.adminUser;
  db.adminProfiles[user].avatar_url = `/uploads/${req.file.filename}`;
  writeDB(db);
  res.json({ ok: true, avatar_url: db.adminProfiles[user].avatar_url });
});

// Admin API: Update Profile Details & Socials for the logged-in admin
app.post('/api/admin/profile', requireAdmin, (req, res) => {
  const db = readDB();
  const user = req.adminUser;
  const current = db.adminProfiles[user] || {};
  const body = req.body || {};
  const socialsIn = body.socials && typeof body.socials === 'object' ? body.socials : {};
  db.adminProfiles[user] = {
    username: user,
    name: String(body.name || ADMIN_USERS[user].displayName).trim().slice(0, 60),
    role: String(body.role || 'Host & Curator').trim().slice(0, 80),
    bio: String(body.bio || '').trim().slice(0, 600),
    avatar_url: String(body.avatar_url ?? current.avatar_url ?? '').trim().slice(0, 500),
    socials: {
      instagram: String(socialsIn.instagram || '').trim().slice(0, 300),
      tiktok: String(socialsIn.tiktok || '').trim().slice(0, 300),
      twitch: String(socialsIn.twitch || '').trim().slice(0, 300),
      youtube: String(socialsIn.youtube || '').trim().slice(0, 300),
      spotify: String(socialsIn.spotify || '').trim().slice(0, 300)
    }
  };
  writeDB(db);
  res.json({ ok: true, profile: db.adminProfiles[user] });
});

// Public API: Admin Curated Top 5 Artists & Top 10 Tracks
app.get('/api/curated', (_req, res) => {
  const db = readDB();
  res.json({
    topArtists: (db.topArtists || []).slice(0, 5),
    topTracks: (db.topTracks || []).slice(0, 10)
  });
});

// Admin API: Save Top 5 Artists
app.post('/api/admin/top-artists', requireAdmin, (req, res) => {
  const list = Array.isArray(req.body.topArtists) ? req.body.topArtists : [];
  const cleaned = list
    .filter(item => item && String(item.artist || '').trim())
    .slice(0, 5)
    .map((item, idx) => ({
      rank: idx + 1,
      artist: String(item.artist || '').trim().slice(0, 80),
      genre: String(item.genre || 'Other').trim().slice(0, 50),
      note: String(item.note || '').trim().slice(0, 160),
      link: String(item.link || '').trim().slice(0, 300)
    }));
  const db = readDB();
  db.topArtists = cleaned;
  writeDB(db);
  res.json({ ok: true, topArtists: db.topArtists });
});

// Admin API: Save Top 10 Tracks
app.post('/api/admin/top-tracks', requireAdmin, (req, res) => {
  const list = Array.isArray(req.body.topTracks) ? req.body.topTracks : [];
  const cleaned = list
    .filter(item => item && String(item.track || '').trim() && String(item.artist || '').trim())
    .slice(0, 10)
    .map((item, idx) => ({
      rank: idx + 1,
      artist: String(item.artist || '').trim().slice(0, 80),
      track: String(item.track || '').trim().slice(0, 100),
      genre: String(item.genre || 'Other').trim().slice(0, 50),
      note: String(item.note || '').trim().slice(0, 160),
      song_url: item.song_url ? String(item.song_url).trim().slice(0, 500) : null,
      audio_url: item.audio_url ? String(item.audio_url).trim().slice(0, 500) : null
    }));
  const db = readDB();
  db.topTracks = cleaned;
  writeDB(db);
  res.json({ ok: true, topTracks: db.topTracks });
});

// Admin Routes
app.get('/admin', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Check which admin accounts have created their password yet
app.get('/api/admin/session', (req, res) => {
  const cookies = parseCookies(req);
  const user = cookies.emerieco_admin && adminTokens.get(cookies.emerieco_admin);
  if (user && ADMIN_USERS[user]) {
    return res.json({ isAdmin: true, user, displayName: ADMIN_USERS[user].displayName });
  }
  return res.json({ isAdmin: false });
});

app.get('/api/admin/accounts-status', (_req, res) => {
  const db = readDB();
  res.json({
    emerieco: Boolean(db.adminPasswords?.emerieco),
    jayclerr: Boolean(db.adminPasswords?.jayclerr)
  });
});

// First-time password setup for an admin who hasn't set a password yet
app.post('/api/admin/setup-password', (req, res) => {
  const username = String(req.body.username || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const confirm = String(req.body.confirmPassword || '');
  const account = ADMIN_USERS[username];
  if (!account) {
    return res.status(400).json({ error: 'Invalid admin account.' });
  }
  const db = readDB();
  if (db.adminPasswords?.[username]) {
    return res.status(400).json({ error: 'Password is already set for this account. Please sign in.' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
  }
  if (password !== confirm) {
    return res.status(400).json({ error: 'Passwords do not match.' });
  }
  db.adminPasswords[username] = hashPassword(password);
  writeDB(db);

  const token = crypto.randomBytes(24).toString('hex');
  adminTokens.set(token, username);
  res.setHeader('Set-Cookie', `emerieco_admin=${token}; HttpOnly; Path=/; SameSite=Lax`);
  res.json({ ok: true, user: username, displayName: account.displayName });
});

// Change password while signed in
app.post('/api/admin/change-password', requireAdmin, (req, res) => {
  const currentPassword = String(req.body.currentPassword || '');
  const newPassword = String(req.body.newPassword || '');
  const confirmPassword = String(req.body.confirmPassword || '');
  const username = req.adminUser;
  const db = readDB();
  const stored = db.adminPasswords?.[username];

  if (!verifyPassword(currentPassword, stored)) {
    return res.status(401).json({ error: 'Current password is incorrect.' });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters long.' });
  }
  if (newPassword !== confirmPassword) {
    return res.status(400).json({ error: 'New passwords do not match.' });
  }
  db.adminPasswords[username] = hashPassword(newPassword);
  writeDB(db);
  res.json({ ok: true });
});

app.post('/api/admin/login', (req, res) => {
  const username = String(req.body.username || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const account = ADMIN_USERS[username];
  if (!account) {
    return res.status(401).json({ error: 'Invalid admin account.' });
  }
  const db = readDB();
  const stored = db.adminPasswords?.[username];
  if (!stored) {
    return res.status(403).json({ error: 'No password created yet for this account. Create one first!', needsSetup: true });
  }
  if (!verifyPassword(password, stored)) {
    return res.status(401).json({ error: 'Incorrect password.' });
  }
  const token = crypto.randomBytes(24).toString('hex');
  adminTokens.set(token, username);
  res.setHeader('Set-Cookie', `emerieco_admin=${token}; HttpOnly; Path=/; SameSite=Lax`);
  res.json({ ok: true, user: username, displayName: account.displayName });
});

app.post('/api/admin/logout', (req, res) => {
  const cookies = parseCookies(req);
  if (cookies.emerieco_admin) adminTokens.delete(cookies.emerieco_admin);
  res.setHeader('Set-Cookie', 'emerieco_admin=; HttpOnly; Path=/; Max-Age=0');
  res.json({ ok: true });
});

app.get('/api/admin/state', requireAdmin, (req, res) => {
  const db = readDB();
  const queue = db.submissions
    .filter(s => s.status !== 'published')
    .sort((a, b) => (b.priority - a.priority) || (a.id - b.id))
    .map(s => ({ ...s, community: summarizeCommunity(s) }));
  const reviews = db.submissions
    .filter(s => s.status === 'published')
    .sort((a, b) => b.id - a.id)
    .map(s => ({ ...s, community: summarizeCommunity(s) }));
  res.json({
    currentAdmin: req.adminUser,
    currentAdminName: ADMIN_USERS[req.adminUser]?.displayName || req.adminUser,
    queue,
    reviews,
    nowPlaying: db.nowPlaying,
    lastWheelSpin: db.lastWheelSpin
  });
});

app.patch('/api/admin/submissions/:id/priority', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const priority = parseInt(req.body.priority, 10);
  if (![0, 1, 2].includes(priority)) {
    return res.status(400).json({ error: 'Invalid priority level.' });
  }
  const db = readDB();
  const sub = db.submissions.find(s => s.id === id);
  if (!sub) return res.status(404).json({ error: 'Not found.' });
  sub.priority = priority;
  writeDB(db);
  res.json({ ok: true });
});

app.post('/api/admin/submissions/:id/unpublish', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const db = readDB();
  const sub = db.submissions.find(s => s.id === id);
  if (!sub) return res.status(404).json({ error: 'Not found.' });
  sub.status = 'queued';
  writeDB(db);
  res.json({ ok: true });
});

app.post('/api/admin/submissions/:id/publish', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const score = parseFloat(req.body.score);
  const review = String(req.body.review || '').trim();
  if (Number.isNaN(score) || score < 0 || score > 10 || !review) {
    return res.status(400).json({ error: 'Valid score (0-10) and review text are required.' });
  }
  const db = readDB();
  const sub = db.submissions.find(s => s.id === id);
  if (!sub) return res.status(404).json({ error: 'Submission not found.' });
  sub.status = 'published';
  sub.score = Math.round(score * 10) / 10;
  sub.review = review;
  writeDB(db);
  res.json({ ok: true });
});

app.delete('/api/admin/submissions/:id', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const db = readDB();
  const idx = db.submissions.findIndex(s => s.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Not found.' });
  db.submissions.splice(idx, 1);
  writeDB(db);
  res.json({ ok: true });
});

app.use((err, _req, res, _next) => {
  res.status(400).json({ error: err.message || 'Request failed.' });
});

app.listen(PORT, () => {
  console.log(`☘ emerieco.sounds running at http://localhost:${PORT}`);
});
