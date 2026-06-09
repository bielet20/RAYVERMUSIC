const fetch = require('node-fetch');

const CLIENT_ID     = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;

const ARTISTS = [
  { id: '0GmwWh84e70RNGNkYOwE6d', label: 'Perfil Principal',        genre: 'Electronic' },
  { id: '5nSppopCQHlvoqzITdo0D5', label: 'Trance & Celtic',         genre: 'Trance / Celtic' },
  { id: '0f0nSRoIlPdvZyPuBIZD8M', label: 'Cinematic & Emotional',   genre: 'Cinematic' },
  { id: '5GzN9yf1adZZKKUBFHArg5', label: 'Uplifting & Harmony',     genre: 'Uplifting' },
  { id: '5kOm7nsefS4UwlK9B11iom', label: 'Classical & Orchestral',  genre: 'Classical' },
];

let _token = null;
let _tokenExpires = 0;

async function getToken() {
  if (_token && Date.now() < _tokenExpires) return _token;
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64'),
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`Spotify token error: ${res.status}`);
  const data = await res.json();
  _token = data.access_token;
  _tokenExpires = Date.now() + (data.expires_in - 60) * 1000;
  return _token;
}

async function fetchArtist(id) {
  const token = await getToken();
  const res = await fetch(`https://api.spotify.com/v1/artists/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  return res.json();
}

async function fetchLatestRelease(artistId) {
  const token = await getToken();
  const res = await fetch(
    `https://api.spotify.com/v1/artists/${artistId}/albums?limit=1&include_groups=album,single&market=ES`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) return null;
  const data = await res.json();
  return data.items?.[0] || null;
}

async function syncAll() {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    console.warn('[Spotify] SPOTIFY_CLIENT_ID/SECRET not set — skipping sync');
    return null;
  }
  const results = [];
  for (const artist of ARTISTS) {
    try {
      const [info, latest] = await Promise.all([
        fetchArtist(artist.id),
        fetchLatestRelease(artist.id),
      ]);
      results.push({
        id: artist.id,
        label: artist.label,
        genre: artist.genre,
        name: info?.name || artist.label,
        followers: info?.followers?.total || 0,
        monthlyListeners: info?.followers?.total || 0,
        popularity: info?.popularity || 0,
        imageUrl: info?.images?.[0]?.url || null,
        externalUrl: info?.external_urls?.spotify || `https://open.spotify.com/artist/${artist.id}`,
        latestRelease: latest ? {
          id: latest.id,
          name: latest.name,
          releaseDate: latest.release_date,
          imageUrl: latest.images?.[0]?.url || null,
          externalUrl: latest.external_urls?.spotify,
          type: latest.album_type,
        } : null,
      });
    } catch (err) {
      console.error(`[Spotify] Error syncing artist ${artist.id}:`, err.message);
    }
  }
  return results;
}

module.exports = { syncAll, ARTISTS };
