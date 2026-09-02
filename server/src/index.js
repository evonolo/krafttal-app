// Einstiegspunkt des Servers.
import express from 'express';
import cookieParser from 'cookie-parser';
import { config } from './config.js';
import { migrate, dbInfo, closeDb } from './db.js';
import { healthRouter } from './routes/health.js';
import { authRouter } from './routes/auth.js';
import { adminRouter } from './routes/admin.js';
import { anliegenRouter } from './routes/anliegen.js';
import { eventsRouter } from './routes/events.js';
import { orgsRouter } from './routes/orgs.js';
import { seed } from './seed.js';
import { loadUser, purgeExpiredSessions } from './auth.js';

migrate();
seed();

const app = express();

// Hinter dem Reverse Proxy der Synology steht die echte Besucher-IP
// im X-Forwarded-For-Kopf, nicht in der Verbindung selbst.
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// Vor allen Routen: Sitzung einlesen, falls vorhanden.
app.use(loadUser);

app.use('/api', healthRouter);
app.use('/api', authRouter);
app.use('/api/admin', adminRouter);
app.use('/api/anliegen', anliegenRouter);
app.use('/api/events', eventsRouter);
app.use('/api/orgs', orgsRouter);

// Die Oberfläche wird als statische Datei ausgeliefert.
app.use(express.static(config.webDir));

// Unbekannte API-Pfade sollen JSON liefern, keine HTML-Fehlerseite.
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Nicht gefunden' });
});

// Abgelaufene Sitzungen beim Start und danach einmal am Tag wegräumen.
purgeExpiredSessions();
setInterval(purgeExpiredSessions, 24 * 60 * 60 * 1000).unref();

const server = app.listen(config.port, () => {
  const info = dbInfo();
  console.log(`Krafttal-Server läuft auf Port ${config.port}`);
  console.log(`Datenbank: ${info.file} (${info.tables} Tabellen)`);
  console.log(`Adresse:   ${config.publicUrl}`);
  console.log(`Oberfläche: ${config.webDir}`);
});

// Docker schickt beim Stoppen SIGTERM. Ohne Behandlung wird der Prozess
// abgeschossen und die Datenbank bleibt unsauber zurück.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    console.log(`${signal} empfangen, fahre herunter.`);
    server.close(() => {
      closeDb();
      process.exit(0);
    });
    // Falls noch Verbindungen offen sind: nach fünf Sekunden trotzdem beenden.
    setTimeout(() => { closeDb(); process.exit(0); }, 5000).unref();
  });
}
