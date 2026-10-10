// Built-in "Public Domain Movies" addon (Internet Archive).
// Stremio addon protocol, in-process. Exposed to the renderer as fusion://archive/...
// Only items in the feature_films collection marked public domain are listed, and
// streams are direct MP4 links on archive.org, so everything here is legal to watch.

const SEARCH = 'https://archive.org/advancedsearch.php';
// Mature/exploitation titles are excluded so Store content stays within PEGI 12 (policy 11.1).
const EXCLUDE = '-subject:(exploitation OR sexploitation OR adult OR erotic OR nudity OR "sex hygiene" OR propaganda OR holocaust OR atrocities OR gore) -title:(sex OR madness OR reefer OR marihuana OR marijuana OR cocaine OR nude OR nazi OR concentration OR bloody OR gore)';
const BASE_QUERY = `collection:(feature_films) AND mediatype:(movies) AND (licenseurl:*publicdomain* OR rights:*public*domain*) ${EXCLUDE}`;
const PAGE = 50;
const ID_PREFIX = 'ia:';
const ID_RE = /^[A-Za-z0-9._-]{1,120}$/;

export const manifest = {
  id: 'fusion.archive',
  version: '1.0.0',
  name: 'Public Domain Movies',
  description: 'Classic films that are free to watch, from the Internet Archive feature film collection.',
  resources: ['catalog', 'meta', 'stream'],
  types: ['movie'],
  idPrefixes: [ID_PREFIX],
  catalogs: [
    {
      type: 'movie',
      id: 'archive-popular',
      name: 'Public Domain Classics',
      extra: [{ name: 'search' }, { name: 'skip' }, { name: 'genre', options: ['Comedy', 'Mystery', 'Drama', 'Sci-Fi', 'Western', 'Silent', 'Noir', 'Animation'] }]
    }
  ]
};

const GENRE_QUERY = {
  Comedy: 'subject:(comedy)', Mystery: 'subject:(mystery OR thriller)', Drama: 'subject:(drama)', 'Sci-Fi': 'subject:(science fiction OR sci-fi)',
  Western: 'subject:(western)', Silent: 'subject:(silent)', Noir: 'subject:(noir)', Animation: 'subject:(animation OR cartoon)'
};

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { 'User-Agent': 'FusionStream/2.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const first = (v) => (Array.isArray(v) ? v[0] : v);
const text = (v) => String(first(v) ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const thumb = (id) => `https://archive.org/services/img/${encodeURIComponent(id)}`;

function toMeta(d) {
  const year = text(d.year) || text(d.date).slice(0, 4);
  return {
    id: ID_PREFIX + d.identifier,
    type: 'movie',
    name: text(d.title) || d.identifier,
    poster: thumb(d.identifier),
    background: thumb(d.identifier),
    releaseInfo: year,
    description: text(d.description).slice(0, 600)
  };
}

function parseExtra(str) {
  const out = {};
  for (const part of String(str || '').split('&')) {
    const [k, v] = part.split('=');
    if (k) out[decodeURIComponent(k)] = decodeURIComponent(v || '');
  }
  return out;
}

async function catalog(extraStr) {
  const extra = parseExtra(extraStr);
  let q = BASE_QUERY;
  if (extra.search) q += ` AND title:(${extra.search.replace(/[^\p{L}\p{N}\s]/gu, ' ').trim()})`;
  if (GENRE_QUERY[extra.genre]) q += ` AND ${GENRE_QUERY[extra.genre]}`;
  const page = Math.floor((Number(extra.skip) || 0) / PAGE) + 1;
  const fields = ['identifier', 'title', 'year', 'date', 'description'].map((f) => `fl[]=${f}`).join('&');
  const url = `${SEARCH}?q=${encodeURIComponent(q)}&${fields}&sort[]=downloads+desc&rows=${PAGE}&page=${page}&output=json`;
  const res = await getJson(url);
  return { metas: (res.response?.docs || []).filter((d) => ID_RE.test(d.identifier)).map(toMeta) };
}

const metaCache = new Map();

async function itemMeta(identifier) {
  if (!metaCache.has(identifier)) {
    metaCache.set(identifier, getJson(`https://archive.org/metadata/${encodeURIComponent(identifier)}`).catch((err) => {
      metaCache.delete(identifier);
      throw err;
    }));
  }
  return metaCache.get(identifier);
}

function isPublicDomain(md) {
  return /publicdomain|public domain/i.test(`${text(md.licenseurl)} ${text(md.rights)}`) || /feature_films/.test(String(md.collection));
}

async function meta(id) {
  const identifier = id.slice(ID_PREFIX.length);
  if (!ID_RE.test(identifier)) throw new Error('Bad id');
  const item = await itemMeta(identifier);
  const md = item.metadata || {};
  const runtime = text(md.runtime);
  const genres = [].concat(md.subject || []).map(text).filter((s) => s && s.length < 24).slice(0, 4);
  return {
    meta: {
      ...toMeta({ identifier, title: md.title, year: md.year, date: md.date, description: md.description }),
      description: text(md.description).slice(0, 1500),
      runtime,
      genres,
      director: md.director ? [].concat(md.director).map(text) : undefined
    }
  };
}

async function streams(id) {
  const identifier = id.slice(ID_PREFIX.length);
  if (!ID_RE.test(identifier)) return { streams: [] };
  const item = await itemMeta(identifier);
  if (!isPublicDomain(item.metadata || {})) return { streams: [] };
  const files = (item.files || [])
    .filter((f) => /\.mp4$/i.test(f.name))
    .sort((a, b) => Number(b.size || 0) - Number(a.size || 0))
    .slice(0, 4);
  const host = item.d1 || item.server;
  return {
    streams: files.map((f) => {
      const url = host && item.dir
        ? `https://${host}${item.dir}/${encodeURIComponent(f.name)}`
        : `https://archive.org/download/${encodeURIComponent(identifier)}/${encodeURIComponent(f.name)}`;
      const mb = Number(f.size || 0) / 1024 ** 2;
      const size = mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${Math.round(mb)} MB`;
      const q = Number(f.height) >= 1000 ? '1080p' : Number(f.height) >= 700 ? '720p' : Number(f.height) >= 470 ? '480p' : '';
      return {
        name: `Archive\n${q || 'SD'}`,
        title: `${f.name}\n💾 ${size} ⚙️ Internet Archive (public domain)`,
        url,
        behaviorHints: { bingeGroup: 'archive' }
      };
    })
  };
}

export async function handle(path) {
  if (path === '/manifest.json') return manifest;
  let m = path.match(/^\/catalog\/movie\/archive-popular(?:\/([^/]+))?\.json$/);
  if (m) return catalog(m[1] ? decodeURIComponent(m[1]) : '');
  m = path.match(/^\/meta\/movie\/([^/]+)\.json$/);
  if (m) return meta(decodeURIComponent(m[1]));
  m = path.match(/^\/stream\/movie\/([^/]+)\.json$/);
  if (m) return streams(decodeURIComponent(m[1]));
  throw new Error('Not found');
}
