// Prüft die vier nachgerüsteten Bereiche:
// Meldungen ansehen, Mitglieder bestätigen, Passwort zurücksetzen,
// Anliegen bearbeiten.
// Aufruf: node tests/loecher.js [adresse]

const BASIS = process.argv[2] || 'http://localhost:3000';
let gruen = 0, rot = 0;

const pruefe = (name, bedingung, detail = '') => {
  if (bedingung) { gruen++; console.log(`  ok   ${name}`); }
  else { rot++; console.log(`  FEHL ${name}${detail ? ' -> ' + detail : ''}`); }
};

function client() {
  let cookie = '';
  return async (methode, pfad, daten) => {
    const r = await fetch(BASIS + pfad, {
      method: methode,
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: daten === undefined ? undefined : JSON.stringify(daten),
    });
    for (const c of r.headers.getSetCookie?.() ?? []) {
      const teil = c.split(';')[0];
      if (teil.startsWith('krafttal_sitzung=')) cookie = teil;
    }
    let body = null;
    try { body = await r.json(); } catch {}
    return { status: r.status, body };
  };
}

const zufall = () => Math.random().toString(36).slice(2, 8);

async function neu(admin, name) {
  const c = client();
  const email = `${name.toLowerCase().replace(/\W/g,'')}-${zufall()}@test.local`;
  const r = await c('POST', '/api/register', {
    email, passwort: 'geheim12345', name, adresse: 'Kelchsau 1',
  });
  if (r.body?.user?.status === 'pending' && admin) {
    await admin('POST', `/api/admin/users/${r.body.user.id}/freischalten`);
  }
  return { c, id: r.body?.user?.id, email };
}

