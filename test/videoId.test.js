import test from 'node:test';
import assert from 'node:assert/strict';
import { extractVideoId } from '../src/videoId.js';

const ID = 'dQw4w9WgXcQ';

test('acepta las variantes de URL de YouTube', () => {
  const valid = [
    `https://www.youtube.com/watch?v=${ID}`,
    `http://youtube.com/watch?v=${ID}&t=42s`,
    `https://m.youtube.com/watch?v=${ID}`,
    `https://youtu.be/${ID}`,
    `https://youtu.be/${ID}?si=abc123`,
    `https://www.youtube.com/shorts/${ID}`,
    `https://www.youtube.com/embed/${ID}`,
    `https://www.youtube.com/live/${ID}`,
    `https://music.youtube.com/watch?v=${ID}`,
    `https://www.youtube-nocookie.com/embed/${ID}`,
    ID, // ID directo
    `  ${ID}  `, // con espacios
  ];
  for (const input of valid) {
    assert.equal(extractVideoId(input), ID, `falló con: ${input}`);
  }
});

test('rechaza entradas inválidas', () => {
  const invalid = [
    '',
    null,
    undefined,
    42,
    'no-es-youtube',
    'https://vimeo.com/12345',
    'https://www.youtube.com/watch', // sin v
    'https://www.youtube.com/watch?v=corto', // ID mal formado
    'https://evil.com/watch?v=' + ID, // host ajeno
    'https://youtube.com.evil.com/watch?v=' + ID, // sufijo falso
    '../../../etc/passwd',
    'dQw4w9WgXc', // 10 chars
    'dQw4w9WgXcQQ', // 12 chars
  ];
  for (const input of invalid) {
    assert.equal(extractVideoId(input), null, `debió rechazar: ${input}`);
  }
});
