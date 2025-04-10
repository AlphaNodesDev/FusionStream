// extensions/discordRPC.js
import rpc from 'discord-rpc';

const clientId = '1359229702983909637';
const client = new rpc.Client({ transport: 'ipc' });

let startTimestamp = new Date();

function setActivity(title = 'MultiMovies', details = 'Idle', state = 'Waiting...', thumbnail = 'logo') {
  client.setActivity({
    details,
    state,
    startTimestamp,
    largeImageKey: thumbnail || 'logo',
    largeImageText: title,
    smallImageKey: 'play',
    smallImageText: 'Streaming',
    instance: false,
  });
}

export default function initRPC() {
  if (!global._app) {
    console.warn('🟡 Express app not found. Discord RPC route not registered.');
    return;
  }

  client.on('ready', () => {
    console.log('🟢 Discord RPC connected');
    setActivity();
  });

  client.login({ clientId }).catch(console.error);

  // Register route using global._app
  global._app.get('/discordrpc', (req, res) => {
    const { title, episode, thumbnail } = req.query;

    if (!title || !episode) {
      return res.status(400).json({ error: 'Missing title or episode' });
    }

    setActivity(title, `Watching ${title}`, `Episode ${episode}`, thumbnail);
    res.json({ success: true });
  });
}
