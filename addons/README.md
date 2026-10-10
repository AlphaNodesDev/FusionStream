# FusionStream Addon Store

`catalog.json` is the list shown in the app under **Addons → Addon Store**. The app downloads it from:

```
https://raw.githubusercontent.com/AlphaNodesDev/FusionStream/main/addons/catalog.json
```

Edit it, push to `main`, and every user sees the change next time they open the Addon Store.
Bump `version` when you change it.

## Fields

```json
{
  "id": "unique-id",
  "name": "Shown name",
  "description": "One or two sentences.",
  "url": "https://example.com/manifest.json",
  "category": "catalogs | streams | subtitles | official | other",
  "logo": "https://… (optional)",
  "store": true,
  "thirdParty": false
}
```

- `store: true` lists it in the **Microsoft Store edition** too. Only use this for legal content.
- `thirdParty: true` shows a "not made by FusionStream" badge and a warning before install.
- `packs` are one-click bundles shown on first launch and in the Addon Store.

## One-click install links for your website

Any addon can be installed with a link:

```
fusionstream://install?url=https%3A%2F%2Fexample.com%2Fmanifest.json
```

Clicking it opens FusionStream and shows an "Install addon?" dialog. In the app, **Addons → Installed → Share**
copies this link for any installed addon.

HTML button:

```html
<a href="fusionstream://install?url=https%3A%2F%2Fexample.com%2Fmanifest.json">Install in FusionStream</a>
```

The URL inside must be percent-encoded (use `encodeURIComponent`).
