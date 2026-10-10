// Exposes a small, explicit API to the renderer. No Node access leaks through.
const { contextBridge, ipcRenderer } = require('electron');

async function call(channel, ...args) {
  const res = await ipcRenderer.invoke(channel, ...args);
  if (!res || !res.ok) throw new Error(res?.error || 'Unknown error');
  return res.data;
}

contextBridge.exposeInMainWorld('fusion', {
  fetchJson: (url) => call('net:fetch', url, false),
  fetchText: (url) => call('net:fetch', url, true),
  torrent: {
    start: (opts) => call('torrent:start', opts),
    stats: (infoHash) => call('torrent:stats', infoHash),
    stopAll: () => call('torrent:stopAll')
  },
  openExternal: (url) => call('shell:open', url),
  addonLinks: {
    pending: () => call('addon:pending-install'),
    // Fires when a fusionstream:// (or stremio://) install link is opened while the app runs.
    onInstallRequest: (cb) => ipcRenderer.on('addon:install-request', (_e, url) => cb(url))
  },
  providers: {
    info: () => call('providers:info'),
    update: () => call('providers:update'),
    setOverrides: (map) => call('providers:setOverrides', map),
    openEmbed: (providerId, url, title) => call('providers:openEmbed', providerId, url, title)
  },
  openInPlayer: (url, playerPath) => call('player:external', url, playerPath),
  info: () => call('app:info')
});
