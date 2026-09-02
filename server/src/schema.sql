-- Krafttal-App: Datenbankschema
-- Bildet das Datenmodell des Prototyps ab (krafttal-app/index.html).
-- Alle Zeitstempel als ISO-8601-Text in UTC.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ---------- Konten ----------

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  email         TEXT    NOT NULL UNIQUE,   -- immer kleingeschrieben gespeichert
  password_hash TEXT    NOT NULL,
  name          TEXT    NOT NULL,
  address       TEXT    NOT NULL DEFAULT '',
  phone         TEXT    NOT NULL DEFAULT '',
  -- Auswahl aus dem Anmeldeformular "Ich bin hier"
  role          TEXT    NOT NULL DEFAULT 'einwohner'
                CHECK (role IN ('einwohner','betrieb','verein','zweitwohnsitz')),
  reference     TEXT    NOT NULL DEFAULT '',  -- "Wer aus dem Tal kennt dich?"
  status        TEXT    NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','active','blocked')),
  is_admin      INTEGER NOT NULL DEFAULT 0 CHECK (is_admin IN (0,1)),
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  decided_at    TEXT,                        -- freigeschaltet oder gesperrt am
  decided_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  decide_reason TEXT    NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT    PRIMARY KEY,           -- Zufallstoken aus dem Cookie
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT    NOT NULL,
  last_seen  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- ---------- Vereine und Betriebe ----------

CREATE TABLE IF NOT EXISTS orgs (
  id       INTEGER PRIMARY KEY,
  type     TEXT NOT NULL CHECK (type IN ('verein','betrieb')),
  short    TEXT NOT NULL DEFAULT '',   -- Kürzel fürs Signet, z. B. "BM"
  name     TEXT NOT NULL,
  sub      TEXT NOT NULL DEFAULT '',   -- Zeile unter dem Namen
  intro    TEXT NOT NULL DEFAULT '',   -- Kurzbeschreibung (nur Betriebe)
  text     TEXT NOT NULL DEFAULT '',   -- Vorstellungstext
  contact  TEXT NOT NULL DEFAULT '',
  web      TEXT NOT NULL DEFAULT '',
  tel      TEXT NOT NULL DEFAULT '',
  mail     TEXT NOT NULL DEFAULT '',
  address  TEXT NOT NULL DEFAULT '',
  hours    TEXT NOT NULL DEFAULT '',   -- Öffnungszeiten (nur Betriebe)
  members  INTEGER NOT NULL DEFAULT 0  -- angezeigte Mitgliederzahl
);

-- Mitgliedschaft und Posting-Recht.
-- Verein: Obmann bestätigt. Betrieb: Krafttal-Team bestätigt.
CREATE TABLE IF NOT EXISTS org_members (
  org_id     INTEGER NOT NULL REFERENCES orgs(id)  ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT    NOT NULL DEFAULT 'member' CHECK (role IN ('member','poster','admin')),
  status     TEXT    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active')),
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (org_id, user_id)
);

-- Mitlesen ohne Beitritt
CREATE TABLE IF NOT EXISTS org_follows (
  org_id  INTEGER NOT NULL REFERENCES orgs(id)  ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (org_id, user_id)
);

-- ---------- Anliegen ----------

