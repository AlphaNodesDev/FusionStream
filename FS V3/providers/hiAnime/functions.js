export const hiAnimeCatalog = [
    { title: 'Top Airing', filter: 'top' },
    { title: 'Recent Episodes', filter: 'recent' }
  ];
  
  export async function fetchHiAnimeCatalog(filter) {
    const baseUrl = 'https://consumet.8man.me/anime/zoro';
    const url = filter === 'recent'
      ? `${baseUrl}/recent-episodes`
      : `${baseUrl}/top-airing`;
  
    const res = await fetch(url);
    const data = await res.json();
  
    return {
      results: data.results.map(normalizeHiAnime)
    };
  }
  
  export async function searchHiAnime(query) {
    const url = `https://consumet.8man.me/anime/zoro/${encodeURIComponent(query)}?page=1`;
    const res = await fetch(url);
    const data = await res.json();
  
    return (data.results || []).map(normalizeHiAnime);
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
      image: item.image,
      synopsis: item.description || '',
      tags: [item.status, item.releaseDate],
      imdbId: '',
      type: item.episodes?.length > 1 ? 'series' : 'movie'
    };
  }
  