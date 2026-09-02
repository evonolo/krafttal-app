// Statusabfrage. Praktisch zum Prüfen, ob der Container läuft,
// und wird von Docker als Healthcheck verwendet.
import express from 'express';
import { dbInfo } from '../db.js';

export const healthRouter = express.Router();

healthRouter.get('/health', (req, res) => {
  const info = dbInfo();
  res.json({
    ok: true,
    zeit: new Date().toISOString(),
    datenbank: { tabellen: info.tables },
  });
});
