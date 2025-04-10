export const catalog = [
  { title: 'Top Airing', filter: 'top' },
  { title: 'Recent Episodes', filter: 'recent' }
];

export async function fetchCatalog(filter) {
  const baseUrl = 'https://consumet.8man.me/movies/dramacool';
  const url = filter === 'recent'
    ? `${baseUrl}/recent-episodes`
    : `${baseUrl}/top-airing`;

  const res = await fetch(url);
  const data = await res.json();

  return {
    results: data.results.map(normalizeHiAnime)
  };
}

export async function search(query) {
  const url = `https://consumet.8man.me/movies/dramacool/${encodeURIComponent(query)}?page=1`;
  const res = await fetch(url);
  const data = await res.json();

  return (data.results || []).map(normalizeHiAnime);
}

export async function fetchInfo(id) {
  const res = await fetch(`https://consumet.8man.me/movies/dramacool/info?id=${encodeURIComponent(id)}`);
  const data = await res.json();

  data.episodes = (data.episodes || []).map(ep => ({
    id: ep.id || ep.url,
    title: ep.title || `Episode ${ep.number}`,
    number: ep.number,
    image: ep.image,
    url: ep.url
  }));

  return {
    id: data.id,
    title: typeof data.title === 'string' ? data.title : (
      data.title?.english || data.title?.romaji || data.title?.userPreferred || 'Unknown Title'
    ),
    image: data.image,
    thumbnail: data.image,
    synopsis: data.description || '',
    tags: [data.status, data.releaseDate],
    episodes: data.episodes
  };
}

function normalizeHiAnime(item) {
  let title = '';
  if (typeof item.title === 'string') {
    title = item.title;
  } else if (item.title) {
    title = item.title.english || item.title.romaji || item.title.userPreferred || '';
  }

  return {
    id: item.id,
    title,
    thumbnail: item.image,
    synopsis: item.description || '',
    tags: [item.status, item.releaseDate],
    type: item.episodes?.length > 1 ? 'series' : 'movie'
  };
}



export async function watch(episodeId) {
  const servers = ['$sub', '$dub', '$vidcdn', '$gogo'];

  let lastError;

  for (const server of servers) {
    let id = episodeId;

    // Append server suffix if not present
    if (!episodeId.includes('$' + server.replace('$', ''))) {
      id += server;
    }

    try {
      const url = `https://consumet.8man.me/movies/dramacool/watch?episodeId=${encodeURIComponent(id)}`;
      const res = await fetch(url);
      const data = await res.json();
           
      if (data.sources && data.sources.length) {
        const result = {
          sources: data.sources.map(src => ({
            url: src.url,
            quality: src.quality || "default"
          })),
          subtitles: (data.subtitles || []).map(sub => ({
            url: sub.url,
            language: sub.lang || "Unknown"
          })),
          headers: {
            Referer: "https://consumet.8man.me"
          }
        };
      
        console.log("✅ Parsed Episode Data:", result);
        return result;
      }
      

      lastError = new Error(`No sources from server ${server}`);
    } catch (err) {
      lastError = err;
    }
  }

  // If all fail
  throw lastError || new Error('No sources returned from any server');
}
