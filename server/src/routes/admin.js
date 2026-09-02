// Admin-Bereich: freischalten, sperren, Administratoren ernennen.
import express from 'express';
import { db } from '../db.js';
import crypto from 'node:crypto';
import { requireAdmin, hashPassword } from '../auth.js';

export const adminRouter = express.Router();
adminRouter.use(requireAdmin);

const jetzt = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
const zahlAdmins = () =>
  db.prepare(`SELECT COUNT(*) AS c FROM users WHERE is_admin = 1 AND status = 'active'`).get().c;

// Wie ein Konto im Admin-Bereich aussieht. Mehr Felder als sonst, weil zum
// Freischalten Adresse und Referenzperson gebraucht werden.
const adminUser = (u) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  adresse: u.address,
  telefon: u.phone,
  rolle: u.role,
  referenz: u.reference,
  status: u.status,
  admin: !!u.is_admin,
  angemeldet: u.created_at,
  entschieden: u.decided_at,
  entschiedenVon: u.decided_by,
  grund: u.decide_reason,
});

// ---------- Konten auflisten ----------

adminRouter.get('/users', (req, res) => {
  const status = req.query.status;
  const erlaubt = ['pending', 'active', 'blocked'];

  const rows = erlaubt.includes(status)
    ? db.prepare(`SELECT * FROM users WHERE status = ? ORDER BY created_at DESC`).all(status)
    : db.prepare(`SELECT * FROM users ORDER BY created_at DESC`).all();

  res.json({
    users: rows.map(adminUser),
    zaehler: {
      offen: db.prepare(`SELECT COUNT(*) AS c FROM users WHERE status='pending'`).get().c,
      frei: db.prepare(`SELECT COUNT(*) AS c FROM users WHERE status='active'`).get().c,
      gesperrt: db.prepare(`SELECT COUNT(*) AS c FROM users WHERE status='blocked'`).get().c,
      admins: zahlAdmins(),
    },
  });
});

// Hilfsfunktion: Konto laden oder 404
function ladeKonto(req, res) {
  const u = db.prepare(`SELECT * FROM users WHERE id = ?`).get(Number(req.params.id));
  if (!u) {
    res.status(404).json({ error: 'Konto nicht gefunden.' });
    return null;
  }
  return u;
}

// ---------- Freischalten ----------

adminRouter.post('/users/:id/freischalten', (req, res) => {
  const u = ladeKonto(req, res);
  if (!u) return;
  if (u.status === 'active') return res.json({ ok: true, user: adminUser(u) });

  db.prepare(`
    UPDATE users SET status='active', decided_at=?, decided_by=?, decide_reason=''
    WHERE id = ?
  `).run(jetzt(), req.user.id, u.id);

  res.json({ ok: true, user: adminUser(db.prepare(`SELECT * FROM users WHERE id=?`).get(u.id)) });
});

// ---------- Sperren ----------

adminRouter.post('/users/:id/sperren', (req, res) => {
  const u = ladeKonto(req, res);
  if (!u) return;
  const grund = String(req.body?.grund ?? '').trim().slice(0, 500);

  // Sich selbst zu sperren wäre ein Weg, sich auszusperren.
  if (u.id === req.user.id) {
    return res.status(400).json({ error: 'Du kannst dich nicht selbst sperren.' });
  }
  // Den letzten Administrator zu sperren ebenfalls.
  if (u.is_admin && zahlAdmins() <= 1) {
    return res.status(400).json({
      error: 'Das ist der letzte Administrator. Ernenne zuerst jemand anderen.',
    });
  }

  db.prepare(`
    UPDATE users SET status='blocked', decided_at=?, decided_by=?, decide_reason=?
    WHERE id = ?
  `).run(jetzt(), req.user.id, grund, u.id);

  // Laufende Anmeldungen sofort beenden.
  db.prepare(`DELETE FROM sessions WHERE user_id = ?`).run(u.id);

  res.json({ ok: true, user: adminUser(db.prepare(`SELECT * FROM users WHERE id=?`).get(u.id)) });
});

// ---------- Sperre aufheben ----------

adminRouter.post('/users/:id/entsperren', (req, res) => {
  const u = ladeKonto(req, res);
  if (!u) return;

  db.prepare(`
    UPDATE users SET status='active', decided_at=?, decided_by=?, decide_reason=''
    WHERE id = ?
  `).run(jetzt(), req.user.id, u.id);

  res.json({ ok: true, user: adminUser(db.prepare(`SELECT * FROM users WHERE id=?`).get(u.id)) });
});

// ---------- Administrator ernennen und absetzen ----------
//
// Keine Obergrenze: Es dürfen beliebig viele Administratoren sein.

adminRouter.post('/users/:id/admin', (req, res) => {
  const u = ladeKonto(req, res);
  if (!u) return;
  const soll = req.body?.admin === true;

  if (soll && u.status !== 'active') {
    return res.status(400).json({
      error: 'Nur freigeschaltete Konten können Administrator werden.',
    });
  }
  // Der letzte Administrator darf sich nicht selbst absetzen, sonst kommt
  // niemand mehr in den Admin-Bereich.
  if (!soll && u.is_admin && zahlAdmins() <= 1) {
    return res.status(400).json({
      error: 'Das ist der letzte Administrator. Ernenne zuerst jemand anderen.',
    });
  }

  db.prepare(`UPDATE users SET is_admin = ? WHERE id = ?`).run(soll ? 1 : 0, u.id);
  res.json({ ok: true, user: adminUser(db.prepare(`SELECT * FROM users WHERE id=?`).get(u.id)) });
});

