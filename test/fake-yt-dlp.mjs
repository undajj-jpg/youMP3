#!/usr/bin/env node
// yt-dlp simulado para los tests de integración: mismo contrato de CLI que
// usa src/converter.js, sin tocar la red.
//
// Comportamiento según el ID del video en la URL:
//   ERRVIDEO___ -> falla como lo haría un video inexistente
//   LONGVIDEO__ -> reporta una duración enorme (para probar el límite)
//   cualquier otro -> metadatos normales y "descarga" un MP3 de mentira
import fs from 'node:fs';

const args = process.argv.slice(2);
const url = args[args.length - 1];
const videoId = new URL(url).searchParams.get('v');

if (videoId === 'ERRVIDEO___') {
  console.error('ERROR: [youtube] ERRVIDEO___: Video unavailable');
  process.exit(1);
}

const duration = videoId === 'LONGVIDEO__' ? 999999 : 111;

if (args.includes('-J')) {
  console.log(JSON.stringify({
    id: videoId,
    title: `Título de prueba ${videoId}`,
    duration,
    channel: 'Canal de prueba',
    thumbnail: `https://i.ytimg.com/vi/${videoId}/hq.jpg`,
  }));
  process.exit(0);
}

// Modo descarga: crear el archivo según la plantilla -o
const template = args[args.indexOf('-o') + 1];
const outPath = template.replace('%(ext)s', 'mp3');
// Pequeña espera para que el estado "processing" sea observable en los tests.
await new Promise((r) => setTimeout(r, 300));
fs.writeFileSync(outPath, 'FAKE-MP3-BYTES-'.repeat(64));
