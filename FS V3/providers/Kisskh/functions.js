export const kisskhCatalog = [
    { title: 'Latest', filter: 'latest' }
  ];
  
  export async function fetchKisskhCatalog(filter) {
    const url = `https://kisskh.ovh/api/DramaList/Search?type=0&size=10&page=1`;
    const res = await fetch(url);
    const data = await res.json();
  
    return {
      results: data.map(item => normalizeKisskh(item))
    };
  }
  
  export async function searchKisskh(query) {
    const url = `https://kisskh.ovh/api/DramaList/Search?q=${encodeURIComponent(query)}&type=0`;
    const res = await fetch(url);
    const data = await res.json();
  
    return data.map(item => normalizeKisskh(item));
  }
  
  function normalizeKisskh(item) {
    return {
      id: item.id,
      title: item.title || item.titleEn,
      image: item.thumbnail || item.poster,
      synopsis: item.description || '',
      tags: [],
      imdbId: '',
      type: item.episodesCount > 1 ? 'series' : 'movie'
    };
  }
  