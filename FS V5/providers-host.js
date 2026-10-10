// FusionStream provider system (main process).
//
// Providers live in the FusionStream git repo under /providers:
//   providers/index.json            -> { "version": N, "providers": ["vidlink", "eztv", ...] }
//   providers/<id>/provider.json    -> metadata + type ("embed" or "script")
//   providers/<id>/index.js         -> only for "script" providers: defines getStreams(args, helpers)
//
// Sources, in order of preference (highest index.version wins):
//   1. Cached copy downloaded from GitHub (userData/providers-cache)
//   2. Bundled copy shipped with the app (resources/providers, or ../providers in dev)
//
// Security:
//   - Script providers run in a hidden, sandboxed Chromium renderer (no Node, no app APIs).
//     Their output is validated before it reaches the app.
//   - Embed providers open in a separate sandboxed window with its own session, an
//     ad/tracker blocker, popups denied and top-level navigation locked to the provider's hosts.

import { app, BrowserWindow, session } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { ElectronBlocker } from '@ghostery/adblocker-electron';

const REPO_RAW = 'https://raw.githubusercontent.com/AlphaNodesDev/FusionStream/main/providers';
const ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const SCRIPT_TIMEOUT_MS = 20000;
const EMBED_PARTITION = 'persist:fusion-embed';
const SANDBOX_PARTITION = 'fusion-provider-sandbox';

let providers = [];
let info = { source: 'none', version: 0, updatedAt: null, error: null };
let overrides = new Map();
let iconPath = null;

const bundledDir = () => (app.isPackaged ? path.join(process.resourcesPath, 'providers') : path.join(app.getAppPath(), '..', 'providers'));
const cacheDir = () => path.join(app.getPath('userData'), 'providers-cache');

// ---------------------------------------------------------------------------
// Loading & validation
// ---------------------------------------------------------------------------
function hostOf(url) {
  try { return new URL(url).hostname.toLowerCase(); } catch { return ''; }
}

