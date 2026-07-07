import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { config } from './config.js';
import { extractVideoId } from './videoId.js';
import { enqueue, getJob, getCached, mp3Path, cleanupExpired } from './jobs.js';

const app = express();
app.use(express.json());
app.set('trust proxy', true);

// ---------- helpers ----------

function baseUrl(req) {
  if (config.publicBaseUrl) return config.publicBaseUrl;
  return `${req.protocol}://${req.get('host')}`;
}

function publicLink(req, videoId) {
  return `${baseUrl(req)}/files/${videoId}.mp3`;
}

function jobResponse(req, job) {
  const body = {
    status: job.status === 'done' ? 'ok' : job.status, // ok | queued | processing | error
    jobId: job.id,
    id: job.videoId,
    title: job.title,
    duration: job.duration,
    channel: job.channel,
    thumbnail: job.thumbnail,
  };
  if (job.status === 'done') {
    body.link = publicLink(req, job.videoId);
    body.filesize = job.filesize;
  }
  if (job.status === 'error') body.msg = job.error;
  if (job.status === 'queued' || job.status === 'processing') {
    body.msg = 'Conversión en curso, consulta /api/jobs/' + job.id;
  }
  return body;
}

// ---------- auth opcional ----------

app.use('/api', (req, res, next) => {
  if (config.apiKey && req.get('x-api-key') !== config.apiKey) {
    return res.status(401).json({ status: 'error', msg: 'API key inválida o ausente' });
  }
  next();
});

// ---------- rutas ----------

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

/**
 * Punto de entrada principal.
 *   POST /api/convert   { "url": "https://www.youtube.com/watch?v=..." }
 *   GET  /api/convert?url=...   (también acepta ?id=<videoId>)
 *
 * Si el MP3 ya está en caché responde de inmediato con status "ok" y el link.
 * Si no, encola la conversión y responde "queued"/"processing" con un jobId
 * para hacer polling en GET /api/jobs/:jobId.
 */
async function handleConvert(req, res) {
  const input = req.body?.url ?? req.query.url ?? req.query.id;
  const videoId = extractVideoId(input ?? '');
  if (!videoId) {
    return res.status(400).json({
      status: 'error',
      msg: 'Falta o es inválido el parámetro "url" (URL de YouTube o ID de video de 11 caracteres)',
    });
  }

  const cached = await getCached(videoId);
  if (cached) {
    return res.json({
      status: 'ok',
      id: videoId,
      title: cached.title ?? null,
      duration: cached.duration ?? null,
      channel: cached.channel ?? null,
      thumbnail: cached.thumbnail ?? null,
      filesize: cached.filesize,
      link: publicLink(req, videoId),
      cached: true,
    });
  }

  const job = enqueue(videoId);
  res.status(202).json(jobResponse(req, job));
}

app.post('/api/convert', handleConvert);
app.get('/api/convert', handleConvert);

/** Polling del estado de una conversión. */
app.get('/api/jobs/:jobId', (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job) {
    return res.status(404).json({ status: 'error', msg: 'Job no encontrado (o ya expiró)' });
  }
  res.json(jobResponse(req, job));
});

/** Descarga pública del MP3 generado. */
app.get('/files/:name', (req, res) => {
  const videoId = extractVideoId(path.basename(req.params.name, '.mp3'));
  if (!videoId || !req.params.name.endsWith('.mp3')) {
    return res.status(400).json({ status: 'error', msg: 'Nombre de archivo inválido' });
  }
  const file = path.resolve(mp3Path(videoId));
  if (!fs.existsSync(file)) {
    return res.status(404).json({ status: 'error', msg: 'Archivo no encontrado o expirado' });
  }
  res.sendFile(file);
});

// ---------- arranque ----------

fs.mkdirSync(config.storageDir, { recursive: true });
setInterval(() => cleanupExpired().catch(() => {}), 15 * 60 * 1000).unref();
cleanupExpired().catch(() => {});

app.listen(config.port, () => {
  console.log(`youMP3 escuchando en puerto ${config.port}`);
  console.log(`Archivos servidos desde ${path.resolve(config.storageDir)}`);
});
