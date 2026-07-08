import path from 'node:path';
import fs from 'node:fs';
import { config } from './config.js';
import { createApp } from './app.js';
import { cleanupExpired } from './jobs.js';

fs.mkdirSync(config.storageDir, { recursive: true });
setInterval(() => cleanupExpired().catch(() => {}), 15 * 60 * 1000).unref();
cleanupExpired().catch(() => {});

createApp().listen(config.port, () => {
  console.log(`youMP3 escuchando en puerto ${config.port}`);
  console.log(`Archivos servidos desde ${path.resolve(config.storageDir)}`);
});
