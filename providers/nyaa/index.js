// Nyaa provider: anime torrents via the nyaa.si RSS feed.
// args: { type, imdb, tmdb, season, episode, name, year, genres }
async function getStreams(args, helpers) {
  // Nyaa is anime-only; skip other titles to avoid wrong matches.
  if (!(args.genres || []).some((g) => /anim/i.test(g)) || !args.name) return [];

  const pad = (n) => String(n).padStart(2, '0');
  const query = args.type === 'series'
    ? `${args.name} ${args.season > 1 ? 'S' + pad(args.season) + 'E' : ''}${pad(args.episode)}`
    : `${args.name} ${args.year || ''}`;
  const xml = await helpers.fetchText(`https://nyaa.si/?page=rss&c=1_2&f=0&q=${encodeURIComponent(query.trim())}`);
  const doc = helpers.parseXML(xml);
  const ns = 'https://nyaa.si/xmlns/nyaa';

  // Episode check: "- 05", "E05", "S02E05", " 05 " etc., but not batches ranges like 01-12.
  const ep = args.episode;
  const epRe = new RegExp(`(?:\\bS0?${args.season}E0?${ep}\\b|[\\s_\\-\\[]E?0?${ep}(?:v\\d)?[\\s_\\]\\.](?!\\s*[-~]\\s*\\d))`, 'i');

  const streams = [];
  for (const item of doc.querySelectorAll('item')) {
    const title = item.querySelector('title')?.textContent || '';
    const hash = item.getElementsByTagNameNS(ns, 'infoHash')[0]?.textContent || '';
    const seeders = item.getElementsByTagNameNS(ns, 'seeders')[0]?.textContent || '0';
    const size = item.getElementsByTagNameNS(ns, 'size')[0]?.textContent || '';
    if (!/^[a-f0-9]{40}$/i.test(hash) || Number(seeders) < 1) continue;
    if (args.type === 'series' && !epRe.test(` ${title} `)) continue;
    streams.push({
      name: 'Nyaa',
      title: `${title}\n👤 ${seeders} 💾 ${size.replace('GiB', 'GB').replace('MiB', 'MB')} ⚙️ Nyaa`,
      infoHash: hash.toLowerCase(),
      behaviorHints: { bingeGroup: 'nyaa' }
    });
  }
  return streams.slice(0, 25);
}