CREATE TABLE IF NOT EXISTS anliegen (
  id         INTEGER PRIMARY KEY,
  cat        TEXT    NOT NULL CHECK (cat IN ('hilfe','biete','hinweis','fund')),
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id     INTEGER REFERENCES orgs(id) ON DELETE SET NULL,  -- "Veröffentlichen als"
  title      TEXT    NOT NULL,
  text       TEXT    NOT NULL DEFAULT '',
  need       INTEGER NOT NULL DEFAULT 0,   -- benötigte Zusagen, 0 = keine
  link_url   TEXT    NOT NULL DEFAULT '',
  link_title TEXT    NOT NULL DEFAULT '',
  status     TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active','hidden')),
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_anliegen_created ON anliegen(created_at DESC);

CREATE TABLE IF NOT EXISTS anliegen_images (
  id          INTEGER PRIMARY KEY,
  anliegen_id INTEGER NOT NULL REFERENCES anliegen(id) ON DELETE CASCADE,
  file        TEXT    NOT NULL,           -- Dateiname im Upload-Verzeichnis
  caption     TEXT    NOT NULL DEFAULT '',
  sort        INTEGER NOT NULL DEFAULT 0
);

-- "Ich bin dabei"
CREATE TABLE IF NOT EXISTS anliegen_joins (
  anliegen_id INTEGER NOT NULL REFERENCES anliegen(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (anliegen_id, user_id)
);

-- Absage: blendet den Beitrag nur für diese Person aus.
-- Der Ersteller sieht die Absage bewusst nicht.
CREATE TABLE IF NOT EXISTS anliegen_declines (
  anliegen_id INTEGER NOT NULL REFERENCES anliegen(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  PRIMARY KEY (anliegen_id, user_id)
);

CREATE TABLE IF NOT EXISTS comments (
  id          INTEGER PRIMARY KEY,
  anliegen_id INTEGER NOT NULL REFERENCES anliegen(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  org_id      INTEGER REFERENCES orgs(id) ON DELETE SET NULL,
  text        TEXT    NOT NULL,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_comments_anliegen ON comments(anliegen_id);

-- ---------- Termine ----------

CREATE TABLE IF NOT EXISTS events (
  id         INTEGER PRIMARY KEY,
  date       TEXT    NOT NULL,            -- YYYY-MM-DD
  time_text  TEXT    NOT NULL DEFAULT '', -- "ab 18 Uhr", "20:00"
  cat        TEXT    NOT NULL CHECK (cat IN ('fest','verein','gemeinde','kurs')),
  title      TEXT    NOT NULL,
  place      TEXT    NOT NULL DEFAULT '',
  text       TEXT    NOT NULL DEFAULT '',
  org_id     INTEGER REFERENCES orgs(id) ON DELETE SET NULL,
  by_text    TEXT    NOT NULL DEFAULT '', -- Veranstalter ohne eigene Org-Seite
  repeat_txt TEXT    NOT NULL DEFAULT '', -- "jeden Mittwoch"
  highlight  INTEGER NOT NULL DEFAULT 0 CHECK (highlight IN (0,1)),
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_events_date ON events(date);

CREATE TABLE IF NOT EXISTS event_going (
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id  INTEGER NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  PRIMARY KEY (event_id, user_id)
);

-- ---------- Abstimmungen ----------

CREATE TABLE IF NOT EXISTS polls (
  id         INTEGER PRIMARY KEY,
  question   TEXT    NOT NULL,
  by_text    TEXT    NOT NULL DEFAULT '',
  ends_at    TEXT,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS poll_options (
  id      INTEGER PRIMARY KEY,
  poll_id INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  label   TEXT    NOT NULL,
  sort    INTEGER NOT NULL DEFAULT 0
);

-- Anonym: es wird festgehalten DASS jemand abgestimmt hat, nicht wofür.
-- Die Stimme selbst zählt nur an der Option hoch.
CREATE TABLE IF NOT EXISTS poll_voted (
  poll_id INTEGER NOT NULL REFERENCES polls(id)  ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  PRIMARY KEY (poll_id, user_id)
);

CREATE TABLE IF NOT EXISTS poll_counts (
  option_id INTEGER PRIMARY KEY REFERENCES poll_options(id) ON DELETE CASCADE,
  votes     INTEGER NOT NULL DEFAULT 0
);

-- ---------- Ideen ----------

CREATE TABLE IF NOT EXISTS ideas (
  id         INTEGER PRIMARY KEY,
  title      TEXT    NOT NULL,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status     TEXT    NOT NULL DEFAULT 'neu' CHECK (status IN ('neu','pruef','done')),
  answer     TEXT    NOT NULL DEFAULT '',
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS idea_votes (
  idea_id INTEGER NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (idea_id, user_id)
);

-- ---------- Meldungen ans Krafttal-Team ----------

CREATE TABLE IF NOT EXISTS reports (
  id          INTEGER PRIMARY KEY,
  target_type TEXT    NOT NULL CHECK (target_type IN ('anliegen','comment','event')),
  target_id   INTEGER NOT NULL,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason      TEXT    NOT NULL DEFAULT '',
  handled     INTEGER NOT NULL DEFAULT 0 CHECK (handled IN (0,1)),
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ---------- Mitteilungen aufs Handy ----------

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint   TEXT    NOT NULL UNIQUE,
  p256dh     TEXT    NOT NULL,
  auth       TEXT    NOT NULL,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notify_settings (
  user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category TEXT    NOT NULL,
  enabled  INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  PRIMARY KEY (user_id, category)
);
