// Anliegen: Hilfe gesucht, Biete, Hinweis, Verloren/Gefunden.
import express from 'express';
import { db } from '../db.js';
import { requireActive } from '../auth.js';

export const anliegenRouter = express.Router();

const KATEGORIEN = ['hilfe', 'biete', 'hinweis', 'fund'];
const text = (v, max) => String(v ?? '').trim().slice(0, max);

// Darf diese Person im Namen dieser Organisation posten?
function darfAlsOrgPosten(userId, orgId) {
  if (!orgId) return true;
  const m = db.prepare(`
    SELECT 1 FROM org_members
    WHERE org_id = ? AND user_id = ? AND status = 'active' AND role IN ('poster','admin')
  `).get(orgId, userId);
  return !!m;
}

// Ändern und löschen darf ausschließlich, wer das Anliegen eingestellt hat,
// sowie das Krafttal-Team. Posting-Recht einer Organisation reicht nicht:
// Wer im Namen der Musikkapelle posten darf, soll die Beiträge der anderen
// Musikanten nicht ändern können.
function darfBearbeiten(user, row) {
  if (!user || user.status !== 'active') return false;
  if (user.is_admin) return true;
  return row.user_id === user.id;
}

// Ein Anliegen so, wie es die Oberfläche braucht.
function baueAnliegen(row, user) {
  const userId = user?.id;
  const zusagen = db.prepare(`
    SELECT u.id, u.name FROM anliegen_joins j
    JOIN users u ON u.id = j.user_id
    WHERE j.anliegen_id = ? ORDER BY j.created_at
  `).all(row.id);

  const bilder = db.prepare(`
    SELECT id, file, caption FROM anliegen_images WHERE anliegen_id = ? ORDER BY sort
  `).all(row.id);

  const kommentare = db.prepare(`SELECT COUNT(*) AS c FROM comments WHERE anliegen_id = ?`)
    .get(row.id).c;

  return {
    id: row.id,
    kategorie: row.cat,
    titel: row.title,
    text: row.text,
    bedarf: row.need,
    erstellt: row.created_at,
    autor: {
      name: row.org_name || row.user_name,
      istOrg: !!row.org_id,
      orgId: row.org_id,
      userId: row.user_id,
    },
    eigenes: row.user_id === userId,
    link: row.link_url ? { url: row.link_url, titel: row.link_title } : null,
    bilder: bilder.map((b) => ({ id: b.id, datei: b.file, text: b.caption })),
    zusagen: zusagen.map((z) => z.name),
    zusagenAnzahl: zusagen.length,
    ichDabei: zusagen.some((z) => z.id === userId),
    kommentarAnzahl: kommentare,
    abgelehnt: !!row.abgelehnt,
    darfBearbeiten: darfBearbeiten(user, row),
  };
}

// Grundabfrage: Anliegen samt Autorname und ob ich es abgelehnt habe.
const BASIS = `
  SELECT a.*, u.name AS user_name, o.name AS org_name,
         (SELECT 1 FROM anliegen_declines d
           WHERE d.anliegen_id = a.id AND d.user_id = @me) AS abgelehnt
  FROM anliegen a
  JOIN users u ON u.id = a.user_id
  LEFT JOIN orgs o ON o.id = a.org_id
  WHERE a.status = 'active'
`;

// ---------- Liste ----------

anliegenRouter.get('/', requireActive, (req, res) => {
  const filter = req.query.filter || 'alle';
  const me = req.user.id;

  let rows = db.prepare(`${BASIS} ORDER BY a.created_at DESC`).all({ me });

  // "Abgelehnt" ist ein eigener Filter: Dort liegen genau die Beiträge,
  // die man weggelegt hat. Überall sonst sind sie ausgeblendet.
  rows = filter === 'abgelehnt'
    ? rows.filter((r) => r.abgelehnt)
    : rows.filter((r) => !r.abgelehnt);

  if (KATEGORIEN.includes(filter)) rows = rows.filter((r) => r.cat === filter);

  res.json({ anliegen: rows.map((r) => baueAnliegen(r, req.user)) });
});

// ---------- Einzelnes Anliegen samt Kommentaren ----------

