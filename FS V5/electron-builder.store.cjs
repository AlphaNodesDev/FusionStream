// Microsoft Store (AppX/MSIX) build config.
// Extends package.json "build", but leaves out the bundled torrent/web providers
// and the Pirate Bay addon so the Store package doesn't contain them at all.
const pkg = require('./package.json');

module.exports = {
  ...pkg.build,
  extraResources: [],
  files: [
    ...pkg.build.files,
    '!addons/piratebay.js',
    '!providers-host.js',
    '!src/assets/piratebay.svg',
    '!node_modules/webtorrent/**',
    '!node_modules/@ghostery/**'
  ]
};
