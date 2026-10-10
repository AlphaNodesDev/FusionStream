'use strict';
/* FusionStream V5 renderer.
 * Works like Stremio: everything (catalogs, metadata, streams, subtitles) comes
 * from installed addons that implement the Stremio addon protocol.
 * Defaults: Cinemeta (catalog + meta), Torrentio (streams), OpenSubtitles v3 (subtitles).
 */

const api = window.fusion;
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeUrl = (u) => (typeof u === 'string' && /^https?:\/\//i.test(u) ? u : '');
// Built-in addons have no remote logo; use a bundled one.
const addonLogo = (a) => {
  const u = a.transportUrl || a.url || '';
  if (safeUrl(a.manifest?.logo)) return a.manifest.logo;
  if (u.startsWith('fusion://piratebay')) return 'assets/piratebay.svg';
  if (u.startsWith('fusion://archive')) return 'assets/logo.png';
  if (u.startsWith('fusion://providers')) return 'assets/logo.png';
  return '';
};

// Web-player streams (from FusionStream providers) open in a sandboxed window.
const isEmbed = (s) => Boolean(s?.embed && s._providerId && safeUrl(s.externalUrl));
const encId = (id) => encodeURIComponent(id).replace(/%3A/gi, ':');

// ---------------------------------------------------------------------------
// Persistent storage
// ---------------------------------------------------------------------------
const store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem('fs.' + key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    localStorage.setItem('fs.' + key, JSON.stringify(value));
  }
};

const settings = Object.assign(
  { subLang: 'eng', autoSubs: false, playerPath: '' },
  store.get('settings', {})
);
const saveSettings = () => store.set('settings', settings);

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------
let toastTimer;
function toast(msg, isError = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.toggle('error', isError);
  el.setAttribute('role', isError ? 'alert' : 'status');
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 4000);
}

// Hide broken images so the text placeholder underneath shows instead.
document.addEventListener('error', (e) => {
  if (e.target instanceof HTMLImageElement) e.target.remove();
}, true);

// ---------------------------------------------------------------------------
// Addon system (Stremio addon protocol)
// ---------------------------------------------------------------------------
const CINEMETA = 'https://v3-cinemeta.strem.io/manifest.json';
const TORRENTIO = 'https://torrentio.strem.fun/manifest.json';
const OPENSUBS = 'https://opensubtitles-v3.strem.io/manifest.json';
const PIRATEBAY = 'fusion://piratebay/manifest.json';
const PROVIDERS = 'fusion://providers/manifest.json';
// Set in init() from the main process. Store edition = Microsoft Store package.
let STORE_EDITION = false;
// Public-domain films from Internet Archive: a legal, working default for the Store edition.
const ARCHIVE = 'fusion://archive/manifest.json';
const FULL_DEFAULTS = [CINEMETA, TORRENTIO, PIRATEBAY, PROVIDERS, OPENSUBS];
const STORE_DEFAULTS = [CINEMETA, ARCHIVE, OPENSUBS];
let DEFAULT_ADDONS = FULL_DEFAULTS;
const FULL_RECOMMENDED = [
  { url: TORRENTIO, name: 'Torrentio', description: 'Torrent streams from YTS, EZTV, 1337x, TPB, Nyaa and more.' },
  { url: PIRATEBAY, name: 'The Pirate Bay', description: 'Built-in: searches The Pirate Bay directly for more torrent streams.' },
  { url: PROVIDERS, name: 'FusionStream Providers', description: 'Built-in: web players and extra torrent sites from the FusionStream repo.' },
  { url: CINEMETA, name: 'Cinemeta', description: 'Official catalogs and metadata for movies and series.' },
  { url: OPENSUBS, name: 'OpenSubtitles v3', description: 'Subtitles in many languages.' }
];
const STORE_RECOMMENDED = [
  { url: ARCHIVE, name: 'Public Domain Movies', description: 'Built-in: classic films that are free to watch, from Internet Archive.' },
  { url: CINEMETA, name: 'Cinemeta', description: 'Catalogs and information for movies and series.' },
  { url: OPENSUBS, name: 'OpenSubtitles v3', description: 'Subtitles in many languages.' }
];
let RECOMMENDED = FULL_RECOMMENDED;

const PRIVACY_URL = 'https://github.com/AlphaNodesDev/FusionStream/blob/main/PRIVACY.md';

let addons = []; // [{ transportUrl, manifest, error? }]