async function main() {
  console.log(`Teste ${BASIS}\n`);
  if (!(await fetch(BASIS + '/api/health').then(r => r.ok).catch(() => false))) {
    console.log('Server nicht erreichbar.'); process.exit(1);
  }

  const admin = client();
  const a = await admin('POST', '/api/register', {
    email: `admin-${zufall()}@test.local`, passwort: 'geheim12345', name: 'Test Admin',
  });
  if (!a.body?.ersterAdmin) { console.log('Test braucht einen frischen Datenbestand.'); process.exit(1); }

  const sepp = await neu(admin, 'Sepp Kruckenhauser');
  const lisa = await neu(admin, 'Lisa Astner');

  // ================= 1. Anliegen bearbeiten =================
  console.log('Anliegen bearbeiten');
  const anl = (await sepp.c('POST', '/api/anliegen', {
    kategorie: 'hilfe', titel: 'Erster Titel', text: 'Erster Text', bedarf: 2,
  })).body.anliegen;
  pruefe('eigenes Anliegen ist als änderbar gekennzeichnet', anl.darfBearbeiten === true);
  pruefe('fremdes Anliegen ist es nicht',
    (await lisa.c('GET', `/api/anliegen/${anl.id}`)).body?.anliegen?.darfBearbeiten === false);

  const g = await sepp.c('PUT', `/api/anliegen/${anl.id}`, {
    kategorie: 'biete', titel: 'Geänderter Titel', text: 'Neuer Text', bedarf: 5,
  });
  pruefe('ändern klappt', g.status === 200, `Status ${g.status}`);
  pruefe('Titel geändert', g.body?.anliegen?.titel === 'Geänderter Titel');
  pruefe('Kategorie geändert', g.body?.anliegen?.kategorie === 'biete');
  pruefe('Bedarf geändert', g.body?.anliegen?.bedarf === 5);
  pruefe('Fremde können nicht ändern',
    (await lisa.c('PUT', `/api/anliegen/${anl.id}`,
      { kategorie: 'hilfe', titel: 'Fremd' })).status === 403);
  pruefe('leerer Titel abgelehnt',
    (await sepp.c('PUT', `/api/anliegen/${anl.id}`, { kategorie:'hilfe', titel:'  ' })).status === 400);
  pruefe('Team darf fremde Anliegen ändern',
    (await admin('PUT', `/api/anliegen/${anl.id}`,
      { kategorie: 'hilfe', titel: 'Vom Team geändert' })).status === 200);
  pruefe('Zusagen überleben eine Änderung',
    (await lisa.c('POST', `/api/anliegen/${anl.id}/zusage`)).body?.anliegen?.zusagenAnzahl === 1 &&
    (await sepp.c('PUT', `/api/anliegen/${anl.id}`,
      { kategorie:'hilfe', titel:'Nochmal geändert' })).body?.anliegen?.zusagenAnzahl === 1);

  // ================= 2. Meldungen =================
  console.log('\nMeldungen ansehen');
  await lisa.c('POST', `/api/anliegen/${anl.id}/melden`, { grund: 'Passt so nicht' });
  const m = await admin('GET', '/api/admin/meldungen');
  pruefe('Team sieht die Meldung', m.status === 200 && m.body.meldungen.length === 1);
  pruefe('Meldung nennt den Melder', m.body?.meldungen?.[0]?.melder === 'Lisa Astner');
  pruefe('Meldung nennt den Grund', m.body?.meldungen?.[0]?.grund === 'Passt so nicht');
  pruefe('gemeldeter Beitrag liegt bei',
    m.body?.meldungen?.[0]?.beitrag?.titel === 'Nochmal geändert');
  pruefe('Zähler stimmt', m.body?.zaehler?.offen === 1 && m.body?.zaehler?.erledigt === 0);
  pruefe('Normale sehen keine Meldungen',
    (await lisa.c('GET', '/api/admin/meldungen')).status === 403);

  const meldungId = m.body.meldungen[0].id;
  pruefe('ausblenden klappt',
    (await admin('POST', `/api/admin/meldungen/${meldungId}/ausblenden`)).status === 200);
  pruefe('ausgeblendeter Beitrag ist für alle weg',
    !(await lisa.c('GET', '/api/anliegen')).body?.anliegen?.some(x => x.id === anl.id));
  const nachher = await admin('GET', '/api/admin/meldungen');
  pruefe('Meldung ist nicht mehr offen', nachher.body?.zaehler?.offen === 0);
  pruefe('Meldung steht unter Erledigt',
    (await admin('GET', '/api/admin/meldungen?erledigt=1')).body?.meldungen?.length === 1);

  // Zweite Meldung nur abhaken, ohne den Beitrag anzurühren
  const anl2 = (await sepp.c('POST', '/api/anliegen',
    { kategorie: 'hinweis', titel: 'Harmloser Hinweis' })).body.anliegen;
  await lisa.c('POST', `/api/anliegen/${anl2.id}/melden`, { grund: '' });
  const offen2 = await admin('GET', '/api/admin/meldungen');
  pruefe('zweite Meldung ist offen', offen2.body?.meldungen?.length === 1);
  pruefe('abhaken klappt',
    (await admin('POST', `/api/admin/meldungen/${offen2.body.meldungen[0].id}/erledigt`)).status === 200);
  pruefe('Beitrag bleibt dabei sichtbar',
    (await lisa.c('GET', '/api/anliegen')).body?.anliegen?.some(x => x.id === anl2.id));

  // ================= 3. Mitglieder bestätigen =================
  console.log('\nMitglieder bestätigen');
  const musik = (await admin('GET', '/api/orgs?art=verein')).body.orgs
    .find(o => o.kuerzel === 'BM');

  pruefe('Normale sehen keinen Verwaltungszugang',
    (await sepp.c('GET', `/api/orgs/${musik.id}`)).body?.org?.darfVerwalten === false);
  pruefe('Team darf verwalten',
    (await admin('GET', `/api/orgs/${musik.id}`)).body?.org?.darfVerwalten === true);

  await sepp.c('POST', `/api/orgs/${musik.id}/beitreten`);
  const mitOffen = await admin('GET', `/api/orgs/${musik.id}`);
  pruefe('offene Anfrage wird gezählt', mitOffen.body?.org?.offeneAnfragen === 1);

  // Team macht Sepp zur Vereinsleitung
  pruefe('zur Leitung machen klappt',
    (await admin('POST', `/api/orgs/${musik.id}/mitglieder/${sepp.id}`, { rolle: 'admin' })).status === 200);
  pruefe('Leitung darf jetzt selbst verwalten',
    (await sepp.c('GET', `/api/orgs/${musik.id}`)).body?.org?.darfVerwalten === true);
  pruefe('Leitung taucht unter "betreut" auf',
    (await sepp.c('GET', '/api/orgs/meine/verwalten')).body?.orgs?.some(o => o.id === musik.id));

  // Ab hier bestätigt der Obmann selbst
  await lisa.c('POST', `/api/orgs/${musik.id}/beitreten`);
  const listeObmann = await sepp.c('GET', `/api/orgs/${musik.id}/mitglieder`);
  pruefe('Obmann sieht die Anfrage',
    listeObmann.body?.mitglieder?.some(x => x.id === lisa.id && x.status === 'pending'));
  pruefe('Obmann bestätigt mit Posting-Recht',
    (await sepp.c('POST', `/api/orgs/${musik.id}/mitglieder/${lisa.id}`, { rolle: 'poster' })).status === 200);
  pruefe('Bestätigte darf im Vereinsnamen posten',
    (await lisa.c('POST', '/api/anliegen',
      { kategorie:'hilfe', titel:'Im Namen der Kapelle', alsOrg: musik.id })).status === 201);
  pruefe('keine offenen Anfragen mehr',
    (await sepp.c('GET', `/api/orgs/${musik.id}`)).body?.org?.offeneAnfragen === 0);
  pruefe('Obmann kann Posting-Recht entziehen',
    (await sepp.c('POST', `/api/orgs/${musik.id}/mitglieder/${lisa.id}`, { rolle: 'member' })).status === 200);
  pruefe('danach kein Posten im Vereinsnamen mehr',
    (await lisa.c('POST', '/api/anliegen',
      { kategorie:'hilfe', titel:'Geht nicht mehr', alsOrg: musik.id })).status === 403);
  pruefe('Obmann kann entfernen',
    (await sepp.c('DELETE', `/api/orgs/${musik.id}/mitglieder/${lisa.id}`)).status === 200);

  // ================= 4. Passwort zurücksetzen =================
  console.log('\nPasswort zurücksetzen');
  const opfer = await neu(admin, 'Anna Wurzrainer');
  const angemeldet = client();
  await angemeldet('POST', '/api/login', { email: opfer.email, passwort: 'geheim12345' });
  pruefe('Konto ist angemeldet', (await angemeldet('GET', '/api/me')).body?.user !== null);

  const r = await admin('POST', `/api/admin/users/${opfer.id}/passwort`);
  pruefe('zurücksetzen klappt', r.status === 200);
  pruefe('neues Passwort wird einmal zurückgegeben', typeof r.body?.passwort === 'string');
  pruefe('Passwort hat brauchbare Länge', (r.body?.passwort || '').length >= 12,
    `${(r.body?.passwort || '').length} Zeichen`);
  pruefe('laufende Anmeldung ist beendet',
    (await angemeldet('GET', '/api/me')).body?.user === null);
  pruefe('altes Passwort gilt nicht mehr',
    (await client()('POST', '/api/login', { email: opfer.email, passwort: 'geheim12345' })).status === 401);
  pruefe('neues Passwort gilt',
    (await client()('POST', '/api/login', { email: opfer.email, passwort: r.body.passwort })).status === 200);
  pruefe('Normale dürfen keine Passwörter zurücksetzen',
    (await lisa.c('POST', `/api/admin/users/${opfer.id}/passwort`)).status === 403);
  // Sonst säße man mit einem Zufallspasswort da, ohne es zu merken.
  const selbst = await admin('POST', `/api/admin/users/${a.body.user.id}/passwort`);
  pruefe('eigenes Passwort geht hier nicht', selbst.status === 400, `Status ${selbst.status}`);
  pruefe('Hinweis verweist aufs Profil', /Profil/.test(selbst.body?.error || ''));
  pruefe('eigene Sitzung lebt danach noch',
    (await admin('GET', '/api/me')).body?.user !== null);

  // Die Person kann es selbst wieder ändern
  const neuAngemeldet = client();
  await neuAngemeldet('POST', '/api/login', { email: opfer.email, passwort: r.body.passwort });
  pruefe('Person kann danach selbst ein eigenes Passwort setzen',
    (await neuAngemeldet('POST', '/api/passwort',
      { alt: r.body.passwort, neu: 'meineigenes123' })).status === 200);

  console.log(`\n${gruen} in Ordnung, ${rot} fehlgeschlagen`);
  process.exit(rot === 0 ? 0 : 1);
}

main().catch((e) => { console.error('Testfehler:', e); process.exit(1); });
