import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default function (api) {
  api.get('/info', async (req, res) => {
    const providerKey = req.query.provider;
    const id = req.query.id;

    if (!providerKey || !id) {
      return res.status(400).json({ error: 'Provider and ID required' });
    }

    try {
      const providerPath = path.join(__dirname, `../../../providers/${providerKey}.js`);
      const providerModule = await import(`file://${providerPath}`);

      if (typeof providerModule.fetchInfo !== 'function') {
        return res.status(500).json({ error: 'Provider does not support info fetching' });
      }

      const info = await providerModule.fetchInfo(id);
      res.json(info);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to fetch info' });
    }
  });
}