function normalizeAddonUrl(input) {
  let u = String(input || '').trim();
  if (u === PIRATEBAY || u === PROVIDERS || u === ARCHIVE) return u;
  if (/^fusionstream:\/\//i.test(u)) return linkToManifestUrl(u);
  if (u.startsWith('stremio://')) u = 'https://' + u.slice('stremio://'.length);
  if (!/^https?:\/\//i.test(u)) throw new Error('Addon URL must start with https:// or stremio://');
  if (!/\/manifest\.json$/i.test(u.split('?')[0])) u = u.replace(/\/+$/, '') + '/manifest.json';
  return u;
}

const addonBase = (a) => a.transportUrl.replace(/\/manifest\.json(\?.*)?$/i, '');

async function fetchManifest(url) {
  const m = await api.fetchJson(url);
  if (!m || !m.id || !m.name || !Array.isArray(m.resources)) {
    throw new Error('That URL is not a valid Stremio addon manifest.');
  }
  return m;
}

function saveAddons() {
  store.set('addons', addons.map(({ transportUrl, manifest }) => ({ transportUrl, manifest })));
}

async function loadAddons() {
  // Before first-run setup, start empty so the user picks a pack instead of getting defaults silently.
  if (!store.get('setupDone', false) && localStorage.getItem('fs.addons') === null && store.get('seenDefaults', null) === null) {
    addons = [];
    store.set('seenDefaults', DEFAULT_ADDONS);
    return;
  }
  let saved = store.get('addons', null) || DEFAULT_ADDONS.map((transportUrl) => ({ transportUrl, manifest: null }));
  // Built-in full-edition addons don't exist in the Store edition.
  if (STORE_EDITION) saved = saved.filter((a) => a.transportUrl !== PIRATEBAY && a.transportUrl !== PROVIDERS && a.transportUrl !== TORRENTIO);
  // One-time migration: add newly bundled default addons to existing installs.
  const seenDefaults = store.get('seenDefaults', []);
  for (const url of DEFAULT_ADDONS) {
    if (!seenDefaults.includes(url) && !saved.some((a) => a.transportUrl === url)) saved.push({ transportUrl: url, manifest: null });
  }
  store.set('seenDefaults', DEFAULT_ADDONS);
  addons = saved;
  const refresh = async (a) => {
    try {
      a.manifest = await fetchManifest(a.transportUrl);
      delete a.error;
    } catch (err) {
      a.error = err.message;
    }
  };
  // Addons without a cached manifest must load before the first render;
  // cached ones refresh in the background.
  await Promise.all(addons.filter((a) => !a.manifest).map(refresh));
  Promise.all(addons.filter((a) => a.manifest).map(refresh)).then(saveAddons);
  saveAddons();
}

// ---------------------------------------------------------------------------
// Addon Store: curated list hosted in the FusionStream repo (addons/catalog.json)
// ---------------------------------------------------------------------------
const ADDON_CATALOG_URL = 'https://raw.githubusercontent.com/AlphaNodesDev/FusionStream/main/addons/catalog.json';
// Used when GitHub can't be reached (or before the file is pushed).
const FALLBACK_CATALOG = {
  version: 0,
  categories: [{ id: 'official', name: 'FusionStream' }, { id: 'catalogs', name: 'Catalogs & info' }, { id: 'subtitles', name: 'Subtitles' }],
  addons: [
    { id: 'fusion.archive', name: 'Public Domain Movies', description: 'Classic films that are free to watch, from Internet Archive.', url: ARCHIVE, category: 'official', store: true, builtin: true },
    { id: 'cinemeta', name: 'Cinemeta', description: 'Movies and series with full information and artwork.', url: CINEMETA, category: 'catalogs', store: true },
    { id: 'opensubtitles', name: 'OpenSubtitles', description: 'Subtitles in many languages.', url: OPENSUBS, category: 'subtitles', store: true }
  ],
  packs: [{ id: 'starter', name: 'Starter pack', description: 'Catalogs, information, subtitles and free movies.', addons: ['fusion.archive', 'cinemeta', 'opensubtitles'], store: true }]
};
let addonCatalog = null;

async function loadAddonCatalog(force = false) {
  if (addonCatalog && !force) return addonCatalog;
  let cat;
  try {
    cat = await api.fetchJson(ADDON_CATALOG_URL);
    if (!Array.isArray(cat?.addons)) throw new Error('bad catalog');
    store.set('addonCatalog', cat);
  } catch {
    cat = store.get('addonCatalog', null) || FALLBACK_CATALOG;
  }
  // Store edition only lists addons marked as allowed there.
  const allowed = (x) => !STORE_EDITION || x.store === true;
  const addonsList = (cat.addons || []).filter((a) => a && a.id && a.name && typeof a.url === 'string' && allowed(a));
  const ids = new Set(addonsList.map((a) => a.id));
  addonCatalog = {
    ...cat,
    addons: addonsList,
    packs: (cat.packs || []).filter((p) => allowed(p) && Array.isArray(p.addons)).map((p) => ({ ...p, addons: p.addons.filter((id) => ids.has(id)) }))
  };
  return addonCatalog;
}

function isInstalledUrl(url) {
  return addons.some((a) => a.transportUrl === url || (a.manifest && a.transportUrl.replace(/\/manifest\.json$/, '') === url.replace(/\/manifest\.json$/, '')));
}

// Installs several addons in one go (used by packs and first-run setup).
async function installMany(urls, onProgress) {
  let ok = 0;
  const failed = [];
  for (const url of urls) {
    if (isInstalledUrl(url)) { ok++; onProgress?.(ok + failed.length, urls.length); continue; }
    try { await installAddon(url); ok++; } catch (err) { failed.push(url); console.warn('install failed', url, err.message); }
    onProgress?.(ok + failed.length, urls.length);
  }
  return { ok, failed };
}

async function installAddon(input) {
  const url = normalizeAddonUrl(input);
  const manifest = await fetchManifest(url);
  const existing = addons.findIndex((a) => a.manifest?.id === manifest.id || a.transportUrl === url);
  if (existing >= 0) addons[existing] = { transportUrl: url, manifest };
  else addons.push({ transportUrl: url, manifest });
  saveAddons();
  return manifest;
}

function uninstallAddon(url) {
  addons = addons.filter((a) => a.transportUrl !== url);
  saveAddons();
}

const activeAddons = () => addons.filter((a) => a.manifest);

function supports(a, resource, type, id) {
  const m = a.manifest;
  if (!m) return false;
  for (const r of m.resources) {
    const name = typeof r === 'string' ? r : r.name;
    if (name !== resource) continue;
    const types = (typeof r === 'object' && r.types) || m.types || [];
    if (type && !types.includes(type)) continue;
    const prefixes = (typeof r === 'object' && r.idPrefixes) || m.idPrefixes;
    if (id && Array.isArray(prefixes) && prefixes.length && !prefixes.some((p) => id.startsWith(p))) continue;
    return true;
  }
  return false;
}

function resourceUrl(a, resource, type, id, extra) {
  let url = `${addonBase(a)}/${resource}/${encodeURIComponent(type)}/${encId(id)}`;
  const extraStr = Object.entries(extra || {})
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  if (extraStr) url += '/' + extraStr;
  return url + '.json';
}

const addonGet = (a, resource, type, id, extra) => api.fetchJson(resourceUrl(a, resource, type, id, extra));

function catalogInfo(c) {
  const extra = Array.isArray(c.extra) ? c.extra : [];
  const required = extra.filter((e) => e.isRequired).map((e) => e.name).concat(c.extraRequired || []);
  const supported = extra.map((e) => e.name).concat(c.extraSupported || []);
  const genreExtra = extra.find((e) => e.name === 'genre');
  return { required, supported, genres: genreExtra?.options || c.genres || [] };
}

function allCatalogs() {
  const list = [];
  for (const a of activeAddons()) {
    for (const c of a.manifest.catalogs || []) {
      list.push({ addon: a, catalog: c, key: `${a.manifest.id}/${c.type}/${c.id}`, ...catalogInfo(c) });
    }
  }
  return list;
}

async function fetchCatalog(entry, extra = {}) {
  const res = await addonGet(entry.addon, 'catalog', entry.catalog.type, entry.catalog.id, extra);
  return Array.isArray(res?.metas) ? res.metas : [];
}

async function fetchMeta(type, id) {
  const candidates = activeAddons().filter((a) => supports(a, 'meta', type, id));
  for (const a of candidates) {
    try {
      const res = await addonGet(a, 'meta', type, id);
      if (res?.meta) return res.meta;
    } catch (err) {
      console.warn('meta failed', a.manifest.name, err.message);
    }
  }
  throw new Error('No installed addon could load details for this title.');
}

// Calls every stream addon in parallel; onGroup fires as each one answers.
function fetchStreams(type, id, onGroup) {
  const list = activeAddons().filter((a) => supports(a, 'stream', type, id));
  return Promise.all(list.map(async (a) => {
    try {
      const res = await addonGet(a, 'stream', type, id);
      const streams = (res?.streams || []).map((s) => ({ ...s, _addon: a.manifest.name }));
      onGroup?.(streams, a);
      return streams;
    } catch (err) {
      onGroup?.([], a, err);
      return [];
    }
  })).then((groups) => ({ streams: groups.flat(), addonCount: list.length }));
}

async function fetchSubtitles(type, id) {
  const list = activeAddons().filter((a) => supports(a, 'subtitles', type, id));
  const groups = await Promise.all(list.map(async (a) => {
    try {
      const res = await addonGet(a, 'subtitles', type, id);
      return (res?.subtitles || []).filter((s) => safeUrl(s.url));
    } catch {
      return [];
    }
  }));
  return groups.flat();
}

// ---------------------------------------------------------------------------
// Library & watch progress
// ---------------------------------------------------------------------------
const library = {
  all: () => store.get('library', {}),
  has: (id) => Boolean(library.all()[id]),
  toggle(meta) {
    const lib = library.all();
    if (lib[meta.id]) delete lib[meta.id];
    else lib[meta.id] = { id: meta.id, type: meta.type, name: meta.name, poster: meta.poster, added: Date.now() };
    store.set('library', lib);
    return Boolean(lib[meta.id]);
  }
};

const progress = {
  all: () => store.get('progress', {}),
  get: (videoId) => progress.all()[videoId],
  save(entry) {
    const all = progress.all();
    if (entry.duration && entry.time / entry.duration > 0.94) delete all[entry.videoId];
    else all[entry.videoId] = { ...entry, updated: Date.now() };
    store.set('progress', all);
  },
  // Most recent entry per title, newest first.
  continueList() {
    const latest = {};
    for (const p of Object.values(progress.all())) {
      if (!latest[p.metaId] || latest[p.metaId].updated < p.updated) latest[p.metaId] = p;
    }
    return Object.values(latest).sort((a, b) => b.updated - a.updated);
  },
  clear: () => store.set('progress', {})
};

// ---------------------------------------------------------------------------
// Rendering helpers
// ---------------------------------------------------------------------------
const view = $('#view');
let renderToken = 0; // increments on every navigation so stale async renders are dropped

function cardHtml(m, extra = {}) {
  const href = `#/detail/${encodeURIComponent(m.type)}/${encodeURIComponent(m.id)}${extra.videoId ? '/' + encodeURIComponent(extra.videoId) : ''}`;
  const poster = safeUrl(m.poster);
  const year = m.releaseInfo || m.year || '';
  const pct = extra.pct ? `<div class="progress"><div style="width:${Math.round(extra.pct * 100)}%"></div></div>` : '';
  const rating = m.imdbRating ? `<div class="rating" aria-hidden="true">${esc(m.imdbRating)}</div>` : '';
  return `<a class="card" href="${href}" aria-label="${esc(m.name)}${year ? ', ' + esc(year) : ''}">
    <div class="poster"><div class="ph">${esc(m.name)}</div>${poster ? `<img loading="lazy" src="${esc(poster)}" alt="">` : ''}${rating}
      <div class="poster-play" aria-hidden="true"><span><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></span></div>${pct}</div>
    <div class="card-title">${esc(m.name)}</div>
    <div class="card-sub">${esc(extra.sub || year)}</div>
  </a>`;
}

// Placeholder cards shown while a catalog loads.
function skeletonHtml(n = 8) {
  return Array.from({ length: n }, () => '<div class="skeleton" aria-hidden="true"><div class="poster"></div><div class="sk-line"></div><div class="sk-line short"></div></div>').join('');
}

function emptyHtml(icon, title, text = '', action = '') {
  return `<div class="empty"><div class="empty-icon" aria-hidden="true">${icon}</div><div class="empty-title">${esc(title)}</div>${text ? `<div>${text}</div>` : ''}${action}</div>`;
}

function rowHtml(title, items, moreHref) {
  return `<section class="row">
    <div class="row-head"><h2>${esc(title)}</h2>${moreHref ? `<a href="${moreHref}">See all</a>` : ''}</div>
    <div class="row-items">${items}</div>
  </section>`;
}

const typeLabel = (t) => ({ movie: 'Movies', series: 'Series', anime: 'Anime', channel: 'Channels', tv: 'TV' }[t] || t);
const catalogTitle = (e) => `${e.catalog.name || e.catalog.id} - ${typeLabel(e.catalog.type)}`;

function fmtTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

function fmtBytes(n) {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`;
}

// ---------------------------------------------------------------------------
// Board (home)
// ---------------------------------------------------------------------------
async function renderBoard(token) {
  const cont = progress.continueList();
  const contHtml = cont.length
    ? rowHtml('Continue watching', cont.map((p) => cardHtml(
        { id: p.metaId, type: p.type, name: p.name, poster: p.poster },
        { videoId: p.type === 'series' ? p.videoId : undefined, pct: p.duration ? p.time / p.duration : 0, sub: p.episodeLabel || fmtTime(p.time) }
      )).join(''))
    : '';

  const boardCatalogs = allCatalogs().filter((e) => e.required.length === 0);
  if (!boardCatalogs.length) {
    view.innerHTML = contHtml + emptyHtml('🧩', 'No catalogs yet', 'Install the Cinemeta addon to browse movies and series.', '<a class="btn" href="#/addons">Go to Addons</a>');
    return;
  }

  view.innerHTML = '<div id="hero-slot"></div>' + contHtml + boardCatalogs.map((e) => `<div data-row="${esc(e.key)}">${rowHtml(catalogTitle(e), skeletonHtml())}</div>`).join('');

  renderHero(token, boardCatalogs);

  boardCatalogs.forEach(async (e) => {
    let html;
    try {
      const metas = (await fetchCatalog(e)).slice(0, 25);
      if (!metas.length) html = '';
      else html = rowHtml(catalogTitle(e), metas.map((m) => cardHtml(m)).join(''), `#/discover/${encodeURIComponent(e.key)}`);
    } catch {
      html = '';
    }
    if (token !== renderToken) return;
    const slot = view.querySelector(`[data-row="${CSS.escape(e.key)}"]`);
    if (slot) slot.outerHTML = html;
  });
}

// ---------------------------------------------------------------------------
// Hero banner (Stremio-style featured titles on the Board)
// ---------------------------------------------------------------------------
let heroTimer = null;

async function renderHero(token, boardCatalogs) {
  clearInterval(heroTimer);
  // Prefer the "Popular" movie + series catalogs (Cinemeta's "top").
  const sources = boardCatalogs.filter((e) => e.catalog.id === 'top').slice(0, 2);
  if (!sources.length) sources.push(boardCatalogs[0]);

  const lists = await Promise.all(sources.map((e) => fetchCatalog(e).catch(() => [])));
  if (token !== renderToken) return;
  // Interleave movies and series; only titles with artwork make a good banner.
  const items = [];
  for (let i = 0; i < 6; i++) for (const l of lists) if (l[i] && safeUrl(l[i].background)) items.push(l[i]);
  const slot = $('#hero-slot');
  if (!items.length || !slot) return;

  slot.innerHTML = `<section class="hero" aria-roledescription="carousel" aria-label="Featured">
    <div class="hero-slides">${items.map((m, i) => heroSlideHtml(m, i)).join('')}</div>
    <div class="hero-dots" role="tablist" aria-label="Featured titles">
      ${items.map((m, i) => `<button class="hero-dot ${i ? '' : 'active'}" data-i="${i}" role="tab" aria-selected="${!i}" aria-label="${esc(m.name)}"></button>`).join('')}
    </div>
  </section>`;

  let current = 0;
  const show = (i) => {
    current = (i + items.length) % items.length;
    $$('.hero-slide', slot).forEach((el, n) => {
      el.classList.toggle('active', n === current);
      el.setAttribute('aria-hidden', String(n !== current));
      $$('a, button', el).forEach((c) => { c.tabIndex = n === current ? 0 : -1; });
    });
    $$('.hero-dot', slot).forEach((el, n) => { el.classList.toggle('active', n === current); el.setAttribute('aria-selected', String(n === current)); });
  };
  const start = () => { clearInterval(heroTimer); heroTimer = setInterval(() => { if (!document.hidden) show(current + 1); }, 8000); };

  show(0);
  start();
  const hero = $('.hero', slot);
  hero.addEventListener('mouseenter', () => clearInterval(heroTimer));
  hero.addEventListener('mouseleave', start);
  hero.addEventListener('focusin', () => clearInterval(heroTimer));
  $$('.hero-dot', slot).forEach((d) => { d.onclick = () => { show(Number(d.dataset.i)); start(); }; });
  $$('[data-hero-lib]', slot).forEach((b) => {
    const m = items[Number(b.dataset.heroLib)];
    b.onclick = () => { b.textContent = library.toggle(m) ? '✓ In library' : '+ Library'; };
  });
}

