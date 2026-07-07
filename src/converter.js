import { spawn } from 'node:child_process';
import { config } from './config.js';

function runYtDlp(args, { timeoutMs = 10 * 60 * 1000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(config.ytDlpBin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('yt-dlp timed out'));
    }, timeoutMs);

    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) return resolve({ stdout, stderr });
      // yt-dlp escribe la causa real en stderr; nos quedamos con la última línea ERROR.
      const errLine = stderr.split('\n').filter((l) => l.includes('ERROR')).pop()
        || stderr.trim().split('\n').pop()
        || `yt-dlp exited with code ${code}`;
      reject(new Error(errLine.replace(/^ERROR:\s*/, '')));
    });
  });
}

function commonArgs(videoId) {
  const args = ['--no-playlist', '--no-warnings'];
  if (config.cookiesFile) args.push('--cookies', config.cookiesFile);
  args.push(`https://www.youtube.com/watch?v=${videoId}`);
  return args;
}

/** Obtiene metadatos (título, duración, etc.) sin descargar. */
export async function fetchMetadata(videoId) {
  const { stdout } = await runYtDlp(['-J', ...commonArgs(videoId)], { timeoutMs: 60 * 1000 });
  const info = JSON.parse(stdout);
  return {
    id: info.id,
    title: info.title,
    duration: info.duration ?? null,
    channel: info.channel ?? info.uploader ?? null,
    thumbnail: info.thumbnail ?? null,
  };
}

/** Descarga el audio y lo convierte a MP3 en outPath (sin extensión .mp3 final duplicada). */
export async function downloadMp3(videoId, outPathTemplate) {
  await runYtDlp([
    '-x',
    '--audio-format', 'mp3',
    '--audio-quality', config.audioBitrate,
    '--embed-thumbnail',
    '--add-metadata',
    '-o', outPathTemplate,
    ...commonArgs(videoId),
  ]);
}
