#!/usr/bin/env node
// Descarga las dependencias que necesita la función serverless a bin/:
//   - yt-dlp (standalone Linux x64)
//   - ffmpeg (build estático)
//   - bgutil-ytdlp-pot-provider (plugin + script generador de PO Tokens de
//     YouTube; sin él, la mayoría de los videos falla con 403/bot-check
//     desde IPs de datacenter)
// Se ejecuta en el build de Vercel (vercel-build); localmente solo descarga
// lo que falte.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

// Versión pineada del provider (supply chain: no seguir "latest")
const BGUTIL_VERSION = '1.3.1';

const BIN = path.join(process.cwd(), 'bin');
fs.mkdirSync(BIN, { recursive: true });

async function download(url, dest) {
  console.log(`Descargando ${url} ...`);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status} al descargar ${url}`);
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(dest));
}

function present(file, minBytes) {
  return fs.existsSync(file) && fs.statSync(file).size > minBytes;
}

// --- yt-dlp ---
const ytdlp = path.join(BIN, 'yt-dlp');
if (present(ytdlp, 10_000_000)) {
  console.log('yt-dlp ya existe, omitiendo');
} else {
  await download(
    'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux',
    ytdlp
  );
  fs.chmodSync(ytdlp, 0o755);
  console.log(`yt-dlp listo (${(fs.statSync(ytdlp).size / 1e6).toFixed(1)} MB)`);
}

// --- ffmpeg ---
const ffmpeg = path.join(BIN, 'ffmpeg');
if (present(ffmpeg, 10_000_000)) {
  console.log('ffmpeg ya existe, omitiendo');
} else {
  const tarball = path.join(BIN, 'ffmpeg.tar.xz');
  // Build estático liviano (~78 MB); el de BtbN pesa 145 MB y acerca la
  // función al límite de 250 MB de Vercel.
  await download(
    'https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz',
    tarball
  );
  // Extraer solo el binario ffmpeg del tarball
  execFileSync('tar', [
    '-xJf', tarball,
    '-C', BIN,
    '--strip-components=1',
    '--wildcards', '*/ffmpeg',
  ]);
  fs.unlinkSync(tarball);
  fs.chmodSync(ffmpeg, 0o755);
  console.log(`ffmpeg listo (${(fs.statSync(ffmpeg).size / 1e6).toFixed(1)} MB)`);
}

// --- bgutil PO token provider ---
const bgutil = path.join(BIN, 'bgutil');
if (present(path.join(bgutil, 'server', 'build', 'generate_once.js'), 1_000)) {
  console.log('bgutil ya existe, omitiendo');
} else {
  const tarball = path.join(BIN, 'bgutil.tar.gz');
  await download(
    `https://github.com/Brainicism/bgutil-ytdlp-pot-provider/archive/refs/tags/${BGUTIL_VERSION}.tar.gz`,
    tarball
  );
  fs.rmSync(bgutil, { recursive: true, force: true });
  fs.mkdirSync(bgutil, { recursive: true });
  execFileSync('tar', ['-xzf', tarball, '-C', bgutil, '--strip-components=1']);
  fs.unlinkSync(tarball);

  const server = path.join(bgutil, 'server');
  const run = (cmd, args) =>
    execFileSync(cmd, args, { cwd: server, stdio: 'inherit', shell: process.platform === 'win32' });
  // --ignore-scripts: evita compilar "canvas" (nativo, no lo necesita el
  // generador de tokens) y cualquier postinstall de terceros.
  run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund']);
  try {
    run('npx', ['tsc']);
  } catch {
    // tsc puede salir !=0 por deprecaciones de tsconfig; el build igual se emite
  }
  if (!fs.existsSync(path.join(server, 'build', 'generate_once.js'))) {
    console.error('bgutil: el build no produjo generate_once.js');
    process.exit(1);
  }
  run('npm', ['prune', '--omit=dev', '--ignore-scripts']);
  console.log('bgutil listo (plugin + script de PO tokens)');
}