function heroSlideHtml(m, i) {
  const href = `#/detail/${encodeURIComponent(m.type)}/${encodeURIComponent(m.id)}`;
  const logo = safeUrl(m.logo);
  const genres = (m.genres || m.genre || []).slice(0, 3);
  // Cinemeta "medium" backgrounds are small; ask for the large version for the banner.
  const bg = safeUrl(m.background).replace('/background/medium/', '/background/large/');
  return `<article class="hero-slide ${i ? '' : 'active'}" aria-hidden="${i ? 'true' : 'false'}">
    <div class="hero-bg" style="background-image:url('${esc(bg)}')"></div>
    <div class="hero-content">
      <span class="hero-tag">Trending ${m.type === 'series' ? 'series' : 'movie'}</span>
      ${logo ? `<img class="hero-logo" src="${esc(logo)}" alt="${esc(m.name)}">` : ''}
      <h2 class="hero-title ${logo ? 'sr-only' : ''}">${esc(m.name)}</h2>
      <div class="meta-line">
        <span class="chip">${esc(m.type === 'series' ? 'Series' : 'Movie')}</span>
        ${m.releaseInfo ? `<span>${esc(m.releaseInfo)}</span>` : ''}
        ${m.runtime ? `<span>${esc(m.runtime)}</span>` : ''}
        ${m.imdbRating ? `<span><span class="imdb">IMDb</span> ${esc(m.imdbRating)}</span>` : ''}
        ${genres.length ? `<span>${esc(genres.join(' · '))}</span>` : ''}
      </div>
      ${m.description ? `<p class="hero-desc">${esc(m.description)}</p>` : ''}
      <div class="actions">
        <a class="btn" href="${href}">▶ Watch now</a>
        <button class="btn ghost" data-hero-lib="${i}">${library.has(m.id) ? '✓ In library' : '+ Library'}</button>
      </div>
    </div>
  </article>`;
}

