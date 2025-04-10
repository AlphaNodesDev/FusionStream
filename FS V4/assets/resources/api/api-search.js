import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default function (api) {
  api.get('/search', async (req, res) => {
    const providerKey = req.query.provider;
    const query = req.query.q;

    if (!providerKey || !query) {
      return res.status(400).json({ error: 'Provider and query are required' });
    }

    try {
      const providerPath = path.join(__dirname, `../../../providers/${providerKey}.js`);
      const providerModule = await import(`file://${providerPath}`);

      if (typeof providerModule.search !== 'function') {
        return res.status(500).json({ error: 'Search not supported by this provider' });
      }

      const results = await providerModule.search(query);
      res.json({ results });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to perform search' });
    }
  });
}
