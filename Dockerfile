FROM node:22-slim

# ffmpeg para la conversión; yt-dlp (pip) + plugin bgutil para descargar de
# YouTube generando los PO Tokens que exige desde IPs de datacenter.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg python3 python3-pip curl ca-certificates \
    && pip3 install --no-cache-dir --break-system-packages "yt-dlp[default]" yt-dlp-ejs bgutil-ytdlp-pot-provider \
    && rm -rf /var/lib/apt/lists/*

# Servidor bgutil (genera los PO Tokens); versión pineada
ARG BGUTIL_VERSION=1.3.1
RUN curl -fsSL "https://github.com/Brainicism/bgutil-ytdlp-pot-provider/archive/refs/tags/${BGUTIL_VERSION}.tar.gz" \
      | tar -xz -C /opt \
    && mv "/opt/bgutil-ytdlp-pot-provider-${BGUTIL_VERSION}" /opt/bgutil \
    && cd /opt/bgutil/server \
    && npm ci --ignore-scripts --no-audit --no-fund \
    && (npx tsc || true) \
    && test -f build/main.js \
    && npm prune --omit=dev --ignore-scripts \
    && npm cache clean --force

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY src ./src
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

ENV PORT=3000 \
    STORAGE_DIR=/data \
    YTDLP_BIN=yt-dlp
VOLUME /data
EXPOSE 3000

CMD ["./docker-entrypoint.sh"]