// ---------------------------------------------------------------------------
// Discover
// ---------------------------------------------------------------------------
async function renderDiscover(token, key, params) {
  const catalogs = allCatalogs().filter((e) => e.required.every((r) => r === 'genre'));
  if (!catalogs.length) {
    view.innerHTML = `<h1>Discover</h1>` + emptyHtml('🧩', 'No catalogs available', 'Install a catalog addon such as Cinemeta.', '<a class="btn" href="#/addons">Go to Addons</a>');
    return;
  }
  const types = [...new Set(catalogs.map((e) => e.catalog.type))];
  let entry = catalogs.find((e) => e.key === key);
  const type = entry?.catalog.type || params.get('type') || types[0];
  if (!entry) entry = catalogs.find((e) => e.catalog.type === type) || catalogs[0];

  let genre = params.get('genre') || '';
  if (!genre && entry.required.includes('genre')) genre = entry.genres[0] || '';
  const canGenre = entry.supported.includes('genre') && entry.genres.length;

  view.innerHTML = `<h1>Discover</h1>
    <p class="page-sub">Browse by type, catalog and genre.</p>
    <div class="filters">
      <div class="tabs" role="group" aria-label="Type">${types.map((t) => `<button class="tab ${t === entry.catalog.type ? 'active' : ''}" data-type="${esc(t)}" aria-pressed="${t === entry.catalog.type}">${esc(typeLabel(t))}</button>`).join('')}</div>
      <label class="sr-only" for="d-cat">Catalog</label>
      <select id="d-cat" class="select">${catalogs.filter((e) => e.catalog.type === entry.catalog.type).map((e) => `<option value="${esc(e.key)}" ${e.key === entry.key ? 'selected' : ''}>${esc(e.catalog.name || e.catalog.id)} (${esc(e.addon.manifest.name)})</option>`).join('')}</select>
      ${canGenre ? `<label class="sr-only" for="d-genre">Genre</label>
      <select id="d-genre" class="select">${entry.required.includes('genre') ? '' : '<option value="">All genres</option>'}${entry.genres.map((g) => `<option ${g === genre ? 'selected' : ''}>${esc(g)}</option>`).join('')}</select>` : ''}
    </div>
    <div id="d-grid" class="grid"></div>
    <div class="load-more"><button id="d-more" class="btn ghost hidden">Load more</button></div>
    <div id="d-status" class="loading">Loading…</div>`;
  $('#d-grid').innerHTML = skeletonHtml(12).replace(/class="skeleton"/g, 'class="skeleton" style="width:auto"');

  $$('.tab[data-type]').forEach((b) => { b.onclick = () => { location.hash = `#/discover?type=${encodeURIComponent(b.dataset.type)}`; }; });
  $('#d-cat').onchange = (e) => { location.hash = `#/discover/${encodeURIComponent(e.target.value)}`; };
  if (canGenre) $('#d-genre').onchange = (e) => {
    location.hash = `#/discover/${encodeURIComponent(entry.key)}${e.target.value ? '?genre=' + encodeURIComponent(e.target.value) : ''}`;
  };

  const grid = $('#d-grid');
  const more = $('#d-more');
  const status = $('#d-status');
  const seen = new Set();
  let skip = 0;

  async function loadPage() {
    more.classList.add('hidden');
    status.textContent = 'Loading…';
    status.classList.remove('hidden');
    try {
      const extra = { genre: genre || undefined };
      if (skip && entry.supported.includes('skip')) extra.skip = skip;
      const metas = (await fetchCatalog(entry, extra)).filter((m) => !seen.has(m.id));
      if (token !== renderToken) return;
      $$('.skeleton', grid).forEach((el) => el.remove());
      metas.forEach((m) => seen.add(m.id));
      grid.insertAdjacentHTML('beforeend', metas.map((m) => cardHtml(m)).join(''));
      skip = seen.size;
      status.classList.add('hidden');
      if (!seen.size) { status.textContent = 'Nothing here.'; status.classList.remove('hidden'); }
      if (metas.length && entry.supported.includes('skip')) more.classList.remove('hidden');
    } catch (err) {
      if (token !== renderToken) return;
      $$('.skeleton', grid).forEach((el) => el.remove());
      status.textContent = `Could not load catalog: ${err.message}`;
    }
  }
  more.onclick = loadPage;
  loadPage();
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------
async function renderSearch(token, query) {
  $('#search-input').value = query;
  const catalogs = allCatalogs().filter((e) => e.supported.includes('search') && e.required.every((r) => r === 'search'));
  view.innerHTML = `<h1>Results for "${esc(query)}"</h1><p class="page-sub">Movies and series matching your search.</p>` + (catalogs.length
    ? catalogs.map((e) => `<div data-row="${esc(e.key)}">${rowHtml(catalogTitle(e), skeletonHtml(6))}</div>`).join('')
    : emptyHtml('🔍', 'Search is unavailable', 'None of your addons support search. Install Cinemeta.', '<a class="btn" href="#/addons">Go to Addons</a>'));

  let found = 0;
  await Promise.all(catalogs.map(async (e) => {
    let html = '';
    try {
      const metas = await fetchCatalog(e, { search: query });
      if (metas.length) { found += metas.length; html = rowHtml(catalogTitle(e), metas.map((m) => cardHtml(m)).join('')); }
    } catch { /* addon failed: hide its row */ }
    if (token !== renderToken) return;
    const slot = view.querySelector(`[data-row="${CSS.escape(e.key)}"]`);
    if (slot) slot.outerHTML = html;
  }));
  if (token === renderToken && catalogs.length && !found) view.insertAdjacentHTML('beforeend', emptyHtml('🔍', `Nothing found for "${esc(query)}"`, 'Check the spelling or try the original title.'));
}

// ---------------------------------------------------------------------------
// Library
// ---------------------------------------------------------------------------
function renderLibrary() {
  const items = Object.values(library.all()).sort((a, b) => b.added - a.added);
  view.innerHTML = `<h1>Library</h1><p class="page-sub">${items.length ? `${items.length} saved title${items.length === 1 ? '' : 's'}` : 'Titles you save show up here.'}</p>` + (items.length
    ? `<div class="grid">${items.map((m) => cardHtml(m, { sub: typeLabel(m.type) })).join('')}</div>`
    : emptyHtml('📚', 'Your library is empty', 'Open any movie or series and click "+ Library" to save it.', '<a class="btn" href="#/discover">Discover titles</a>'));
}

// ---------------------------------------------------------------------------
// Detail page (meta + episodes + streams)
// ---------------------------------------------------------------------------
const QUALITIES = ['4k', '1080p', '720p', '480p'];

function streamQuality(s) {
  const text = `${s.name || ''} ${s.title || s.description || ''}`.toLowerCase();
  if (/2160p|\b4k\b|uhd/.test(text)) return '4k';
  for (const q of QUALITIES.slice(1)) if (text.includes(q)) return q;
  return 'other';
}

function isPlayable(s) {
  // The Store edition has no torrent engine, so torrent streams can't play there.
  if (STORE_EDITION && s.infoHash) return false;
  return Boolean(s.infoHash || safeUrl(s.url) || safeUrl(s.externalUrl) || s.ytId);
}

// --- Stream analysis -------------------------------------------------------
// Torrentio puts seeders/size in the title, e.g. "👤 163 💾 6.91 GB ⚙️ YTS".
function streamInfo(s) {
  if (s._info) return s._info;
  const text = `${s.name || ''}\n${s.title || s.description || ''}\n${s.behaviorHints?.filename || ''}`;
  const lower = text.toLowerCase();
  const seeders = Number((text.match(/👤\s*(\d+)/) || [])[1] || 0);
  const sizeM = text.match(/💾\s*([\d.]+)\s*(tb|gb|mb)/i) || text.match(/([\d.]+)\s*(tb|gb|mb)\b/i);
  const sizeGB = sizeM ? Number(sizeM[1]) * ({ tb: 1024, gb: 1, mb: 1 / 1024 }[sizeM[2].toLowerCase()]) : 0;
  const quality = streamQuality(s);
  const hevc = /x265|hevc|h\.?265/.test(lower);
  const tenBit = /10.?bit|hdr|\bdv\b|dolby.?vision/.test(lower);
  const remux = /remux/.test(lower);
  const container = (s.behaviorHints?.filename || lower).match(/\.(mp4|mkv|avi|m4v|webm)\b/)?.[1] || '';
  const badAudio = /\b(dts|truehd|atmos|ac3|dd5\.?1|ddp|eac3)\b/.test(lower);
  // Will Chromium's built-in player handle it without lagging or failing?
  const compat = !s.infoHash ? 'ok' : (hevc || tenBit || remux || container === 'avi') ? 'vlc' : (badAudio || container === 'mkv') ? 'maybe' : 'ok';
  return (s._info = { seeders, sizeGB, quality, hevc, tenBit, remux, compat });
}

// Higher = smoother. Seeders matter most for torrents: more peers = faster download.
function streamScore(s) {
  const i = streamInfo(s);
  if (isEmbed(s)) return -1e6; // web players are a fallback, never the default pick
  if (!s.infoHash) return 1e6 + (safeUrl(s.url) ? 1 : 0); // direct HTTP links don't depend on peers
  const seedScore = Math.log2(1 + i.seeders) * 10;             // diminishing returns past ~100 seeders
  const qualityBonus = { '1080p': 12, '720p': 9, '4k': 4, '480p': 3, other: 0 }[i.quality];
  const compatBonus = { ok: 15, maybe: 4, vlc: -25 }[i.compat];
  // Big files need more bandwidth per second of video; penalise heavy bitrates.
  const sizePenalty = i.sizeGB > 15 ? 18 : i.sizeGB > 8 ? 8 : 0;
  const deadPenalty = i.seeders < 3 ? 40 : 0;
  return seedScore + qualityBonus + compatBonus - sizePenalty - deadPenalty;
}

const SORTS = {
  best: (a, b) => streamScore(b) - streamScore(a),
  seeders: (a, b) => streamInfo(b).seeders - streamInfo(a).seeders,
  size: (a, b) => streamInfo(a).sizeGB - streamInfo(b).sizeGB,
  quality: (a, b) => QUALITIES.indexOf(streamInfo(a).quality) - QUALITIES.indexOf(streamInfo(b).quality) || streamScore(b) - streamScore(a)
};

function bestStream(list) {
  return list.slice().sort(SORTS.best)[0] || null;
}

function embedHtml(s, i) {
  const name = (s.name || '').split('\n')[0];
  return `<button class="stream web" data-idx="${i}" title="Opens ${esc(name)} in a separate window">
    <div class="q-badge q-web" aria-hidden="true">WEB</div>
    <div class="stream-main">
      <div class="stream-title">${esc(name)}</div>
      <div class="stream-badges"><span class="badge good">Instant start</span><span class="badge">No peers needed</span><span class="badge">May show ads</span></div>
    </div>
    <div class="stream-play" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></div>
  </button>`;
}

function openWebPlayer(s, meta, video) {
  const title = [meta?.name, videoLabel(video)].filter(Boolean).join(' · ');
  toast(`Opening ${(s.name || '').split('\n')[0]}…`);
  return api.providers.openEmbed(s._providerId, s.externalUrl, title).catch((err) => toast(err.message, true));
}

function streamHtml(s, i, isBest) {
  if (isEmbed(s)) return embedHtml(s, i);
  const title = s.title || s.description || '';
  const info = streamInfo(s);
  const badges = [];
  if (isBest) badges.push('<span class="badge best">Best match</span>');
  if (s.infoHash) {
    const health = info.seeders >= 50 ? 'good' : info.seeders >= 10 ? 'ok' : 'low';
    badges.push(`<span class="badge seed-${health}">${info.seeders} seeders</span>`);
    if (info.compat === 'vlc') badges.push('<span class="badge warn" title="HEVC/10-bit/REMUX: may lag or fail in the built-in player">Best in VLC</span>');
    else if (info.compat === 'ok') badges.push('<span class="badge good">Smooth</span>');
  }
  if (info.sizeGB) badges.push(`<span class="badge">${info.sizeGB >= 1 ? info.sizeGB.toFixed(1) + ' GB' : Math.round(info.sizeGB * 1024) + ' MB'}</span>`);
  badges.push(`<span class="badge">${esc(s._addon)}</span>`);
  const firstLine = title.split('\n')[0] || s.name || 'Stream';
  const qLabel = info.quality === 'other' ? 'SD' : info.quality.toUpperCase().replace('P', 'p');
  return `<button class="stream ${isBest ? 'is-best' : ''}" data-idx="${i}" title="${esc(title)}">
    <div class="q-badge q-${esc(info.quality)}" aria-hidden="true">${esc(qLabel)}</div>
    <div class="stream-main">
      <div class="stream-title"><span class="sr-only">${esc(qLabel)} </span>${esc(firstLine)}</div>
      <div class="stream-badges">${badges.join('')}</div>
    </div>
    <div class="stream-play" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></div>
  </button>`;
}

function videoLabel(v) {
  if (!v) return '';
  if (v.season != null && v.episode != null) return `S${v.season}E${v.episode}${v.title || v.name ? ' - ' + (v.title || v.name) : ''}`;
  return v.title || v.name || '';
}

function sortedVideos(meta) {
  return (meta.videos || []).slice().sort((a, b) =>
    (a.season ?? 0) - (b.season ?? 0) || (a.episode ?? 0) - (b.episode ?? 0) ||
    String(a.released || '').localeCompare(String(b.released || '')));
}

async function renderDetail(token, type, id, videoId) {
  view.innerHTML = '<div class="loading">Loading…</div>';
  let meta;
  try {
    meta = await fetchMeta(type, id);
  } catch (err) {
    if (token === renderToken) view.innerHTML = emptyHtml('⚠️', 'Couldn\'t load this title', esc(err.message), '<a class="btn" href="#/board">Back to Board</a>');
    return;
  }
  if (token !== renderToken) return;
  meta.type = meta.type || type;
  meta.id = meta.id || id;

  const videos = sortedVideos(meta);
  const hasEpisodes = videos.length > 1 || (type === 'series' && videos.length > 0);
  // Movies stream directly by meta id; series need an episode first.
  const streamId = hasEpisodes ? videoId : (videoId || videos[0]?.id || meta.id);
  const currentVideo = videos.find((v) => v.id === streamId);

  const bg = safeUrl(meta.background) || safeUrl(meta.poster);
  const logo = safeUrl(meta.logo);
  const genres = meta.genres || meta.genre || [];
  const inLib = library.has(meta.id);
  const resume = progress.continueList().find((p) => p.metaId === meta.id);

  view.innerHTML = `<div class="detail">
    ${bg ? `<div class="detail-bg" style="background-image:url('${esc(bg)}')"></div>` : ''}
    <div class="detail-body">
      <div class="detail-info">
        <button class="back-link" id="back-btn"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.4 5.4 14 4l-8 8 8 8 1.4-1.4L8.8 12z"/></svg>Back</button>
        ${logo ? `<img class="detail-logo" src="${esc(logo)}" alt="${esc(meta.name)}">` : ''}
        <h1 class="detail-title ${logo ? 'sr-only' : ''}">${esc(meta.name)}</h1>
        <div class="meta-line">
          ${meta.releaseInfo ? `<span>${esc(meta.releaseInfo)}</span>` : ''}
          ${meta.runtime ? `<span>${esc(meta.runtime)}</span>` : ''}
          ${meta.imdbRating ? `<span><span class="imdb">IMDb</span> ${esc(meta.imdbRating)}</span>` : ''}
        </div>
        ${genres.length ? `<div class="chips">${genres.map((g) => `<span class="chip">${esc(g)}</span>`).join('')}</div>` : ''}
        ${meta.description ? `<p class="desc">${esc(meta.description)}</p>` : ''}
        <div class="credits">
          ${meta.director?.length ? `<div><b>Director:</b> ${esc([].concat(meta.director).join(', '))}</div>` : ''}
          ${meta.cast?.length ? `<div><b>Cast:</b> ${esc(meta.cast.slice(0, 8).join(', '))}</div>` : ''}
        </div>
        <div class="actions">
          ${resume ? `<a class="btn" href="#/detail/${encodeURIComponent(type)}/${encodeURIComponent(meta.id)}/${encodeURIComponent(resume.videoId)}">▶ Resume ${esc(resume.episodeLabel || '')} (${fmtTime(resume.time)})</a>` : ''}
          <button id="lib-btn" class="btn ghost" aria-pressed="${inLib}">${inLib ? '✓ In library' : '+ Library'}</button>
          ${meta.trailers?.[0]?.source ? `<button id="trailer-btn" class="btn ghost">🎬 Trailer</button>` : ''}
          ${meta.imdb_id || /^tt\d+$/.test(meta.id) ? `<button id="imdb-btn" class="btn ghost">IMDb</button>` : ''}
        </div>
      </div>
      <aside class="side-panel" id="side"></aside>
    </div>
  </div>`;

  $('#lib-btn').onclick = (e) => {
    const added = library.toggle(meta);
    e.target.textContent = added ? '✓ In library' : '+ Library';
    e.target.setAttribute('aria-pressed', String(added));
    toast(added ? `Added "${meta.name}" to your library` : `Removed "${meta.name}" from your library`);
  };
  $('#back-btn').onclick = () => { if (history.length > 1) history.back(); else location.hash = '#/board'; };
  $('#trailer-btn')?.addEventListener('click', () => api.openExternal(`https://www.youtube.com/watch?v=${encodeURIComponent(meta.trailers[0].source)}`));
  $('#imdb-btn')?.addEventListener('click', () => api.openExternal(`https://www.imdb.com/title/${encodeURIComponent(meta.imdb_id || meta.id)}/`));

  const side = $('#side');
  if (hasEpisodes && !streamId) renderEpisodes(side, meta, videos);
  else renderStreamList(token, side, meta, currentVideo, streamId, hasEpisodes, videos);
}

function renderEpisodes(side, meta, videos) {
  const seasons = [...new Set(videos.map((v) => v.season ?? 0))];
  const watched = progress.all();
  const lastSeason = store.get('season.' + meta.id, null);
  let season = seasons.includes(lastSeason) ? lastSeason : (seasons.find((s) => s > 0) ?? seasons[0]);

  const draw = () => {
    const eps = videos.filter((v) => (v.season ?? 0) === season);
    $('#ep-list', side).innerHTML = eps.map((v) => {
      const thumb = safeUrl(v.thumbnail);
      const p = watched[v.id];
      const aired = v.released ? new Date(v.released) : null;
      const future = aired && aired > new Date();
      return `<a class="episode" href="#/detail/${encodeURIComponent(meta.type)}/${encodeURIComponent(meta.id)}/${encodeURIComponent(v.id)}">
        ${thumb ? `<img loading="lazy" src="${esc(thumb)}" alt="">` : '<div class="thumb-ph"></div>'}
        <div>
          <div class="episode-t">${esc(v.episode != null ? v.episode + '. ' : '')}${esc(v.title || v.name || 'Episode')}</div>
          <div class="episode-d">${aired && !isNaN(aired) ? esc(aired.toLocaleDateString()) : ''}${future ? ' · upcoming' : ''}</div>
          ${p ? `<div class="episode-w">Watched ${fmtTime(p.time)}</div>` : ''}
        </div>
      </a>`;
    }).join('') || '<div class="empty">No episodes.</div>';
  };

  side.innerHTML = `<div class="side-head">
      <h2>Episodes</h2>
      <label class="sr-only" for="season-sel">Season</label>
      <select id="season-sel" class="select small">${seasons.map((s) => `<option value="${s}" ${s === season ? 'selected' : ''}>${s === 0 ? 'Specials' : 'Season ' + s}</option>`).join('')}</select>
    </div>
    <div class="side-scroll" id="ep-list"></div>`;
  $('#season-sel', side).onchange = (e) => {
    season = Number(e.target.value);
    store.set('season.' + meta.id, season);
    draw();
  };
  draw();
}

function renderStreamList(token, side, meta, video, streamId, hasEpisodes, videos) {
  side.innerHTML = `<div class="side-head">
      ${hasEpisodes ? `<a class="icon-btn" href="#/detail/${encodeURIComponent(meta.type)}/${encodeURIComponent(meta.id)}" aria-label="Back to episodes"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.4 5.4 14 4l-8 8 8 8 1.4-1.4L8.8 12z"/></svg></a>` : ''}
      <h2>${hasEpisodes ? esc(videoLabel(video) || 'Streams') : 'Streams'}</h2>
    </div>
    <div class="quick-play">
      <button id="s-best" class="btn big" disabled>▶ Play</button>
      <div class="quick-play-info" id="s-best-info" aria-live="polite">Finding the best stream…</div>
    </div>
    <div class="stream-tools">
      <span class="stream-count" id="s-count">Or pick a stream</span>
      <label class="sr-only" for="s-sort">Sort streams</label>
      <select id="s-sort" class="select small">
        <option value="best">Sort: Best match</option>
        <option value="seeders">Sort: Most seeders</option>
        <option value="quality">Sort: Quality</option>
        <option value="size">Sort: Smallest size</option>
      </select>
    </div>
    <div class="stream-filter" id="s-filter"></div>
    <div class="side-scroll" id="s-list"><div class="loading">Asking addons for streams…</div></div>`;

  const streams = [];
  let hiddenTorrents = 0; // Store edition: torrent streams from user-added addons
  let filter = 'all';
  let sort = store.get('streamSort', 'best');
  let pending = true;
  $('#s-sort', side).value = sort;

  const draw = () => {
    const files = streams.filter((s) => !isEmbed(s));
    const webs = streams.map((s, i) => [s, i]).filter(([s]) => isEmbed(s));
    const counts = {};
    files.forEach((s) => { const q = streamQuality(s); counts[q] = (counts[q] || 0) + 1; });
    const pills = ['all', ...QUALITIES, 'other'].filter((q) => q === 'all' || counts[q]);
    if (webs.length) pills.push('web');
    $('#s-filter', side).innerHTML = streams.length ? pills.map((q) => {
      const label = q === 'all' ? `All (${files.length})` : q === 'web' ? `Web players (${webs.length})` : `${q} (${counts[q]})`;
      return `<button class="pill ${q === filter ? 'active' : ''}" data-q="${q}" aria-pressed="${q === filter}">${label}</button>`;
    }).join('') : '';
    // Torrents/direct links are the main pick; fall back to a web player if that's all there is.
    const best = bestStream(files) || webs[0]?.[0] || null;
    $('#s-best', side).disabled = !best;
    $('#s-count', side).textContent = streams.length ? `Or pick from ${files.length} streams${webs.length ? ` + ${webs.length} web players` : ''}` : 'Or pick a stream';
    if (best) {
      const bi = streamInfo(best);
      const q = bi.quality === 'other' ? 'SD' : bi.quality;
      $('#s-best-info', side).innerHTML = isEmbed(best)
        ? `No torrents found. Plays on <b>${esc(best.name.split('\n')[0])}</b> web player`
        : `Best match: <b>${esc(q)}</b>${bi.sizeGB ? ` · ${bi.sizeGB.toFixed(1)} GB` : ''}${best.infoHash ? ` · ${bi.seeders} seeders` : ''} · ${esc(best._addon)}`;
    } else {
      $('#s-best-info', side).textContent = pending ? 'Finding the best stream…' : 'No streams available';
    }
    const shown = streams.map((s, i) => [s, i])
      .filter(([s]) => !isEmbed(s) && (filter === 'all' || streamQuality(s) === filter))
      .sort(([a], [b]) => SORTS[sort](a, b));
    // Web players get their own section at the bottom (or alone under the "Web players" filter).
    const webList = filter === 'all' || filter === 'web' ? webs : [];
    const webSection = webList.length
      ? `<div class="section-title stream-section">Web players · if torrents are slow</div>${webList.map(([s, i]) => embedHtml(s, i)).join('')}`
      : '';
    $('#s-list', side).innerHTML = (filter === 'web' ? '' : shown.map(([s, i]) => streamHtml(s, i, s === best)).join('')) + webSection +
      (pending ? '<div class="loading">Asking your addons for streams…</div>' : (!streams.length ? emptyHtml('📭', 'No streams found', 'Try another episode, or add more stream addons.', '<a class="btn small" href="#/addons">Manage addons</a>') : '')) +
      (hiddenTorrents ? `<div class="info-box">${hiddenTorrents} torrent stream${hiddenTorrents === 1 ? '' : 's'} hidden: torrent playback isn't available in the Microsoft Store edition.</div>` : '');
  };

  $('#s-sort', side).onchange = (e) => { sort = e.target.value; store.set('streamSort', sort); draw(); };
  $('#s-best', side).onclick = () => {
    const best = bestStream(streams.filter((s) => !isEmbed(s))) || streams.find(isEmbed);
    if (!best) return;
    if (isEmbed(best)) openWebPlayer(best, meta, video);
    else playStream({ meta, video, videoId: streamId, stream: best, videos, alternatives: streams });
  };

  side.addEventListener('click', (e) => {
    const pill = e.target.closest('.pill');
    if (pill) { filter = pill.dataset.q; draw(); return; }
    const btn = e.target.closest('.stream');
    if (btn) {
      const s = streams[Number(btn.dataset.idx)];
      if (!s) return;
      if (isEmbed(s)) openWebPlayer(s, meta, video);
      else playStream({ meta, video, videoId: streamId, stream: s, videos, alternatives: streams });
    }
  });

  if (!activeAddons().some((a) => supports(a, 'stream', meta.type, streamId))) {
    pending = false;
    draw();
    return;
  }

  fetchStreams(meta.type, streamId, (group) => {
    if (token !== renderToken) return;
    // Several addons can return the same torrent; keep the first copy of each.
    const seen = new Set(streams.map((s) => s.infoHash).filter(Boolean));
    if (STORE_EDITION) hiddenTorrents += group.filter((s) => s.infoHash).length;
    for (const s of group.filter(isPlayable)) {
      if (s.infoHash && seen.has(s.infoHash.toLowerCase())) continue;
      if (s.infoHash) seen.add(s.infoHash.toLowerCase());
      streams.push(s);
    }
    draw();
  }).then(() => {
    if (token !== renderToken) return;
    pending = false;
    draw();
  });
}

