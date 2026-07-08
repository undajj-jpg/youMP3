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

## Tests

```bash
npm test
```

Corre la suite con el runner nativo de Node: tests unitarios del parser de URLs y tests de integración de la API completa (encolar → poll → descargar → caché → errores) usando un `yt-dlp` simulado, así que no necesitan red. El workflow de CI (`.github/workflows/ci.yml`) los ejecuta en cada push y además construye la imagen Docker.

## Notas de operación

- **Caché**: los MP3 se guardan como `<videoId>.mp3` junto a un `<videoId>.json` con metadatos, así la caché sobrevive reinicios.
- **Anti-bot de YouTube**: en datacenters, YouTube a veces exige verificación. Si aparece el error "Sign in to confirm you're not a bot", exporta cookies de un navegador con sesión y configura `YTDLP_COOKIES`.
- **yt-dlp desactualizado** es la causa #1 de fallos de descarga; actualízalo periódicamente (`yt-dlp -U` o reconstruye la imagen).
- **Legal**: usa esta herramienta solo con contenido que tengas derecho a descargar; descargar contenido protegido puede violar los Términos de Servicio de YouTube.
