import RPC from 'discord-rpc';
import dotenv from 'dotenv';

dotenv.config(); 

export const name = "Discord Rich Presence";
export const version = "1.0.0";
export const description = "Enables Discord Rich Presence while watching.";
export const image = "https://i.ibb.co/bgwNyMH4/8b81eb984a67f6652e430b88962a1bd4.jpg"; 

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
    client.setActivity({
      details: 'Watching Anime',
      state: 'Episode 3',
      startTimestamp: Date.now(),
      largeImageKey: 'logo',
      instance: false,
    });
  });
}
