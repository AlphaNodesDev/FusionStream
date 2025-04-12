// 🔄 NO top-level imports here!

export const name = "Discord Rich Presence";
export const version = "1.0.0";
export const description = "Enables Discord Rich Presence while watching.";
export const image = "https://i.ibb.co/bgwNyMH4/8b81eb984a67f6652e430b88962a1bd4.jpg";

export function register({ require }) {
  const RPC = require('discord-rpc');
  const dotenv = require('dotenv');
  dotenv.config();

  const clientId = process.env.DISCORD_CLIENT_ID;
  if (!clientId) {
    globalThis.sendFrontendMessage?.({
      type: 'error',
      message: '[Discord RPC] Failed (Current Version Of FS is not Supported !)',
    });
    return;
  }

  const client = new RPC.Client({ transport: 'ipc' });

  client.login({ clientId }).catch(() => {
    globalThis.sendFrontendMessage?.({
      type: 'error',
      message: '[Discord RPC] Failed to login.',
    });
  });

  client.on('ready', () => {
    setIdlePresence();

    let lastInfoCache = null;
    const originalFetch = globalThis.fetch;

    globalThis.fetch = async (...args) => {
      const [url] = args;

      if (typeof url === 'string') {
        if (url.includes('/info')) {
          try {
            const response = await originalFetch(...args);
            const cloned = response.clone();
            const json = await cloned.json();
            if (json?.title) lastInfoCache = json;
            return response;
          } catch (err) {
            console.warn('[RPC] /info fetch fail:', err);
          }
        }

        if (url.includes('/watch')) {
          try {
            const urlObj = new URL(url, 'http://localhost');
            const episodeId = urlObj.searchParams.get('episodeId');
            const response = await originalFetch(...args);
            const cloned = response.clone();
            await cloned.json();

            if (lastInfoCache?.episodes) {
              const episode = lastInfoCache.episodes.find(ep => ep.id === episodeId || ep.url?.includes(episodeId));
              updateDiscordPresence({
                animeTitle: lastInfoCache.title,
                episodeTitle: episode?.title || 'Episode',
                thumbnail: lastInfoCache.thumbnail || lastInfoCache.image,
              });
            }

            return response;
          } catch (err) {
            console.warn('[RPC] /watch processing fail:', err);
          }
        }
      }

      return originalFetch(...args);
    };
  });

  globalThis.updateDiscordPresence = function ({ animeTitle, episodeTitle, thumbnail }) {
    if (!client) return;
    client.setActivity({
      details: `Watching ${animeTitle}`,
      state: episodeTitle,
      startTimestamp: Date.now(),
      largeImageKey: thumbnail,
      largeImageText: animeTitle,
      smallImageKey: 'https://i.ibb.co/tptvZjMB/Chat-GPT-Image-Apr-9-2025-12-21-01-PM.png',
      smallImageText: 'Streaming via MyApp',
      instance: false,
      type: 3,
    });
  };

  function setIdlePresence() {
    if (!client) return;
    client.setActivity({
      details: 'Browsing',
      state: 'In the app',
      startTimestamp: Date.now(),
      largeImageKey: 'https://i.ibb.co/tptvZjMB/Chat-GPT-Image-Apr-9-2025-12-21-01-PM.png',
      largeImageText: 'Browsing',
      smallImageKey: 'https://i.ibb.co/tptvZjMB/Chat-GPT-Image-Apr-9-2025-12-21-01-PM.png',
      smallImageText: 'Idle Mode',
      instance: false,
      type: 0,
    });
  }
}
