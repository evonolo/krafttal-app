// SQLite-Anbindung. Eine einzige Datei als Datenbank - Sicherung heißt
// hier: Datei kopieren.
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, dbFile, uploadDir } from './config.js';

const here = path.dirname(fileURLToPath(import.meta.url));

fs.mkdirSync(config.dataDir, { recursive: true });
fs.mkdirSync(uploadDir, { recursive: true });

export const db = new Database(dbFile);

// WAL macht gleichzeitiges Lesen und Schreiben verträglich,
// foreign_keys erzwingt, dass Verweise zwischen Tabellen stimmen.
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Schema bei jedem Start anwenden. Alle Anweisungen sind "IF NOT EXISTS",
// ein zweiter Start ändert also nichts.
export function migrate() {
  const sql = fs.readFileSync(path.join(here, 'schema.sql'), 'utf8');
  db.exec(sql);
}

// Sauber schließen, wenn der Container gestoppt wird.
//
// SQLite schreibt frische Änderungen zuerst in die Begleitdatei krafttal.db-wal
// und erst später in die Hauptdatei. Wird der Prozess einfach abgeschossen,
// bleiben die letzten Änderungen dort liegen. Für SQLite ist das
// unproblematisch - beim nächsten Start holt es sie sich von dort. Wer aber
// nur die Hauptdatei sichert, dem fehlen sie.
//
// Deshalb: beim Stoppen die Begleitdatei in die Hauptdatei überführen und
// die Datenbank ordentlich schließen.
export function closeDb() {
  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
    db.close();
  } catch { /* beim Herunterfahren nicht mehr wichtig */ }
}

export function dbInfo() {
  const tables = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
    .all()
    .map((r) => r.name);
  return { file: dbFile, tables: tables.length, names: tables };
}
