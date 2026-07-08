# youMP3

API HTTP que recibe una URL de YouTube, convierte el video a MP3 con `yt-dlp` + `ffmpeg`, lo guarda en disco y devuelve una **URL pública de descarga** para que otro sistema la consuma. Equivalente autohospedado de la API `lurkapi/youtube-to-mp3-audio-downloader` de RapidAPI.

## Requisitos

- Node.js ≥ 20
- `yt-dlp` y `ffmpeg` en el PATH (el `Dockerfile` ya los incluye)

## Arranque rápido

```bash
npm install
cp .env.example .env   # ajusta PUBLIC_BASE_URL, etc.
npm start
```

Con Docker:

```bash
PUBLIC_BASE_URL=https://mp3.midominio.com docker compose up -d --build
```

## Uso

### 1. Pedir la conversión

```bash
curl -X POST http://localhost:3000/api/convert \
  -H 'Content-Type: application/json' \
  -d '{"url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"}'
```

También funciona por GET: `GET /api/convert?url=...` o `GET /api/convert?id=dQw4w9WgXcQ`.

Primera vez (aún convirtiendo) → `202 Accepted`:

```json
{
  "status": "processing",
  "jobId": "b8b1c9c2-...",
  "id": "dQw4w9WgXcQ",
  "msg": "Conversión en curso, consulta /api/jobs/b8b1c9c2-..."
}
```

### 2. Hacer polling hasta que termine

```bash
curl http://localhost:3000/api/jobs/b8b1c9c2-...
```

Al terminar → `status: "ok"` con el link público:

```json
{
  "status": "ok",
  "jobId": "b8b1c9c2-...",
  "id": "dQw4w9WgXcQ",
  "title": "Rick Astley - Never Gonna Give You Up",
  "duration": 213,
  "channel": "Rick Astley",
  "filesize": 5120345,
  "link": "https://mp3.midominio.com/files/dQw4w9WgXcQ.mp3"
}
```

Si el mismo video ya fue convertido antes, `POST /api/convert` responde `200` de inmediato con `"cached": true` y el link, sin reconvertir.

### 3. Descargar el MP3

```
GET /files/dQw4w9WgXcQ.mp3
```

## Endpoints

| Método | Ruta | Descripción |
|---|---|---|
| POST/GET | `/api/convert` | Encola la conversión (o devuelve el link si está en caché) |
| GET | `/api/jobs/:jobId` | Estado de una conversión en curso |
| GET | `/files/:videoId.mp3` | Descarga pública del MP3 |
| GET | `/health` | Healthcheck |

Estados posibles: `queued`, `processing`, `ok`, `error` (con `msg` explicando la causa).

## Configuración (variables de entorno)

Ver `.env.example`. Las más importantes:

- `PUBLIC_BASE_URL` — dominio con el que se construyen los links devueltos. Si está vacío se usa el host de la petición.
- `FILE_TTL_HOURS` — los MP3 se borran automáticamente tras este tiempo (default 24 h).
- `MAX_CONCURRENT` — conversiones simultáneas (default 2); el resto espera en cola.
- `MAX_DURATION_SECONDS` — rechaza videos más largos que esto (default 90 min).
- `API_KEY` — si se define, `/api/*` exige el header `x-api-key`.
- `YTDLP_COOKIES` — ruta a un `cookies.txt`; útil si YouTube aplica verificación anti-bot a la IP del servidor.

## Despliegue en Vercel

> Instancia desplegada: `https://yoump3-undajj-2087s-projects.vercel.app`
>
> ```bash
> curl "https://yoump3-undajj-2087s-projects.vercel.app/api/convert?url=https://youtu.be/dQw4w9WgXcQ"
> ```

El repo incluye una segunda variante del servicio pensada para serverless (`api/convert.js`): convierte **sincrónicamente** dentro de la request (Fluid compute, hasta 300 s) y guarda el MP3 en **Vercel Blob**, cuyo `link` devuelto es una URL pública permanente — no hace falta el sistema de jobs ni el disco local.

```bash
npm i -g vercel
vercel login
vercel link          # crea/asocia el proyecto
vercel blob store add yoump3-storage   # crea el Blob store y conecta BLOB_READ_WRITE_TOKEN
vercel deploy --prod
```

En el build, `vercel-build` (script `scripts/fetch-binaries.mjs`) descarga `yt-dlp` y un `ffmpeg` estático a `bin/`, que se empaquetan con la función (`includeFiles` en `vercel.json`).

