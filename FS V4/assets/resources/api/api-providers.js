export default function (api) {
    api.get('/providers', async (req, res) => {
      try {
        const response = await fetch('https://raw.githubusercontent.com/AlphaNodesDev/FusionStream/main/providers.json');
        if (!response.ok) throw new Error('Failed to fetch from GitHub');
        const data = await response.json();
        res.json(data);
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Could not fetch providers from GitHub' });
      }
    });
  }
  