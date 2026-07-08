// Versión serverless (Vercel) del conversor: convierte de forma síncrona
// dentro de la request (Fluid compute) y guarda el MP3 en Vercel Blob, que
// expone una URL pública permanente.
//
//   POST /api/convert   { "url": "https://www.youtube.com/watch?v=..." }
//   GET  /api/convert?url=...   (o ?id=<videoId>)
//
// Respuesta: { status: "ok", id, title, duration, filesize, link, cached? }
//
// Límite práctico: la función vive como máximo maxDuration segundos
// (vercel.json). Videos que no quepan en esa ventana se rechazan con 422 y
// SYNC_MAX_SECONDS explica el límite; para videos muy largos (horas) usa la
// variante autohospedada (src/server.js), que convierte en segundo plano.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { list, put } from '@vercel/blob';
import * as tar from 'tar';
import { extractVideoId } from '../src/videoId.js';

const YTDLP = process.env.YTDLP_BIN || path.join(process.cwd(), 'bin', 'yt-dlp');
const FFMPEG = process.env.FFMPEG_BIN || path.join(process.cwd(), 'bin', 'ffmpeg');
const BGUTIL_DIR = process.env.BGUTIL_DIR || path.join(process.cwd(), 'bin', 'bgutil');
const MAX_DURATION = parseInt(process.env.MAX_DURATION_SECONDS ?? '32400', 10);
// Duración de video que se considera convertible dentro de la ventana de la
// función. Ajustable por instancia según el plan (maxDuration) observado.
const SYNC_MAX_SECONDS = parseInt(process.env.SYNC_MAX_SECONDS ?? '10800', 10);
const YTDLP_TIMEOUT_MS = parseInt(process.env.SYNC_TIMEOUT_SECONDS ?? '280', 10) * 1000;
const BITRATE = process.env.AUDIO_BITRATE ?? '192K';
const BLOB_PREFIX = 'mp3/';

function runYtDlp(args, timeoutMs, { captureStdout = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(YTDLP, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('La conversión excedió el tiempo máximo de la función'));
    }, timeoutMs);
    if (captureStdout) child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (err) => { clearTimeout(timer); reject(err); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) return resolve(stdout);
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
  await fsp.writeFile(file, Buffer.from(process.env.YTDLP_COOKIES_B64, 'base64'));
  return ['--cookies', file];
}

/**
 * Localiza el script generador de PO Tokens de bgutil. En Vercel el runtime
 * del provider viaja como tarball (node_modules no sobrevive includeFiles) y
 * se extrae a /tmp en el primer uso; en local/Docker se usa directo.
 */
async function bgutilScriptPath() {
  const local = path.join(BGUTIL_DIR, 'server', 'build', 'generate_once.js');
  if (fs.existsSync(path.join(BGUTIL_DIR, 'server', 'node_modules'))) return local;

  const extracted = '/tmp/bgutil-server';
  const script = path.join(extracted, 'build', 'generate_once.js');
  if (fs.existsSync(script)) return script;
  const tarball = path.join(BGUTIL_DIR, 'server-bundle.tar.gz');
  if (!fs.existsSync(tarball)) return null;
  fs.mkdirSync(extracted, { recursive: true });
  await tar.x({ file: tarball, cwd: extracted });
  return fs.existsSync(script) ? script : null;
}

/**
 * Flags comunes de yt-dlp: runtime JS (firma de URLs) y plugin bgutil que
 * genera los PO Tokens que YouTube exige desde IPs de datacenter.
 */
async function baseArgs() {
  const args = [
    '--no-playlist', '--no-warnings', '--js-runtimes', 'node',
    '--cache-dir', '/tmp/yt-dlp-cache',
  ];
  // Proxy de salida para yt-dlp (ej. proxy residencial) — remedio principal
  // cuando YouTube bloquea la IP del datacenter.
  if (process.env.YTDLP_PROXY) args.push('--proxy', process.env.YTDLP_PROXY);
  const script = await bgutilScriptPath();
  if (script) {
    args.push(
      // --plugin-dirs espera el dir cuyos hijos son paquetes de plugins
      // (<dir>/plugin/yt_dlp_plugins/...)
      '--plugin-dirs', BGUTIL_DIR,
      '--extractor-args', `youtubepot-bgutilscript:script_path=${script}`,
    );
  }
  return args;
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

    const url = `https://www.youtube.com/watch?v=${videoId}`;
    const cookies = await cookiesArgs();
    const common = await baseArgs();

    // Metadatos primero: falla rápido y con causa clara si el video no es
    // convertible, en vez de agotar la ventana de la función.
    const rawInfo = await runYtDlp(
      ['-J', ...common, ...cookies, url],
      90_000,
      { captureStdout: true },
    );
    const info = JSON.parse(rawInfo);
    const meta = {
      title: info.title,
      duration: info.duration ?? null,
      channel: info.channel ?? info.uploader ?? null,
    };

    if (MAX_DURATION > 0 && meta.duration > MAX_DURATION) {
      return res.status(422).json({
        status: 'error',
        id: videoId,
        ...meta,
        msg: `El video dura ${meta.duration}s y el máximo permitido es ${MAX_DURATION}s`,
      });
    }
    if (meta.duration > SYNC_MAX_SECONDS) {
      return res.status(422).json({
        status: 'error',
        id: videoId,
        ...meta,
        msg: `El video dura ${meta.duration}s y supera lo convertible dentro de la ventana serverless (${SYNC_MAX_SECONDS}s). Usa la instancia autohospedada para videos de esta duración.`,
      });
    }

    const outMp3 = `/tmp/${videoId}.mp3`;
    await runYtDlp([
      '-x',
      '--audio-format', 'mp3',
      '--audio-quality', BITRATE,
      '--ffmpeg-location', FFMPEG,
      ...common,
      ...cookies,
      '-o', `/tmp/${videoId}.%(ext)s`,
      url,
    ], YTDLP_TIMEOUT_MS);

    const { size } = await fsp.stat(outMp3);
    // Subida en streaming (multipart): nunca cargamos el MP3 completo en RAM,
    // importante para videos largos cuyos archivos pesan cientos de MB.
    const blob = await put(`${BLOB_PREFIX}${videoId}.mp3`, fs.createReadStream(outMp3), {
      access: 'public',
      addRandomSuffix: false,
      contentType: 'audio/mpeg',
      cacheControlMaxAge: 31536000,
      multipart: true,
    });

    await fsp.unlink(outMp3).catch(() => {});

    return res.json({
      status: 'ok',
      id: videoId,
      ...meta,
      filesize: size,
      link: blob.url,
    });
  } catch (err) {
    // Bot-check de YouTube: la IP de salida está marcada. Devolver un error
    // accionable en lugar del texto crudo de yt-dlp.
    if (/Sign in to confirm/i.test(err.message)) {
      return res.status(503).json({
        status: 'error',
        id: videoId,
        code: 'YOUTUBE_BOT_CHECK',
        msg: 'YouTube exige verificación desde esta IP. Configura YTDLP_COOKIES_B64 (cookies de una sesión de YouTube en base64) o YTDLP_PROXY (proxy con IP limpia), o usa la instancia autohospedada.',
      });
    }
    return res.status(500).json({ status: 'error', id: videoId, msg: err.message });
  }
}
