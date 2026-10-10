// Built-in Pirate Bay addon.
// Implements the Stremio addon protocol (manifest + stream resource) in-process,
// using the public apibay.org JSON API. Exposed to the renderer as fusion://piratebay/...

const APIBAY = 'https://apibay.org/q.php';
const CINEMETA = 'https://v3-cinemeta.strem.io/meta';
const EMPTY_HASH = /^0+$/;

export const manifest = {
  id: 'fusion.piratebay',
  version: '1.0.0',
  name: 'The Pirate Bay',
  description: 'Torrent streams searched directly on The Pirate Bay (apibay). Built into FusionStream.',
  logo: '',
  resources: ['stream'],
  types: ['movie', 'series'],
  idPrefixes: ['tt'],
  catalogs: []
};

const cache = new Map(); // id -> { at, streams }
const CACHE_MS = 10 * 60 * 1000;

async function getJson(url) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(15000),
    headers: { 'User-Agent': 'FusionStream/2.0' }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const pad = (n) => String(n).padStart(2, '0');
const clean = (s) => String(s).replace(/['’]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

function fmtSize(bytes) {
  const gb = bytes / 1024 ** 3;
  return gb >= 1 ? `${gb.toFixed(2)} GB` : `${(bytes / 1024 ** 2).toFixed(0)} MB`;
}

function quality(name) {
  const n = name.toLowerCase();
  if (/2160p|\b4k\b|uhd/.test(n)) return '4k';
  for (const q of ['1080p', '720p', '480p']) if (n.includes(q)) return q;
  return '';
}

async function search(query) {
  const list = await getJson(`${APIBAY}?q=${encodeURIComponent(query)}&cat=200`);
  return (Array.isArray(list) ? list : []).filter((t) => t.info_hash && !EMPTY_HASH.test(t.info_hash) && Number(t.seeders) > 0);
}

function toStream(t) {
  const q = quality(t.name);
  return {
    name: `PirateBay\n${q || 'SD'}`,
    title: `${t.name}\n👤 ${t.seeders} 💾 ${fmtSize(Number(t.size))} ⚙️ ThePirateBay`,
    infoHash: t.info_hash.toLowerCase(),
    behaviorHints: { bingeGroup: `piratebay|${q}` }
  };
}

async function movieStreams(imdb) {
  const { meta } = await getJson(`${CINEMETA}/movie/${imdb}.json`);
  if (!meta?.name) return [];
  const year = String(meta.releaseInfo || meta.year || '').slice(0, 4);
  let results = await search(`${clean(meta.name)} ${year}`.trim());
  if (!results.length) results = await search(clean(meta.name));
  // Keep exact IMDb matches; for untagged uploads require the year in the name.
  return results.filter((t) => t.imdb === imdb || (!t.imdb && (!year || t.name.includes(year))));
}

async function episodeStreams(imdb, season, episode) {
  const { meta } = await getJson(`${CINEMETA}/series/${imdb}.json`);
  if (!meta?.name) return [];
  const tag = `S${pad(season)}E${pad(episode)}`;
  const results = await search(`${clean(meta.name)} ${tag}`);
  // Single-episode releases only: season packs would need per-file selection.
  const re = new RegExp(`\\bS0?${season}E0?${episode}(?!\\d)|\\b${season}x${pad(episode)}\\b`, 'i');
  return results.filter((t) => re.test(t.name) && (!t.imdb || t.imdb === imdb));
}

export async function handle(path) {
  // path examples: /manifest.json, /stream/movie/tt0111161.json, /stream/series/tt0903747:1:1.json
  if (path === '/manifest.json') return manifest;

  const m = path.match(/^\/stream\/(movie|series)\/([^/]+)\.json$/);
  if (!m) throw new Error('Not found');
  const [, type, rawId] = m;
  const id = decodeURIComponent(rawId);

  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < CACHE_MS) return { streams: hit.streams };

  let torrents = [];
  if (type === 'movie' && /^tt\d+$/.test(id)) {
    torrents = await movieStreams(id);
  } else if (type === 'series') {
    const [imdb, s, e] = id.split(':');
    if (/^tt\d+$/.test(imdb) && Number(s) >= 0 && Number(e) > 0) torrents = await episodeStreams(imdb, Number(s), Number(e));
  }

  const streams = torrents
    .sort((a, b) => Number(b.seeders) - Number(a.seeders))
    .slice(0, 30)
    .map(toStream);
  cache.set(id, { at: Date.now(), streams });
  return { streams };
}
