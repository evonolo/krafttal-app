// Prüft Registrierung, Anmeldung, Freischaltung, Sperre und Admin-Rechte
// gegen einen laufenden Server. Aufruf: node tests/konten.js [adresse]

const BASIS = process.argv[2] || 'http://localhost:3000';
let gruen = 0, rot = 0;

const pruefe = (name, bedingung, detail = '') => {
  if (bedingung) { gruen++; console.log(`  ok   ${name}`); }
  else { rot++; console.log(`  FEHL ${name}${detail ? ' -> ' + detail : ''}`); }
};

// Winziger Client, der Cookies wie ein Browser behält.
function client() {
  let cookie = '';
  return async (methode, pfad, daten) => {
    const r = await fetch(BASIS + pfad, {
      method: methode,
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: daten === undefined ? undefined : JSON.stringify(daten),
    });
    const gesetzt = r.headers.getSetCookie?.() ?? [];
    for (const c of gesetzt) {
      const teil = c.split(';')[0];
      if (teil.startsWith('krafttal_sitzung=')) cookie = teil;
    }
    let body = null;
    try { body = await r.json(); } catch { /* leer */ }
    return { status: r.status, body };
  };
}

const zufall = () => Math.random().toString(36).slice(2, 8);

async function main() {
  console.log(`Teste ${BASIS}\n`);

  const gesund = await fetch(BASIS + '/api/health').then((r) => r.ok).catch(() => false);
  if (!gesund) { console.log('Server nicht erreichbar.'); process.exit(1); }

  // --- Erste Person wird Admin ---
  console.log('Registrierung');
  const admin = client();
  const a = await admin('POST', '/api/register', {
    email: `admin-${zufall()}@test.local`, passwort: 'geheim12345',
    name: 'Andreas Prosch', adresse: 'Kelchsau 1', telefon: '+43 664 1', rolle: 'einwohner',
  });
  const istErster = a.body?.ersterAdmin === true;
  pruefe('Registrierung angenommen', a.status === 201, `Status ${a.status}`);
  if (istErster) {
    pruefe('erste Person ist Admin', a.body.user.admin === true);
    pruefe('erste Person ist freigeschaltet', a.body.user.status === 'active');
  } else {
    console.log('  (Datenbank nicht leer - Admin-Automatik wird nicht geprüft)');
  }

  // --- Prüfungen bei der Registrierung ---
  const k = client();
  pruefe('kurzes Passwort abgelehnt',
    (await k('POST', '/api/register', { email: `x-${zufall()}@test.local`, passwort: 'kurz', name: 'X' })).status === 400);
  pruefe('krumme E-Mail abgelehnt',
    (await k('POST', '/api/register', { email: 'keine-email', passwort: 'geheim12345', name: 'X' })).status === 400);
  pruefe('fehlender Name abgelehnt',
    (await k('POST', '/api/register', { email: `y-${zufall()}@test.local`, passwort: 'geheim12345', name: '' })).status === 400);

  // --- Zweite Person landet in der Warteschleife ---
  console.log('\nWarteschleife');
  const mail2 = `maria-${zufall()}@test.local`;
  const maria = client();
  const m = await maria('POST', '/api/register', {
    email: mail2, passwort: 'geheim12345', name: 'Maria Hauser',
    adresse: 'Kelchsau 42', rolle: 'einwohner',
  });
  pruefe('zweite Person wartet auf Freischaltung', m.body?.user?.status === 'pending');
  pruefe('zweite Person ist kein Admin', m.body?.user?.admin === false);
  pruefe('doppelte E-Mail abgelehnt',
    (await client()('POST', '/api/register', { email: mail2, passwort: 'geheim12345', name: 'Doppelt' })).status === 409);

  // --- Wartende darf nichts Geschütztes ---
  pruefe('Wartende kommt nicht in den Admin-Bereich',
    (await maria('GET', '/api/admin/users')).status === 403);

  // --- Anmeldung ---
  console.log('\nAnmeldung');
  const m2 = client();
  pruefe('falsches Passwort abgelehnt',
    (await m2('POST', '/api/login', { email: mail2, passwort: 'falschfalsch' })).status === 401);
  pruefe('unbekanntes Konto abgelehnt',
    (await m2('POST', '/api/login', { email: `nix-${zufall()}@test.local`, passwort: 'geheim12345' })).status === 401);
  const login = await m2('POST', '/api/login', { email: mail2, passwort: 'geheim12345' });
  pruefe('richtiges Passwort angenommen', login.status === 200, `Status ${login.status}`);
  pruefe('me liefert das Konto', (await m2('GET', '/api/me')).body?.user?.email === mail2);
  pruefe('ohne Anmeldung liefert me nichts', (await client()('GET', '/api/me')).body?.user === null);

  if (!istErster) {
    console.log('\n(Admin-Teil übersprungen - kein frischer Datenbestand)');
    return ende();
  }

  // --- Admin: freischalten ---
  console.log('\nFreischalten und sperren');
  const liste = await admin('GET', '/api/admin/users?status=pending');
  pruefe('Admin sieht offene Anmeldungen', liste.status === 200 && liste.body.users.length >= 1);
  const mariaId = m.body.user.id;
  pruefe('freischalten klappt',
    (await admin('POST', `/api/admin/users/${mariaId}/freischalten`)).body?.user?.status === 'active');
  pruefe('Freigeschaltete kommt trotzdem nicht in den Admin-Bereich',
    (await m2('GET', '/api/admin/users')).status === 403);

  // --- Admin ernennen, beliebig viele ---
  pruefe('zum Admin ernennen klappt',
    (await admin('POST', `/api/admin/users/${mariaId}/admin`, { admin: true })).body?.user?.admin === true);
  pruefe('neuer Admin kommt in den Admin-Bereich',
    (await m2('GET', '/api/admin/users')).status === 200);
  const nachher = await admin('GET', '/api/admin/users');
  pruefe('zwei Admins gleichzeitig möglich', nachher.body?.zaehler?.admins === 2,
    `gezählt: ${nachher.body?.zaehler?.admins}`);

  // --- Sicherungen gegen Aussperren ---
  console.log('\nSicherungen');
  const adminId = a.body.user.id;
  pruefe('sich selbst sperren wird verweigert',
    (await admin('POST', `/api/admin/users/${adminId}/sperren`)).status === 400);

  // Maria wieder absetzen, dann ist der erste Admin der letzte.
  await admin('POST', `/api/admin/users/${mariaId}/admin`, { admin: false });
  pruefe('letzter Admin kann sich nicht selbst absetzen',
    (await admin('POST', `/api/admin/users/${adminId}/admin`, { admin: false })).status === 400);

  // --- Sperren wirkt sofort ---
  pruefe('sperren klappt',
    (await admin('POST', `/api/admin/users/${mariaId}/sperren`, { grund: 'Test' })).body?.user?.status === 'blocked');
  pruefe('laufende Anmeldung der Gesperrten ist beendet',
    (await m2('GET', '/api/me')).body?.user === null);
  pruefe('Gesperrte kann sich nicht neu anmelden',
    (await client()('POST', '/api/login', { email: mail2, passwort: 'geheim12345' })).status === 403);
  pruefe('entsperren klappt',
    (await admin('POST', `/api/admin/users/${mariaId}/entsperren`)).body?.user?.status === 'active');
  pruefe('Entsperrte kann sich wieder anmelden',
    (await client()('POST', '/api/login', { email: mail2, passwort: 'geheim12345' })).status === 200);

  // --- Passwort ändern ---
  console.log('\nPasswort');
  const m3 = client();
  await m3('POST', '/api/login', { email: mail2, passwort: 'geheim12345' });
  pruefe('falsches altes Passwort abgelehnt',
    (await m3('POST', '/api/passwort', { alt: 'stimmtnicht', neu: 'neuesgeheim123' })).status === 401);
  pruefe('Passwort ändern klappt',
    (await m3('POST', '/api/passwort', { alt: 'geheim12345', neu: 'neuesgeheim123' })).status === 200);
  pruefe('altes Passwort gilt nicht mehr',
    (await client()('POST', '/api/login', { email: mail2, passwort: 'geheim12345' })).status === 401);
  pruefe('neues Passwort gilt',
    (await client()('POST', '/api/login', { email: mail2, passwort: 'neuesgeheim123' })).status === 200);

  // --- Abmelden ---
  pruefe('abmelden klappt', (await m3('POST', '/api/logout')).status === 200);
  pruefe('nach dem Abmelden ist die Sitzung weg', (await m3('GET', '/api/me')).body?.user === null);

  ende();
}

function ende() {
  console.log(`\n${gruen} in Ordnung, ${rot} fehlgeschlagen`);
  process.exit(rot === 0 ? 0 : 1);
}

main().catch((e) => { console.error('Testfehler:', e); process.exit(1); });
