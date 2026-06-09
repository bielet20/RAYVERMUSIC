require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const cron    = require('node-cron');
const path    = require('path');
const fs      = require('fs');
const Database = require('better-sqlite3');
const spotify  = require('./services/spotify');
const youtube  = require('./services/youtube');

const app  = express();
const PORT = process.env.BACKEND_PORT || 3001;

// ── Database ──────────────────────────────────────────────────────────────────
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'rayver.db');
const db = new Database(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS yt_channels (
    id TEXT PRIMARY KEY,
    title TEXT,
    description TEXT,
    custom_url TEXT,
    thumbnail_url TEXT,
    subscriber_count INTEGER DEFAULT 0,
    video_count INTEGER DEFAULT 0,
    view_count INTEGER DEFAULT 0,
    updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS yt_videos (
    id TEXT PRIMARY KEY,
    title TEXT,
    description TEXT,
    published_at TEXT,
    channel_id TEXT,
    channel_title TEXT,
    thumbnail_url TEXT,
    embed_url TEXT,
    watch_url TEXT,
    updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS artists (
    id TEXT PRIMARY KEY,
    label TEXT,
    genre TEXT,
    name TEXT,
    followers INTEGER DEFAULT 0,
    popularity INTEGER DEFAULT 0,
    image_url TEXT,
    external_url TEXT,
    latest_release_json TEXT,
    updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS sync_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    synced_at TEXT DEFAULT (datetime('now')),
    status TEXT
  );
`);

// ── Helpers ───────────────────────────────────────────────────────────────────
const TRACKS_FILE = path.join(__dirname, 'data', 'tracks.json');

function getTracks() {
  try {
    return JSON.parse(fs.readFileSync(TRACKS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function getArtists() {
  return db.prepare('SELECT * FROM artists ORDER BY followers DESC').all().map(r => ({
    ...r,
    latestRelease: r.latest_release_json ? JSON.parse(r.latest_release_json) : null,
  }));
}

function upsertArtists(artists) {
  const stmt = db.prepare(`
    INSERT INTO artists (id, label, genre, name, followers, popularity, image_url, external_url, latest_release_json, updated_at)
    VALUES (@id, @label, @genre, @name, @followers, @popularity, @imageUrl, @externalUrl, @latestReleaseJson, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      followers = excluded.followers,
      popularity = excluded.popularity,
      image_url = excluded.image_url,
      external_url = excluded.external_url,
      latest_release_json = excluded.latest_release_json,
      updated_at = excluded.updated_at
  `);
  const insertMany = db.transaction((list) => {
    for (const a of list) {
      stmt.run({ ...a, latestReleaseJson: JSON.stringify(a.latestRelease) });
    }
  });
  insertMany(artists);
}

// ── YouTube helpers ───────────────────────────────────────────────────────────
function upsertYoutube({ channels, videos }) {
  const chStmt = db.prepare(`
    INSERT INTO yt_channels (id, title, description, custom_url, thumbnail_url,
      subscriber_count, video_count, view_count, updated_at)
    VALUES (@id,@title,@description,@customUrl,@thumbnailUrl,
      @subscriberCount,@videoCount,@viewCount,datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      title=excluded.title, description=excluded.description,
      custom_url=excluded.custom_url, thumbnail_url=excluded.thumbnail_url,
      subscriber_count=excluded.subscriber_count, video_count=excluded.video_count,
      view_count=excluded.view_count, updated_at=excluded.updated_at
  `);
  const vidStmt = db.prepare(`
    INSERT INTO yt_videos (id,title,description,published_at,channel_id,channel_title,
      thumbnail_url,embed_url,watch_url,updated_at)
    VALUES (@id,@title,@description,@publishedAt,@channelId,@channelTitle,
      @thumbnailUrl,@embedUrl,@watchUrl,datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      title=excluded.title, description=excluded.description,
      thumbnail_url=excluded.thumbnail_url, embed_url=excluded.embed_url,
      watch_url=excluded.watch_url, updated_at=excluded.updated_at
  `);
  db.transaction(() => {
    channels.forEach(c => chStmt.run(c));
    videos.forEach(v => vidStmt.run(v));
  })();
}

function getYtVideos(limit = 12) {
  return db.prepare('SELECT * FROM yt_videos ORDER BY published_at DESC LIMIT ?').all(limit);
}
function getYtChannels() {
  return db.prepare('SELECT * FROM yt_channels').all();
}

// ── YouTube sync ──────────────────────────────────────────────────────────────
async function runYoutubeSync() {
  console.log('[Sync] Starting YouTube sync…');
  try {
    const data = await youtube.syncAll();
    if (data) {
      upsertYoutube(data);
      console.log(`[Sync] YouTube: ${data.channels.length} channels, ${data.videos.length} videos`);
    }
  } catch (err) {
    console.error('[Sync] YouTube error:', err.message);
  }
}

// ── Spotify sync ──────────────────────────────────────────────────────────────
async function runSpotifySync() {
  console.log('[Sync] Starting Spotify sync…');
  try {
    const artists = await spotify.syncAll();
    if (artists && artists.length) {
      upsertArtists(artists);
      db.prepare("INSERT INTO sync_log (status) VALUES ('ok')").run();
      console.log(`[Sync] Updated ${artists.length} artists`);
    }
  } catch (err) {
    db.prepare("INSERT INTO sync_log (status) VALUES ('error')").run();
    console.error('[Sync] Error:', err.message);
  }
}

// Run immediately on start, then every hour
runSpotifySync();
runYoutubeSync();
cron.schedule('0 * * * *', () => { runSpotifySync(); runYoutubeSync(); });

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors({ origin: process.env.FRONTEND_ORIGIN || '*' }));
app.use(express.json());

// ── Routes ────────────────────────────────────────────────────────────────────

// GET /api/artists — all artist profiles with latest stats
app.get('/api/artists', (_req, res) => {
  const artists = getArtists();
  // Fallback: if DB is empty (Spotify not configured), return static data
  if (!artists.length) {
    return res.json(spotify.ARTISTS.map(a => ({
      id: a.id,
      label: a.label,
      genre: a.genre,
      name: a.label,
      followers: 0,
      externalUrl: `https://open.spotify.com/artist/${a.id}`,
      latestRelease: null,
    })));
  }
  res.json(artists);
});

