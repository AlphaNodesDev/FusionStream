
      
      import axios from 'axios';
      import * as cheerio from 'cheerio';

/**
 * @typedef {Object} Stream
 * @property {string} server
 * @property {string} link
 * @property {string} type
 * @property {Array<Object>} subtitles
 */

export const multiGetStream = async (url, type) => {
  try {
    const headers = {
        'sec-ch-ua':
          '"Not_A Brand";v="8", "Chromium";v="120", "Microsoft Edge";v="120"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        Referer: 'https://multimovies.online/',
        'Sec-Fetch-User': '?1',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
      };

    const res = await axios.get(url, { headers });
    const html = res.data;
    const $ = cheerio.load(html);

    const streamLinks = [];

    const postId = $('#player-option-1').attr('data-post');
    const nume = $('#player-option-1').attr('data-nume');
    const typeValue = $('#player-option-1').attr('data-type');

    const baseUrl = url.split('/').slice(0, 3).join('/');

    const formData = new URLSearchParams();
    formData.append('action', 'doo_player_ajax');
    formData.append('post', postId);
    formData.append('nume', nume);
    formData.append('type', typeValue);

    const playerRes = await axios.post(`${baseUrl}/wp-admin/admin-ajax.php`, formData, {
      headers: {
        ...headers,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });

    let iframeUrl = playerRes.data?.embed_url?.match(/src="([^"]+)"/)?.[1] || playerRes.data?.embed_url;

    if (iframeUrl.startsWith('//')) {
        iframeUrl = 'https:' + iframeUrl;
      }
      

    const iframeRes = await axios.get(iframeUrl, { headers });
    const iframeData = iframeRes.data;

    // Simple match for .m3u8 stream link
    const streamUrl = iframeData.match(/https:\/\/[^"]+\.m3u8[^"]*/)?.[0];

    if (!streamUrl) {
      throw new Error('Stream URL not found in iframe HTML');
    }

    streamLinks.push({
      server: 'Multi',
      link: streamUrl,
      type: 'm3u8',
      subtitles: [], // Add subtitle support if needed
    });

    return streamLinks;
  } catch (err) {
    console.error('multiGetStream error:', err);
    return [];
  }
};