// ---------------------------------------------------------------------------
// Addons page
// ---------------------------------------------------------------------------
function addonCardHtml(a, installed) {
  const m = a.manifest || {};
  const logo = addonLogo(a);
  const resources = (m.resources || []).map((r) => (typeof r === 'string' ? r : r.name));
  const isCore = a.transportUrl === CINEMETA;
  return `<div class="addon">
    ${logo ? `<img class="addon-logo" src="${esc(logo)}" alt="">` : `<div class="addon-logo" aria-hidden="true">${esc((m.name || '?')[0])}</div>`}
    <div class="addon-main">
      <div class="addon-name">${installed ? `<span class="status-dot ${a.error ? 'off' : ''}" title="${a.error ? 'Not working' : 'Working'}"></span>` : ''}${esc(m.name || a.transportUrl)}${m.version ? `<small>v${esc(m.version)}</small>` : ''}</div>
      <div class="addon-desc">${esc(a.error ? 'Failed to load: ' + a.error : (m.description || a.description || ''))}</div>
      <div class="addon-types">${[...(m.types || []), ...resources].map((t) => `<span class="chip">${esc(t)}</span>`).join('')}</div>
    </div>
    <div class="addon-actions">
      ${installed
        ? `${/^https:/i.test(a.transportUrl) ? `<button class="btn ghost small" data-share="${esc(a.transportUrl)}" title="Copy a fusionstream:// link others can click to install">Share</button>` : ''}
           ${a.manifest?.behaviorHints?.configurable ? `<button class="btn ghost small" data-configure="${esc(a.transportUrl)}">Configure</button>` : ''}
           ${isCore ? '' : `<button class="btn danger small" data-uninstall="${esc(a.transportUrl)}">Uninstall</button>`}`
        : `<button class="btn small" data-install="${esc(a.url)}">Install</button>`}
    </div>
  </div>`;
}

async function renderProviderList(data) {
  const box = $('#prov-list');
  if (!box) return;
  let info = data;
  try { info = info || await api.providers.info(); } catch (err) { box.innerHTML = `<div class="empty">${esc(err.message)}</div>`; return; }
  if (!$('#prov-list')) return; // navigated away

  const src = info.source === 'github' ? 'GitHub' : info.source === 'bundled' ? 'bundled with the app' : 'none';
  const rows = info.providers.map((p) => `<div class="addon">
      <div class="addon-logo" aria-hidden="true">${p.type === 'embed' ? '▶' : '⇣'}</div>
      <div class="addon-main">
        <div class="addon-name">${esc(p.name)}<small>${p.type === 'embed' ? 'Web player' : 'Torrent source'}</small></div>
        <div class="addon-desc">${esc(p.description)}</div>
        <div class="addon-types">${p.types.map((t) => `<span class="chip">${esc(t)}</span>`).join('')}</div>
      </div>
      <label class="switch">
        <input type="checkbox" data-prov="${esc(p.id)}" ${p.enabled ? 'checked' : ''} aria-label="Enable ${esc(p.name)}">
        <span aria-hidden="true"></span>
      </label>
    </div>`).join('');

  box.innerHTML = `<div class="info-box">
      Version ${esc(info.version)} · loaded from ${esc(src)}${info.error ? ` · last update failed: ${esc(info.error)}` : ''}.
      Providers come from the <a href="#" id="prov-repo">providers folder on GitHub</a>.
      Web players open in a separate window with ads and popups blocked where possible.
    </div>` + (rows || emptyHtml('🧩', 'No providers', 'Click "Check for updates" to download them.'));

  $('#prov-repo', box)?.addEventListener('click', (e) => { e.preventDefault(); api.openExternal(info.repo); });
  $$('[data-prov]', box).forEach((cb) => {
    cb.onchange = async () => {
      const map = store.get('providerOverrides', {});
      map[cb.dataset.prov] = cb.checked;
      store.set('providerOverrides', map);
      await api.providers.setOverrides(map).catch(() => {});
    };
  });
}

// One row in the Addon Store list.
function storeCardHtml(x) {
  const installed = isInstalledUrl(x.url);
  const logo = safeUrl(x.logo) || (x.builtin ? 'assets/logo.png' : '');
  return `<div class="addon">
    ${logo ? `<img class="addon-logo" src="${esc(logo)}" alt="">` : `<div class="addon-logo" aria-hidden="true">${esc(x.name[0])}</div>`}
    <div class="addon-main">
      <div class="addon-name">${esc(x.name)}${x.builtin ? '<small>Built in</small>' : ''}</div>
      <div class="addon-desc">${esc(x.description || '')}</div>
      ${x.thirdParty ? '<div class="addon-types"><span class="badge third">Third-party · not made by FusionStream</span></div>' : ''}
    </div>
    <div class="addon-actions">
      ${installed
        ? '<button class="btn small installed" disabled>✓ Installed</button>'
        : `<button class="btn small" data-store-install="${esc(x.id)}">Install</button>`}
    </div>
  </div>`;
}

function packHtml(p, cat) {
  const items = p.addons.map((id) => cat.addons.find((a) => a.id === id)).filter(Boolean);
  const missing = items.filter((a) => !isInstalledUrl(a.url));
  return `<div class="pack">
    <h3>${esc(p.name)}</h3>
    <p>${esc(p.description || '')}</p>
    <div class="pack-list">${items.map((a) => esc(a.name)).join(' · ')}</div>
    ${missing.length
      ? `<button class="btn" data-pack="${esc(p.id)}">Install ${missing.length === items.length ? 'all' : `${missing.length} missing`}</button>`
      : '<button class="btn installed" disabled>✓ All installed</button>'}
  </div>`;
}

async function installPack(id, btn) {
  const cat = await loadAddonCatalog();
  const pack = cat.packs.find((p) => p.id === id);
  if (!pack) return;
  const urls = pack.addons.map((aid) => cat.addons.find((a) => a.id === aid)?.url).filter(Boolean);
  if (btn) btn.disabled = true;
  const res = await installMany(urls, (done, total) => { if (btn) btn.textContent = `Installing ${done}/${total}…`; });
  toast(res.failed.length ? `Installed ${res.ok} of ${urls.length}. ${res.failed.length} failed.` : `${pack.name} installed`, Boolean(res.failed.length));
}

let addonsTab = 'installed';