// ---------- Meldungen ----------
//
// "Beitrag melden" schreibt hierher. Ohne diese Ansicht liefe jede Meldung
// ins Leere.

adminRouter.get('/meldungen', (req, res) => {
  const offen = req.query.erledigt !== '1';

  const rows = db.prepare(`
    SELECT r.*, u.name AS melder
    FROM reports r JOIN users u ON u.id = r.user_id
    WHERE r.handled = ?
    ORDER BY r.created_at DESC
  `).all(offen ? 0 : 1);

  // Zu jeder Meldung den gemeldeten Beitrag dazuholen, damit man ihn
  // beurteilen kann, ohne ihn zu suchen.
  const meldungen = rows.map((r) => {
    let beitrag = null;
    if (r.target_type === 'anliegen') {
      const a = db.prepare(`
        SELECT a.id, a.title, a.text, a.status, u.name AS user_name, o.name AS org_name
        FROM anliegen a JOIN users u ON u.id = a.user_id
        LEFT JOIN orgs o ON o.id = a.org_id WHERE a.id = ?
      `).get(r.target_id);
      if (a) beitrag = {
        id: a.id, titel: a.title, text: a.text,
        autor: a.org_name || a.user_name, ausgeblendet: a.status === 'hidden',
      };
    }
    return {
      id: r.id,
      art: r.target_type,
      zielId: r.target_id,
      melder: r.melder,
      grund: r.reason,
      wann: r.created_at,
      erledigt: !!r.handled,
      beitrag,           // null, wenn der Beitrag inzwischen weg ist
    };
  });

  res.json({
    meldungen,
    zaehler: {
      offen: db.prepare(`SELECT COUNT(*) AS c FROM reports WHERE handled = 0`).get().c,
      erledigt: db.prepare(`SELECT COUNT(*) AS c FROM reports WHERE handled = 1`).get().c,
    },
  });
});

adminRouter.post('/meldungen/:id/erledigt', (req, res) => {
  const r = db.prepare(`SELECT * FROM reports WHERE id = ?`).get(Number(req.params.id));
  if (!r) return res.status(404).json({ error: 'Meldung nicht gefunden.' });
  db.prepare(`UPDATE reports SET handled = 1 WHERE id = ?`).run(r.id);
  res.json({ ok: true });
});

// Gemeldeten Beitrag ausblenden und die Meldung gleich abhaken.
adminRouter.post('/meldungen/:id/ausblenden', (req, res) => {
  const r = db.prepare(`SELECT * FROM reports WHERE id = ?`).get(Number(req.params.id));
  if (!r) return res.status(404).json({ error: 'Meldung nicht gefunden.' });
  if (r.target_type !== 'anliegen') {
    return res.status(400).json({ error: 'Das lässt sich hier nicht ausblenden.' });
  }
  db.prepare(`UPDATE anliegen SET status = 'hidden' WHERE id = ?`).run(r.target_id);
  db.prepare(`UPDATE reports SET handled = 1 WHERE id = ?`).run(r.id);
  res.json({ ok: true });
});

// ---------- Passwort zurücksetzen ----------
//
// Ohne Mailversand kann sich niemand selbst aussperren-frei helfen. Deshalb
// erzeugt das Team ein neues Passwort und gibt es der Person weiter, etwa
// am Telefon. Es wird genau einmal angezeigt und ist danach nicht mehr
// auslesbar - gespeichert wird nur die Prüfsumme.

// Zeichen ohne Verwechslungsgefahr: kein l/1/I, kein O/0.
const ZEICHEN = 'abcdefghijkmnpqrstuvwxyz23456789';

function neuesPasswort() {
  const bytes = crypto.randomBytes(12);
  let s = '';
  for (let i = 0; i < 12; i++) {
    s += ZEICHEN[bytes[i] % ZEICHEN.length];
    if (i === 3 || i === 7) s += '-';
  }
  return s;
}

adminRouter.post('/users/:id/passwort', (req, res) => {
  const u = ladeKonto(req, res);
  if (!u) return;

  // Das eigene Passwort hier zurückzusetzen würde die eigene Sitzung beenden -
  // man stünde mit einem Zufallspasswort da, ohne es zu merken. Dafür gibt es
  // "Passwort ändern" im Profil.
  if (u.id === req.user.id) {
    return res.status(400).json({
      error: 'Das eigene Passwort änderst du im Profil unter „Passwort ändern".',
    });
  }

  const passwort = neuesPasswort();
  db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).run(hashPassword(passwort), u.id);
  // Alle laufenden Anmeldungen beenden.
  db.prepare(`DELETE FROM sessions WHERE user_id = ?`).run(u.id);

  res.json({
    ok: true,
    passwort,
    hinweis: 'Gib das Passwort persönlich oder telefonisch weiter. Es wird nur jetzt angezeigt.',
  });
});
