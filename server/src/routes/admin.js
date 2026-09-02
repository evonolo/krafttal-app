// Admin-Bereich: freischalten, sperren, Administratoren ernennen.
import express from 'express';
import { db } from '../db.js';
import { requireAdmin } from '../auth.js';

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
