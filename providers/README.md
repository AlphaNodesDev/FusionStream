# FusionStream providers

The app downloads this folder from GitHub (`main` branch) at startup and when you click
"Check for updates" in Addons. A copy is also bundled into the installer as a fallback.

## Layout

```
providers/
  index.json              list of provider ids + a version number
  <id>/provider.json      metadata
  <id>/index.js           only for "script" providers
```

Bump `version` in `index.json` every time you change anything, or apps won't download it.
Provider ids: lowercase letters, digits and `-`.

## Type 1: `embed` (web player sites, most of FMHY)

No code. Give URL templates; the app fills in the ids and opens the page in a sandboxed
window with an ad blocker, popups blocked and navigation locked to `allowedHosts`.

```json
{
  "name": "VidLink",
  "description": "Web player.",
  "type": "embed",
  "types": ["movie", "series"],
  "embed": {
    "movie": "https://vidlink.pro/movie/{tmdb}",
    "series": "https://vidlink.pro/tv/{tmdb}/{season}/{episode}"
  },
  "allowedHosts": ["vidlink.pro"],
  "enabled": true
}
```

Placeholders: `{imdb}` (tt1234567), `{tmdb}`, `{season}`, `{episode}`. URLs must be `https://`.
`enabled: false` ships it switched off; users can turn it on in Addons.

## Type 2: `script` (APIs / scraping that returns torrents or direct video links)

`provider.json`:

```json
{ "name": "EZTV", "type": "script", "script": "index.js", "types": ["series"], "enabled": true }
```

`index.js` must define `getStreams(args, helpers)` and return an array:

```js
async function getStreams(args, helpers) {
  // args:    { type, imdb, tmdb, season, episode, name, year, genres }
  // helpers: fetchJson(url, opts), fetchText(url, opts), parseHTML(html), parseXML(xml)
  return [
    { name: 'Site', title: 'Release name\n👤 120 💾 1.4 GB', infoHash: '<40 hex chars>' },
    { name: 'Site', title: '1080p direct', url: 'https://cdn.example/video.mp4' }
  ];
}
```

- Put seeders and size in `title` as `👤 <n>` and `💾 <size>` so the app can rank the stream.
- Scripts run in a sandboxed, hidden browser page: `fetch`/`DOMParser` work (no CORS limits),
  but there is no Node.js and no access to the app. 20 second time limit, max 100 streams.
- Only `infoHash` torrents and `http(s)` URLs are accepted; anything else is dropped.

## Testing locally

Run the app from source (`cd "FS V5" && npm start`). It loads this folder directly.
Bump `version` higher than the copy on GitHub so the local one wins.
