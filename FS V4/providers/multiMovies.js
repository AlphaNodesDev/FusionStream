// multimovies.ts

import axios from 'axios';
import * as cheerio from 'cheerio';
import FormData from 'form-data';
import puppeteer from 'puppeteer'
const TextTrackType = {
  VTT: 'vtt',
};
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
    const streamLinks = await multiGetStream(episodeId);

    if (!streamLinks.length) {
      throw new Error('No valid stream links found');
    }

    // 🧠 Merge subtitles from all streams
    const allSubtitles = streamLinks.flatMap(link => link.subtitles || []);
     
    const result = {
      sources: streamLinks.map(link => ({
        url: link.link,
        quality: link.quality || 'default'
      })),
      subtitles: allSubtitles.map(sub => ({
        url: sub.url,
        language: sub.lang || 'Unknown'
     
      })),
      headers: {
        Referer: new URL(episodeId).origin + '/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      }
    };

    console.log("✅ Parsed Stream Data:", result);
    return result;

  } catch (err) {
    console.error('❌ watch() failed:', err.message);
    throw new Error('Failed to fetch stream');
  }
}



/**
 * Custom headers copied from app
 */
const headers = {
  'sec-ch-ua':
    '"Not_A Brand";v="8", "Chromium";v="120", "Microsoft Edge";v="120"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
};

/**
 * Gets streaming links for a movie page
 * @param {string} url - The multimovies.guru movie URL
 * @returns {Promise<Stream[]>}
 */
function getLangFromUrl(url) {
    const match = url.match(/_(\w+)\.vtt$/);
  if (!match) return 'Unknown';

  const code = match[1].toLowerCase();

  const langMap = {
    eng: 'English',
    ara: 'Arabic',
    jpn: 'Japanese',
    chi: 'Chinese',
    ind: 'Indonesian',
    spa: 'Spanish',
    fra: 'French',
    ger: 'German',
    ita: 'Italian',
    kor: 'Korean'
  };
  

  return langMap[code] || code.toUpperCase();
}

export const multiGetStream = async (url) => {
  console.log('🎯 Launching Puppeteer to fetch page:', url);

  let browser;
  const interceptedStreams = [];

  try {
    browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();

    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const reqUrl = req.url();

      // 🎥 HLS streams
      if (reqUrl.includes('.m3u8')) {
        let quality = 'default';
        const match = reqUrl.match(/index-(f\d+)-v\d+-a\d+\.m3u8/);
        if (match) {
          const qualityCode = match[1];
          switch (qualityCode) {
            case 'f1':
              quality = '360p';
              break;
            case 'f2':
              quality = '480p';
              break;
            case 'f3':
              quality = '720p';
              break;
            case 'f4':
              quality = '1080p';
              break;
            default:
              quality = 'auto';
          }
        } else if (reqUrl.includes('master.m3u8')) {
          quality = 'auto';
        }

        console.log(`📡 Intercepted stream: ${reqUrl} (Quality: ${quality})`);

        interceptedStreams.push({
          server: 'Multi',
          link: reqUrl,
          type: 'm3u8',
          quality,
          subtitles: [],
        });
      }

      if (reqUrl.endsWith('.vtt') || reqUrl.endsWith('.srt')) {
        console.log(`📝 Found subtitle: ${reqUrl}`);
        if (interceptedStreams.length > 0) {
          interceptedStreams[interceptedStreams.length - 1].subtitles.push({
            url: reqUrl,
            lang: getLangFromUrl(reqUrl)
          });
        }
      }
      

      req.continue();
    });

    await page.goto(url, { waitUntil: 'domcontentloaded' });

    await page.waitForSelector('iframe', { timeout: 10000 });
    const iframeUrl = await page.evaluate(() => {
      const iframe = document.querySelector('iframe');
      return iframe?.src || null;
    });

    console.log('🎥 Found iframe:', iframeUrl);
    if (!iframeUrl) throw new Error('No iframe found');

    await page.goto(iframeUrl, { waitUntil: 'networkidle2' });
    await new Promise((res) => setTimeout(res, 5000));

    if (!interceptedStreams.length) {
      throw new Error('No stream URLs intercepted');
    }

    return interceptedStreams;
  } catch (err) {
    console.error('⚠️ multiGetStream() failed:', err.message);
    return [];
  } finally {
    if (browser) await browser.close();
  }
};
