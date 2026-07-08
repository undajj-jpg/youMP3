// Harness de desarrollo para probar api/convert.js sin desplegar:
//   node --experimental-test-module-mocks scripts/vercel-local.mjs
// Simula @vercel/blob guardando los blobs en ./storage/blob-local y expone el
// handler en http://localhost:3333 con la interfaz req/res de Vercel.
import { mock } from 'node:test';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const OUT_DIR = path.resolve('storage/blob-local');
fs.mkdirSync(OUT_DIR, { recursive: true });

mock.module('@vercel/blob', {
  namedExports: {
    async list({ prefix }) {
      // Prefijo exacto de archivo (caché de convert) o de carpeta (cleanup)
      const names = prefix.endsWith('.mp3')
        ? [path.basename(prefix)].filter((n) => fs.existsSync(path.join(OUT_DIR, n)))
        : fs.readdirSync(OUT_DIR);
      return {
        cursor: undefined,
        blobs: names.map((n) => {
          const stat = fs.statSync(path.join(OUT_DIR, n));
          return {
            url: `https://fake.blob.vercel-storage.com/mp3/${n}`,
            pathname: `mp3/${n}`,
            size: stat.size,
            uploadedAt: stat.mtime.toISOString(),
          };
        }),
      };
    },
    async put(pathname, data) {
      const f = path.join(OUT_DIR, path.basename(pathname));
      if (typeof data?.pipe === 'function') {
        const { pipeline } = await import('node:stream/promises');
        await pipeline(data, fs.createWriteStream(f));
      } else {
        fs.writeFileSync(f, data);
      }
      return { url: `https://fake.blob.vercel-storage.com/${pathname}` };
    },
    async del(urls) {
      for (const u of [].concat(urls)) {
        fs.rmSync(path.join(OUT_DIR, path.basename(u)), { force: true });
      }
    },
  },
});

const { default: convert } = await import('../api/convert.js');
const { default: cleanup } = await import('../api/cleanup.js');

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let raw = '';
  req.on('data', (d) => (raw += d));
  req.on('end', () => {
    const vreq = {
      method: req.method,
      headers: req.headers,
      query: Object.fromEntries(url.searchParams),
      body: raw ? JSON.parse(raw) : undefined,
    };
    const vres = {
      _code: 200,
      status(c) { this._code = c; return this; },
      json(obj) {
        res.writeHead(this._code, { 'content-type': 'application/json' });
        res.end(JSON.stringify(obj));
      },
    };
    const handler = url.pathname === '/api/cleanup' ? cleanup : convert;
    Promise.resolve(handler(vreq, vres)).catch((e) => {
      res.writeHead(500);
      res.end(String(e));
    });
  });
}).listen(process.env.PORT ?? 3333, () => console.log('harness listo'));
