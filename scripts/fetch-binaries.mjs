#!/usr/bin/env node
// Descarga los binarios que necesita la función serverless a bin/:
//   - yt-dlp (standalone Linux x64)
//   - ffmpeg (build estático de BtbN)
// Se ejecuta en el build de Vercel (vercel-build); localmente solo descarga
// lo que falte.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

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
