import RPC from 'discord-rpc';
import dotenv from 'dotenv';

dotenv.config(); 

export const name = "Discord Rich Presence";
export const version = "1.0.0";
export const description = "Enables Discord Rich Presence while watching.";
export const image = "https://i.ibb.co/bgwNyMH4/8b81eb984a67f6652e430b88962a1bd4.jpg"; // small icon (app logo)

export function register() {
  const clientId = process.env.DISCORD_CLIENT_ID;
  if (!clientId) {
    console.warn("[Discord RPC] Client ID not found in .env");
    return;
  }

  const client = new RPC.Client({ transport: 'ipc' });

  client.login({ clientId }).catch(err => {
    console.error("[Discord RPC] Failed to login:", err);
  });

  client.on('ready', () => {
    setIdlePresence();
    let lastInfoCache = null; // 🔹 Cache latest /info response

    const originalFetch = globalThis.fetch;
    
    globalThis.fetch = async (...args) => {
      const [url] = args;
    
      if (typeof url === 'string') {
        // 🔹 Intercept /info and cache it
        if (url.includes('/info')) {
          try {
            const response = await originalFetch(...args);
            const cloned = response.clone();
            const json = await cloned.json();
    
            if (json?.title) {
              lastInfoCache = json;
            }
    
            return response;
          } catch (err) {
            console.warn('[Rich Presence Intercept] Failed to fetch info:', err);
          }
        }
    
        // 🔹 Intercept /watch and use the cached info
        if (url.includes('/watch')) {
          try {
            const urlObj = new URL(url, 'http://localhost');
            const episodeId = urlObj.searchParams.get('episodeId');
    
            const response = await originalFetch(...args);
            const cloned = response.clone();
            await cloned.json(); // ignore actual streamData
    
            // Use previously cached info to set presence
            if (lastInfoCache && lastInfoCache.episodes) {
              const episode = lastInfoCache.episodes.find(ep => ep.id === episodeId || ep.url?.includes(episodeId));
    
              updateDiscordPresence({
                animeTitle: lastInfoCache.title,
                episodeTitle: episode?.title || 'Episode',
                thumbnail: lastInfoCache.thumbnail || lastInfoCache.image,
                largeImageKey: 'anime_thumb',
                largeImageText: `Watching ${lastInfoCache.title}`,
                smallImageKey: 'logo',
                smallImageText: 'Enjoying the show!',
              });
              
            }
    
            return response;
          } catch (err) {
            console.warn('[Rich Presence Intercept] Failed during /watch processing:', err);
          }
        }
      }
    
      return originalFetch(...args);
    };
    
    
  });

  // 💡 Dynamically update the Discord status
  globalThis.updateDiscordPresence = function ({ animeTitle, episodeTitle, thumbnail }) {
    if (!client) return;
    client.setActivity({
      details: `Watching ${animeTitle}`,
      state: episodeTitle,
      startTimestamp: Date.now(),
      largeImageKey: thumbnail, // ✅ Dynamic thumbnail
      largeImageText: animeTitle,
      smallImageKey: 'https://i.ibb.co/tptvZjMB/Chat-GPT-Image-Apr-9-2025-12-21-01-PM.png', // ✅ Your app logo (must be pre-configured in Discord Dev portal)
      smallImageText: 'Streaming via MyApp',
      instance: false,
      type: 3 // Streaming
    });
  };

  // 👋 Idle state (browsing)
  function setIdlePresence() {
    if (!client) return;
    client.setActivity({
      details: 'Browsing',
      state: 'In the app',
      startTimestamp: Date.now(),
      largeImageKey: 'https://i.ibb.co/tptvZjMB/Chat-GPT-Image-Apr-9-2025-12-21-01-PM.png', // show logo as main
      largeImageText: 'Browsing',
      smallImageKey: 'https://i.ibb.co/tptvZjMB/Chat-GPT-Image-Apr-9-2025-12-21-01-PM.png',
      smallImageText: 'Idle Mode',
      instance: false,
      type: 0
    });
  }
}
