// FusionStream V5 - main process
// Responsibilities:
//  - Create the app window (sandboxed renderer, context isolation)
//  - Proxy addon HTTP requests (avoids CORS issues with third-party addons)
//  - Run the torrent engine (WebTorrent) and expose torrent files over a
//    local-only HTTP server so the <video> element can stream them
//  - Launch external players (VLC) for files Chromium can't decode

import { app, BrowserWindow, ipcMain, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as archive from './addons/archive.js';

// Store edition: true when running from the Microsoft Store (AppX/MSIX) package,
// or when forced with FUSION_STORE=1 for local testing. The Store package is built
// without torrent and third-party stream code (Microsoft Store policy 11.8), so those
// modules are only loaded in the full edition.
const STORE_EDITION = Boolean(process.windowsStore) || process.env.FUSION_STORE === '1';
// Keep the Store edition's data (addons, library, settings) separate from the full
// edition, so addons installed in one never show up in the other.
if (STORE_EDITION) app.setPath('userData', path.join(app.getPath('appData'), 'FusionStream Store'));
const { default: WebTorrent } = STORE_EDITION ? { default: null } : await import('webtorrent');
const piratebay = STORE_EDITION ? null : await import('./addons/piratebay.js');
const providerHost = STORE_EDITION ? null : await import('./providers-host.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(app.getPath('temp'), 'fusionstream-cache');

const DEFAULT_TRACKERS = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.demonii.com:1337/announce',
  'udp://tracker.torrent.eu.org:451/announce',
  'udp://open.stealth.si:80/announce',
  'udp://exodus.desync.com:6969/announce',
  'udp://explodie.org:6969/announce',
  'udp://tracker.openbittorrent.com:6969/announce',
  'udp://tracker.tiny-vps.com:6969/announce',
  'udp://tracker.moeking.me:6969/announce',
  'udp://opentracker.i2p.rocks:6969/announce'
];

// Community-maintained list of the most reliable public trackers.
// More healthy trackers = more peers found = faster start and less buffering.
const TRACKER_LIST_URLS = [
  'https://raw.githubusercontent.com/ngosang/trackerslist/master/trackers_best.txt',
  'https://cdn.jsdelivr.net/gh/ngosang/trackerslist@master/trackers_best.txt'
];
let extraTrackers = [];

async function refreshTrackers() {
  for (const url of TRACKER_LIST_URLS) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      const list = (await res.text()).split(/\s+/).filter((t) => /^(udp|https?|wss?):\/\//i.test(t));
      if (list.length) { extraTrackers = list; return; }
    } catch { /* try next mirror */ }
  }
}

// Read-ahead window: pieces in this range are downloaded with top priority
// (and from multiple peers at once), so playback stays ahead of the download.
const READ_AHEAD_BYTES = 40 * 1024 * 1024;

const VIDEO_EXT = /\.(mkv|mp4|m4v|webm|avi|mov|wmv|flv|ts|m2ts|mpg|mpeg)$/i;
const MIME = {
  mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mkv: 'video/x-matroska',
  avi: 'video/x-msvideo', mov: 'video/quicktime', ts: 'video/mp2t', m2ts: 'video/mp2t',
  mpg: 'video/mpeg', mpeg: 'video/mpeg', wmv: 'video/x-ms-wmv', flv: 'video/x-flv'
};

let mainWindow = null;

// ---------------------------------------------------------------------------
// Torrent engine
// ---------------------------------------------------------------------------
let client = null;
const torrents = new Map(); // infoHash -> torrent

function getClient() {
  if (!WebTorrent) throw new Error('Torrent streaming is not available in this edition.');
  if (!client) {
    // More simultaneous peer connections spreads the download across more peers.
    client = new WebTorrent({ maxConns: 150 });
    client.on('error', (err) => console.error('[webtorrent]', err?.message || err));
  }
  return client;
}

function buildMagnet(infoHash, sources = []) {
  const fromSources = sources
    .filter((s) => typeof s === 'string' && s.startsWith('tracker:'))
    .map((s) => s.slice('tracker:'.length));
  const trackers = [...new Set([...fromSources, ...DEFAULT_TRACKERS, ...extraTrackers])];
  return `magnet:?xt=urn:btih:${infoHash}` + trackers.map((t) => `&tr=${encodeURIComponent(t)}`).join('');
}

function addTorrent(infoHash, sources) {
  if (torrents.has(infoHash)) return torrents.get(infoHash);
  const torrent = getClient().add(buildMagnet(infoHash, sources), {
    path: path.join(CACHE_DIR, infoHash),
    deselect: true // only download pieces that are actually streamed
  });
  torrent.on('error', (err) => {
    console.error('[torrent]', infoHash, err?.message || err);
    torrents.delete(infoHash);
  });
  torrents.set(infoHash, torrent);
  return torrent;
}

