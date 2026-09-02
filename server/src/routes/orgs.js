// Vereine und Betriebe.
//
// Beitreten läuft unterschiedlich, so wie im Konzept beschrieben:
// Bei einem Verein bestätigt der Obmann oder die Obfrau, bei einem Betrieb
// das Krafttal-Team nach Rücksprache. Mitlesen geht ohne Beitritt über
// "Folgen".
import express from 'express';
import { db } from '../db.js';
import { requireLogin, requireActive } from '../auth.js';

export const orgsRouter = express.Router();

const text = (v, max) => String(v ?? '').trim().slice(0, max);

// Wer darf über die Mitgliedschaften dieser Organisation entscheiden?
function darfVerwalten(user, org) {
  if (user.is_admin) return true;                 // Krafttal-Team immer
  if (org.type === 'betrieb') return false;       // Betriebe nur das Team
  const m = db.prepare(`
    SELECT 1 FROM org_members WHERE org_id=? AND user_id=? AND status='active' AND role='admin'
  `).get(org.id, user.id);
  return !!m;
}

function baueOrg(row, userId, ausfuehrlich = false) {
  const mitglied = db.prepare(`
    SELECT role, status FROM org_members WHERE org_id=? AND user_id=?
  `).get(row.id, userId);

  const folgt = !!db.prepare(`SELECT 1 FROM org_follows WHERE org_id=? AND user_id=?`)
    .get(row.id, userId);

  const basis = {
    id: row.id,
    art: row.type,
    kuerzel: row.short,
    name: row.name,
    zeile: row.sub,
    mitgliederZahl: row.members,
    meineRolle: mitglied?.status === 'active' ? mitglied.role : null,
    meinAntrag: mitglied?.status === 'pending' ? true : false,
    folgeIch: folgt,
  };
  if (!ausfuehrlich) return basis;

  const posters = db.prepare(`
    SELECT u.id, u.name, m.role FROM org_members m
    JOIN users u ON u.id = m.user_id
    WHERE m.org_id = ? AND m.status='active' AND m.role IN ('poster','admin')
    ORDER BY m.role DESC, u.name
  `).all(row.id);

  return {
    ...basis,
    kurz: row.intro,
    text: row.text,
    kontakt: row.contact,
    web: row.web,
    telefon: row.tel,
    mail: row.mail,
    adresse: row.address,
    zeiten: row.hours,
    dktPosten: posters.map((p) => ({ id: p.id, name: p.name, rolle: p.role })),
  };
}

// ---------- Liste ----------

orgsRouter.get('/', requireLogin, (req, res) => {
  const art = ['verein', 'betrieb'].includes(req.query.art) ? req.query.art : null;
  const rows = art
    ? db.prepare(`SELECT * FROM orgs WHERE type = ? ORDER BY name`).all(art)
    : db.prepare(`SELECT * FROM orgs ORDER BY type, name`).all();
  res.json({ orgs: rows.map((r) => baueOrg(r, req.user.id)) });
});

orgsRouter.get('/:id', requireLogin, (req, res) => {
  const row = db.prepare(`SELECT * FROM orgs WHERE id = ?`).get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'Nicht gefunden.' });
  res.json({ org: baueOrg(row, req.user.id, true) });
});

// ---------- Folgen ----------

orgsRouter.post('/:id/folgen', requireActive, (req, res) => {
  const id = Number(req.params.id);
  const da = db.prepare(`SELECT 1 FROM orgs WHERE id = ?`).get(id);
  if (!da) return res.status(404).json({ error: 'Nicht gefunden.' });

  const folgt = db.prepare(`SELECT 1 FROM org_follows WHERE org_id=? AND user_id=?`).get(id, req.user.id);
  if (folgt) db.prepare(`DELETE FROM org_follows WHERE org_id=? AND user_id=?`).run(id, req.user.id);
  else db.prepare(`INSERT INTO org_follows (org_id, user_id) VALUES (?, ?)`).run(id, req.user.id);

  res.json({ folgeIch: !folgt });
});

// ---------- Beitreten beantragen ----------

