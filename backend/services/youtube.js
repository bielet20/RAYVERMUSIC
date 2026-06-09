const fetch = require('node-fetch');

const API_KEY = process.env.YOUTUBE_API_KEY;
const BASE    = 'https://www.googleapis.com/youtube/v3';

// Channel IDs — set via YOUTUBE_CHANNEL_IDS env var (comma-separated)
// e.g.  YOUTUBE_CHANNEL_IDS=UCxxxMain,UCxxxSecond
const CHANNEL_IDS = (process.env.YOUTUBE_CHANNEL_IDS || '')
  .split(',').map(s => s.trim()).filter(Boolean);

async function get(path, params) {
  const url = new URL(`${BASE}${path}`);
  url.searchParams.set('key', API_KEY);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString());
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`YouTube API ${res.status}: ${err?.error?.message || res.statusText}`);
  }
  return res.json();
}

async function fetchChannelInfo(channelId) {
  const data = await get('/channels', {
    part: 'snippet,statistics,brandingSettings',
    id: channelId,
  });
  const ch = data.items?.[0];
  if (!ch) return null;
  return {
    id: ch.id,
    title: ch.snippet.title,
    description: ch.snippet.description,
    customUrl: ch.snippet.customUrl || null,
    thumbnailUrl: ch.snippet.thumbnails?.high?.url || ch.snippet.thumbnails?.default?.url,
    subscriberCount: parseInt(ch.statistics.subscriberCount || '0', 10),
    videoCount: parseInt(ch.statistics.videoCount || '0', 10),
    viewCount: parseInt(ch.statistics.viewCount || '0', 10),
    uploadsPlaylistId: ch.contentDetails?.relatedPlaylists?.uploads || null,
  };
}

async function fetchLatestVideos(channelId, maxResults = 6) {
  // Use search endpoint to get latest uploads sorted by date
  const data = await get('/search', {
    part: 'snippet',
    channelId,
    order: 'date',
    type: 'video',
    maxResults,
    videoCategoryId: '10', // Music category (broadens to all if empty)
  });

  return (data.items || []).map(item => ({
    id: item.id.videoId,
    title: item.snippet.title,
    description: item.snippet.description,
    publishedAt: item.snippet.publishedAt,
    channelId: item.snippet.channelId,
    channelTitle: item.snippet.channelTitle,
    thumbnailUrl: item.snippet.thumbnails?.high?.url
      || item.snippet.thumbnails?.medium?.url
      || item.snippet.thumbnails?.default?.url,
    embedUrl: `https://www.youtube.com/embed/${item.id.videoId}`,
    watchUrl: `https://www.youtube.com/watch?v=${item.id.videoId}`,
  }));
}

async function syncAll() {
  if (!API_KEY) {
    console.warn('[YouTube] YOUTUBE_API_KEY not set — skipping sync');
    return null;
  }
  if (!CHANNEL_IDS.length) {
    console.warn('[YouTube] YOUTUBE_CHANNEL_IDS not set — skipping sync');
    return null;
  }

  const channels = [];
  const videos   = [];

  for (const channelId of CHANNEL_IDS) {
    try {
      const [info, latest] = await Promise.all([
        fetchChannelInfo(channelId),
        fetchLatestVideos(channelId, 6),
      ]);
      if (info) channels.push(info);
      videos.push(...latest);
    } catch (err) {
      console.error(`[YouTube] Error syncing channel ${channelId}:`, err.message);
    }
  }

  // Sort all videos by date desc across all channels
  videos.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

  return { channels, videos };
}

module.exports = { syncAll, CHANNEL_IDS };
