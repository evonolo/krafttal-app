# Ein einziger Container für die ganze App.
# Debian statt Alpine, weil better-sqlite3 dafür fertige Binärdateien liefert
# und nicht im Container übersetzt werden muss.
FROM node:24-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

# Erst nur die Paketlisten kopieren: Solange sich die nicht ändern,
# überspringt Docker beim nächsten Bauen das Installieren.
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts=false && npm cache clean --force

COPY server/src ./src
COPY web ./web

# Datenverzeichnis. Wird per Volume von außen eingehängt,
# damit Datenbank und Fotos den Container überleben.
ENV DATA_DIR=/data
RUN mkdir -p /data && chown -R node:node /data /app

# Nicht als Administrator laufen lassen.
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/index.js"]
