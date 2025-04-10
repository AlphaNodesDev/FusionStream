import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default function (api) {
  api.get('/catalog', async (req, res) => {
    const providerKey = req.query.provider;
    if (!providerKey) return res.status(400).json({ error: 'Provider is required' });

    try {
      const providerPath = path.join(__dirname, `../../../providers/${providerKey}.js`);
      const providerModule = await import(`file://${providerPath}`);

      const catalog = {};
      for (const entry of providerModule.catalog) {
        const data = await providerModule.fetchCatalog(entry.filter);
        catalog[entry.title] = data.results;
      }

      res.json(catalog);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to fetch catalog' });
    }
  });
}
