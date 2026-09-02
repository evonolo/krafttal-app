#!/bin/sh
# Sicherung der Krafttal-Datenbank.
#
# Wichtig: Es reicht NICHT, krafttal.db zu kopieren. SQLite legt frische
# Änderungen zuerst in krafttal.db-wal ab. Eine Kopie nur der Hauptdatei
# kann deshalb Stunden alt sein, obwohl die Datei eben erst geändert wurde.
#
# Dieses Skript benutzt den eingebauten Sicherungsbefehl von SQLite. Der
# nimmt immer den vollständigen Stand, auch während die App weiterläuft.
#
# Aufruf:   ./sichern.sh [Zielverzeichnis]
# Beispiel: ./sichern.sh /volume1/backups/krafttal

set -e

ZIEL="${1:-./sicherungen}"
NAME="krafttal-$(date +%Y-%m-%d-%H%M).db"
BEHAELTER="${CONTAINER:-krafttal}"

mkdir -p "$ZIEL"

docker exec "$BEHAELTER" node -e "
const D = require('better-sqlite3');
const d = new D('/data/krafttal.db', { readonly: true });
d.backup('/tmp/sicherung.db').then(() => { console.log('fertig'); process.exit(0); })
 .catch((e) => { console.error(e.message); process.exit(1); });
" > /dev/null

docker cp "$BEHAELTER:/tmp/sicherung.db" "$ZIEL/$NAME"
docker exec "$BEHAELTER" rm -f /tmp/sicherung.db

echo "Gesichert: $ZIEL/$NAME ($(du -h "$ZIEL/$NAME" | cut -f1))"

# Hochgeladene Fotos liegen daneben und gehören mitgesichert.
if [ -d ./data/uploads ]; then
  tar -czf "$ZIEL/fotos-$(date +%Y-%m-%d-%H%M).tar.gz" -C ./data uploads
  echo "Fotos gesichert."
fi

# Alte Sicherungen aufräumen: die letzten 30 behalten.
ls -1t "$ZIEL"/krafttal-*.db 2>/dev/null | tail -n +31 | xargs -r rm --