// GET /api/latest-release — newest single/album across all profiles
app.get('/api/latest-release', (_req, res) => {
  const artists = getArtists();
  let latest = null;
  for (const a of artists) {
    if (!a.latestRelease) continue;
    if (!latest || a.latestRelease.releaseDate > latest.releaseDate) {
      latest = { ...a.latestRelease, artistLabel: a.label, artistGenre: a.genre };
    }
  }
  if (!latest) return res.json(null);
  res.json(latest);
});

// GET /api/tracks — radio playlist from tracks.json
app.get('/api/tracks', (_req, res) => {
  res.json(getTracks());
});

// GET /api/youtube/videos — latest videos across all channels
app.get('/api/youtube/videos', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '12', 10), 50);
  const videos = getYtVideos(limit);
  res.json(videos);
});

// GET /api/youtube/latest — single most recent video
app.get('/api/youtube/latest', (_req, res) => {
  const video = db.prepare('SELECT * FROM yt_videos ORDER BY published_at DESC LIMIT 1').get();
  res.json(video || null);
});

// GET /api/youtube/channels — channel stats
app.get('/api/youtube/channels', (_req, res) => {
  res.json(getYtChannels());
});

// GET /api/stats — quick dashboard stats
app.get('/api/stats', (_req, res) => {
  const artists  = getArtists();
  const lastSync = db.prepare("SELECT synced_at FROM sync_log ORDER BY id DESC LIMIT 1").get();
  res.json({
    totalArtists: artists.length,
    totalFollowers: artists.reduce((s, a) => s + (a.followers || 0), 0),
    lastSync: lastSync?.synced_at || null,
  });
});

// Health check
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => console.log(`[Backend] RAYVER API running on port ${PORT}`));
