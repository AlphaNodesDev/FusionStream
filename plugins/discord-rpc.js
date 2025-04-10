
import RPC from 'discord-rpc';

export const name = "Discord Rich Presence";
export const version = "1.0.0";
export const description = "Enables Discord Rich Presence while watching.";
export const image = "https://i.ibb.co/bgwNyMH4/8b81eb984a67f6652e430b88962a1bd4.jpg"; // Can be a public URL or local

export function register() {
  const client = new RPC.Client({ transport: 'ipc' });

  client.login({ clientId: '' });

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