function destroyTorrent(infoHash) {
  const torrent = torrents.get(infoHash);
  torrents.delete(infoHash);
  if (!torrent || torrent.destroyed) return;
  try {
    torrent.destroy({ destroyStore: true });
  } catch (err) {
    console.error('[torrent] destroy failed', err?.message || err);
  }
}

function waitReady(torrent, timeoutMs = 120000) {
  if (torrent.ready) return Promise.resolve(torrent);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Could not find peers for this torrent. Try another stream.'));
    }, timeoutMs);
    const onReady = () => { cleanup(); resolve(torrent); };
    const onError = (err) => { cleanup(); reject(err instanceof Error ? err : new Error(String(err))); };
    const onClose = () => { cleanup(); reject(new Error('Torrent was stopped.')); };
    function cleanup() {
      clearTimeout(timer);
      torrent.removeListener('ready', onReady);
      torrent.removeListener('error', onError);
      torrent.removeListener('close', onClose);
    }
    torrent.once('ready', onReady);
    torrent.once('error', onError);
    torrent.once('close', onClose);
  });
}

function pickFileIndex(torrent, fileIdx, filename) {
  const files = torrent.files;
  if (Number.isInteger(fileIdx) && files[fileIdx]) return fileIdx;
  if (filename) {
    const byName = files.findIndex((f) => f.name === filename);
    if (byName >= 0) return byName;
  }
  let best = -1;
  files.forEach((f, i) => {
    if (VIDEO_EXT.test(f.name) && (best < 0 || f.length > files[best].length)) best = i;
  });
  if (best < 0) throw new Error('No playable video file found in this torrent.');
  return best;
}

// ---------------------------------------------------------------------------
// Local streaming server (127.0.0.1 only, random token in every URL)
// ---------------------------------------------------------------------------
const TOKEN = crypto.randomBytes(16).toString('hex');
let serverPort = 0;

const server = http.createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, 'http://127.0.0.1');
    const m = pathname.match(/^\/([a-f0-9]{32})\/([a-f0-9]{40})\/(\d+)(?:\/.*)?$/i);
    if (!m || m[1] !== TOKEN) { res.writeHead(404); return res.end(); }

    const torrent = torrents.get(m[2].toLowerCase());
    if (!torrent) { res.writeHead(404); return res.end(); }
    await waitReady(torrent);

    const file = torrent.files[Number(m[3])];
    if (!file) { res.writeHead(404); return res.end(); }

    const total = file.length;
    const ext = path.extname(file.name).slice(1).toLowerCase();
    let start = 0;
    let end = total - 1;
    let status = 200;

    const range = req.headers.range && /bytes=(\d*)-(\d*)/.exec(req.headers.range);
    if (range) {
      if (range[1] === '') {
        start = Math.max(0, total - Number(range[2]));
      } else {
        start = Number(range[1]);
        if (range[2]) end = Math.min(Number(range[2]), total - 1);
      }
      if (start >= total || start > end) {
        res.writeHead(416, { 'Content-Range': `bytes */${total}` });
        return res.end();
      }
      status = 206;
      res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
    }

    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
    res.setHeader('Content-Length', end - start + 1);
    res.writeHead(status);
    if (req.method === 'HEAD') return res.end();

    // Mark the next chunk after the playhead as critical so it's fetched first,
    // with the same piece requested from several peers ("endgame" style).
    const pieceLen = torrent.pieceLength;
    const absStart = file.offset + start;
    const firstPiece = Math.floor(absStart / pieceLen);
    const lastPiece = Math.min(
      Math.floor((file.offset + end) / pieceLen),
      Math.floor((absStart + READ_AHEAD_BYTES) / pieceLen)
    );
    try { torrent.critical(firstPiece, lastPiece); } catch { /* torrent may be closing */ }

    const stream = file.createReadStream({ start, end });
    stream.on('error', () => res.destroy());
    res.on('close', () => stream.destroy());
    stream.pipe(res);
  } catch (err) {
    console.error('[server]', err?.message || err);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  }
});

function startServer() {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      serverPort = server.address().port;
      resolve();
    });
  });
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------
function handle(channel, fn) {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      return { ok: true, data: await fn(...args) };
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  });
}

function assertHttpUrl(url) {
  const u = new URL(url);
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('Only http(s) URLs are allowed.');
  return u;
}

