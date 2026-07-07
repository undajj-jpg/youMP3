FROM node:22-slim

# ffmpeg para la conversión a MP3 y yt-dlp para la descarga
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg python3 curl ca-certificates \
    && curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod +x /usr/local/bin/yt-dlp \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY src ./src

ENV PORT=3000 \
    STORAGE_DIR=/data
VOLUME /data
EXPOSE 3000

CMD ["node", "src/server.js"]
