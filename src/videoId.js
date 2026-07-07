const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

/**
 * Extrae el ID de video de una URL de YouTube (o acepta el ID directo).
 * Soporta: watch?v=, youtu.be/, shorts/, embed/, live/, music.youtube.com.
 * Devuelve null si no es un video de YouTube válido.
 */
export function extractVideoId(input) {
  if (typeof input !== 'string') return null;
  const raw = input.trim();

  if (VIDEO_ID_RE.test(raw)) return raw;

  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\.|^m\./, '').toLowerCase();

  if (host === 'youtu.be') {
    const id = url.pathname.split('/')[1] ?? '';
    return VIDEO_ID_RE.test(id) ? id : null;
  }

  if (host === 'youtube.com' || host === 'music.youtube.com' || host === 'youtube-nocookie.com') {
    const v = url.searchParams.get('v');
    if (v && VIDEO_ID_RE.test(v)) return v;

    const match = url.pathname.match(/^\/(shorts|embed|live|v)\/([A-Za-z0-9_-]{11})(?:\/|$)/);
    if (match) return match[2];
  }

  return null;
}