function normalize(id, def, scriptSource) {
  if (!ID_RE.test(id) || !def || typeof def !== 'object') return null;
  const type = def.type === 'script' ? 'script' : def.type === 'embed' ? 'embed' : null;
  if (!type) return null;
  const types = (Array.isArray(def.types) ? def.types : ['movie', 'series']).filter((t) => t === 'movie' || t === 'series');
  const p = {
    id,
    name: String(def.name || id).slice(0, 40),
    description: String(def.description || '').slice(0, 300),
    type,
    types,
    enabledByDefault: def.enabled !== false
  };
  if (type === 'embed') {
    const embed = {};
    for (const t of types) {
      const tpl = def.embed?.[t];
      if (typeof tpl === 'string' && /^https:\/\//i.test(tpl)) embed[t] = tpl;
    }
    if (!Object.keys(embed).length) return null;
    p.embed = embed;
    const hosts = Array.isArray(def.allowedHosts) ? def.allowedHosts : Object.values(embed).map(hostOf);
    p.allowedHosts = [...new Set(hosts.map((h) => String(h).toLowerCase()).filter(Boolean))];
  } else {
    if (typeof scriptSource !== 'string' || !scriptSource.includes('getStreams')) return null;
    p.scriptSource = scriptSource;
  }
  return p;
}

function readLocalSet(dir) {
  const index = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
  const list = [];
  for (const id of Array.isArray(index.providers) ? index.providers : []) {
    if (!ID_RE.test(id)) continue;
    try {
      const def = JSON.parse(fs.readFileSync(path.join(dir, id, 'provider.json'), 'utf8'));
      const script = def.type === 'script'
        ? fs.readFileSync(path.join(dir, id, path.basename(def.script || 'index.js')), 'utf8')
        : null;
      const p = normalize(id, def, script);
      if (p) list.push(p); else console.warn('[providers] invalid provider', id);
    } catch (err) {
      console.warn('[providers] failed to load', id, err.message);
    }
  }
  return { version: Number(index.version) || 0, list };
}

export function loadProviders() {
  let bundled = null;
  let cached = null;
  try { bundled = readLocalSet(bundledDir()); } catch (err) { console.warn('[providers] no bundled providers:', err.message); }
  try { cached = readLocalSet(cacheDir()); } catch { /* no cache yet */ }

  const pick = cached && (!bundled || cached.version > bundled.version) ? ['github', cached] : bundled ? ['bundled', bundled] : null;
  providers = pick ? pick[1].list : [];
  info = { ...info, source: pick ? pick[0] : 'none', version: pick ? pick[1].version : 0 };
  return providers;
}

async function getRemote(url, asText) {
  const res = await fetch(url, { signal: AbortSignal.timeout(15000), cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url.replace(REPO_RAW, 'providers')}`);
  return asText ? res.text() : res.json();
}

// Downloads the provider set from GitHub into the cache, then reloads.
export async function updateFromGitHub({ force = false } = {}) {
  try {
    const index = await getRemote(`${REPO_RAW}/index.json`);
    const version = Number(index.version) || 0;
    if (!force && version <= info.version) {
      info = { ...info, updatedAt: Date.now(), error: null };
      return { updated: false, ...publicInfo() };
    }
    const tmp = cacheDir() + '.tmp';
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.mkdirSync(tmp, { recursive: true });
    const ids = (Array.isArray(index.providers) ? index.providers : []).filter((id) => ID_RE.test(id));
    for (const id of ids) {
      const def = await getRemote(`${REPO_RAW}/${id}/provider.json`);
      fs.mkdirSync(path.join(tmp, id), { recursive: true });
      fs.writeFileSync(path.join(tmp, id, 'provider.json'), JSON.stringify(def, null, 2));
      if (def.type === 'script') {
        const file = path.basename(def.script || 'index.js');
        fs.writeFileSync(path.join(tmp, id, file), await getRemote(`${REPO_RAW}/${id}/${encodeURIComponent(file)}`, true));
      }
    }
    fs.writeFileSync(path.join(tmp, 'index.json'), JSON.stringify({ ...index, providers: ids }, null, 2));
    fs.rmSync(cacheDir(), { recursive: true, force: true });
    fs.renameSync(tmp, cacheDir());
    loadProviders();
    info = { ...info, updatedAt: Date.now(), error: null };
    return { updated: true, ...publicInfo() };
  } catch (err) {
    info = { ...info, error: err.message };
    return { updated: false, ...publicInfo() };
  }
}

// User on/off choices: { [providerId]: boolean }. Missing = provider's default.
export function setOverrides(map) {
  overrides = new Map(Object.entries(map && typeof map === 'object' ? map : {}).filter(([, v]) => typeof v === 'boolean'));
}

export function setIcon(p) { iconPath = p; }

const isEnabled = (p) => (overrides.has(p.id) ? overrides.get(p.id) : p.enabledByDefault);

export function publicInfo() {
  return {
    ...info,
    repo: 'https://github.com/AlphaNodesDev/FusionStream/tree/main/providers',
    providers: providers.map((p) => ({
      id: p.id, name: p.name, description: p.description, type: p.type, types: p.types, enabled: isEnabled(p)
    }))
  };
}

// ---------------------------------------------------------------------------
// Title info (IMDb -> TMDB id, name, year) via Cinemeta, cached
// ---------------------------------------------------------------------------
const metaCache = new Map();

async function titleInfo(type, imdb) {
  const key = `${type}/${imdb}`;
  if (!metaCache.has(key)) {
    metaCache.set(key, fetch(`https://v3-cinemeta.strem.io/meta/${type}/${imdb}.json`, { signal: AbortSignal.timeout(15000) })
      .then((r) => (r.ok ? r.json() : {}))
      .then(({ meta = {} }) => ({
        tmdb: meta.moviedb_id ? String(meta.moviedb_id) : '',
        name: meta.name || '',
        year: String(meta.releaseInfo || meta.year || '').slice(0, 4),
        genres: meta.genres || meta.genre || []
      }))
      .catch(() => { metaCache.delete(key); return { tmdb: '', name: '', year: '', genres: [] }; }));
  }
  return metaCache.get(key);
}

