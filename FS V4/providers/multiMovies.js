// multimovies.ts

import axios from 'axios';
import * as cheerio from 'cheerio';
import FormData from 'form-data';

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
  const doc = new JSDOM(html).window.document;

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
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
        'Referer': 'https://gdmirrorbot.nl/', // This is important – the site you got the embed from
        'Accept': '*/*',
        'Origin': 'https://gdmirrorbot.nl',
        'Connection': 'keep-alive'
      }
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
  console.log("🎬 Starting stream fetch for:", episodeId);
  try {
    const streamLinks = await multiGetStream(episodeId, 'movie');

    if (!streamLinks.length) {
      throw new Error('No valid stream links found');
    }

    const primary = streamLinks[0];

    return {
      sources: [
        {
          url: primary.link,
          quality: 'auto', // or you could extract variant qualities later
        },
      ],
      subtitles: primary.subtitles || [],
      headers: {
        Referer: new URL(episodeId).origin + '/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      },
    };
  } catch (err) {
    console.error('❌ watch() failed:', err.message);
    throw new Error('Failed to fetch stream');
  }
}




export async function getMultiMoviesStream(url) {
  const headers = {
    'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120", "Microsoft Edge";v="120"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'Referer': 'https://multimovies.online/',
    'Sec-Fetch-User': '?1',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
    'Origin': 'https://multimovies.online',
    'X-Requested-With': 'XMLHttpRequest',
  };

  try {
    const res = await axios.get(url, { headers });
    const html = res.data;
    const $ = cheerio.load(html);

    const postId = $('#player-option-1').attr('data-post') ?? '';
    const nume = $('#player-option-1').attr('data-nume') ?? '';
    const typeValue = $('#player-option-1').attr('data-type') ?? '';

    const baseUrl = url.split('/').slice(0, 3).join('/');

    const formData = new FormData();
    formData.append('action', 'doo_player_ajax');
    formData.append('post', postId);
    formData.append('nume', nume);
    formData.append('type', typeValue);

    const playerRes = await fetch(`${baseUrl}/wp-admin/admin-ajax.php`, {
      method: 'POST',
      headers,
      body: formData,
    });

    const playerData = await playerRes.json();
    let ifameUrl = playerData?.embed_url?.match(/<iframe[^>]+src=["']([^"']+)["']/i)?.[1] || playerData?.embed_url;

    if (!ifameUrl.includes('multimovies')) {
      let playerBaseUrl = ifameUrl.split('/').slice(0, 3).join('/');
      const headRes = await axios.head(playerBaseUrl, { headers });

      if (headRes?.request?.res?.responseUrl) {
        playerBaseUrl = headRes.request.res.responseUrl.split('/').slice(0, 3).join('/');
      }

      const playerId = ifameUrl.split('/').pop();
      const newFormData = new FormData();
      newFormData.append('sid', playerId);

      const newPlayerRes = await fetch(`${playerBaseUrl}/embedhelper.php`, {
        method: 'POST',
        headers,
        body: newFormData,
      });

      const newPlayerData = await newPlayerRes.json();
      let siteId;
      try {
        siteId = JSON.parse(atob(newPlayerData?.mresult))?.smwh;
      } catch (e) {
        siteId = newPlayerData?.mresult?.smwh;
      }

      const siteUrl = newPlayerData?.siteUrls?.smwh;
      ifameUrl = siteUrl + siteId;
    }

    const iframeRes = await axios.get(ifameUrl, { headers });
    const iframeData = iframeRes.data;

    const functionRegex = /eval\(function\((.*?)\)\{.*?return p\}.*?\('(.*?)'\.split/;
    const match = functionRegex.exec(iframeData);

    let decodedScript = '';
    if (match) {
      const encodedString = match[2];
      decodedScript = encodedString.split("',36,")[0];
      const a = 36;
      const k = encodedString.split("',36,")[1].slice(2).split('|');
      let c = k.length;

      while (c--) {
        if (k[c]) {
          const regex = new RegExp('\\b' + c.toString(a) + '\\b', 'g');
          decodedScript = decodedScript.replace(regex, k[c]);
        }
      }
    }

    const streamUrl = decodedScript?.match(/file:\s*"([^"]+\.m3u8[^"]*)"/)?.[1];
    const subtitles = [];
    const subtitleMatch = decodedScript?.match(/https:\/\/[^\s"]+\.vtt/g);

    if (subtitleMatch?.length) {
      subtitleMatch.forEach(sub => {
        const langMatch = sub.match(/_([a-zA-Z]{3})\.vtt$/);
        const lang = langMatch ? langMatch[1] : 'eng';
        subtitles.push({
          language: lang,
          uri: sub,
          type: 'vtt',
          title: lang,
        });
      });
    }

    if (streamUrl) {
      return [
        {
          server: 'Multi',
          link: streamUrl.replace(/&i=\d+(\.\d+)?&/, '&i=0.4&'),
          type: 'm3u8',
          subtitles,
        },
      ];
    }

    return [];
  } catch (err) {
    console.error('Error fetching stream:', err);
    return [];
  }
}
