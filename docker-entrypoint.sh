#!/bin/sh
set -e

# Proveedor de PO Tokens de YouTube (bgutil) en segundo plano; el plugin de
# yt-dlp lo detecta automáticamente en 127.0.0.1:4416.
node /opt/bgutil/server/build/main.js &

exec node src/server.js
