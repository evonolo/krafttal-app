# Zweistufiger Bau.
#
# Node 22 ist die LTS-Version und wird lange gepflegt - richtig für etwas,
# das auf dem NAS unbeaufsichtigt durchläuft. Mit Node 24 stürzt
# better-sqlite3 beim Aufräumen seiner Datenbankbefehle ab.
#
# Stufe 1 übersetzt better-sqlite3 selbst. Das ist nötig, weil es nicht für
# jede Kombination aus Node-Version und Prozessortyp fertige Binärdateien
# gibt - auf dem Mac (ARM) fehlen sie, auf der Synology (Intel) je nach
# Modell ebenso. Selbst übersetzen funktioniert immer.
#
# Stufe 2 nimmt nur das fertige Ergebnis. Compiler und Python bleiben
# zurück, das Endimage bleibt schlank.

FROM node:22-bookworm-slim AS build

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force


FROM node:22-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

# Nur die fertigen Pakete aus der Baustufe übernehmen.
COPY --from=build /app/node_modules ./node_modules
COPY server/package.json ./
COPY server/src ./src
COPY web ./web

# Datenverzeichnis. Wird per Volume von außen eingehängt,
# damit Datenbank und Fotos den Container überleben.
ENV DATA_DIR=/data
ENV WEB_DIR=/app/web
RUN mkdir -p /data && chown -R node:node /data /app

# Nicht als Administrator laufen lassen.
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/index.js"]