function parseId(type, id) {
  const [imdb, s, e] = String(id).split(':');
  if (!/^tt\d+$/.test(imdb)) return null;
  if (type === 'series') {
    const season = Number(s);
    const episode = Number(e);
    if (!Number.isInteger(season) || !Number.isInteger(episode) || episode < 1) return null;
    return { imdb, season, episode };
  }
  return { imdb };
}

function fillTemplate(tpl, vars) {
  let missing = false;
  const url = tpl.replace(/\{(imdb|tmdb|season|episode)\}/g, (_, k) => {
    const v = vars[k];
    if (v === undefined || v === null || v === '') { missing = true; return ''; }
    return encodeURIComponent(String(v));
  });
  return missing ? null : url;
}

// ---------------------------------------------------------------------------
// Script sandbox: hidden, sandboxed renderer without Node or app APIs.
// webSecurity is off only in this isolated window so scripts can call site APIs without CORS.
// ---------------------------------------------------------------------------
let sandboxWin = null;
let sandboxReady = null;

function getSandbox() {
  if (sandboxWin && !sandboxWin.isDestroyed()) return sandboxReady;
  sandboxWin = new BrowserWindow({
    show: false,
    webPreferences: {
      partition: SANDBOX_PARTITION,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
      images: false
    }
  });
  sandboxWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  sandboxWin.webContents.on('will-navigate', (e) => e.preventDefault());
  sandboxWin.on('closed', () => { sandboxWin = null; });
  sandboxReady = sandboxWin.loadURL('about:blank').then(() => sandboxWin);
  return sandboxReady;
}

