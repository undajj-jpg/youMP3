// Limpieza periódica del Blob store: borra los MP3 más viejos que
// BLOB_TTL_DAYS (default 30; 0 = nunca borrar). Lo invoca el cron de Vercel
// definido en vercel.json. Si CRON_SECRET está definido, exige el header
// Authorization: Bearer <CRON_SECRET> (Vercel lo envía automáticamente).
import { list, del } from '@vercel/blob';

const TTL_DAYS = parseFloat(process.env.BLOB_TTL_DAYS ?? '30');

export default async function handler(req, res) {
  if (process.env.CRON_SECRET && req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ status: 'error', msg: 'No autorizado' });
  }
  if (TTL_DAYS <= 0) {
    return res.json({ status: 'ok', deleted: 0, msg: 'BLOB_TTL_DAYS <= 0, limpieza desactivada' });
  }

  const cutoff = Date.now() - TTL_DAYS * 86400 * 1000;
  let cursor;
  let deleted = 0;
  try {
    do {
      const page = await list({ prefix: 'mp3/', cursor, limit: 1000 });
      cursor = page.cursor;
      const expired = page.blobs.filter((b) => new Date(b.uploadedAt).getTime() < cutoff);
      if (expired.length > 0) {
        await del(expired.map((b) => b.url));
        deleted += expired.length;
      }
    } while (cursor);
    return res.json({ status: 'ok', deleted, ttlDays: TTL_DAYS });
  } catch (err) {
    return res.status(500).json({ status: 'error', deleted, msg: err.message });
  }
}
