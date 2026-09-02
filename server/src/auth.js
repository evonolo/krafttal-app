// Passwörter und Anmeldesitzungen.
import crypto from 'node:crypto';
import { db } from './db.js';
import { config } from './config.js';

export const COOKIE = 'krafttal_sitzung';

// ---------- Passwörter ----------
//
// scrypt ist in Node eingebaut, es braucht also kein Zusatzpaket. Es ist
// absichtlich langsam und speicherhungrig, damit das Durchprobieren von
// Passwörtern teuer wird. Jedes Passwort bekommt ein eigenes Salz, damit
// zwei gleiche Passwörter verschiedene Prüfsummen ergeben.

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, SCRYPT.keylen, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  try {
    const [scheme, N, r, p, saltHex, hashHex] = stored.split('$');
    if (scheme !== 'scrypt') return false;
    const salt = Buffer.from(saltHex, 'hex');
    const expected = Buffer.from(hashHex, 'hex');
    const actual = crypto.scryptSync(password, salt, expected.length, {
      N: Number(N), r: Number(r), p: Number(p),
    });
    // Zeitkonstanter Vergleich: Die Dauer verrät nicht, ab welchem Zeichen
    // es abweicht.
    return crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

// ---------- Sitzungen ----------

export function createSession(userId) {
  const id = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + config.sessionDays * 864e5);
  db.prepare(
    `INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)`
  ).run(id, userId, expires.toISOString().replace('T', ' ').slice(0, 19));
  return { id, expires };
}

export function destroySession(id) {
  db.prepare(`DELETE FROM sessions WHERE id = ?`).run(id);
}

export function setSessionCookie(res, session) {
  res.cookie(COOKIE, session.id, {
    httpOnly: true,                 // für JavaScript im Browser unlesbar
    sameSite: 'lax',                // schützt vor fremden Seiten, die mitschicken
    secure: config.secureCookies,   // nur über HTTPS, sobald verfügbar
    expires: session.expires,
    path: '/',
  });
}

export function clearSessionCookie(res) {
  res.clearCookie(COOKIE, { path: '/' });
}

// Abgelaufene Sitzungen regelmäßig wegräumen.
export function purgeExpiredSessions() {
  return db.prepare(`DELETE FROM sessions WHERE expires_at < datetime('now')`).run().changes;
}

// ---------- Middleware ----------

// Hängt req.user an, wenn eine gültige Sitzung vorliegt. Blockiert nichts.
export function loadUser(req, res, next) {
  req.user = null;
  const id = req.cookies?.[COOKIE];
  if (id) {
    const row = db.prepare(`
      SELECT u.* FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.id = ? AND s.expires_at > datetime('now')
    `).get(id);
    if (row) {
      req.user = row;
      req.sessionId = id;
      db.prepare(`UPDATE sessions SET last_seen = datetime('now') WHERE id = ?`).run(id);
    }
  }
  next();
}

export function requireLogin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Nicht angemeldet' });
  if (req.user.status === 'blocked') {
    return res.status(403).json({ error: 'Dieses Konto ist gesperrt.' });
  }
  next();
}

// Für alles, was Freischaltung voraussetzt: schreiben, zusagen, abstimmen.
export function requireActive(req, res, next) {
  requireLogin(req, res, () => {
    if (req.user.status !== 'active') {
      return res.status(403).json({
        error: 'Dein Konto ist noch nicht freigeschaltet.',
        status: req.user.status,
      });
    }
    next();
  });
}

export function requireAdmin(req, res, next) {
  requireActive(req, res, () => {
    if (!req.user.is_admin) {
      return res.status(403).json({ error: 'Nur für Administratoren.' });
    }
    next();
  });
}

// So sieht ein Konto von außen aus. Passwort-Prüfsumme bleibt drin.
export function publicUser(u) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    rolle: u.role,
    status: u.status,
    admin: !!u.is_admin,
    initialen: u.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase(),
  };
}