Uso (síncrono, sin polling):

```bash
curl "https://<tu-proyecto>.vercel.app/api/convert?url=https://youtu.be/dQw4w9WgXcQ"
# → { "status": "ok", "title": "...", "link": "https://<store>.public.blob.vercel-storage.com/mp3/dQw4w9WgXcQ.mp3" }
```

Variables de entorno soportadas en Vercel: `API_KEY`, `MAX_DURATION_SECONDS`, `AUDIO_BITRATE` y `YTDLP_COOKIES_B64` (un `cookies.txt` en base64, para sortear la verificación anti-bot de YouTube desde IPs de datacenter — en Vercel es probable que la necesites).

**Limpieza automática**: un cron diario de Vercel (`vercel.json`) invoca `/api/cleanup`, que borra del Blob store los MP3 con más de `BLOB_TTL_DAYS` días (default 30; `0` desactiva el borrado). Define `CRON_SECRET` en el proyecto si quieres que solo el cron pueda invocarlo.

La raíz del despliegue (`/`) sirve una página con la documentación de la API (`public/index.html`).

Para probar el handler serverless en local sin desplegar:

```bash
node --experimental-test-module-mocks scripts/vercel-local.mjs
curl "http://localhost:3333/api/convert?id=dQw4w9WgXcQ"
```

## Tests

```bash
npm test
```

Corre la suite con el runner nativo de Node: tests unitarios del parser de URLs y tests de integración de la API completa (encolar → poll → descargar → caché → errores) usando un `yt-dlp` simulado, así que no necesitan red. El workflow de CI (`.github/workflows/ci.yml`) los ejecuta en cada push y además construye la imagen Docker.

## Videos largos (hasta 9 horas) y bloqueos de YouTube

El límite por defecto es `MAX_DURATION_SECONDS=32400` (9 h). Dónde puede convertirse cada duración:

| Escenario | Límite práctico | Nota |
|---|---|---|
| **Autohospedado (Docker)** | 9 h+ | Conversión asíncrona en segundo plano con polling; es la vía recomendada para videos de horas. `YTDLP_TIMEOUT_MINUTES` (default 90) acota cada conversión. |
| **Vercel Hobby** | ~3 h (`SYNC_MAX_SECONDS=10800`) | La función vive máx. 300 s; videos que no caben se rechazan con 422 y mensaje claro. |
| **Vercel Pro** | ~9 h | Sube `maxDuration` a 800 en `vercel.json` y `SYNC_MAX_SECONDS=32400`. |

**PO Tokens / bot-check**: YouTube exige "PO Tokens" y verificación anti-bot a las IPs de datacenter. Este proyecto integra [bgutil-ytdlp-pot-provider](https://github.com/Brainicism/bgutil-ytdlp-pot-provider) (estándar de la comunidad yt-dlp) en ambas variantes: la imagen Docker corre su servidor local automáticamente y la función de Vercel empaqueta el generador en modo script. Aun así, **en IPs muy marcadas (p. ej. las compartidas de Vercel) YouTube puede bloquear a nivel del player API**, donde los tokens no bastan; en ese caso la API devuelve `503 YOUTUBE_BOT_CHECK` y las opciones son:

1. `YTDLP_COOKIES_B64` — cookies de una sesión de YouTube exportadas del navegador, en base64 (`base64 -w0 cookies.txt`). Lo más efectivo.
2. `YTDLP_PROXY` — enrutar yt-dlp por un proxy con IP limpia (p. ej. residencial).
3. Autohospedar con Docker en un servidor cuya IP no esté marcada (VPS pequeño suele bastar).

## Notas de operación

- **Caché**: los MP3 se guardan como `<videoId>.mp3` junto a un `<videoId>.json` con metadatos, así la caché sobrevive reinicios.
- **Anti-bot de YouTube**: en datacenters, YouTube a veces exige verificación. Si aparece el error "Sign in to confirm you're not a bot", exporta cookies de un navegador con sesión y configura `YTDLP_COOKIES`.
- **yt-dlp desactualizado** es la causa #1 de fallos de descarga; actualízalo periódicamente (`yt-dlp -U` o reconstruye la imagen).
- **Legal**: usa esta herramienta solo con contenido que tengas derecho a descargar; descargar contenido protegido puede violar los Términos de Servicio de YouTube.