// Built-in addons, reachable from the renderer as fusion://<name>/...
const BUILTIN_ADDONS = STORE_EDITION ? { archive } : { archive, piratebay, providers: providerHost };

function requireFullEdition() {
  if (STORE_EDITION) throw new Error('Not available in the Microsoft Store edition.');
}
handle('providers:info', async () => { requireFullEdition(); return providerHost.publicInfo(); });
handle('providers:update', async () => { requireFullEdition(); return providerHost.updateFromGitHub({ force: true }); });
handle('providers:setOverrides', async (map) => {
  if (STORE_EDITION) return null; // called at startup; nothing to configure
  providerHost.setOverrides(map);
  return providerHost.publicInfo();
});
handle('providers:openEmbed', async (providerId, url, title) => {
  requireFullEdition();
  return providerHost.openEmbed(String(providerId), String(url), String(title || '').slice(0, 120));
});

handle('net:fetch', async (url, asText) => {
  if (typeof url === 'string' && url.startsWith('fusion://')) {
    const u = new URL(url);
    const addon = BUILTIN_ADDONS[u.hostname];
    if (!addon) throw new Error('Unknown built-in addon.');
    return addon.handle(u.pathname);
  }
  const res = await fetch(assertHttpUrl(url), {
    signal: AbortSignal.timeout(20000),
    headers: { 'User-Agent': 'FusionStream/2.0' }
  });
  if (!res.ok) throw new Error(`Request failed (HTTP ${res.status})`);
  return asText ? res.text() : res.json();
});

handle('torrent:start', async ({ infoHash, fileIdx, sources, filename } = {}) => {
  if (typeof infoHash !== 'string' || !/^[a-f0-9]{40}$/i.test(infoHash)) throw new Error('Invalid info hash.');
  const hash = infoHash.toLowerCase();

  // Only one active torrent at a time keeps bandwidth focused on what's playing.
  for (const other of [...torrents.keys()]) if (other !== hash) destroyTorrent(other);

  const torrent = addTorrent(hash, Array.isArray(sources) ? sources : []);
  await waitReady(torrent);

  const idx = pickFileIndex(torrent, Number.isInteger(fileIdx) ? fileIdx : undefined, filename);
  const file = torrent.files[idx];
  file.select();
  // Players read the file's tail (MP4 moov / MKV cues) right after the head,
  // so grab both ends up front to make the first seek and start instant.
  const pl = torrent.pieceLength;
  const headEnd = Math.floor((file.offset + Math.min(file.length, 8 * 1024 * 1024)) / pl);
  const tailStart = Math.floor((file.offset + Math.max(0, file.length - 4 * 1024 * 1024)) / pl);
  const tailEnd = Math.floor((file.offset + file.length - 1) / pl);
  try {
    torrent.critical(Math.floor(file.offset / pl), headEnd);
    torrent.critical(tailStart, tailEnd);
  } catch { /* ignore */ }

  return {
    url: `http://127.0.0.1:${serverPort}/${TOKEN}/${hash}/${idx}/${encodeURIComponent(file.name)}`,
    fileName: file.name,
    size: file.length
  };
});

handle('torrent:stats', async (infoHash) => {
  const torrent = torrents.get(String(infoHash).toLowerCase());
  if (!torrent) return null;
  return {
    ready: torrent.ready,
    peers: torrent.numPeers,
    downloadSpeed: torrent.downloadSpeed,
    uploadSpeed: torrent.uploadSpeed,
    downloaded: torrent.downloaded,
    progress: torrent.progress
  };
});

handle('torrent:stopAll', async () => {
  for (const hash of [...torrents.keys()]) destroyTorrent(hash);
  return true;
});

handle('shell:open', async (url) => {
  const u = new URL(url);
  if (!['http:', 'https:', 'magnet:'].includes(u.protocol)) throw new Error('Unsupported link.');
  await shell.openExternal(u.toString());
  return true;
});

function findPlayer(customPath) {
  if (customPath) {
    if (!fs.existsSync(customPath)) throw new Error('The external player path in Settings does not exist.');
    return customPath;
  }
  const candidates = process.platform === 'win32'
    ? [
        path.join(process.env.ProgramFiles || 'C:\\Program Files', 'VideoLAN', 'VLC', 'vlc.exe'),
        path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'VideoLAN', 'VLC', 'vlc.exe')
      ]
    : process.platform === 'darwin'
      ? ['/Applications/VLC.app/Contents/MacOS/VLC']
      : ['/usr/bin/vlc', '/snap/bin/vlc'];
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) throw new Error('VLC was not found. Install VLC or set the player path in Settings.');
  return found;
}

