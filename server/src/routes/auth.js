// Registrierung, Anmeldung, Abmeldung.
import express from 'express';
import { db } from '../db.js';
import {
  hashPassword, verifyPassword, createSession, destroySession,
  setSessionCookie, clearSessionCookie, publicUser, requireLogin,
} from '../auth.js';

export const authRouter = express.Router();

const ROLLEN = ['einwohner', 'betrieb', 'verein', 'zweitwohnsitz'];
const MIN_PASSWORT = 8;

const istEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);
const text = (v, max = 200) => String(v ?? '').trim().slice(0, max);

// ---------- Bremse gegen Durchprobieren ----------
//
// Pro E-Mail und pro IP werden Fehlversuche gezählt. Nach zu vielen
// Versuchen wird für einige Minuten abgewiesen. Bewusst einfach und im
// Arbeitsspeicher: Bei 800 Leuten braucht das keine Datenbank.

const versuche = new Map();
const MAX_VERSUCHE = 8;
const SPERRE_MS = 10 * 60 * 1000;

function zuVieleVersuche(schluessel) {
  const e = versuche.get(schluessel);
  if (!e) return false;
  if (Date.now() > e.bis) { versuche.delete(schluessel); return false; }
  return e.n >= MAX_VERSUCHE;
}

function fehlversuch(schluessel) {
  const e = versuche.get(schluessel);
  if (e && Date.now() <= e.bis) e.n += 1;
  else versuche.set(schluessel, { n: 1, bis: Date.now() + SPERRE_MS });
}

function versucheZuruecksetzen(schluessel) {
  versuche.delete(schluessel);
}

// ---------- Registrierung ----------

authRouter.post('/register', (req, res) => {
  const email = text(req.body?.email, 200).toLowerCase();
  const passwort = String(req.body?.passwort ?? '');
  const name = text(req.body?.name, 120);
  const adresse = text(req.body?.adresse, 200);
  const telefon = text(req.body?.telefon, 60);
  const rolle = ROLLEN.includes(req.body?.rolle) ? req.body.rolle : 'einwohner';
  const referenz = text(req.body?.referenz, 200);

  if (!name) return res.status(400).json({ error: 'Bitte gib deinen Namen an.' });
  if (!istEmail(email)) return res.status(400).json({ error: 'Diese E-Mail-Adresse sieht nicht richtig aus.' });
  if (passwort.length < MIN_PASSWORT) {
    return res.status(400).json({ error: `Das Passwort braucht mindestens ${MIN_PASSWORT} Zeichen.` });
  }

  const schonDa = db.prepare(`SELECT id FROM users WHERE email = ?`).get(email);
  if (schonDa) {
    return res.status(409).json({ error: 'Für diese E-Mail-Adresse gibt es schon ein Konto.' });
  }

  // Die erste Person, die sich anmeldet, wird automatisch freigeschaltet und
  // Administrator - sonst könnte sie niemand freischalten.
  const istErste = db.prepare(`SELECT COUNT(*) AS c FROM users`).get().c === 0;

  const info = db.prepare(`
    INSERT INTO users (email, password_hash, name, address, phone, role, reference, status, is_admin, decided_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    email, hashPassword(passwort), name, adresse, telefon, rolle, referenz,
    istErste ? 'active' : 'pending',
    istErste ? 1 : 0,
    istErste ? new Date().toISOString().replace('T', ' ').slice(0, 19) : null,
  );

  const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(info.lastInsertRowid);
  setSessionCookie(res, createSession(user.id));

  res.status(201).json({
    user: publicUser(user),
    ersterAdmin: istErste,
  });
});

// ---------- Anmeldung ----------

authRouter.post('/login', (req, res) => {
  const email = text(req.body?.email, 200).toLowerCase();
  const passwort = String(req.body?.passwort ?? '');
  const ip = req.ip || 'unbekannt';

  if (zuVieleVersuche(email) || zuVieleVersuche(ip)) {
    return res.status(429).json({
      error: 'Zu viele Fehlversuche. Bitte in zehn Minuten noch einmal probieren.',
    });
  }

  const user = db.prepare(`SELECT * FROM users WHERE email = ?`).get(email);

  // Bewusst dieselbe Meldung für "Konto gibt es nicht" und "Passwort falsch":
  // Sonst könnte man ausprobieren, wer im Tal ein Konto hat.
  if (!user || !verifyPassword(passwort, user.password_hash)) {
    fehlversuch(email);
    fehlversuch(ip);
    return res.status(401).json({ error: 'E-Mail-Adresse oder Passwort stimmt nicht.' });
  }

  if (user.status === 'blocked') {
    return res.status(403).json({
      error: 'Dieses Konto ist gesperrt. Melde dich beim Krafttal-Team.',
    });
  }

  versucheZuruecksetzen(email);
  versucheZuruecksetzen(ip);
  setSessionCookie(res, createSession(user.id));
  res.json({ user: publicUser(user) });
});

// ---------- Abmeldung ----------

authRouter.post('/logout', (req, res) => {
  if (req.sessionId) destroySession(req.sessionId);
  clearSessionCookie(res);
  res.json({ ok: true });
});

// ---------- Wer bin ich ----------

authRouter.get('/me', (req, res) => {
  if (!req.user) return res.json({ user: null });
  res.json({ user: publicUser(req.user) });
});

// ---------- Passwort ändern ----------

authRouter.post('/passwort', requireLogin, (req, res) => {
  const alt = String(req.body?.alt ?? '');
  const neu = String(req.body?.neu ?? '');

  if (!verifyPassword(alt, req.user.password_hash)) {
    return res.status(401).json({ error: 'Das bisherige Passwort stimmt nicht.' });
  }
  if (neu.length < MIN_PASSWORT) {
    return res.status(400).json({ error: `Das neue Passwort braucht mindestens ${MIN_PASSWORT} Zeichen.` });
  }

  db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).run(hashPassword(neu), req.user.id);
  // Alle anderen Sitzungen beenden, die aktuelle behalten.
  db.prepare(`DELETE FROM sessions WHERE user_id = ? AND id != ?`).run(req.user.id, req.sessionId);
  res.json({ ok: true });
});