function renderAddons(tab = addonsTab) {
  addonsTab = tab;
  const tabs = [['installed', `Installed (${addons.length})`], ['store', 'Addon Store'], ['link', 'Install from link']];

  view.innerHTML = `<h1>Addons</h1>
    <p class="page-sub">Addons add catalogs, information, streams and subtitles to FusionStream.</p>
    <div class="tabs store-tabs" role="tablist" aria-label="Addons">
      ${tabs.map(([id, label]) => `<button class="tab ${id === tab ? 'active' : ''}" role="tab" aria-selected="${id === tab}" data-addons-tab="${id}">${esc(label)}</button>`).join('')}
    </div>
    <div id="addons-body"></div>`;

  $$('[data-addons-tab]').forEach((b) => { b.onclick = () => renderAddons(b.dataset.addonsTab); });
  const body = $('#addons-body');

  if (tab === 'store') {
    body.innerHTML = '<div class="loading">Loading Addon Store…</div>';
    loadAddonCatalog().then((cat) => {
      if (addonsTab !== 'store' || !$('#addons-body')) return;
      const groups = (cat.categories || []).map((c) => [c, cat.addons.filter((a) => a.category === c.id)]).filter(([, l]) => l.length);
      const other = cat.addons.filter((a) => !(cat.categories || []).some((c) => c.id === a.category));
      if (other.length) groups.push([{ name: 'More' }, other]);
      $('#addons-body').innerHTML =
        (cat.packs.length ? `<div class="section-title">Quick install</div><div class="packs">${cat.packs.map((p) => packHtml(p, cat)).join('')}</div>` : '') +
        groups.map(([c, list]) => `<div class="section-title">${esc(c.name)}</div><div class="addon-list">${list.map(storeCardHtml).join('')}</div>`).join('') +
        `<div class="section-title">About addons</div>
         <div class="info-box">FusionStream does not host videos. Addons marked third-party are made and run by others.
           Only use content you have the right to watch.</div>`;
    });
  } else if (tab === 'link') {
    body.innerHTML = `
      <form class="addon-tools" id="addon-form">
        <label class="sr-only" for="addon-url">Addon link</label>
        <input id="addon-url" class="input" placeholder="Paste addon link (https://…/manifest.json or fusionstream://…)" autocomplete="off" />
        <button class="btn" type="submit">Install</button>
      </form>
      <div class="info-box">Got an addon link from a website? Paste it here. Links starting with <b>fusionstream://</b>
        open FusionStream automatically when clicked in your browser.</div>`;
  } else {
    body.innerHTML = `<div class="addon-list">${addons.map((a) => addonCardHtml(a, true)).join('') || emptyHtml('🧩', 'No addons installed', 'Open the Addon Store to add some.', '<button class="btn" data-addons-tab-go="store">Open Addon Store</button>')}</div>
    ${STORE_EDITION ? `<div class="section-title">About addons</div>
    <div class="info-box">FusionStream does not include or host any videos. Addons are made by third parties.
      Only install addons from sources you trust, and only use content you have the right to watch.</div>` : `
    <div class="section-title providers-head">
      <span>FusionStream providers</span>
      <button id="prov-update" class="btn ghost small">Check for updates</button>
    </div>
    <div id="prov-list" class="addon-list"><div class="loading">Loading providers…</div></div>
    <div class="section-title">Torrentio configuration</div>
    <div class="info-box">To pick providers, quality filters or a debrid service, open Torrentio's configure page,
      then click "Copy link" there and paste it under "Install from link". It replaces the default Torrentio install.</div>`}`;
  }

  if (!STORE_EDITION && tab === 'installed') renderProviderList();
  $('#prov-update')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = 'Checking…';
    try {
      const res = await api.providers.update();
      if (res.error) toast(`Update failed: ${res.error}`, true);
      else toast(res.updated ? `Providers updated to v${res.version}` : 'Providers are up to date');
      renderProviderList(res);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Check for updates';
    }
  });

  const form = $('#addon-form');
  if (form) form.onsubmit = async (e) => {
    e.preventDefault();
    const value = $('#addon-url').value.trim();
    if (!value) return;
    try {
      // Same confirmation as clicking a link, so users see what they're adding.
      await confirmInstall(linkToManifestUrl(value));
    } catch (err) {
      toast(err.message, true);
    }
  };

  view.onclick = async (e) => {
    const go = e.target.closest('[data-addons-tab-go]');
    if (go) { renderAddons(go.dataset.addonsTabGo); return; }
    const storeBtn = e.target.closest('[data-store-install]');
    if (storeBtn) {
      const cat = await loadAddonCatalog();
      const x = cat.addons.find((a) => a.id === storeBtn.dataset.storeInstall);
      if (!x) return;
      storeBtn.disabled = true;
      storeBtn.textContent = 'Installing…';
      try { toast(`Installed ${(await installAddon(x.url)).name}`); } catch (err) { toast(err.message, true); }
      renderAddons('store');
      return;
    }
    const packBtn = e.target.closest('[data-pack]');
    if (packBtn) {
      await installPack(packBtn.dataset.pack, packBtn);
      renderAddons('store');
      return;
    }
    const inst = e.target.closest('[data-install]');
    const uninst = e.target.closest('[data-uninstall]');
    const conf = e.target.closest('[data-configure]');
    if (inst) {
      inst.disabled = true;
      try { toast(`Installed ${(await installAddon(inst.dataset.install)).name}`); }
      catch (err) { toast(err.message, true); }
      renderAddons();
    } else if (uninst) {
      uninstallAddon(uninst.dataset.uninstall);
      renderAddons();
    } else if (e.target.closest('[data-share]')) {
      const link = installLinkFor(e.target.closest('[data-share]').dataset.share);
      navigator.clipboard.writeText(link).then(() => toast('Install link copied')).catch(() => toast(link));
    } else if (conf && /^https?:/i.test(conf.dataset.configure)) {
      api.openExternal(conf.dataset.configure.replace(/manifest\.json$/i, 'configure'));
    }
  };
}

