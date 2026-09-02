// Zentrale Konfiguration. Alles kommt aus Umgebungsvariablen, damit auf der
// Synology nichts im Code geändert werden muss.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Wurzel des Projekts, ausgehend von dieser Datei (server/src/config.js).
// Bewusst nicht das Arbeitsverzeichnis: Sonst hinge es davon ab, aus
// welchem Ordner der Server gestartet wurde.
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const int = (v, fallback) => (v && Number.isFinite(Number(v)) ? Number(v) : fallback);

export const config = {
  port: int(process.env.PORT, 3000),

  // Verzeichnis für Datenbank und hochgeladene Fotos.
  // Im Docker ist das ein Volume, damit die Daten einen Neustart überleben.
  dataDir: process.env.DATA_DIR || path.join(projectRoot, 'data'),

  // Öffentliche Adresse der App, später z. B. https://krafttal.example.at
  publicUrl: process.env.PUBLIC_URL || 'http://localhost:3000',

  // true, sobald die App hinter HTTPS läuft: setzt das Secure-Flag am Cookie.
  secureCookies: process.env.SECURE_COOKIES === 'true',

  // Gültigkeitsdauer einer Anmeldung in Tagen
  sessionDays: int(process.env.SESSION_DAYS, 30),

  isProduction: process.env.NODE_ENV === 'production',

  // Verzeichnis der Oberfläche. Lokal liegt web/ neben server/, im Container
  // liegen beide nebeneinander unter /app - deshalb überschreibbar.
  webDir: process.env.WEB_DIR || path.join(projectRoot, 'web'),
};

export const dbFile = path.join(config.dataDir, 'krafttal.db');
export const uploadDir = path.join(config.dataDir, 'uploads');
