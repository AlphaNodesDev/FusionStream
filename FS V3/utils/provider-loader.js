import modflix from '../modflix.json' assert { type: 'json' };

export async function loadProvider(providerName) {
  const baseURL = modflix[providerName].url;

  const catalog = await import(`../providers/${providerName}/catalog.js`);
  const info = await import(`../providers/${providerName}/getinfo.js`);
  const stream = await import(`../providers/${providerName}/stream.js`);

  return {
    getRecentEpisodes: () => catalog.getRecentEpisodes(baseURL),
    searchAnime: (query) => catalog.searchAnime(query, baseURL),
    getInfo: (id) => info.getInfo(id, baseURL),
    getWatch: (epId) => stream.getWatch(epId, baseURL),
  };
}



