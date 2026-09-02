// Zentrale Konfiguration. Alles kommt aus Umgebungsvariablen, damit auf der
// Synology nichts im Code geändert werden muss.
import path from 'node:path';

const int = (v, fallback) => (v && Number.isFinite(Number(v)) ? Number(v) : fallback);

export const config = {
  port: int(process.env.PORT, 3000),

  // Verzeichnis für Datenbank und hochgeladene Fotos.
  // Im Docker ist das ein Volume, damit die Daten einen Neustart überleben.
  dataDir: process.env.DATA_DIR || path.resolve(process.cwd(), '../data'),

  // Öffentliche Adresse der App, später z. B. https://krafttal.example.at
  publicUrl: process.env.PUBLIC_URL || 'http://localhost:3000',

  // true, sobald die App hinter HTTPS läuft: setzt das Secure-Flag am Cookie.
  secureCookies: process.env.SECURE_COOKIES === 'true',

  // Gültigkeitsdauer einer Anmeldung in Tagen
  sessionDays: int(process.env.SESSION_DAYS, 30),

  isProduction: process.env.NODE_ENV === 'production',
};

export const dbFile = path.join(config.dataDir, 'krafttal.db');
export const uploadDir = path.join(config.dataDir, 'uploads');
