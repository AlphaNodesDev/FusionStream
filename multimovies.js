import axios from 'axios';
import * as cheerio from 'cheerio';
import puppeteer from 'puppeteer';

// 🔄 In-memory cache
const memoryCache = new Map();
const CACHE_TTL = 1000 * 60 * 5; // 5 minutes

function cacheGet(key) {
  const entry = memoryCache.get(key);
  if (entry && (Date.now() - entry.timestamp) < CACHE_TTL) {
    return entry.data;
  }
  memoryCache.delete(key);
  return null;
}

function cacheSet(key, data) {
  memoryCache.set(key, { timestamp: Date.now(), data });
}

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
  const url = `https://multimovies.press${filter}?page=1`;
  const cached = cacheGet(url);
  if (cached) return cached;

  const res = await axios.get(url);
  const $ = cheerio.load(res.data);

  const items = $('.items.full > *').map((_, el) => {
    const img = $(el).find('.poster img');
    const link = $(el).find('.poster a').attr('href') || '';
    return normalizeMultiMovies({
      id: link,
      title: img.attr('alt') || 'Unknown',
      thumbnail: img.data('src') || img.attr('src') || '',
      type: 'movie'
    });
  }).get();

  const result = { results: items.filter(item => item.id && item.title && item.thumbnail) };
  cacheSet(url, result);
  return result;
}

export async function search(query) {
  const url = `https://multimovies.press/?s=${encodeURIComponent(query)}`;
  const cached = cacheGet(url);
  if (cached) return cached;

  const res = await axios.get(url);
  const $ = cheerio.load(res.data);

  const items = $('.result-item').map((_, el) => {
    const img = $(el).find('img');
    const a = $(el).find('a');
    return normalizeMultiMovies({
      id: a.attr('href') || '',
      title: img.attr('alt') || 'Unknown',
      thumbnail: img.data('src') || img.attr('src') || '',
      type: 'movie'
    });
  }).get();

  const result = items.filter(item => item.title && item.id && item.thumbnail);
  cacheSet(url, result);
  return result;
}


async function multiGetInfo(link) {
  try {
    const res = await axios.get(link, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Referer': 'https://gdmirrorbot.nl/',
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
        season: season.title, // 👈 add this!
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

export async function multiGetStream(url) {
  console.log('🎯 Launching Puppeteer to fetch page:', url);
  let browser;
  const interceptedStreams = [];
  const subtitleList = [];

  try {
    browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();

    await page.setRequestInterception(true);
    page.on('request', async (req) => {
      const reqUrl = req.url();

      // 🎬 Intercept stream files
      if (reqUrl.includes('.m3u8')) {
        let quality = 'default';
        const match = reqUrl.match(/index-(f\d+)-v\d+-a\d+\.m3u8/);
        if (match) {
          const qualityCode = match[1];
          const qualities = {
            f1: '360p',
            f2: '480p',
            f3: '720p',
            f4: '1080p'
          };
          quality = qualities[qualityCode] || 'auto';
        } else if (reqUrl.includes('master.m3u8')) {
          quality = 'auto';
        }

        console.log(`📡 Intercepted stream: ${reqUrl} (Quality: ${quality})`);

        const frame = req.frame();
        console.log(`↪ Triggered by frame: ${frame.url()}`);

        try {
          const elementHTMLs = await frame.evaluate(() => {
            const elements = Array.from(document.querySelectorAll('iframe, video, source'))
              .map(el => el.outerHTML);
            return elements;
          });

          console.log("🔍 Elements in triggering frame that might hold stream:");
          console.log(elementHTMLs.join('\n---\n'));
        } catch (evalErr) {
          console.warn('⚠️ Failed to inspect elements in frame:', evalErr.message);
        }

        interceptedStreams.push({
          server: 'Multi',
          link: reqUrl,
          type: 'm3u8',
          quality,
          subtitles: [] // Will be filled later
        });
      }

      // 📝 Intercept subtitles
      if (reqUrl.endsWith('.vtt') || reqUrl.endsWith('.srt')) {
        console.log(`📝 Found subtitle: ${reqUrl}`);
        subtitleList.push({
          url: reqUrl,
          lang: getLangFromUrl(reqUrl)
        });
      }

      req.continue();
    });

    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('iframe', { timeout: 10000 });

    const iframeUrl = await page.evaluate(() => {
      const iframe = document.querySelector('iframe');
      return iframe?.src || null;
    });

    if (!iframeUrl) throw new Error('No iframe found');
    console.log('🌐 Navigating into iframe:', iframeUrl);

    await page.goto(iframeUrl, { waitUntil: 'networkidle2' });

    // Wait for requests to finish
    await new Promise(resolve => setTimeout(resolve, 5000));

    if (!interceptedStreams.length) {
      throw new Error('No stream URLs intercepted');
    }

    interceptedStreams[0].subtitles = subtitleList;

    return interceptedStreams;
  } catch (err) {
    console.error('⚠️ multiGetStream() failed:', err.message);
    return [];
  } finally {
    if (browser) await browser.close();
  }
}



export async function watch(episodeId) {
  console.log("🎬 Starting stream fetch for:", episodeId);
  try {
    const streamLinks = await multiGetStream(episodeId);
    if (!streamLinks.length) throw new Error('No valid stream links found');

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