// ---------------------------------------------------------------------------
// Install links & confirmation dialog
// ---------------------------------------------------------------------------
// Accepts https://…/manifest.json, fusionstream://install?url=…, fusionstream://host/…, stremio://host/…
function linkToManifestUrl(input) {
  const v = String(input || '').trim();
  const m = v.match(/^fusionstream:\/\/(?:install|addon)\/?\?(.*)$/i);
  if (m) {
    const url = new URLSearchParams(m[1]).get('url');
    if (!url) throw new Error('This install link has no addon URL.');
    return normalizeAddonUrl(url);
  }
  if (/^fusionstream:\/\//i.test(v)) return normalizeAddonUrl('https://' + v.slice('fusionstream://'.length));
  return normalizeAddonUrl(v);
}

// A shareable one-click link for an addon (put this behind an "Install" button on your website).
const installLinkFor = (manifestUrl) => `fusionstream://install?url=${encodeURIComponent(manifestUrl)}`;

let installBusy = false;

async function confirmInstall(manifestUrl) {
  if (installBusy) return;
  installBusy = true;
  const dlg = $('#install-dialog');
  try {
    if (!manifestUrl) throw new Error('Invalid addon link.');
    if (isInstalledUrl(manifestUrl)) { toast('That addon is already installed'); return; }
    toast('Loading addon…');
    const m = await fetchManifest(manifestUrl);
    const resources = (m.resources || []).map((r) => (typeof r === 'string' ? r : r.name));

    $('#install-title').textContent = `Install ${m.name}?`;
    $('#install-sub').textContent = m.version ? `Version ${m.version}` : '';
    $('#install-desc').textContent = m.description || '';
    $('#install-types').innerHTML = [...(m.types || []), ...resources].map((t) => `<span class="chip">${esc(t)}</span>`).join('');
    $('#install-url').textContent = manifestUrl;
    $('#install-logo').src = safeUrl(m.logo) || 'assets/logo.png';
    const warn = $('#install-warn');
    const official = (addonCatalog?.addons || []).some((a) => a.url === manifestUrl && !a.thirdParty);
    warn.classList.toggle('hidden', official);
    warn.textContent = 'This addon is made by a third party, not FusionStream. Only install addons you trust, and only watch content you have the right to.';

    dlg.returnValue = '';
    dlg.showModal();
    $('#install-ok').focus();
    const choice = await new Promise((resolve) => dlg.addEventListener('close', () => resolve(dlg.returnValue), { once: true }));
    if (choice !== 'install') return;

    await installAddon(manifestUrl);
    toast(`Installed ${m.name}`);
    if (location.hash.startsWith('#/addons')) renderAddons(); else route();
  } catch (err) {
    toast(`Couldn't install addon: ${err.message}`, true);
  } finally {
    installBusy = false;
  }
}

// ---------------------------------------------------------------------------
// First-run setup (auto-install)
// ---------------------------------------------------------------------------
async function renderWelcome(token) {
  view.innerHTML = `<div class="welcome">
    <img src="assets/logo.png" alt="">
    <h1>Welcome to Fusion<span style="color:var(--green)">Stream</span></h1>
    <p>Pick a pack to set everything up in one click. You can add or remove addons any time from the Addons page.</p>
    <div class="packs" id="w-packs"><div class="loading">Loading…</div></div>
    <div class="welcome-progress hidden" id="w-progress" aria-hidden="true"><div></div></div>
    <div id="w-status" class="muted" role="status" aria-live="polite"></div>
    <button class="btn ghost" id="w-skip">Skip for now</button>
  </div>`;

  const finish = () => { store.set('setupDone', true); location.hash = '#/board'; };
  $('#w-skip').onclick = finish;

  const cat = await loadAddonCatalog();
  if (token !== renderToken) return;
  $('#w-packs').innerHTML = cat.packs.map((p) => packHtml(p, cat)).join('') || emptyHtml('🧩', 'No packs available', 'Continue to the app and add addons from the Addon Store.');

  view.onclick = async (e) => {
    const btn = e.target.closest('[data-pack]');
    if (!btn) return;
    const pack = cat.packs.find((p) => p.id === btn.dataset.pack);
    const urls = pack.addons.map((id) => cat.addons.find((a) => a.id === id)?.url).filter(Boolean);
    $$('[data-pack]').forEach((b) => { b.disabled = true; });
    const bar = $('#w-progress');
    bar.classList.remove('hidden');
    const res = await installMany(urls, (done, total) => {
      bar.firstElementChild.style.width = `${Math.round((done / total) * 100)}%`;
      $('#w-status').textContent = `Installing ${done} of ${total}…`;
    });
    $('#w-status').textContent = res.failed.length ? `Done. ${res.failed.length} addon(s) couldn't be reached; you can retry from Addons.` : 'All set!';
    setTimeout(finish, 700);
  };
}

// ---------------------------------------------------------------------------
// Settings page
// ---------------------------------------------------------------------------
const SUB_LANGS = [
  ['eng', 'English'], ['spa', 'Spanish'], ['fre', 'French'], ['ger', 'German'], ['ita', 'Italian'],
  ['por', 'Portuguese'], ['pob', 'Portuguese (BR)'], ['ara', 'Arabic'], ['hin', 'Hindi'], ['mal', 'Malayalam'],
  ['tam', 'Tamil'], ['jpn', 'Japanese'], ['kor', 'Korean'], ['chi', 'Chinese'], ['rus', 'Russian'], ['tur', 'Turkish']
];

async function renderSettings() {
  const info = await api.info().catch(() => ({}));
  view.innerHTML = `<h1>Settings</h1>
    <p class="page-sub">Subtitles, playback and app data.</p>
    <div class="settings">
      <div class="setting">
        <label for="s-lang">Preferred subtitle language</label>
        <select id="s-lang" class="select">${SUB_LANGS.map(([c, n]) => `<option value="${c}" ${c === settings.subLang ? 'selected' : ''}>${n}</option>`).join('')}</select>
        <label class="check"><input type="checkbox" id="s-auto" ${settings.autoSubs ? 'checked' : ''}> Turn subtitles on automatically</label>
      </div>
      <div class="setting">
        <label for="s-player">External player (VLC) path</label>
        <input id="s-player" class="input" placeholder="Leave empty to auto-detect VLC" value="${esc(settings.playerPath)}" />
        <div class="hint">Used for files the built-in player can't decode (e.g. some MKV audio like AC3/DTS).</div>
      </div>
      <div class="setting">
        <label>Data</label>
        <div class="actions">
          <button id="s-clear-progress" class="btn ghost small">Clear watch history</button>
          <button id="s-reset-addons" class="btn ghost small">Reset addons to defaults</button>
        </div>
        ${STORE_EDITION ? '' : `<div class="hint">Torrent cache: ${esc(info.cacheDir || '')} (cleared when the app closes)</div>`}
      </div>
      <div class="setting">
        <label>About</label>
        <div class="hint">FusionStream ${esc(info.version || '')}${STORE_EDITION ? ' · Microsoft Store edition' : ''}.
          FusionStream does not host any videos. Content comes from addons; you are responsible for what you watch and for complying with the laws in your country.
          ${STORE_EDITION ? '' : 'Torrent streaming shares data with other peers and exposes your IP address.'}</div>
        <div class="actions"><button id="s-privacy" class="btn ghost small">Privacy policy</button></div>
      </div>
    </div>`;

  $('#s-lang').onchange = (e) => { settings.subLang = e.target.value; saveSettings(); };
  $('#s-auto').onchange = (e) => { settings.autoSubs = e.target.checked; saveSettings(); };
  $('#s-player').onchange = (e) => { settings.playerPath = e.target.value.trim(); saveSettings(); };
  $('#s-clear-progress').onclick = () => { progress.clear(); toast('Watch history cleared'); };
  $('#s-privacy').onclick = () => api.openExternal(PRIVACY_URL);
  $('#s-reset-addons').onclick = async () => {
    store.set('addons', null);
    await loadAddons();
    toast('Addons reset');
  };
}

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------
const player = {
  el: $('#player'),
  video: $('#video'),
  ctx: null,          // { meta, video, videoId, stream, videos }
  src: '',
  statsTimer: null,
  saveTimer: null,
  idleTimer: null,
  subUrls: [],
  session: 0
};

function srtToVtt(text) {
  const body = text.replace(/^\uFEFF/, '').replace(/\r+/g, '')
    .replace(/(\d\d:\d\d:\d\d),(\d\d\d)/g, '$1.$2')
    .replace(/<\/?font[^>]*>/gi, '');
  return body.trimStart().startsWith('WEBVTT') ? body : 'WEBVTT\n\n' + body;
}

function setStatus(text, { error = false, actions = [] } = {}) {
  const box = $('#p-status');
  if (text == null) { box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  box.classList.toggle('error', error);
  $('#p-status-text').textContent = text;
  const act = $('#p-status-actions');
  // Status refreshes every second; only rebuild buttons when they change so clicks aren't lost.
  const sig = actions.map((a) => a.label).join('|');
  if (act.dataset.sig === sig) return;
  act.dataset.sig = sig;
  act.innerHTML = '';
  for (const a of actions) {
    const b = document.createElement('button');
    b.className = 'btn small' + (a.ghost ? ' ghost' : '');
    b.textContent = a.label;
    b.onclick = a.onClick;
    act.appendChild(b);
  }
}

// Seconds of video already buffered ahead of the playhead.
function bufferedAhead() {
  const v = player.video;
  for (let i = 0; i < v.buffered.length; i++) {
    if (v.buffered.start(i) <= v.currentTime + 0.5 && v.buffered.end(i) >= v.currentTime) return v.buffered.end(i) - v.currentTime;
  }
  return 0;
}

// Web players available for the title that's playing.
const webAlternatives = () => (player.ctx?.alternatives || []).filter(isEmbed);

function watchOnWeb() {
  const ctx = player.ctx;
  const web = webAlternatives()[0];
  if (!ctx || !web) return;
  saveProgress();
  const { meta, video } = ctx;
  closePlayer();
  openWebPlayer(web, meta, video);
}

// Actions offered when a stream stalls or fails: a faster torrent, a web player, or the list.
function fallbackActions() {
  const actions = [];
  if (nextAlternativeExists()) actions.push({ label: 'Switch to faster stream', onClick: switchToFasterStream });
  const web = webAlternatives()[0];
  if (web) actions.push({ label: `Watch on ${web.name.split('\n')[0]}`, ghost: actions.length > 0, onClick: watchOnWeb });
  actions.push({ label: 'Choose another stream', ghost: true, onClick: () => closePlayer() });
  return actions;
}

// After 12s of stalling, offer alternatives.
function stallActions(since) {
  if (Date.now() - since < 12000) return {};
  return { actions: fallbackActions() };
}

function nextVideo(ctx) {
  if (!ctx.video || !ctx.videos?.length) return null;
  const i = ctx.videos.findIndex((v) => v.id === ctx.video.id);
  return i >= 0 ? ctx.videos[i + 1] || null : null;
}

function saveProgress() {
  const { ctx, video } = player;
  if (!ctx || !video.duration || !Number.isFinite(video.duration) || video.currentTime < 5) return;
  progress.save({
    videoId: ctx.videoId,
    metaId: ctx.meta.id,
    type: ctx.meta.type,
    name: ctx.meta.name,
    poster: ctx.meta.poster,
    episodeLabel: ctx.video?.season != null ? `S${ctx.video.season}E${ctx.video.episode}` : '',
    time: video.currentTime,
    duration: video.duration
  });
}

function openExternalPlayer() {
  if (!player.src) return;
  api.openInPlayer(player.src, settings.playerPath)
    .then(() => { player.video.pause(); toast('Opened in external player'); })
    .catch((err) => toast(err.message, true));
}

async function loadSubtitles(session) {
  const select = $('#p-subs');
  select.innerHTML = '<option value="">Subtitles off</option>';
  const { meta, videoId } = player.ctx;
  const subs = await fetchSubtitles(meta.type, videoId);
  if (session !== player.session) return;

  // Preferred language first, then the rest grouped by language.
  subs.sort((a, b) => (b.lang === settings.subLang) - (a.lang === settings.subLang) || String(a.lang).localeCompare(String(b.lang)));
  const perLang = {};
  subs.slice(0, 120).forEach((s, i) => {
    perLang[s.lang] = (perLang[s.lang] || 0) + 1;
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = `${s.lang || 'unknown'} ${perLang[s.lang]}`;
    select.appendChild(opt);
  });
  player.subList = subs;
  if (settings.autoSubs) {
    const idx = subs.findIndex((s) => s.lang === settings.subLang);
    if (idx >= 0) { select.value = String(idx); selectSubtitle(idx); }
  }
}

async function selectSubtitle(idx) {
  const video = player.video;
  $$('track', video).forEach((t) => t.remove());
  for (const t of video.textTracks) t.mode = 'disabled';
  if (idx === '' || idx == null) return;
  const sub = player.subList?.[Number(idx)];
  if (!sub) return;
  const session = player.session;
  try {
    const text = await api.fetchText(sub.url);
    if (session !== player.session) return;
    const url = URL.createObjectURL(new Blob([srtToVtt(text)], { type: 'text/vtt' }));
    player.subUrls.push(url);
    const track = document.createElement('track');
    track.kind = 'subtitles';
    track.label = sub.lang || 'Subtitles';
    track.srclang = (sub.lang || 'en').slice(0, 2);
    track.src = url;
    track.default = true;
    video.appendChild(track);
    track.track.mode = 'showing';
  } catch (err) {
    toast('Could not load subtitles: ' + err.message, true);
  }
}

async function playStream(ctx) {
  const s = ctx.stream;

  // Streams that can't play inside the app open in the browser.
  if (!s.infoHash && !safeUrl(s.url)) {
    const ext = s.ytId ? `https://www.youtube.com/watch?v=${encodeURIComponent(s.ytId)}` : safeUrl(s.externalUrl);
    if (ext) api.openExternal(ext);
    return;
  }

  closePlayer(false);
  const session = ++player.session;
  player.ctx = ctx;
  player.src = '';
  const video = player.video;

  $('#p-title').textContent = ctx.meta.name;
  $('#p-subtitle').textContent = [videoLabel(ctx.video), (s.title || s.name || '').split('\n')[0]].filter(Boolean).join(' · ');
  $('#p-stats').textContent = '';
  $('#p-next').classList.toggle('hidden', !nextVideo(ctx));
  player.el.classList.remove('hidden', 'playing');
  player.el.inert = false;
  showControls();
  setStatus(s.infoHash ? 'Connecting to peers…' : 'Loading…');

  loadSubtitles(session);

  try {
    if (s.infoHash) {
      let stuckSince = Date.now();
      let offered = false;
      player.statsTimer = setInterval(async () => {
        const st = await api.torrent.stats(s.infoHash).catch(() => null);
        if (!st || session !== player.session) return;
        const buffered = bufferedAhead();
        $('#p-stats').textContent = `${st.peers} peers · ↓ ${fmtBytes(st.downloadSpeed)}/s` + (player.src ? ` · ${Math.round(buffered)}s buffered` : '');

        // Stall detection: not playing (connecting or buffering) for 20s+.
        const stalled = !st.ready || player.video.readyState < 3;
        if (!stalled) { stuckSince = Date.now(); offered = false; }
        if (!st.ready) setStatus(`Connecting to peers… (${st.peers} found)`, stallActions(stuckSince));
        else if (stalled && player.src) setStatus(`Buffering… ${fmtBytes(st.downloadSpeed)}/s from ${st.peers} peers`, stallActions(stuckSince));
        if (stalled && !offered && Date.now() - stuckSince > 20000 && (nextAlternativeExists() || webAlternatives().length)) {
          offered = true;
          toast(st.peers === 0 ? 'No peers for this torrent. Try a faster stream or a web player.' : 'This stream is slow. Try a faster stream or a web player.');
        }
      }, 1000);
      const res = await api.torrent.start({
        infoHash: s.infoHash,
        fileIdx: Number.isInteger(s.fileIdx) ? s.fileIdx : undefined,
        sources: s.sources,
        filename: s.behaviorHints?.filename
      });
      if (session !== player.session) return;
      player.src = res.url;
      setStatus('Buffering…');
    } else {
      player.src = s.url;
    }

    video.src = player.src;
    const saved = progress.get(ctx.videoId);
    video.addEventListener('loadedmetadata', () => {
      if (saved && saved.time < video.duration - 30) video.currentTime = saved.time;
    }, { once: true });
    await video.play().catch(() => {});
    player.saveTimer = setInterval(saveProgress, 5000);
  } catch (err) {
    if (session !== player.session) return;
    setStatus(err.message, { error: true, actions: fallbackActions() });
  }
}

function closePlayer(hide = true) {
  saveProgress();
  player.session++;
  clearInterval(player.statsTimer);
  clearInterval(player.saveTimer);
  const video = player.video;
  video.pause();
  video.removeAttribute('src');
  $$('track', video).forEach((t) => t.remove());
  video.load();
  player.subUrls.forEach((u) => URL.revokeObjectURL(u));
  player.subUrls = [];
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  if (hide) {
    player.el.classList.add('hidden');
    player.el.inert = true; // hidden player is still in the DOM for the fade-out; keep it out of focus order
    player.ctx = null;
    api.torrent.stopAll().catch(() => {});
  }
}

async function playNext() {
  const ctx = player.ctx;
  const next = ctx && nextVideo(ctx);
  if (!next) return;
  saveProgress();
  setStatus('Finding a stream for the next episode…');
  const { streams } = await fetchStreams(ctx.meta.type, next.id);
  const all = streams.filter(isPlayable);
  const playable = all.filter((s) => !isEmbed(s));
  // Prefer a stream from the same release group (Stremio "bingeGroup").
  const group = ctx.stream.behaviorHints?.bingeGroup;
  const sameGroup = group ? playable.filter((s) => s.behaviorHints?.bingeGroup === group) : [];
  // Same release group if it's healthy, otherwise the best-ranked stream.
  const groupBest = bestStream(sameGroup);
  const pick = (groupBest && streamInfo(groupBest).seeders >= 5 ? groupBest : null) || bestStream(playable);
  if (!pick) {
    setStatus('No streams found for the next episode.', { error: true, actions: [{ label: 'Close', onClick: () => closePlayer() }] });
    return;
  }
  playStream({ ...ctx, video: next, videoId: next.id, stream: pick, alternatives: all, tried: [] });
}

// Switch to the next best torrent we haven't tried, keeping the playback position.
function switchToFasterStream() {
  const ctx = player.ctx;
  if (!ctx) return;
  const tried = new Set([...(ctx.tried || []), ctx.stream.infoHash || ctx.stream.url]);
  const next = (ctx.alternatives || [])
    .filter((s) => isPlayable(s) && !isEmbed(s))
    .filter((s) => !tried.has(s.infoHash || s.url))
    .sort(SORTS.best)[0];
  if (!next) { toast('No other streams to try.', true); return; }
  saveProgress(); // resume position carries over to the new stream
  toast(`Switching to: ${(next.title || next.name || '').split('\n')[0]}`);
  playStream({ ...ctx, stream: next, tried: [...tried] });
}

function nextAlternativeExists() {
  const ctx = player.ctx;
  if (!ctx?.alternatives) return false;
  const tried = new Set([...(ctx.tried || []), ctx.stream.infoHash || ctx.stream.url]);
  return ctx.alternatives.some((s) => isPlayable(s) && !isEmbed(s) && (s.infoHash || s.url) && !tried.has(s.infoHash || s.url));
}

// Player controls
function showControls() {
  player.el.classList.remove('idle');
  clearTimeout(player.idleTimer);
  player.idleTimer = setTimeout(() => {
    if (!player.video.paused) player.el.classList.add('idle');
  }, 3000);
}

const FLASH_ICONS = {
  play: '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg>'
};

// Brief animated icon in the middle of the video (YouTube-style feedback).
function flash(kind) {
  const el = $('#p-flash');
  el.className = 'player-flash' + (kind === 'back' ? ' side-left' : kind === 'fwd' ? ' side-right' : '');
  el.innerHTML = FLASH_ICONS[kind] || (kind === 'back' ? '−10s' : '+10s');
  void el.offsetWidth; // restart the animation
  el.classList.add('go');
}

function togglePlay() {
  const v = player.video;
  const willPlay = v.paused;
  if (willPlay) v.play().catch(() => {}); else v.pause();
  flash(willPlay ? 'play' : 'pause');
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else player.el.requestFullscreen().catch(() => {});
}

(function bindPlayer() {
  const v = player.video;
  const seek = $('#p-seek');
  let seeking = false;

  player.el.addEventListener('mousemove', showControls);
  v.addEventListener('click', togglePlay);
  v.addEventListener('dblclick', toggleFullscreen);
  v.addEventListener('play', () => { player.el.classList.add('playing'); $('#p-play').setAttribute('aria-label', 'Pause'); showControls(); });
  v.addEventListener('pause', () => { player.el.classList.remove('playing'); $('#p-play').setAttribute('aria-label', 'Play'); showControls(); });
  v.addEventListener('waiting', () => { if (player.src && !player.ctx?.stream.infoHash) setStatus('Buffering…'); });
  v.addEventListener('playing', () => setStatus(null));
  v.addEventListener('canplay', () => { if (!v.paused) setStatus(null); });
  v.addEventListener('loadedmetadata', () => {
    $('#p-duration').textContent = fmtTime(v.duration);
    // Video loaded but no picture usually means an unsupported codec (e.g. some HEVC).
    if (!v.videoWidth && player.ctx) toast('This file has no video track Chromium can decode. Try "Open in VLC".', true);
  });
  v.addEventListener('timeupdate', () => {
    $('#p-time').textContent = fmtTime(v.currentTime);
    if (!seeking && v.duration) seek.value = String(Math.round((v.currentTime / v.duration) * 1000));
  });
  v.addEventListener('ended', () => {
    saveProgress();
    if (nextVideo(player.ctx || {})) playNext();
  });
  v.addEventListener('error', () => {
    if (!player.src || !player.ctx) return;
    const code = v.error?.code;
    const msg = code === 4 ? 'The built-in player can\'t play this file format.' : 'Playback failed.';
    setStatus(msg, {
      error: true,
      actions: [
        { label: 'Open in VLC', onClick: openExternalPlayer },
        ...fallbackActions().map((a) => ({ ...a, ghost: true }))
      ]
    });
  });

  seek.addEventListener('input', () => { seeking = true; if (v.duration) $('#p-time').textContent = fmtTime((seek.value / 1000) * v.duration); });
  seek.addEventListener('change', () => { if (v.duration) v.currentTime = (seek.value / 1000) * v.duration; seeking = false; });

  $('#p-play').onclick = togglePlay;
  $('#p-back10').onclick = () => { v.currentTime = Math.max(0, v.currentTime - 10); flash('back'); };
  $('#p-fwd10').onclick = () => { v.currentTime = Math.min(v.duration || 0, v.currentTime + 10); flash('fwd'); };
  $('#p-mute').onclick = () => { v.muted = !v.muted; $('#p-mute').setAttribute('aria-label', v.muted ? 'Unmute' : 'Mute'); };
  $('#p-volume').oninput = (e) => { v.volume = Number(e.target.value); v.muted = false; };
  $('#p-fullscreen').onclick = toggleFullscreen;
  $('#p-back').onclick = () => closePlayer();
  $('#p-external').onclick = openExternalPlayer;
  $('#p-next').onclick = playNext;
  $('#p-subs').onchange = (e) => selectSubtitle(e.target.value);

  document.addEventListener('keydown', (e) => {
    if (player.el.classList.contains('hidden')) return;
    if (e.target.closest('select, input[type=text], input[type=search]')) return;
    const keys = {
      ' ': togglePlay, k: togglePlay, f: toggleFullscreen, m: () => $('#p-mute').click(),
      ArrowLeft: () => $('#p-back10').click(), ArrowRight: () => $('#p-fwd10').click(),
      ArrowUp: () => { v.volume = Math.min(1, v.volume + 0.1); $('#p-volume').value = v.volume; },
      ArrowDown: () => { v.volume = Math.max(0, v.volume - 0.1); $('#p-volume').value = v.volume; },
      Escape: () => { if (!document.fullscreenElement) closePlayer(); }
    };
    const fn = keys[e.key];
    if (fn) { e.preventDefault(); fn(); showControls(); }
  });
})();

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
async function route() {
  const token = ++renderToken;
  const [pathPart, query = ''] = location.hash.replace(/^#\/?/, '').split('?');
  const parts = pathPart.split('/').filter(Boolean).map(decodeURIComponent);
  const params = new URLSearchParams(query);
  const name = parts[0] || 'board';

  if (!player.el.classList.contains('hidden')) closePlayer();
  clearInterval(heroTimer);
  view.onclick = null;
  $$('.nav-item').forEach((a) => {
    const active = a.dataset.route === name;
    a.classList.toggle('active', active);
    if (active) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  if (name !== 'search') $('#search-input').value = '';
  view.scrollTop = 0;
  moveNavIndicator();
  // Re-trigger the page entrance animation.
  view.classList.remove('page-enter');
  void view.offsetWidth;
  view.classList.add('page-enter');

  try {
    switch (name) {
      case 'discover': await renderDiscover(token, parts[1], params); break;
      case 'search': await renderSearch(token, params.get('q') || ''); break;
      case 'library': renderLibrary(); break;
      case 'addons': renderAddons(); break;
      case 'settings': await renderSettings(); break;
      case 'welcome': await renderWelcome(token); break;
      case 'detail': await renderDetail(token, parts[1], parts[2], parts[3]); break;
      default: await renderBoard(token);
    }
  } catch (err) {
    console.error(err);
    if (token === renderToken) view.innerHTML = `<div class="empty">Something went wrong: ${esc(err.message)}</div>`;
  }
}

$('#search-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = $('#search-input').value.trim();
  if (q) location.hash = `#/search?q=${encodeURIComponent(q)}`;
});

// Slides the green highlight to the active sidebar item.
function moveNavIndicator() {
  const ind = $('.nav-indicator');
  const active = $('.nav-item.active');
  if (!ind) return;
  if (!active) { ind.style.opacity = '0'; return; }
  ind.style.height = `${active.offsetHeight}px`;
  ind.style.transform = `translateY(${active.offsetTop}px)`;
  ind.style.opacity = '1';
}
window.addEventListener('resize', moveNavIndicator);

// Stagger card entrances: each newly added batch counts up from 0 (capped).
new MutationObserver((mutations) => {
  let i = 0;
  for (const m of mutations) {
    for (const node of m.addedNodes) {
      if (!(node instanceof HTMLElement)) continue;
      const cards = node.matches('.card') ? [node] : node.querySelectorAll('.card');
      for (const c of cards) c.style.setProperty('--i', String(Math.min(i++, 14)));
    }
  }
}).observe(view, { childList: true, subtree: true });

window.addEventListener('hashchange', route);
window.addEventListener('beforeunload', saveProgress);

(async function init() {
  view.innerHTML = '<div class="loading">Loading addons…</div>';
  const appInfo = await api.info().catch(() => ({}));
  STORE_EDITION = Boolean(appInfo.storeEdition);
  if (STORE_EDITION) {
    DEFAULT_ADDONS = STORE_DEFAULTS;
    RECOMMENDED = STORE_RECOMMENDED;
    document.body.classList.add('store-edition');
  }
  // Apply saved provider on/off choices before any streams are requested.
  await api.providers.setOverrides(store.get('providerOverrides', {})).catch(() => {});
  await loadAddons();
  // fusionstream:// links: one that launched the app, and any opened while it runs.
  api.addonLinks.onInstallRequest((url) => confirmInstall(url));
  const pendingLink = await api.addonLinks.pending().catch(() => null);
  // First launch: offer the one-click setup instead of an empty-looking app.
  // (Existing users who already picked addons skip it.)
  if (!store.get('setupDone', false) && localStorage.getItem('fs.addons') === null) history.replaceState(null, '', '#/welcome');
  else store.set('setupDone', true);
  route();
  if (pendingLink) confirmInstall(pendingLink);
})();