handle('player:external', async (url, customPath) => {
  assertHttpUrl(url);
  const exe = findPlayer(customPath);
  // Arguments are passed as an array (no shell), so the URL can't inject commands.
  const child = spawn(exe, [url], { detached: true, stdio: 'ignore' });
  child.on('error', (err) => console.error('[player]', err.message));
  child.unref();
  return true;
});

handle('app:info', async () => ({ version: app.getVersion(), cacheDir: CACHE_DIR, storeEdition: STORE_EDITION }));

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 860,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#0c0b11',
    title: 'FusionStream',
    icon: path.join(__dirname, 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.removeMenu();
  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  // Never navigate the app window away; open web links in the browser.
  mainWindow.webContents.on('will-navigate', (e) => e.preventDefault());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  // Surface renderer warnings/errors in the terminal.
  mainWindow.webContents.on('console-message', (e) => {
    if (e.level === 'warning' || e.level === 'error') console.log(`[renderer:${e.level}] ${e.message} (${e.sourceId}:${e.lineNumber})`);
  });
  mainWindow.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') mainWindow.webContents.toggleDevTools();
  });
}

// ---------------------------------------------------------------------------
// One-click addon install links
//   fusionstream://install?url=https://host/manifest.json   (our own links)
//   fusionstream://host/path/manifest.json                   (short form)
//   stremio://host/path/manifest.json                        (full edition only)
// The link is only turned into an https manifest URL here; the renderer shows the
// addon's details and asks the user before anything is installed.
// ---------------------------------------------------------------------------
const PROTOCOLS = STORE_EDITION ? ['fusionstream'] : ['fusionstream', 'stremio'];
let pendingInstall = null;

function linkToManifest(link) {
  try {
    const u = new URL(link);
    const scheme = u.protocol.replace(':', '');
    if (!PROTOCOLS.includes(scheme)) return null;
    let target;
    if (scheme === 'fusionstream' && (u.hostname === 'install' || u.hostname === 'addon')) {
      target = u.searchParams.get('url') || '';
      if (target.startsWith('stremio://')) target = 'https://' + target.slice('stremio://'.length);
    } else {
      target = 'https://' + link.slice(u.protocol.length + 2);
    }
    const t = new URL(target);
    if (t.protocol !== 'https:' || !t.hostname) return null;
    if (!/\/manifest\.json$/i.test(t.pathname)) t.pathname = t.pathname.replace(/\/+$/, '') + '/manifest.json';
    return t.toString();
  } catch {
    return null;
  }
}

function handleLink(link) {
  const manifestUrl = linkToManifest(link);
  if (!manifestUrl) return;
  if (mainWindow && !mainWindow.webContents.isLoading()) {
    mainWindow.webContents.send('addon:install-request', manifestUrl);
  } else {
    pendingInstall = manifestUrl; // delivered when the renderer asks on startup
  }
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
}

const findLink = (argv) => argv.find((a) => PROTOCOLS.some((p) => String(a).toLowerCase().startsWith(p + '://')));

// One running copy: a second launch (from a link) hands its link to the first.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const link = findLink(argv);
    if (link) handleLink(link);
    else if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); }
  });
}
app.on('open-url', (e, url) => { e.preventDefault(); handleLink(url); }); // macOS

handle('addon:pending-install', async () => {
  const url = pendingInstall;
  pendingInstall = null;
  return url;
});

function registerProtocols() {
  // The Store package declares fusionstream:// in its AppX manifest instead, and the
  // local Store test (FUSION_STORE=1) must not take over the full edition's handler.
  if (STORE_EDITION) return;
  for (const p of PROTOCOLS) {
    if (process.defaultApp) {
      // Running from source (npm start): register electron.exe + this app folder.
      app.setAsDefaultProtocolClient(p, process.execPath, [path.resolve(process.argv[1])]);
    } else {
      app.setAsDefaultProtocolClient(p);
    }
  }
}

app.whenReady().then(async () => {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  registerProtocols();
  const startLink = findLink(process.argv);
  if (startLink) pendingInstall = linkToManifest(startLink);
  refreshTrackers(); // background; streams started before it finishes use the built-in list
  if (!STORE_EDITION) {
    providerHost.setIcon(path.join(__dirname, 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png'));
    providerHost.loadProviders();
    providerHost.updateFromGitHub(); // background: picks up new providers pushed to the repo
  }
  await startServer();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  for (const hash of [...torrents.keys()]) destroyTorrent(hash);
  try { client?.destroy(); } catch { /* ignore */ }
  if (!STORE_EDITION) providerHost.closeAll?.();
  server.close();
  // Only our own temp cache folder is removed.
  try { fs.rmSync(CACHE_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});
