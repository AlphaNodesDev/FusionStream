// EZTV provider: episode torrents by IMDb id.
// args: { type, imdb, tmdb, season, episode, name, year, genres }
async function getStreams(args, helpers) {
  if (args.type !== 'series') return [];
  const id = args.imdb.replace(/^tt/, '');
  const streams = [];
  // EZTV's imdb filter is loose (e.g. "Breaking Brad" for Breaking Bad), so the
  // release name must also start with the show name.
  const norm = (s) => String(s).toLowerCase().replace(/&/g, 'and').replace(/['’]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const show = norm(args.name);
  // The API pages at 100 results; long shows need a few pages to reach older seasons.
  for (let page = 1; page <= 5; page++) {
    const data = await helpers.fetchJson(`https://eztvx.to/api/get-torrents?imdb_id=${id}&limit=100&page=${page}`);
    const list = data.torrents || [];
    for (const t of list) {
      if (Number(t.season) !== args.season || Number(t.episode) !== args.episode) continue;
      if (!/^[a-f0-9]{40}$/i.test(t.hash || '')) continue;
      if (show && !norm(t.filename || t.title).startsWith(show)) continue;
      const gb = Number(t.size_bytes) / 1024 ** 3;
      const size = gb >= 1 ? `${gb.toFixed(2)} GB` : `${Math.round(gb * 1024)} MB`;
      streams.push({
        name: 'EZTV',
        title: `${t.filename || t.title}\n👤 ${t.seeds || 0} 💾 ${size} ⚙️ EZTV`,
        infoHash: t.hash.toLowerCase(),
        behaviorHints: { bingeGroup: 'eztv', filename: t.filename }
      });
    }
    if (list.length < 100) break;
  }
  return streams;
}