orgsRouter.post('/:id/beitreten', requireActive, (req, res) => {
  const id = Number(req.params.id);
  const org = db.prepare(`SELECT * FROM orgs WHERE id = ?`).get(id);
  if (!org) return res.status(404).json({ error: 'Nicht gefunden.' });

  const schon = db.prepare(`SELECT * FROM org_members WHERE org_id=? AND user_id=?`).get(id, req.user.id);
  if (schon) {
    return res.status(409).json({
      error: schon.status === 'active' ? 'Du bist schon dabei.' : 'Deine Anfrage läuft schon.',
    });
  }

  db.prepare(`INSERT INTO org_members (org_id, user_id, role, status) VALUES (?, ?, 'member', 'pending')`)
    .run(id, req.user.id);

  res.status(201).json({
    ok: true,
    hinweis: org.type === 'verein'
      ? 'Die Anfrage geht an die Vereinsleitung.'
      : 'Die Anfrage geht ans Krafttal-Team, das beim Betrieb nachfragt.',
  });
});

// Austreten oder Anfrage zurückziehen
orgsRouter.delete('/:id/beitreten', requireActive, (req, res) => {
  db.prepare(`DELETE FROM org_members WHERE org_id=? AND user_id=?`).run(Number(req.params.id), req.user.id);
  res.json({ ok: true });
});

// ---------- Mitglieder verwalten ----------

orgsRouter.get('/:id/mitglieder', requireActive, (req, res) => {
  const org = db.prepare(`SELECT * FROM orgs WHERE id = ?`).get(Number(req.params.id));
  if (!org) return res.status(404).json({ error: 'Nicht gefunden.' });
  if (!darfVerwalten(req.user, org)) return res.status(403).json({ error: 'Nur für die Vereinsleitung.' });

  const rows = db.prepare(`
    SELECT u.id, u.name, u.email, m.role, m.status, m.created_at
    FROM org_members m JOIN users u ON u.id = m.user_id
    WHERE m.org_id = ? ORDER BY m.status, u.name
  `).all(org.id);

  res.json({
    mitglieder: rows.map((r) => ({
      id: r.id, name: r.name, email: r.email,
      rolle: r.role, status: r.status, seit: r.created_at,
    })),
  });
});

orgsRouter.post('/:id/mitglieder/:userId', requireActive, (req, res) => {
  const org = db.prepare(`SELECT * FROM orgs WHERE id = ?`).get(Number(req.params.id));
  if (!org) return res.status(404).json({ error: 'Nicht gefunden.' });
  if (!darfVerwalten(req.user, org)) return res.status(403).json({ error: 'Nur für die Vereinsleitung.' });

  const userId = Number(req.params.userId);
  const rolle = ['member', 'poster', 'admin'].includes(req.body?.rolle) ? req.body.rolle : 'member';
  const m = db.prepare(`SELECT * FROM org_members WHERE org_id=? AND user_id=?`).get(org.id, userId);
  if (!m) return res.status(404).json({ error: 'Keine Anfrage von dieser Person.' });

  db.prepare(`UPDATE org_members SET status='active', role=? WHERE org_id=? AND user_id=?`)
    .run(rolle, org.id, userId);
  res.json({ ok: true });
});

orgsRouter.delete('/:id/mitglieder/:userId', requireActive, (req, res) => {
  const org = db.prepare(`SELECT * FROM orgs WHERE id = ?`).get(Number(req.params.id));
  if (!org) return res.status(404).json({ error: 'Nicht gefunden.' });
  if (!darfVerwalten(req.user, org)) return res.status(403).json({ error: 'Nur für die Vereinsleitung.' });

  db.prepare(`DELETE FROM org_members WHERE org_id=? AND user_id=?`)
    .run(org.id, Number(req.params.userId));
  res.json({ ok: true });
});

// ---------- Wo darf ich im Namen posten? ----------

orgsRouter.get('/meine/posten', requireActive, (req, res) => {
  const rows = db.prepare(`
    SELECT o.id, o.name, o.type FROM org_members m JOIN orgs o ON o.id = m.org_id
    WHERE m.user_id = ? AND m.status='active' AND m.role IN ('poster','admin')
    ORDER BY o.name
  `).all(req.user.id);
  res.json({ orgs: rows.map((r) => ({ id: r.id, name: r.name, art: r.type })) });
});