async function runScript(p, args) {
  const win = await getSandbox();
  const code = `(async () => {
    const src = ${JSON.stringify(p.scriptSource)};
    const args = Object.freeze(${JSON.stringify(args)});
    const check = (r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r; };
    const helpers = Object.freeze({
      fetchText: async (u, o) => (await check(await fetch(u, o))).text(),
      fetchJson: async (u, o) => (await check(await fetch(u, o))).json(),
      parseHTML: (h) => new DOMParser().parseFromString(h, 'text/html'),
      parseXML: (x) => new DOMParser().parseFromString(x, 'text/xml')
    });
    const getStreams = new Function('helpers', src + '\\n;return typeof getStreams === "function" ? getStreams : null;')(helpers);
    if (!getStreams) throw new Error('script has no getStreams()');
    const out = await getStreams(args, helpers);
    return JSON.parse(JSON.stringify(Array.isArray(out) ? out.slice(0, 100) : []));
  })()`;
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timed out')), SCRIPT_TIMEOUT_MS); });
  try {
    return await Promise.race([win.webContents.executeJavaScript(code, true), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

// Only well-formed torrent or http(s) streams get through.
function sanitizeStream(s, p) {
  if (!s || typeof s !== 'object') return null;
  const out = {
    name: String(s.name || p.name).slice(0, 60),
    title: String(s.title || '').slice(0, 400),
    _providerId: p.id
  };
  if (typeof s.infoHash === 'string' && /^[a-f0-9]{40}$/i.test(s.infoHash)) {
    out.infoHash = s.infoHash.toLowerCase();
    if (Number.isInteger(s.fileIdx) && s.fileIdx >= 0) out.fileIdx = s.fileIdx;
    if (Array.isArray(s.sources)) out.sources = s.sources.filter((x) => typeof x === 'string' && /^tracker:(udp|https?|wss?):\/\//.test(x)).slice(0, 30);
  } else if (typeof s.url === 'string' && /^https?:\/\//i.test(s.url)) {
    out.url = s.url;
  } else {
    return null;
  }
  const bh = s.behaviorHints || {};
  out.behaviorHints = {
    bingeGroup: typeof bh.bingeGroup === 'string' ? bh.bingeGroup.slice(0, 80) : `${p.id}`,
    ...(typeof bh.filename === 'string' ? { filename: bh.filename.slice(0, 200) } : {})
  };
  return out;
}

// ---------------------------------------------------------------------------
// Stremio-style addon endpoint: fusion://providers/...
// ---------------------------------------------------------------------------
export const manifest = {
  id: 'fusion.providers',
  version: '1.0.0',
  name: 'FusionStream Providers',
  description: 'Web players and extra torrent sources from the FusionStream provider repo. Used as a fallback when torrents are slow.',
  resources: ['stream'],
  types: ['movie', 'series'],
  idPrefixes: ['tt'],
  catalogs: []
};

export async function handle(pathname) {
  if (pathname === '/manifest.json') return manifest;
  const m = pathname.match(/^\/stream\/(movie|series)\/([^/]+)\.json$/);
  if (!m) throw new Error('Not found');
  const type = m[1];
  const ids = parseId(type, decodeURIComponent(m[2]));
  if (!ids) return { streams: [] };

  const active = providers.filter((p) => isEnabled(p) && p.types.includes(type));
  if (!active.length) return { streams: [] };
  const t = await titleInfo(type, ids.imdb);
  const vars = { ...ids, tmdb: t.tmdb };

  const embeds = active.filter((p) => p.type === 'embed').map((p) => {
    const url = fillTemplate(p.embed[type], vars);
    return url && {
      name: `${p.name}\nWEB`,
      title: `${p.name} web player\nInstant start · no peers needed · may show ads`,
      externalUrl: url,
      embed: true,
      _providerId: p.id,
      behaviorHints: { bingeGroup: `provider|${p.id}` }
    };
  }).filter(Boolean);

  const args = { type, ...vars, name: t.name, year: t.year, genres: t.genres };
  const scripted = await Promise.all(active.filter((p) => p.type === 'script').map(async (p) => {
    try {
      return (await runScript(p, args)).map((s) => sanitizeStream(s, p)).filter(Boolean);
    } catch (err) {
      console.warn(`[providers] ${p.id} failed:`, err.message);
      return [];
    }
  }));

  return { streams: [...scripted.flat(), ...embeds] };
}

// ---------------------------------------------------------------------------
// Embed player window
// ---------------------------------------------------------------------------
let blockerPromise = null;

function ensureBlocker(ses) {
  if (!blockerPromise) {
    const cache = path.join(app.getPath('userData'), 'adblock-engine.bin');
    blockerPromise = ElectronBlocker.fromPrebuiltAdsAndTracking(fetch, {
      path: cache,
      read: fs.promises.readFile,
      write: fs.promises.writeFile
    }).then((blocker) => {
      blocker.enableBlockingInSession(ses);
      return blocker;
    }).catch((err) => {
      console.warn('[providers] ad blocker unavailable:', err.message);
      blockerPromise = null;
      return null;
    });
  }
  return blockerPromise;
}

const hostAllowed = (url, hosts) => {
  const h = hostOf(url);
  return hosts.some((a) => h === a || h.endsWith('.' + a));
};

export async function openEmbed(providerId, url, title) {
  const p = providers.find((x) => x.id === providerId && x.type === 'embed');
  if (!p) throw new Error('Unknown web provider.');
  if (!/^https:\/\//i.test(url) || !hostAllowed(url, p.allowedHosts)) throw new Error('Blocked: URL does not belong to this provider.');

  const ses = session.fromPartition(EMBED_PARTITION);
  await ensureBlocker(ses);

  const win = new BrowserWindow({
    width: 1280,
    height: 760,
    title: `${title || 'FusionStream'} · ${p.name}`,
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    ...(iconPath ? { icon: iconPath } : {}),
    webPreferences: {
      partition: EMBED_PARTITION,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.removeMenu();
  win.on('page-title-updated', (e) => e.preventDefault());
  // Popups/new tabs are where most ads live: block them all.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  // Keep the window on the provider's site; ads often try to redirect the whole page.
  win.webContents.on('will-navigate', (e, target) => {
    if (!hostAllowed(target, p.allowedHosts)) e.preventDefault();
  });
  win.webContents.on('will-redirect', (e) => {
    if (e.isMainFrame && !hostAllowed(e.url, p.allowedHosts)) e.preventDefault();
  });
  win.webContents.session.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'fullscreen'));
  await win.loadURL(url);
  return true;
}
