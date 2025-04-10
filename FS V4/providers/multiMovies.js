import axios from 'axios';
import * as cheerio from 'cheerio';

export const catalog = [
  { title: 'Trending', filter: '/trending/' },
  { title: 'Netflix', filter: '/genre/netflix/' },
  { title: 'Amazon Prime', filter: '/genre/amazon-prime/' },
  { title: 'Disney Hotstar', filter: '/genre/disney-hotstar/' }
];

function normalizeMultiMovies(item) {
  return {
    id: item.id,
    title: item.title,
    thumbnail: item.thumbnail,
    synopsis: item.synopsis || '',
    tags: item.tags || [],
    type: item.type || 'movie'
  };
}

export async function fetchCatalog(filter) {
  const url = `https://multimovies.press${filter}page/1/`;
  const res = await fetch(url);
  const html = await res.text();
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM(html);
  const doc = dom.window.document;

  const items = [...doc.querySelectorAll('.items.full > *')].map(el => {
    const img = el.querySelector('.poster img');
    const link = el.querySelector('.poster a')?.href || '';
    return normalizeMultiMovies({
      id: link,
      title: img?.alt || 'Unknown',
      thumbnail: img?.dataset?.src || img?.src || '',
      type: 'movie'
    });
  });

  return { results: items.filter(item => item.id && item.title && item.thumbnail) };
}

export async function search(query) {
  const url = `https://multimovies.press/?s=${encodeURIComponent(query)}`;
  const res = await fetch(url);
  const html = await res.text();
  const { JSDOM } = await import('jsdom');
  const doc = new JSDOM(html).window.document;

  const items = [...doc.querySelectorAll('.result-item')].map(el => {
    const img = el.querySelector('img');
    const a = el.querySelector('a');
    return normalizeMultiMovies({
      id: a?.href || '',
      title: img?.alt || 'Unknown',
      thumbnail: img?.dataset?.src || img?.src || '',
      type: 'movie'
    });
  });

  return items.filter(item => item.title && item.id && item.thumbnail);
}

async function multiGetInfo(link) {
  try {
    const res = await axios.get(link, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
    });

    const $ = cheerio.load(res.data);
    const type = link.includes('tvshows') ? 'series' : 'movie';
    const title = decodeURIComponent(link.split('/').filter(Boolean).pop() || '').replace(/-/g, ' ');
    const image = $('.g-item a').attr('href') || '';
    const synopsis = $('.wp-content p').first().text() || '';
    const links = [];

    if (type === 'series') {
      $('#seasons').children().each((_, season) => {
        const seasonTitle = $(season).find('.title').text().trim();
        const episodesList = [];

        $(season).find('.episodios').children().each((__, ep) => {
          const epTitle = 'Episode ' + ($(ep).find('.numerando').text().split('-')[1]?.trim() || '1');
          const epLink = $(ep).find('a').attr('href');
          if (epLink) {
            episodesList.push({ title: epTitle, link: epLink });
          }
        });

        if (seasonTitle && episodesList.length) {
          links.push({ title: seasonTitle, directLinks: episodesList });
        }
      });
    } else {
      links.push({
        title,
        directLinks: [{ title, link, type: 'movie' }]
      });
    }

    return { title, synopsis, image, type, linkList: links };
  } catch (err) {
    console.error('❌ multiGetInfo failed:', err.message);
    return { title: '', synopsis: '', image: '', type: 'movie', linkList: [] };
  }
}

export async function fetchInfo(id) {
  try {
    const info = await multiGetInfo(id);
    const isTVShow = info.type === 'series';

    const episodes = info.linkList.flatMap(season =>
      season.directLinks.map((ep, idx) => ({
        id: ep.link,
        title: ep.title || `Episode ${idx + 1}`,
        number: idx + 1,
        image: info.image,
        url: ep.link
      }))
    );

    return {
      id,
      title: info.title,
      image: info.image,
      thumbnail: info.image,
      synopsis: info.synopsis || 'No description available.',
      tags: [isTVShow ? 'TV Show' : 'Movie'],
      episodes: episodes.length ? episodes : [{
        id,
        title: 'Episode 1',
        number: 1,
        image: info.image,
        url: id
      }]
    };
  } catch (err) {
    console.error('❌ fetchInfo failed:', err.message);
    return {
      id,
      title: 'Untitled',
      image: '',
      thumbnail: '',
      synopsis: 'No description available.',
      tags: [],
      episodes: []
    };
  }
}

export async function watch(episodeId) {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    Referer: 'https://multimovies.online/',
  };

  try {
    const res = await fetch(episodeId, { headers });
    if (!res.ok) throw new Error('Failed to load episode page');

    const html = await res.text();
    const { JSDOM } = await import('jsdom');
    const doc = new JSDOM(html).window.document;

    const playerEl = doc.querySelector('[data-post][data-nume][data-type]');
    const postId = playerEl?.getAttribute('data-post');
    const nume = playerEl?.getAttribute('data-nume');
    const typeValue = playerEl?.getAttribute('data-type');

    if (!postId || !nume || !typeValue) {
      throw new Error('Missing data attributes');
    }

    const baseUrl = new URL(episodeId).origin;
    const formData = new URLSearchParams();
    formData.append('action', 'doo_player_ajax');
    formData.append('post', postId);
    formData.append('nume', nume);
    formData.append('type', typeValue);

    const playerRes = await fetch(`${baseUrl}/wp-admin/admin-ajax.php`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        ...headers
      },
      body: formData,
    });
  
    const playerData = await playerRes.json();
    let iframeUrl =
      playerData?.embed_url?.match(/<iframe[^>]+src="([^"]+)"/i)?.[1] ||
      playerData?.embed_url;

    // Optional: extract stream from iframe
    const iframeRes = await fetch(iframeUrl, { headers });
    const iframeHtml = await iframeRes.text();

    // Extract stream
    const streamUrl = iframeHtml.match(/file:\s*"([^"]+\.m3u8[^"]*)"/)?.[1];
    if (!streamUrl) throw new Error('No stream URL found');

    const subtitleMatches = iframeHtml.match(/https:\/\/[^\s"]+\.vtt/g) || [];
    const subtitles = subtitleMatches.map(sub => {
      const lang = sub.match(/_([a-zA-Z]{3})\.vtt$/)?.[1] || 'eng';
      return {
        language: lang,
        uri: sub,
        title: lang,
        type: 'vtt',
      };
    });

    return {
      sources: [{ url: streamUrl, quality: 'auto' }],
      subtitles,
      headers: { Referer: baseUrl }
    };
  } catch (err) {
    console.error('❌ watch() failed:', err.message);
    throw new Error('Failed to fetch stream');
  }
}
