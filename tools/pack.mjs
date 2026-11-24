#!/usr/bin/env bun
// Self-contained build + pack for this mod's `.mcmod`. Needs only Bun -- no checkout of the game.
//
// A `.mcmod` is a ZIP holding `package.json` plus the BUILT entry scripts and the mod's asset folders.
// This script bundles each entry declared in `package.json` -> `scripts` with Bun (one plain ES module per
// side, the SDK file included: it only reads the classes the game puts on `globalThis.MineClaude`), then
// writes the zip deterministically -- same input, same bytes -- with the same layout the game's reader
// expects: forward-slash names, fixed DOS timestamp, sorted entries.
//
// Usage: bun tools/pack.mjs [--out <file.mcmod>] [--no-build]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SIDES = ['main', 'server', 'client'];
// Folders the game loads from a mod besides its scripts (lang/model/loot/recipe/tag data) and the ones the
// browser fetches (textures, sounds, generic assets). Everything else in the repo stays out of the package.
const ASSET_DIRS = ['assets', 'lang', 'models', 'textures', 'sounds', 'data'];
// Only the keys the game knows; `scripts` is reduced to the entry sides (the `build` script is author tooling).
const MCMOD_KEYS = ['name', 'version', 'description', 'author', 'authors', 'homepage', 'license', 'scripts', 'private', 'type', '$schema', 'mineclaude'];

const die = (m) => { console.error(`ERRO: ${m}`); process.exit(1); };

const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const noBuild = args.includes('--no-build');

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const id = pkg.name;
if (typeof id !== 'string' || !/^[a-z0-9_]+$/.test(id)) die(`package.json name "${id}" invalido (esperado [a-z0-9_]+)`);
const version = pkg.version ?? '0.0.0';
if (!/^[0-9A-Za-z.+-]{1,32}$/.test(version)) die(`version "${version}" invalida`);

// ---------------------------------------------------------------- build
// `scripts.<side>` names the BUILT file; `scripts._sources.<side>` the entry to bundle.
const sources = pkg.scripts?._sources ?? {};
if (!noBuild) {
  fs.rmSync(path.join(ROOT, 'dist'), { recursive: true, force: true });
  for (const side of SIDES) {
    const entry = sources[side];
    if (!entry) continue;
    const outfile = pkg.scripts[side];
    if (!outfile) die(`scripts._sources.${side} existe mas scripts.${side} nao`);
    // `main` and `client` are fetched and run by the BROWSER, so they bundle for the browser (and may not
    // touch node APIs at all -- the game refuses that). A `server` entry runs only on the server, where
    // `node:*` imports are allowed, so it bundles for Bun.
    const r = await Bun.build({
      entrypoints: [path.join(ROOT, entry)],
      outdir: path.join(ROOT, path.posix.dirname(outfile)),
      naming: path.posix.basename(outfile),
      target: side === 'server' ? 'bun' : 'browser',
      format: 'esm',
      minify: false,
    });
    if (!r.success) { for (const log of r.logs) console.error(log); die(`o build de ${side} falhou`); }
    console.log(`${outfile} (${fs.statSync(path.join(ROOT, outfile)).size} bytes)`);
  }
}

// ---------------------------------------------------------------- collect
function walk(rel) {
  const out = [];
  const rec = (r) => {
    for (const e of fs.readdirSync(path.join(ROOT, r), { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const child = `${r}/${e.name}`;
      if (e.isDirectory()) rec(child);
      else if (e.isFile()) out.push(child);
    }
  };
  rec(rel);
  return out;
}

const shipped = {};
for (const [k, v] of Object.entries(pkg)) {
  if (!MCMOD_KEYS.includes(k) && !k.startsWith('_')) continue;
  if (k === 'scripts') {
    shipped.scripts = {};
    for (const s of SIDES) if (typeof v[s] === 'string') shipped.scripts[s] = v[s];
  } else shipped[k] = v;
}
if (!Object.keys(shipped.scripts ?? {}).length) die('package.json: scripts precisa de "main", "server" e/ou "client"');

const names = new Set();
for (const side of SIDES) {
  const script = shipped.scripts[side];
  if (!script) continue;
  if (!fs.statSync(path.join(ROOT, script), { throwIfNoEntry: false })?.isFile()) die(`scripts.${side} "${script}" nao existe (rode o build)`);
  const folder = path.posix.dirname(script);
  if (folder === '.') names.add(script);
  else for (const f of walk(folder)) names.add(f);
}
for (const a of ASSET_DIRS) {
  if (fs.statSync(path.join(ROOT, a), { throwIfNoEntry: false })?.isDirectory()) for (const f of walk(a)) names.add(f);
}

const entries = [{ name: 'package.json', data: Buffer.from(JSON.stringify(shipped, null, 2) + '\n') }];
for (const f of [...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
  entries.push({ name: f, data: fs.readFileSync(path.join(ROOT, f)) });
}
if (entries.length > 4096) die(`arquivos demais (${entries.length})`);

// ---------------------------------------------------------------- deterministic zip
const TABLE = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crc32(buf) { let c = 0xffffffff; for (const x of buf) c = TABLE[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

const DOS_TIME = 0;
const DOS_DATE = ((2024 - 1980) << 9) | (1 << 5) | 1; // 2024-01-01: fixed, so the bytes are reproducible

function safeName(name) {
  if (!name || name.includes('\\') || name.startsWith('/') || /^[A-Za-z]:/.test(name) || name.split('/').some((p) => p === '..' || p === '' || p === '.')) {
    throw new Error(`nome de entrada invalido no zip: "${name}"`);
  }
  return name;
}

function makeZip(list) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const { name, data } of list) {
    const nameBuf = Buffer.from(safeName(name), 'utf8');
    const deflated = zlib.deflateRawSync(data);
    const stored = deflated.length >= data.length;
    const body = stored ? data : deflated;
    const method = stored ? 0 : 8;
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(method, 8); local.writeUInt16LE(DOS_TIME, 10); local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(method, 10); cd.writeUInt16LE(DOS_TIME, 12); cd.writeUInt16LE(DOS_DATE, 14);
    cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(body.length, 20); cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28); cd.writeUInt32LE(offset, 42);
    parts.push(local, nameBuf, body);
    central.push(cd, nameBuf);
    offset += 30 + nameBuf.length + body.length;
  }
  const cdBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(list.length, 8); end.writeUInt16LE(list.length, 10);
  end.writeUInt32LE(cdBuf.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cdBuf, end]);
}

const zip = makeZip(entries);
const target = path.resolve(ROOT, outIdx >= 0 ? args[outIdx + 1] : `${id}-${version}.mcmod`);
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, zip);
console.log(`pacote ${target}`);
console.log(`  id: ${id}`);
console.log(`  versao: ${version}`);
console.log(`  arquivos: ${entries.length}`);
console.log(`  tamanho: ${(zip.length / 1024).toFixed(1)} KiB`);
