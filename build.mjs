// Dual-browser build: assembles dist-chrome/ and dist-firefox/ from a single
// manifest.json source. Run: node build.mjs
import { readFileSync, writeFileSync, rmSync, mkdirSync, cpSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';

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

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (~c) >>> 0;
}

function zipDir(dir, zipPath) {
  const files = [];
  (function walk(d, prefix) {
    for (const name of readdirSync(d).sort()) {
      const full = join(d, name);
      const rel = prefix ? `${prefix}/${name}` : name;
      if (statSync(full).isDirectory()) walk(full, rel);
      else files.push({ rel, data: readFileSync(full) });
    }
  })(dir, '');

  const chunks = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const nameBuf = Buffer.from(f.rel, 'utf8');
    const comp = deflateRawSync(f.data);
    const crc = crc32(f.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(f.data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    chunks.push(local, nameBuf, comp);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(8, 10);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(comp.length, 20);
    cd.writeUInt32LE(f.data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([cd, nameBuf]));

    offset += local.length + nameBuf.length + comp.length;
  }
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  writeFileSync(zipPath, Buffer.concat([...chunks, centralBuf, end]));
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

const version = base.version;
zipDir(OUT_CHROME, join(ROOT, `leetsquad-chrome-${version}.zip`));
zipDir(OUT_FIREFOX, join(ROOT, `leetsquad-firefox-${version}.zip`));

console.log(`Built dist-chrome/ and dist-firefox/ (v${version}) + store zips`);
