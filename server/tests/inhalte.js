// Prüft Anliegen, Kalender, Vereine und Betriebe.
// Aufruf: node tests/inhalte.js [adresse]

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

async function neuerNutzer(admin, name) {
  const c = client();
  const email = `${name.toLowerCase().replace(/\W/g,'')}-${zufall()}@test.local`;
  const r = await c('POST', '/api/register', {
    email, passwort: 'geheim12345', name, adresse: 'Kelchsau 1', rolle: 'einwohner',
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

  // Erste Person = Admin
  const admin = client();
  const a = await admin('POST', '/api/register', {
    email: `admin-${zufall()}@test.local`, passwort: 'geheim12345',
    name: 'Test Admin', adresse: 'Kelchsau 1',
  });
  if (!a.body?.ersterAdmin) {
    console.log('Datenbank ist nicht leer - Test braucht einen frischen Bestand.');
    process.exit(1);
  }

  const sepp = await neuerNutzer(admin, 'Sepp Kruckenhauser');
  const lisa = await neuerNutzer(admin, 'Lisa Astner');

  // ---------- Grunddaten ----------
  console.log('Grunddaten');
  const vereine = await admin('GET', '/api/orgs?art=verein');
  pruefe('Vereine angelegt', vereine.body?.orgs?.length === 8, `${vereine.body?.orgs?.length}`);
  const betriebe = await admin('GET', '/api/orgs?art=betrieb');
  pruefe('Betriebe angelegt', betriebe.body?.orgs?.length === 9, `${betriebe.body?.orgs?.length}`);
  const termine = await admin('GET', '/api/events');
  pruefe('Beispieltermine angelegt', termine.body?.events?.length === 11, `${termine.body?.events?.length}`);
  pruefe('Termin kennt seinen Veranstalter',
    termine.body?.events?.[0]?.veranstalter?.length > 0);

  // ---------- Anliegen anlegen ----------
  console.log('\nAnliegen');
  const neu = await sepp.c('POST', '/api/anliegen', {
    kategorie: 'hilfe', titel: 'Heuernte, zwei Leute für Samstag',
    text: 'Ab 8 Uhr, Mittagessen inklusive.', bedarf: 2,
  });
  pruefe('anlegen klappt', neu.status === 201, `Status ${neu.status}`);
  const anlId = neu.body?.anliegen?.id;
  pruefe('Autor ist gesetzt', neu.body?.anliegen?.autor?.name === 'Sepp Kruckenhauser');
  pruefe('als eigenes erkannt', neu.body?.anliegen?.eigenes === true);
  pruefe('ohne Titel abgelehnt',
    (await sepp.c('POST', '/api/anliegen', { kategorie: 'hilfe', titel: '' })).status === 400);
  pruefe('ohne Kategorie abgelehnt',
    (await sepp.c('POST', '/api/anliegen', { titel: 'X' })).status === 400);

  // ---------- Zusagen ----------
  console.log('\nZusagen');
  const z1 = await lisa.c('POST', `/api/anliegen/${anlId}/zusage`);
  pruefe('zusagen klappt', z1.body?.anliegen?.ichDabei === true);
  pruefe('Zähler steht auf 1', z1.body?.anliegen?.zusagenAnzahl === 1);
  pruefe('Name steht in der Liste', z1.body?.anliegen?.zusagen?.includes('Lisa Astner'));
  const z2 = await lisa.c('POST', `/api/anliegen/${anlId}/zusage`);
  pruefe('nochmal drücken nimmt die Zusage zurück', z2.body?.anliegen?.ichDabei === false);
  pruefe('Zähler wieder auf 0', z2.body?.anliegen?.zusagenAnzahl === 0);
  await lisa.c('POST', `/api/anliegen/${anlId}/zusage`);

  // ---------- Absagen: nur für die absagende Person ----------
  console.log('\nAbsagen');
  await admin('POST', `/api/anliegen/${anlId}/absage`);
  const listeAdmin = await admin('GET', '/api/anliegen');
  pruefe('abgesagtes Anliegen ist für mich weg',
    !listeAdmin.body?.anliegen?.some(x => x.id === anlId));
  const listeAbgelehnt = await admin('GET', '/api/anliegen?filter=abgelehnt');
  pruefe('liegt unter "Abgelehnt"',
    listeAbgelehnt.body?.anliegen?.some(x => x.id === anlId));

  // Der entscheidende Punkt aus dem Konzept:
  const listeSepp = await sepp.c('GET', '/api/anliegen');
  const beimErsteller = listeSepp.body?.anliegen?.find(x => x.id === anlId);
  pruefe('Ersteller sieht sein Anliegen unverändert', !!beimErsteller);
  pruefe('Ersteller sieht die Absage nicht', beimErsteller?.abgelehnt === false);
  pruefe('Absage ändert die Zusagen nicht', beimErsteller?.zusagenAnzahl === 1);

  await admin('DELETE', `/api/anliegen/${anlId}/absage`);
  pruefe('zurückholen klappt',
    (await admin('GET', '/api/anliegen')).body?.anliegen?.some(x => x.id === anlId));

  // ---------- Kommentare ----------
  console.log('\nKommentare');
  const k = await lisa.c('POST', `/api/anliegen/${anlId}/kommentar`, { text: 'Ich komm mit dem Traktor.' });
  pruefe('kommentieren klappt', k.status === 201);
  pruefe('Kommentar kennt den Schreiber', k.body?.kommentar?.wer === 'Lisa Astner');
  pruefe('leerer Kommentar abgelehnt',
    (await lisa.c('POST', `/api/anliegen/${anlId}/kommentar`, { text: '  ' })).status === 400);
  const detail = await sepp.c('GET', `/api/anliegen/${anlId}`);
  pruefe('Kommentar steht beim Anliegen', detail.body?.anliegen?.kommentare?.length === 1);

  // ---------- Filter ----------
  console.log('\nFilter');
  await sepp.c('POST', '/api/anliegen', { kategorie: 'biete', titel: 'Fahrgemeinschaft nach Wörgl' });
  const nurBiete = await sepp.c('GET', '/api/anliegen?filter=biete');
  pruefe('Kategoriefilter greift',
    nurBiete.body?.anliegen?.length === 1 && nurBiete.body.anliegen[0].kategorie === 'biete');

  // ---------- Vereine ----------
  console.log('\nVereine und Betriebe');
  const musik = vereine.body.orgs.find(o => o.kuerzel === 'BM');
  const bei = await lisa.c('POST', `/api/orgs/${musik.id}/beitreten`);
  pruefe('Beitrittsanfrage klappt', bei.status === 201);
  pruefe('Hinweis nennt die Vereinsleitung', /Vereinsleitung/.test(bei.body?.hinweis || ''));
  pruefe('zweite Anfrage abgelehnt',
    (await lisa.c('POST', `/api/orgs/${musik.id}/beitreten`)).status === 409);
  pruefe('Anfrage ist als laufend sichtbar',
    (await lisa.c('GET', `/api/orgs/${musik.id}`)).body?.org?.meinAntrag === true);

  pruefe('Fremde dürfen Mitglieder nicht verwalten',
    (await sepp.c('GET', `/api/orgs/${musik.id}/mitglieder`)).status === 403);
  const mit = await admin('GET', `/api/orgs/${musik.id}/mitglieder`);
  pruefe('Team sieht die Anfrage', mit.body?.mitglieder?.length === 1);

  // Posting-Recht
  pruefe('ohne Bestätigung kein Posten im Vereinsnamen',
    (await lisa.c('POST', '/api/anliegen', { kategorie:'hilfe', titel:'Test', alsOrg: musik.id })).status === 403);
  await admin('POST', `/api/orgs/${musik.id}/mitglieder/${lisa.id}`, { rolle: 'poster' });
  const alsVerein = await lisa.c('POST', '/api/anliegen', {
    kategorie: 'hilfe', titel: 'Aufbau fürs Hoamfohrfest', alsOrg: musik.id,
  });
  pruefe('mit Posting-Recht klappt es', alsVerein.status === 201, `Status ${alsVerein.status}`);
  pruefe('Beitrag erscheint im Vereinsnamen',
    alsVerein.body?.anliegen?.autor?.name === 'Bundesmusikkapelle Kelchsau');
  pruefe('Beitrag ist als Organisation gekennzeichnet',
    alsVerein.body?.anliegen?.autor?.istOrg === true);
  pruefe('"Wo darf ich posten" nennt den Verein',
    (await lisa.c('GET', '/api/orgs/meine/posten')).body?.orgs?.some(o => o.id === musik.id));

  // Betrieb: nur das Team bestätigt
  const spar = betriebe.body.orgs.find(o => o.name === 'Spar Kelchsau');
  const beiB = await sepp.c('POST', `/api/orgs/${spar.id}/beitreten`);
  pruefe('Hinweis beim Betrieb nennt das Krafttal-Team', /Krafttal-Team/.test(beiB.body?.hinweis || ''));

  // Folgen
  const f1 = await sepp.c('POST', `/api/orgs/${musik.id}/folgen`);
  pruefe('folgen klappt', f1.body?.folgeIch === true);
  pruefe('nochmal drücken hebt es auf',
    (await sepp.c('POST', `/api/orgs/${musik.id}/folgen`)).body?.folgeIch === false);

  // ---------- Termine ----------
  console.log('\nTermine');
  const ev = termine.body.events[0];
  const komme = await sepp.c('POST', `/api/events/${ev.id}/komme`);
  pruefe('"Ich komme" klappt', komme.body?.event?.ichKomme === true);
  pruefe('Zähler steigt', komme.body?.event?.kommen === 1);
  pruefe('nochmal drücken nimmt es zurück',
    (await sepp.c('POST', `/api/events/${ev.id}/komme`)).body?.event?.ichKomme === false);
  const imSep = await sepp.c('GET', '/api/events?von=2026-09-01&bis=2026-09-30');
  pruefe('Zeitraumfilter greift', imSep.body?.events?.every(e => e.datum.startsWith('2026-09')));
  pruefe('Kategoriefilter greift',
    (await sepp.c('GET','/api/events?kategorie=fest')).body?.events?.every(e => e.kategorie === 'fest'));
  const neuerTermin = await sepp.c('POST', '/api/events', {
    datum: '2026-11-08', kategorie: 'verein', titel: 'Testtermin', ort: 'Musikheim',
  });
  pruefe('Termin anlegen klappt', neuerTermin.status === 201);
  pruefe('krummes Datum abgelehnt',
    (await sepp.c('POST', '/api/events', { datum: '8.11.2026', kategorie:'fest', titel:'X' })).status === 400);

  // ---------- Termine ändern und löschen ----------
  console.log('\nTermine ändern und löschen');
  const eigener = (await sepp.c('POST', '/api/events', {
    datum: '2026-11-15', kategorie: 'kurs', titel: 'Erster Titel', ort: 'Musikheim',
    zeit: '18:00', text: 'Erste Beschreibung',
  })).body.event;
  pruefe('eigener Termin ist als änderbar gekennzeichnet', eigener.darfBearbeiten === true);
  pruefe('fremder Termin ist es nicht',
    (await lisa.c('GET', `/api/events/${eigener.id}`)).body?.event?.darfBearbeiten === false);

  const geaendert = await sepp.c('PUT', `/api/events/${eigener.id}`, {
    datum: '2026-11-16', kategorie: 'fest', titel: 'Geänderter Titel',
    ort: 'Dorfplatz', zeit: '19:30', text: 'Neue Beschreibung',
  });
  pruefe('ändern klappt', geaendert.status === 200, `Status ${geaendert.status}`);
  pruefe('Titel ist geändert', geaendert.body?.event?.titel === 'Geänderter Titel');
  pruefe('Datum ist geändert', geaendert.body?.event?.datum === '2026-11-16');
  pruefe('Kategorie ist geändert', geaendert.body?.event?.kategorie === 'fest');
  pruefe('Ort ist geändert', geaendert.body?.event?.ort === 'Dorfplatz');

  pruefe('Fremde können nicht ändern',
    (await lisa.c('PUT', `/api/events/${eigener.id}`,
      { datum: '2026-12-01', kategorie: 'fest', titel: 'Fremd' })).status === 403);
  pruefe('Fremde können nicht löschen',
    (await lisa.c('DELETE', `/api/events/${eigener.id}`)).status === 403);
  pruefe('krummes Datum wird auch beim Ändern abgelehnt',
    (await sepp.c('PUT', `/api/events/${eigener.id}`,
      { datum: '16.11.2026', kategorie: 'fest', titel: 'X' })).status === 400);
  pruefe('leerer Titel wird beim Ändern abgelehnt',
    (await sepp.c('PUT', `/api/events/${eigener.id}`,
      { datum: '2026-11-16', kategorie: 'fest', titel: '  ' })).status === 400);

  // Zusagen müssen mitverschwinden, sonst bleiben verwaiste Einträge liegen.
  await lisa.c('POST', `/api/events/${eigener.id}/komme`);
  pruefe('Zusage vor dem Löschen vorhanden',
    (await sepp.c('GET', `/api/events/${eigener.id}`)).body?.event?.kommen === 1);
  pruefe('löschen klappt', (await sepp.c('DELETE', `/api/events/${eigener.id}`)).status === 200);
  pruefe('gelöschter Termin ist weg',
    (await sepp.c('GET', `/api/events/${eigener.id}`)).status === 404);
  pruefe('Zusagen des gelöschten Termins sind mit weg',
    !(await sepp.c('GET', '/api/events')).body?.events?.some(e => e.id === eigener.id));

  // Das Team darf auch fremde Termine aufräumen.
  const vonLisa = (await lisa.c('POST', '/api/events', {
    datum: '2026-11-20', kategorie: 'verein', titel: 'Von Lisa',
  })).body.event;
  pruefe('Team darf fremde Termine ändern',
    (await admin('PUT', `/api/events/${vonLisa.id}`,
      { datum: '2026-11-21', kategorie: 'verein', titel: 'Vom Team geändert' })).status === 200);
  pruefe('Team darf fremde Termine löschen',
    (await admin('DELETE', `/api/events/${vonLisa.id}`)).status === 200);

  // ---------- Wartende ----------
  console.log('\nWartende');
  const warte = client();
  await warte('POST', '/api/register', {
    email: `warte-${zufall()}@test.local`, passwort: 'geheim12345', name: 'Wartende Person',
  });
  pruefe('Wartende sieht den Kalender', (await warte('GET', '/api/events')).status === 200);
  pruefe('Wartende sieht die Vereine', (await warte('GET', '/api/orgs')).status === 200);
  pruefe('Wartende sieht keine Anliegen', (await warte('GET', '/api/anliegen')).status === 403);
  pruefe('Wartende kann nichts anlegen',
    (await warte('POST', '/api/anliegen', { kategorie:'hilfe', titel:'X' })).status === 403);
  pruefe('Wartende kann nicht zusagen',
    (await warte('POST', `/api/events/${ev.id}/komme`)).status === 403);

  // ---------- Melden und zurückziehen ----------
  console.log('\nMelden und zurückziehen');
  pruefe('melden klappt',
    (await lisa.c('POST', `/api/anliegen/${anlId}/melden`, { grund: 'Test' })).status === 200);
  pruefe('fremdes Anliegen kann man nicht zurückziehen',
    (await lisa.c('DELETE', `/api/anliegen/${anlId}`)).status === 403);
  pruefe('eigenes Anliegen zurückziehen klappt',
    (await sepp.c('DELETE', `/api/anliegen/${anlId}`)).status === 200);
  pruefe('zurückgezogenes ist verschwunden',
    !(await sepp.c('GET','/api/anliegen')).body?.anliegen?.some(x => x.id === anlId));

  console.log(`\n${gruen} in Ordnung, ${rot} fehlgeschlagen`);
  process.exit(rot === 0 ? 0 : 1);
}

main().catch((e) => { console.error('Testfehler:', e); process.exit(1); });
