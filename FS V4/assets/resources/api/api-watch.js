import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default function (api) {
  api.get('/watch', async (req, res) => {
    const providerKey = req.query.provider;
    const episodeId = req.query.episodeId;

    if (!providerKey || !episodeId) {
      return res.status(400).json({ error: 'Provider and episode ID required' });
    }

    try {
      const providerPath = path.join(__dirname, `../../../providers/${providerKey}.js`);
      const providerModule = await import(`file://${providerPath}`);

      if (typeof providerModule.watch !== 'function') {
        return res.status(500).json({ error: 'Provider does not support streaming' });
      }

      const streamData = await providerModule.watch(episodeId);
      res.json(streamData);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to fetch stream' });
    }
  });
}
