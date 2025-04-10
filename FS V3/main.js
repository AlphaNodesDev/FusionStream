import electron from 'electron';
const { app, BrowserWindow } = electron;

import path from 'path';
import fs from 'fs';
import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import axios from 'axios';
import * as cheerio from 'cheerio';
import FormData from 'form-data';
import fetch from 'node-fetch';
import { pathToFileURL } from 'url';
import chokidar from 'chokidar';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { initialize, enable } from '@electron/remote/main/index.js'; 
initialize();

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 800,
    icon: path.join(__dirname, 'logo.png'),
   frame: false, 
   titleBarStyle: 'hiddenInset', 
   backgroundColor: '#000000',
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: true,
    },
  });
  enable(mainWindow.webContents);

  mainWindow.setMenu(null); 

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

function startBackend() {
  const server = express();
  server.use(cors());
  global._app = server;
  async function multiGetStream(url, type) {
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      Referer: 'https://multimovies.online/',
    };

    try {
      const res = await axios.get(url, { headers });
      const html = res.data;
      const $ = cheerio.load(html);
      const streamLinks = [];

      const playerEl = $('[data-post][data-nume][data-type]').first();
      const postId = playerEl.attr('data-post');
      const nume = playerEl.attr('data-nume');
      const typeValue = playerEl.attr('data-type');

      if (!postId || !nume || !typeValue) {
        console.warn('⚠️ Missing data attributes from page:', { postId, nume, typeValue });
        return [];
      }

      const formData = new FormData();
      formData.append('action', 'doo_player_ajax');
      formData.append('post', postId);
      formData.append('nume', nume);
      formData.append('type', typeValue);

      const baseUrl = url.split('/').slice(0, 3).join('/');

      const playerRes = await fetch(`${baseUrl}/wp-admin/admin-ajax.php`, {
        headers,
        body: formData,
        method: 'POST',
      });

      const contentType = playerRes.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        const fallback = await playerRes.text();
        console.error('💥 Expected JSON but received HTML:', fallback.slice(0, 200));
        return [];
      }

      const playerData = await playerRes.json();
      let iframeUrl =
        playerData?.embed_url?.match(/<iframe[^>]+src="([^"]+)"/i)?.[1] ||
        playerData?.embed_url;

      if (!iframeUrl.includes('multimovies')) {
        let playerBaseUrl = iframeUrl.split('/').slice(0, 3).join('/');
        const headRes = await axios.head(playerBaseUrl, { headers });
        if (headRes?.request?.res?.responseUrl) {
          playerBaseUrl = headRes.request.res.responseUrl.split('/').slice(0, 3).join('/');
        }

        const playerId = iframeUrl.split('/').pop();
        const newFormData = new FormData();
        newFormData.append('sid', playerId);

        const playerRes2 = await fetch(`${playerBaseUrl}/embedhelper.php`, {
          headers,
          body: newFormData,
          method: 'POST',
        });

        const helperJson = await playerRes2.json();
        const siteUrl = helperJson?.siteUrls?.smwh;
        const siteId = JSON.parse(atob(helperJson?.mresult))?.smwh;

        iframeUrl = siteUrl + siteId;
      }

      const iframeRes = await axios.get(iframeUrl, { headers });
      const iframeHtml = iframeRes.data;


      const functionRegex = /eval\(function\((.*?)\)\{.*?return p\}.*?\('(.*?)'\.split/;
      const match = functionRegex.exec(iframeHtml);
      let decoded = '';
      if (match) {
        const encodedString = match[2];
        decoded = encodedString.split("',36,")[0].trim();
        const a = 36;
        const k = encodedString.split("',36,")[1].slice(2).split('|');
        let c = k.length;

        while (c--) {
          if (k[c]) {
            const regex = new RegExp(`\\b${c.toString(a)}\\b`, 'g');
            decoded = decoded.replace(regex, k[c]);
          }
        }
      }

      const streamUrl = decoded?.match(/file:\s*"([^"]+\.m3u8[^"]*)"/)?.[1];
      const subtitleMatches = decoded?.match(/https:\/\/[^\s"]+\.vtt/g) || [];

      const subtitles = subtitleMatches.map(sub => {
        const lang = sub.match(/_([a-zA-Z]{3})\.vtt$/)?.[1] || 'eng';
        return {
          language: lang,
          uri: sub,
          title: lang,
          type: 'vtt',
        };
      });

      if (streamUrl) {
        streamLinks.push({
          server: 'Multi',
          link: streamUrl.replace(/&i=\d+,'\.4&/, '&i=0.4&'),
          type: 'm3u8',
          subtitles,
        });
      }

      return streamLinks;
    } catch (err) {
      console.error('❌ Stream fetch failed:', err);
      return [];
    }
  }

  server.get('/multimovies/episodes', async (req, res) => {
    const seriesUrl = req.query.url;
    if (!seriesUrl) return res.status(400).json({ error: 'Missing series URL' });

    try {
      const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      };

      const response = await axios.get(seriesUrl, { headers });
      const $ = cheerio.load(response.data);
      const episodes = [];

      $('.les-content a[data-episode]').each((i, el) => {
        const epUrl = $(el).attr('href');
        const epNum = $(el).text().trim().match(/Episode\s*(\d+)/i)?.[1] || i + 1;

        if (epUrl) {
          episodes.push({
            id: epUrl,
            number: parseInt(epNum),
          });
        }
      });

      const title = $('h1.entry-title').text().trim() || 'Untitled';

      res.send({ title, episodes });
    } catch (err) {
      console.error('❌ Failed to fetch episodes:', err.message);
      res.status(500).send({ error: 'Failed to fetch episodes' });
    }
  });

  server.get('/multimovies/stream', async (req, res) => {
    const episodeUrl = req.query.episodeUrl;
    if (!episodeUrl)
      return res.status(400).send({ error: 'Missing episodeUrl' });

    const partMatch = episodeUrl.match(/part=(\d+)/);
    const part = partMatch ? parseInt(partMatch[1]) : 1;

    const streams = await multiGetStream(episodeUrl, 'movie');

    res.send({
      link: streams?.[0]?.link || null,
      subtitles: streams?.[0]?.subtitles || [],
      part,
    });
  });

  server.get('/multimovies/info', async (req, res) => {
    const url = req.query.url;
    if (!url) return res.status(400).json({ error: 'Missing URL' });

    try {
      const response = await axios.get(url);
      const html = response.data;
      const $ = cheerio.load(html);

      const title = $('h1.entry-title').text().trim() || 'Untitled';
      const type = url.includes('tvshows') ? 'series' : 'movie';
      const episodes = [];

      if (type === 'series') {
        $('#seasons').children().each((i, seasonElem) => {
          const seasonNumber = i + 1;
          $(seasonElem)
            .find('.episodios')
            .children()
            .each((j, epElem) => {
              const epTitle = $(epElem).find('.numerando').text().trim();
              const epNum = parseInt(epTitle.split('-')[1]?.trim() || j + 1);
              const epLink = $(epElem).find('a').attr('href');

              if (epLink) {
                episodes.push({
                  id: epLink,
                  number: epNum,
                  season: seasonNumber,
                });
              }
            });
        });
      } else {
        episodes.push({
          id: url,
          number: 1,
        });
      }

      res.send({ title, episodes });
    } catch (err) {
      console.error('❌ Failed to fetch info:', err.message);
      res.status(500).json({ error: 'Failed to fetch series info' });
    }
  });

  server.listen(3000, () => {
    console.log('✅ Express backend running at http://localhost:3000');
  });
}
const extensionsPath = path.join(__dirname, 'extensions');


function loadExtension(file) {
  const fullPath = path.join(extensionsPath, file);
  const fileUrl = pathToFileURL(fullPath).href;
  console.log(`🔌 Loading extension: ${file}`);

  import(`${fileUrl}?update=${Date.now()}`) // cache bust with query param
    .then(mod => {
      if (typeof mod.default === 'function') {
        mod.default();
        console.log(`✅ Loaded extension: ${file}`);
      } else {
        console.warn(`⚠️ No default export function in: ${file}`);
      }
    })
    .catch(err => {
      console.error(`❌ Failed to load extension ${file}:`, err);
    });
}

// Initial load
fs.readdirSync(extensionsPath).forEach(file => {
  if (file.endsWith('.js')) loadExtension(file);
});

// Watch and reload
chokidar.watch(extensionsPath).on('change', (changedPath) => {
  const changedFile = path.basename(changedPath);
  if (changedFile.endsWith('.js')) {
    console.log(`🔁 Detected change in ${changedFile}, reloading...`);
    loadExtension(changedFile);
  }
});



app.whenReady().then(() => {
  createWindow();
  startBackend();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
