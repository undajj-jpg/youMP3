import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { fetchMetadata, downloadMp3 } from './converter.js';

/**
 * Gestor de trabajos de conversión.
 * - Deduplica por videoId: si el MP3 ya existe (caché) responde al instante,
 *   y si ya hay una conversión en curso del mismo video, reutiliza ese job.
 * - Limita la concurrencia a config.maxConcurrent; el resto queda en cola.
 * - Junto a cada MP3 guarda un <id>.json con los metadatos para sobrevivir reinicios.
 */

const jobs = new Map();        // jobId -> job
const jobByVideo = new Map();  // videoId -> job activo (queued/processing)
const queue = [];
let running = 0;

export function mp3Path(videoId) {
  return path.join(config.storageDir, `${videoId}.mp3`);
}

function metaPath(videoId) {
  return path.join(config.storageDir, `${videoId}.json`);
}

export function getJob(jobId) {
  return jobs.get(jobId) ?? null;
}

/** Job activo (en cola o procesando) para un video, si existe. */
export function getActiveJob(videoId) {
  return jobByVideo.get(videoId) ?? null;
}

/** Devuelve los metadatos cacheados si el MP3 ya existe y sigue vigente. */
export async function getCached(videoId) {
  try {
    const stat = await fs.stat(mp3Path(videoId));
    let meta = {};
    try {
      meta = JSON.parse(await fs.readFile(metaPath(videoId), 'utf8'));
    } catch { /* metadatos opcionales */ }
    return { filesize: stat.size, ...meta };
  } catch {
    return null;
  }
}

export function enqueue(videoId) {
  const existing = jobByVideo.get(videoId);
  if (existing) return existing;

  const job = {
    id: randomUUID(),
    videoId,
    status: 'queued', // queued | processing | done | error
    title: null,
    duration: null,
    channel: null,
    thumbnail: null,
    filesize: null,
    error: null,
    createdAt: Date.now(),
    finishedAt: null,
  };
  jobs.set(job.id, job);
  jobByVideo.set(videoId, job);
  queue.push(job);
  pump();
  return job;
}

function pump() {
  while (running < config.maxConcurrent && queue.length > 0) {
    const job = queue.shift();
    running++;
    runJob(job).finally(() => {
      running--;
      pump();
    });
  }
}

async function runJob(job) {
  job.status = 'processing';
  try {
    const meta = await fetchMetadata(job.videoId);
    Object.assign(job, {
      title: meta.title,
      duration: meta.duration,
      channel: meta.channel,
      thumbnail: meta.thumbnail,
    });

    if (config.maxDurationSeconds > 0 && meta.duration > config.maxDurationSeconds) {
      throw new Error(
        `El video dura ${meta.duration}s y el máximo permitido es ${config.maxDurationSeconds}s`
      );
    }

    await fs.mkdir(config.storageDir, { recursive: true });
    // Plantilla de salida de yt-dlp; el postprocesador la deja en <id>.mp3
    const template = path.join(config.storageDir, `${job.videoId}.%(ext)s`);
    await downloadMp3(job.videoId, template);

    const stat = await fs.stat(mp3Path(job.videoId));
    job.filesize = stat.size;
    job.status = 'done';

    await fs.writeFile(
      metaPath(job.videoId),
      JSON.stringify({
        id: job.videoId,
        title: job.title,
        duration: job.duration,
        channel: job.channel,
        thumbnail: job.thumbnail,
        convertedAt: new Date().toISOString(),
      }, null, 2)
    );
  } catch (err) {
    job.status = 'error';
    job.error = err.message;
  } finally {
    job.finishedAt = Date.now();
    jobByVideo.delete(job.videoId);
    // Los jobs terminados se olvidan tras 1 hora para no crecer sin límite.
    setTimeout(() => jobs.delete(job.id), 60 * 60 * 1000).unref();
  }
}

/** Borra MP3 y metadatos más viejos que el TTL configurado. */
export async function cleanupExpired() {
  if (config.fileTtlHours <= 0) return;
  const cutoff = Date.now() - config.fileTtlHours * 3600 * 1000;
  let entries;
  try {
    entries = await fs.readdir(config.storageDir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (!/\.(mp3|json)$/.test(name)) continue;
    const file = path.join(config.storageDir, name);
    try {
      const stat = await fs.stat(file);
      if (stat.mtimeMs < cutoff) await fs.unlink(file);
    } catch { /* pudo borrarse en paralelo */ }
  }
}