anliegenRouter.get('/:id', requireActive, (req, res) => {
  const me = req.user.id;
  const row = db.prepare(`${BASIS} AND a.id = @id`).get({ me, id: Number(req.params.id) });
  if (!row) return res.status(404).json({ error: 'Anliegen nicht gefunden.' });

  const kommentare = db.prepare(`
    SELECT k.id, k.text, k.created_at, u.name AS user_name, o.name AS org_name
    FROM comments k
    JOIN users u ON u.id = k.user_id
    LEFT JOIN orgs o ON o.id = k.org_id
    WHERE k.anliegen_id = ? ORDER BY k.created_at
  `).all(row.id);

  res.json({
    anliegen: {
      ...baueAnliegen(row, req.user),
      kommentare: kommentare.map((k) => ({
        id: k.id,
        wer: k.org_name || k.user_name,
        text: k.text,
        wann: k.created_at,
      })),
    },
  });
});

// ---------- Anlegen ----------

anliegenRouter.post('/', requireActive, (req, res) => {
  const kategorie = KATEGORIEN.includes(req.body?.kategorie) ? req.body.kategorie : null;
  const titel = text(req.body?.titel, 200);
  const inhalt = text(req.body?.text, 5000);
  const bedarf = Math.max(0, Math.min(999, Number(req.body?.bedarf) || 0));
  const linkUrl = text(req.body?.linkUrl, 500);
  const linkTitel = text(req.body?.linkTitel, 200);
  const orgId = req.body?.alsOrg ? Number(req.body.alsOrg) : null;

  if (!kategorie) return res.status(400).json({ error: 'Bitte eine Kategorie wählen.' });
  if (!titel) return res.status(400).json({ error: 'Bitte gib einen Titel an.' });
  if (orgId && !darfAlsOrgPosten(req.user.id, orgId)) {
    return res.status(403).json({ error: 'Du darfst nicht im Namen dieser Organisation posten.' });
  }

  const info = db.prepare(`
    INSERT INTO anliegen (cat, user_id, org_id, title, text, need, link_url, link_title)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(kategorie, req.user.id, orgId, titel, inhalt, bedarf, linkUrl, linkTitel);

  const row = db.prepare(`${BASIS} AND a.id = @id`)
    .get({ me: req.user.id, id: info.lastInsertRowid });
  res.status(201).json({ anliegen: baueAnliegen(row, req.user) });
});

// ---------- Zusagen ----------

anliegenRouter.post('/:id/zusage', requireActive, (req, res) => {
  const id = Number(req.params.id);
  const da = db.prepare(`SELECT 1 FROM anliegen WHERE id = ? AND status='active'`).get(id);
  if (!da) return res.status(404).json({ error: 'Anliegen nicht gefunden.' });

  const dabei = db.prepare(`SELECT 1 FROM anliegen_joins WHERE anliegen_id=? AND user_id=?`)
    .get(id, req.user.id);

  if (dabei) db.prepare(`DELETE FROM anliegen_joins WHERE anliegen_id=? AND user_id=?`).run(id, req.user.id);
  else db.prepare(`INSERT INTO anliegen_joins (anliegen_id, user_id) VALUES (?, ?)`).run(id, req.user.id);

  const row = db.prepare(`${BASIS} AND a.id = @id`).get({ me: req.user.id, id });
  res.json({ anliegen: baueAnliegen(row, req.user) });
});

// ---------- Absagen und zurückholen ----------
//
// Eine Absage blendet den Beitrag nur für die absagende Person aus.
// Der Ersteller erfährt davon bewusst nichts.

anliegenRouter.post('/:id/absage', requireActive, (req, res) => {
  const id = Number(req.params.id);
  db.prepare(`INSERT OR IGNORE INTO anliegen_declines (anliegen_id, user_id) VALUES (?, ?)`)
    .run(id, req.user.id);
  db.prepare(`DELETE FROM anliegen_joins WHERE anliegen_id=? AND user_id=?`).run(id, req.user.id);
  res.json({ ok: true });
});

anliegenRouter.delete('/:id/absage', requireActive, (req, res) => {
  db.prepare(`DELETE FROM anliegen_declines WHERE anliegen_id=? AND user_id=?`)
    .run(Number(req.params.id), req.user.id);
  res.json({ ok: true });
});

// ---------- Kommentare ----------

anliegenRouter.post('/:id/kommentar', requireActive, (req, res) => {
  const id = Number(req.params.id);
  const inhalt = text(req.body?.text, 2000);
  const orgId = req.body?.alsOrg ? Number(req.body.alsOrg) : null;

  if (!inhalt) return res.status(400).json({ error: 'Der Kommentar ist leer.' });
  const da = db.prepare(`SELECT 1 FROM anliegen WHERE id=? AND status='active'`).get(id);
  if (!da) return res.status(404).json({ error: 'Anliegen nicht gefunden.' });
  if (orgId && !darfAlsOrgPosten(req.user.id, orgId)) {
    return res.status(403).json({ error: 'Du darfst nicht im Namen dieser Organisation schreiben.' });
  }

  const info = db.prepare(`
    INSERT INTO comments (anliegen_id, user_id, org_id, text) VALUES (?, ?, ?, ?)
  `).run(id, req.user.id, orgId, inhalt);

  const k = db.prepare(`
    SELECT k.id, k.text, k.created_at, u.name AS user_name, o.name AS org_name
    FROM comments k JOIN users u ON u.id=k.user_id LEFT JOIN orgs o ON o.id=k.org_id
    WHERE k.id = ?
  `).get(info.lastInsertRowid);

  res.status(201).json({
    kommentar: { id: k.id, wer: k.org_name || k.user_name, text: k.text, wann: k.created_at },
  });
});

// ---------- Melden ----------

anliegenRouter.post('/:id/melden', requireActive, (req, res) => {
  const id = Number(req.params.id);
  const grund = text(req.body?.grund, 500);
  const da = db.prepare(`SELECT 1 FROM anliegen WHERE id = ?`).get(id);
  if (!da) return res.status(404).json({ error: 'Anliegen nicht gefunden.' });

  db.prepare(`
    INSERT INTO reports (target_type, target_id, user_id, reason) VALUES ('anliegen', ?, ?, ?)
  `).run(id, req.user.id, grund);

  res.json({ ok: true });
});

// ---------- Ändern ----------

anliegenRouter.put('/:id', requireActive, (req, res) => {
  const id = Number(req.params.id);
  const a = db.prepare(`SELECT * FROM anliegen WHERE id = ? AND status='active'`).get(id);
  if (!a) return res.status(404).json({ error: 'Anliegen nicht gefunden.' });
  if (!darfBearbeiten(req.user, a)) {
    return res.status(403).json({ error: 'Dieses Anliegen darfst du nicht ändern.' });
  }

  const kategorie = KATEGORIEN.includes(req.body?.kategorie) ? req.body.kategorie : null;
  const titel = text(req.body?.titel, 200);
  if (!kategorie) return res.status(400).json({ error: 'Bitte eine Kategorie wählen.' });
  if (!titel) return res.status(400).json({ error: 'Bitte gib einen Titel an.' });

  // Veröffentlichen-als nur ändern, wenn es mitgeschickt wurde.
  let orgId = a.org_id;
  if ('alsOrg' in (req.body ?? {})) {
    orgId = req.body.alsOrg ? Number(req.body.alsOrg) : null;
    if (orgId && !darfAlsOrgPosten(req.user.id, orgId)) {
      return res.status(403).json({ error: 'Du darfst nicht im Namen dieser Organisation posten.' });
    }
  }

  db.prepare(`
    UPDATE anliegen SET cat=?, title=?, text=?, need=?, link_url=?, link_title=?, org_id=?
    WHERE id = ?
  `).run(
    kategorie, titel, text(req.body?.text, 5000),
    Math.max(0, Math.min(999, Number(req.body?.bedarf) || 0)),
    text(req.body?.linkUrl, 500), text(req.body?.linkTitel, 200), orgId, id,
  );

  const row = db.prepare(`${BASIS} AND a.id = @id`).get({ me: req.user.id, id });
  res.json({ anliegen: baueAnliegen(row, req.user) });
});

// ---------- Eigenes Anliegen zurückziehen ----------

anliegenRouter.delete('/:id', requireActive, (req, res) => {
  const id = Number(req.params.id);
  const a = db.prepare(`SELECT * FROM anliegen WHERE id = ?`).get(id);
  if (!a) return res.status(404).json({ error: 'Anliegen nicht gefunden.' });
  if (!darfBearbeiten(req.user, a)) {
    return res.status(403).json({ error: 'Das ist nicht dein Beitrag.' });
  }
  db.prepare(`UPDATE anliegen SET status='hidden' WHERE id = ?`).run(id);
  res.json({ ok: true });
});
