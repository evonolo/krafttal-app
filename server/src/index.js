// Einstiegspunkt des Servers.
import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { migrate, dbInfo } from './db.js';
import { healthRouter } from './routes/health.js';

const here = path.dirname(fileURLToPath(import.meta.url));

migrate();

const app = express();

// Hinter dem Reverse Proxy der Synology steht die echte Besucher-IP
// im X-Forwarded-For-Kopf, nicht in der Verbindung selbst.
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

app.use('/api', healthRouter);

// Die Oberfläche wird als statische Datei ausgeliefert.
app.use(express.static(path.resolve(here, '../../web')));

// Unbekannte API-Pfade sollen JSON liefern, keine HTML-Fehlerseite.
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Nicht gefunden' });
});

app.listen(config.port, () => {
  const info = dbInfo();
  console.log(`Krafttal-Server läuft auf Port ${config.port}`);
  console.log(`Datenbank: ${info.file} (${info.tables} Tabellen)`);
  console.log(`Adresse:   ${config.publicUrl}`);
});
