// Versión serverless (Vercel) del conversor: convierte de forma síncrona
// dentro de la request (Fluid compute, hasta 300 s) y guarda el MP3 en
// Vercel Blob, que expone una URL pública permanente.
//
//   POST /api/convert   { "url": "https://www.youtube.com/watch?v=..." }
//   GET  /api/convert?url=...   (o ?id=<videoId>)
//
// Respuesta: { status: "ok", id, title, duration, filesize, link, cached? }
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { list, put } from '@vercel/blob';
import { extractVideoId } from '../src/videoId.js';

const YTDLP = process.env.YTDLP_BIN || path.join(process.cwd(), 'bin', 'yt-dlp');
const FFMPEG = process.env.FFMPEG_BIN || path.join(process.cwd(), 'bin', 'ffmpeg');
const MAX_DURATION = parseInt(process.env.MAX_DURATION_SECONDS ?? '5400', 10);
const BITRATE = process.env.AUDIO_BITRATE ?? '192K';
const BLOB_PREFIX = 'mp3/';

function runYtDlp(args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(YTDLP, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('La conversión excedió el tiempo máximo'));
    }, timeoutMs);
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (err) => { clearTimeout(timer); reject(err); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) return resolve();
      const errLine = stderr.split('\n').filter((l) => l.includes('ERROR')).pop()
        || stderr.trim().split('\n').pop() || `yt-dlp exited with code ${code}`;
      reject(new Error(errLine.replace(/^ERROR:\s*/, '')));
    });
  });
}

/** Cookies opcionales vía env (base64 de un cookies.txt) para sortear anti-bot. */
async function cookiesArgs() {
  if (!process.env.YTDLP_COOKIES_B64) return [];
  const file = '/tmp/cookies.txt';
  await fs.writeFile(file, Buffer.from(process.env.YTDLP_COOKIES_B64, 'base64'));
  return ['--cookies', file];
}

async function findCached(videoId) {
  const { blobs } = await list({ prefix: `${BLOB_PREFIX}${videoId}.mp3`, limit: 1 });
  return blobs[0] ?? null;
}

export default async function handler(req, res) {
  if (process.env.API_KEY && req.headers['x-api-key'] !== process.env.API_KEY) {
    return res.status(401).json({ status: 'error', msg: 'API key inválida o ausente' });
  }
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ status: 'error', msg: 'Método no permitido' });
  }

  const input = req.body?.url ?? req.query.url ?? req.query.id;
  const videoId = extractVideoId(input ?? '');
  if (!videoId) {
    return res.status(400).json({
      status: 'error',
      msg: 'Falta o es inválido el parámetro "url" (URL de YouTube o ID de video de 11 caracteres)',
    });
  }

  try {
    const cached = await findCached(videoId);
    if (cached) {
      return res.json({
        status: 'ok',
        id: videoId,
        filesize: cached.size,
        link: cached.url,
        cached: true,
      });
    }

    const outMp3 = `/tmp/${videoId}.mp3`;
    const infoJson = `/tmp/${videoId}.info.json`;
    const url = `https://www.youtube.com/watch?v=${videoId}`;

    await runYtDlp([
      '-x',
      '--audio-format', 'mp3',
      '--audio-quality', BITRATE,
      '--ffmpeg-location', FFMPEG,
      '--no-playlist',
      '--no-warnings',
      '--write-info-json',
      '--match-filter', `duration<=${MAX_DURATION}`,
      ...(await cookiesArgs()),
      '-o', `/tmp/${videoId}.%(ext)s`,
      url,
    ], 270_000);

    let mp3;
    try {
      mp3 = await fs.readFile(outMp3);
    } catch {
      // El match-filter descartó el video sin marcar error: no se generó archivo.
      return res.status(422).json({
        status: 'error',
        id: videoId,
        msg: `El video supera la duración máxima permitida (${MAX_DURATION}s) o no produjo audio`,
      });
    }

    let meta = {};
    try {
      const info = JSON.parse(await fs.readFile(infoJson, 'utf8'));
      meta = { title: info.title, duration: info.duration, channel: info.channel ?? info.uploader };
    } catch { /* metadatos opcionales */ }

    const blob = await put(`${BLOB_PREFIX}${videoId}.mp3`, mp3, {
      access: 'public',
      addRandomSuffix: false,
      contentType: 'audio/mpeg',
      cacheControlMaxAge: 31536000,
    });

    await Promise.allSettled([fs.unlink(outMp3), fs.unlink(infoJson)]);

    return res.json({
      status: 'ok',
      id: videoId,
      ...meta,
      filesize: mp3.length,
      link: blob.url,
    });
  } catch (err) {
    return res.status(500).json({ status: 'error', id: videoId, msg: err.message });
  }
}
