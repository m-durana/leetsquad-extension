// Dual-browser build: assembles dist-chrome/ and dist-firefox/ from a single
// manifest.json source. Run: node build.mjs
import { readFileSync, writeFileSync, rmSync, mkdirSync, cpSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const OUT_CHROME = join(ROOT, 'dist-chrome');
const OUT_FIREFOX = join(ROOT, 'dist-firefox');

// Top-level .js files we never ship.
const JS_EXCLUDE = new Set(['build.mjs', 'jest.config.js']);
// Folders shipped verbatim to both targets.
const ASSET_DIRS = ['styles', 'icons'];
// Non-js top-level files shipped to both.
const STATIC_FILES = ['popup.html', 'welcome.html'];

function copyShared(outDir) {
  mkdirSync(outDir, { recursive: true });

  for (const name of readdirSync(ROOT)) {
    if (name.endsWith('.js') && !JS_EXCLUDE.has(name) && statSync(join(ROOT, name)).isFile()) {
      cpSync(join(ROOT, name), join(outDir, name));
    }
  }
  for (const f of STATIC_FILES) cpSync(join(ROOT, f), join(outDir, f));
  for (const d of ASSET_DIRS) cpSync(join(ROOT, d), join(outDir, d), { recursive: true });
}

const base = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));

// Chrome: manifest as-is (MV3 service worker).
const chromeManifest = base;

// Firefox: event page instead of a service worker (no importScripts there),
// plus gecko settings. 128+ is required for world:"MAIN" content scripts.
const firefoxManifest = JSON.parse(JSON.stringify(base));
delete firefoxManifest.background;
firefoxManifest.background = {
  scripts: ['browser-polyfill.js', 'shared.js', 'storage.js', 'achievements.js', 'background.js'],
};
firefoxManifest.browser_specific_settings = {
  gecko: {
    id: 'leetsquad@miro.build',
    strict_min_version: '140.0',
    data_collection_permissions: {
      required: ['none'],
      optional: ['websiteActivity'],
    },
  },
  gecko_android: {
    strict_min_version: '142.0',
  },
};

rmSync(OUT_CHROME, { recursive: true, force: true });
rmSync(OUT_FIREFOX, { recursive: true, force: true });

copyShared(OUT_CHROME);
writeFileSync(join(OUT_CHROME, 'manifest.json'), JSON.stringify(chromeManifest, null, 2) + '\n');

copyShared(OUT_FIREFOX);
writeFileSync(join(OUT_FIREFOX, 'manifest.json'), JSON.stringify(firefoxManifest, null, 2) + '\n');

console.log('Built dist-chrome/ and dist-firefox/');
