// Termine. Wartende dürfen mitlesen - im Konzept steht, dass der Kalender
// schon vor der Freischaltung sichtbar ist.
import express from 'express';
import { db } from '../db.js';
import { requireLogin, requireActive } from '../auth.js';

export const eventsRouter = express.Router();

const KATEGORIEN = ['fest', 'verein', 'gemeinde', 'kurs'];
const text = (v, max) => String(v ?? '').trim().slice(0, max);
const istDatum = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s);

// Wer einen Termin eingetragen hat, darf ihn auch ändern und löschen.
// Ebenso das Krafttal-Team und - bei Terminen im Namen einer Organisation -
// alle, die für diese Organisation posten dürfen.
export function darfBearbeiten(user, row) {
  if (!user || user.status !== 'active') return false;
  if (user.is_admin) return true;
  if (row.user_id && row.user_id === user.id) return true;
  if (row.org_id) {
    return !!db.prepare(`
      SELECT 1 FROM org_members
      WHERE org_id = ? AND user_id = ? AND status = 'active' AND role IN ('poster','admin')
    `).get(row.org_id, user.id);
  }
  return false;
}

function baueEvent(row, user) {
  const userId = user?.id;
  const kommen = db.prepare(`SELECT COUNT(*) AS c FROM event_going WHERE event_id = ?`).get(row.id).c;
  const ich = userId
    ? !!db.prepare(`SELECT 1 FROM event_going WHERE event_id=? AND user_id=?`).get(row.id, userId)
    : false;
  return {
    id: row.id,
    datum: row.date,
    zeit: row.time_text,
    kategorie: row.cat,
    titel: row.title,
    ort: row.place,
    text: row.text,
    veranstalter: row.org_name || row.by_text,
    orgId: row.org_id,
    wiederholung: row.repeat_txt,
    hervorgehoben: !!row.highlight,
    kommen,
    ichKomme: ich,
    darfBearbeiten: darfBearbeiten(user, row),
  };
}

const BASIS = `
  SELECT e.*, o.name AS org_name
  FROM events e LEFT JOIN orgs o ON o.id = e.org_id
`;

// ---------- Liste ----------

eventsRouter.get('/', requireLogin, (req, res) => {
  const von = istDatum(req.query.von) ? req.query.von : null;
  const bis = istDatum(req.query.bis) ? req.query.bis : null;
  const kategorie = KATEGORIEN.includes(req.query.kategorie) ? req.query.kategorie : null;

  const wo = [];
  const p = {};
  if (von) { wo.push('e.date >= @von'); p.von = von; }
  if (bis) { wo.push('e.date <= @bis'); p.bis = bis; }
  if (kategorie) { wo.push('e.cat = @kat'); p.kat = kategorie; }

  const sql = `${BASIS} ${wo.length ? 'WHERE ' + wo.join(' AND ') : ''} ORDER BY e.date, e.id`;
  const rows = db.prepare(sql).all(p);
  res.json({ events: rows.map((r) => baueEvent(r, req.user)) });
});

eventsRouter.get('/:id', requireLogin, (req, res) => {
  const row = db.prepare(`${BASIS} WHERE e.id = ?`).get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'Termin nicht gefunden.' });
  res.json({ event: baueEvent(row, req.user) });
});

// ---------- Anlegen ----------

