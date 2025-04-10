const baseUrl = 'https://multimovies.press';

export const multiMoviesCatalog = [
  { title: 'Trending', filter: '/trending/' },
  { title: 'Netflix', filter: '/genre/netflix/' },
  { title: 'Amazon Prime', filter: '/genre/amazon-prime/' },
  { title: 'Disney Hotstar', filter: '/genre/disney-hotstar/' }
];

// Fetch catalog like Trending, Netflix, etc.
export async function fetchMultiMoviesCatalog(filter) {
  const url = `${baseUrl}${filter}page/1/`;
  const res = await fetch(url);
  const html = await res.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  const cards = [...doc.querySelectorAll('.items.full > *')].map((el) => {
    const img = el.querySelector('.poster img');
    const linkEl = el.querySelector('.poster a');
    const link = linkEl?.href || '';

    return {
      id: link, // use link as unique identifier
      title: img?.alt || 'Unknown',
      link: link,
      image: img?.dataset?.src || img?.src || '',
      type: 'movie'
    };
  });

  return {
    results: cards.filter(item => item.title && item.link && item.image)
  };
}

// Search functionality
export async function searchMultiMovies(query) {
  const url = `${baseUrl}/?s=${encodeURIComponent(query)}`;
  const res = await fetch(url);
  const html = await res.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  const items = [...doc.querySelectorAll('.result-item')].map((el) => {
    const img = el.querySelector('img');
    const a = el.querySelector('a');
    const link = a?.href || '';

    return {
      id: link,
      title: img?.alt || 'Unknown',
      link: link,
      image: img?.dataset?.src || img?.src || '',
      type: 'movie'
    };
  });

  return items.filter(item => item.title && item.link);
}
