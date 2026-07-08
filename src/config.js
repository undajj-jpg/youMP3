const env = (key, fallback) => process.env[key] ?? fallback;

export const config = {
  port: parseInt(env('PORT', '3000'), 10),

  // Base pública con la que se construyen los links devueltos por la API.
  // En producción debe ser el dominio real, ej: https://mp3.midominio.com
  publicBaseUrl: env('PUBLIC_BASE_URL', '').replace(/\/+$/, ''),

  // Carpeta donde se guardan los MP3 generados.
  storageDir: env('STORAGE_DIR', './storage'),

  // Horas que un MP3 permanece disponible antes de ser borrado.
  fileTtlHours: parseFloat(env('FILE_TTL_HOURS', '24')),

  // Conversiones simultáneas máximas; el resto espera en cola.
  maxConcurrent: parseInt(env('MAX_CONCURRENT', '2'), 10),

  // Duración máxima permitida del video (en segundos). 0 = sin límite.
  // Default: 9 horas.
  maxDurationSeconds: parseInt(env('MAX_DURATION_SECONDS', '32400'), 10),

  // Tiempo máximo de descarga+conversión de un video (en minutos).
  ytdlpTimeoutMinutes: parseFloat(env('YTDLP_TIMEOUT_MINUTES', '90')),

  // Calidad del MP3 (bitrate). Ej: 128K, 192K, 320K.
  audioBitrate: env('AUDIO_BITRATE', '192K'),

  // Si se define, todas las rutas /api/* exigen el header x-api-key.
  apiKey: env('API_KEY', ''),

  // Binario de yt-dlp (por si se instala en otra ruta).
  ytDlpBin: env('YTDLP_BIN', 'yt-dlp'),

  // Archivo de cookies para yt-dlp (opcional, ayuda contra bloqueos anti-bot).
  cookiesFile: env('YTDLP_COOKIES', ''),

  // Proxy de salida para yt-dlp (opcional, ej. proxy residencial).
  proxy: env('YTDLP_PROXY', ''),

  // Ruta al generate_once.js de bgutil para generar PO Tokens en modo script
  // (opcional; si el servidor bgutil corre en 127.0.0.1:4416 no hace falta).
  bgutilScript: env('BGUTIL_SCRIPT', ''),
};