eventsRouter.post('/', requireActive, (req, res) => {
  const datum = String(req.body?.datum ?? '');
  const kategorie = KATEGORIEN.includes(req.body?.kategorie) ? req.body.kategorie : null;
  const titel = text(req.body?.titel, 200);

  if (!istDatum(datum)) return res.status(400).json({ error: 'Bitte ein Datum als JJJJ-MM-TT angeben.' });
  if (!kategorie) return res.status(400).json({ error: 'Bitte eine Kategorie wählen.' });
  if (!titel) return res.status(400).json({ error: 'Bitte gib einen Titel an.' });

  const orgId = req.body?.alsOrg ? Number(req.body.alsOrg) : null;
  if (orgId) {
    const darf = db.prepare(`
      SELECT 1 FROM org_members WHERE org_id=? AND user_id=? AND status='active' AND role IN ('poster','admin')
    `).get(orgId, req.user.id);
    if (!darf) return res.status(403).json({ error: 'Du darfst nicht im Namen dieser Organisation posten.' });
  }

  const info = db.prepare(`
    INSERT INTO events (date, time_text, cat, title, place, text, org_id, by_text, repeat_txt, user_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    datum, text(req.body?.zeit, 60), kategorie, titel,
    text(req.body?.ort, 200), text(req.body?.text, 5000),
    orgId, orgId ? '' : req.user.name, text(req.body?.wiederholung, 100), req.user.id,
  );

  const row = db.prepare(`${BASIS} WHERE e.id = ?`).get(info.lastInsertRowid);
  res.status(201).json({ event: baueEvent(row, req.user) });
});

// ---------- Ich komme ----------

eventsRouter.post('/:id/komme', requireActive, (req, res) => {
  const id = Number(req.params.id);
  const da = db.prepare(`SELECT 1 FROM events WHERE id = ?`).get(id);
  if (!da) return res.status(404).json({ error: 'Termin nicht gefunden.' });

  const drin = db.prepare(`SELECT 1 FROM event_going WHERE event_id=? AND user_id=?`).get(id, req.user.id);
  if (drin) db.prepare(`DELETE FROM event_going WHERE event_id=? AND user_id=?`).run(id, req.user.id);
  else db.prepare(`INSERT INTO event_going (event_id, user_id) VALUES (?, ?)`).run(id, req.user.id);

  const row = db.prepare(`${BASIS} WHERE e.id = ?`).get(id);
  res.json({ event: baueEvent(row, req.user) });
});

// ---------- Ändern ----------

eventsRouter.put('/:id', requireActive, (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare(`SELECT * FROM events WHERE id = ?`).get(id);
  if (!row) return res.status(404).json({ error: 'Termin nicht gefunden.' });
  if (!darfBearbeiten(req.user, row)) {
    return res.status(403).json({ error: 'Diesen Termin darfst du nicht ändern.' });
  }

  const datum = String(req.body?.datum ?? '');
  const kategorie = KATEGORIEN.includes(req.body?.kategorie) ? req.body.kategorie : null;
  const titel = text(req.body?.titel, 200);

  if (!istDatum(datum)) return res.status(400).json({ error: 'Bitte ein Datum als JJJJ-MM-TT angeben.' });
  if (!kategorie) return res.status(400).json({ error: 'Bitte eine Kategorie wählen.' });
  if (!titel) return res.status(400).json({ error: 'Bitte gib einen Titel an.' });

  // Veranstalter darf nur auf eine Organisation gesetzt werden, für die man
  // posten darf. Fehlt die Angabe, bleibt der bisherige Veranstalter stehen.
  let orgId = row.org_id;
  if ('alsOrg' in (req.body ?? {})) {
    orgId = req.body.alsOrg ? Number(req.body.alsOrg) : null;
    if (orgId) {
      const darf = db.prepare(`
        SELECT 1 FROM org_members WHERE org_id=? AND user_id=? AND status='active' AND role IN ('poster','admin')
      `).get(orgId, req.user.id);
      if (!darf) return res.status(403).json({ error: 'Du darfst nicht im Namen dieser Organisation posten.' });
    }
  }

  db.prepare(`
    UPDATE events SET date=?, time_text=?, cat=?, title=?, place=?, text=?,
                      org_id=?, by_text=?, repeat_txt=?
    WHERE id = ?
  `).run(
    datum, text(req.body?.zeit, 60), kategorie, titel,
    text(req.body?.ort, 200), text(req.body?.text, 5000),
    orgId, orgId ? '' : (row.by_text || req.user.name),
    text(req.body?.wiederholung, 100), id,
  );

  const neu = db.prepare(`${BASIS} WHERE e.id = ?`).get(id);
  res.json({ event: baueEvent(neu, req.user) });
});

// ---------- Löschen ----------

eventsRouter.delete('/:id', requireActive, (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare(`SELECT * FROM events WHERE id = ?`).get(id);
  if (!row) return res.status(404).json({ error: 'Termin nicht gefunden.' });
  if (!darfBearbeiten(req.user, row)) {
    return res.status(403).json({ error: 'Diesen Termin darfst du nicht löschen.' });
  }

  // Zusagen hängen per Fremdschlüssel dran und verschwinden mit.
  db.prepare(`DELETE FROM events WHERE id = ?`).run(id);
  res.json({ ok: true });
});
