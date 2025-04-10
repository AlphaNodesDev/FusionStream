// extensions/index.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default async function loadExtensions() {
  const extensionsDir = path.join(__dirname);

  const files = fs.readdirSync(extensionsDir)
    .filter(file => file.endsWith('.js') && file !== 'index.js');

  for (const file of files) {
    const modulePath = pathToFileURL(path.join(extensionsDir, file)).href;

    try {
      const extension = await import(modulePath);
      if (typeof extension.default === 'function') {
        extension.default(); // Call the default export if it’s a function
        console.log(`✅ Loaded extension: ${file}`);
      }
    } catch (err) {
      console.error(`❌ Failed to load extension "${file}":`, err);
    }
  }
}
