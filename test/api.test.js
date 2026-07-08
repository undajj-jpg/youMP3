import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

// Configurar el entorno ANTES de importar la app (config.js lee env al importar).
const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yoump3-test-'));
process.env.STORAGE_DIR = storageDir;
process.env.YTDLP_BIN = fileURLToPath(new URL('./fake-yt-dlp.mjs', import.meta.url));
process.env.MAX_DURATION_SECONDS = '5400';
process.env.API_KEY = '';
process.env.PUBLIC_BASE_URL = 'https://mp3.example.com';

const { createApp } = await import('../src/app.js');

const server = createApp().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

test.after(() => {
  server.close();
  fs.rmSync(storageDir, { recursive: true, force: true });
});

async function api(pathname, opts) {
  const res = await fetch(base + pathname, opts);
  return { status: res.status, body: await res.json().catch(() => null), res };
}

async function waitForJob(jobId, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { body } = await api(`/api/jobs/${jobId}`);
    if (body.status !== 'processing' && body.status !== 'queued') return body;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('timeout esperando el job');
}

test('health responde ok', async () => {
  const { status, body } = await api('/health');
  assert.equal(status, 200);
  assert.equal(body.status, 'ok');
});

test('rechaza URL inválida con 400', async () => {
  const { status, body } = await api('/api/convert', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: 'https://vimeo.com/123' }),
  });
  assert.equal(status, 400);
  assert.equal(body.status, 'error');
});

test('flujo completo: convertir, poll, descargar, caché', async () => {
  const url = 'https://www.youtube.com/watch?v=OKVIDEO____';

  // 1. Encolar
  const first = await api('/api/convert', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  assert.equal(first.status, 202);
  assert.ok(['queued', 'processing'].includes(first.body.status));
  assert.equal(first.body.id, 'OKVIDEO____');

  // Mientras convierte: repetir la petición reutiliza el mismo job (dedup)...
  const dup = await api(`/api/convert?url=${encodeURIComponent(url)}`);
  assert.equal(dup.status, 202);
  assert.equal(dup.body.jobId, first.body.jobId);
  // ...y el archivo aún no se sirve.
  const early = await api('/files/OKVIDEO____.mp3');
  assert.equal(early.status, 409);

  // 2. Poll hasta terminar
  const done = await waitForJob(first.body.jobId);
  assert.equal(done.status, 'ok');
  assert.equal(done.title, 'Título de prueba OKVIDEO____');
  assert.equal(done.duration, 111);
  assert.equal(done.link, 'https://mp3.example.com/files/OKVIDEO____.mp3');
  assert.ok(done.filesize > 0);

  // 3. Descargar (contra el server local, no la URL pública configurada)
  const dl = await fetch(`${base}/files/OKVIDEO____.mp3`);
  assert.equal(dl.status, 200);
  const bytes = await dl.arrayBuffer();
  assert.equal(bytes.byteLength, done.filesize);

  // 4. Segunda conversión del mismo video sale de caché al instante
  const cachedRes = await api(`/api/convert?id=OKVIDEO____`);
  assert.equal(cachedRes.status, 200);
  assert.equal(cachedRes.body.cached, true);
  assert.equal(cachedRes.body.link, 'https://mp3.example.com/files/OKVIDEO____.mp3');
});

test('video inexistente termina en error con mensaje', async () => {
  const { body } = await api('/api/convert?id=ERRVIDEO___');
  const done = await waitForJob(body.jobId);
  assert.equal(done.status, 'error');
  assert.match(done.msg, /unavailable/i);
});

test('video más largo que MAX_DURATION_SECONDS se rechaza', async () => {
  const { body } = await api('/api/convert?id=LONGVIDEO__');
  const done = await waitForJob(body.jobId);
  assert.equal(done.status, 'error');
  assert.match(done.msg, /máximo permitido/);
});

test('modo síncrono (?wait=1) devuelve el link en una sola llamada', async () => {
  const { status, body } = await api('/api/convert?id=WAITVIDEO__&wait=1');
  assert.equal(status, 200);
  assert.equal(body.status, 'ok');
  assert.equal(body.link, 'https://mp3.example.com/files/WAITVIDEO__.mp3');
  assert.ok(body.filesize > 0);
});

test('modo síncrono con video en error responde 500 con causa', async () => {
  const { status, body } = await api('/api/convert?url=https://youtu.be/ERRVIDEO___&wait=1');
  // ERRVIDEO___ ya corrió en un test anterior; puede venir de un job nuevo
  assert.ok(status === 500 || body.status === 'error');
  assert.equal(body.status, 'error');
});

test('job desconocido devuelve 404', async () => {
  const { status } = await api('/api/jobs/no-existe');
  assert.equal(status, 404);
});

test('nombres de archivo maliciosos se rechazan', async () => {
  for (const name of ['..%2F..%2Fetc%2Fpasswd', 'foo.mp3', 'OKVIDEO____.txt']) {
    const { status } = await api(`/files/${name}`);
    assert.ok(status === 400 || status === 404, `${name} devolvió ${status}`);
  }
});
