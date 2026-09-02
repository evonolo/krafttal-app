// Grunddaten beim ersten Start.
//
// Vereins- und Betriebsnamen stammen von krafttal.at. Kontaktdaten,
// Öffnungszeiten und Ansprechpartner sind Platzhalter und müssen vor dem
// echten Betrieb ersetzt werden.
//
// Termine werden nur angelegt, wenn SEED_DEMO nicht auf "false" steht.
// Für den Echtbetrieb: SEED_DEMO=false setzen und den Kalender leer lassen.
import { db } from './db.js';

const VEREINE = [
  ['BM', 'Bundesmusikkapelle Kelchsau', '52 Mitglieder · Probe Mi 20 Uhr', 'Gegründet vor über hundert Jahren, heute mit Jugendkapelle. Spielt bei Kirchenfesten, Konzerten und dem Hoamfohrfest.', 52],
  ['SV', 'Sportverein Kelchsau', 'Fußball · Tennis · Nachwuchs', 'Fußball in der Bezirksliga, Tennisplätze am Sportgelände, Nachwuchsbetrieb von U8 bis U16.', 140],
  ['RV', 'Ringerverein Kelchsau', 'Bundesliga · Training Di & Do', 'Einer der bekanntesten Vereine im Tal. Training für Kinder ab 6 Jahren dienstags um 17 Uhr.', 64],
  ['WSV', 'Ski- & Wintersportverein', 'Rennlauf · Skitouren · Kinderskikurs', 'Kinderskikurse in den Weihnachtsferien, Vereinsrennen im Februar, Tourengruppe im Winter.', 88],
  ['K', 'Kirchenchor Kelchsau', 'Gesang · Probe Do 19:30', 'Einer von vier Gesangsvereinen im Tal. Gestaltet Messen und das Adventsingen.', 23],
  ['FF', 'Freiwillige Feuerwehr Kelchsau', 'Einsatz · Jugendfeuerwehr', 'Zuständig fürs ganze Tal bis zur Bamberger Hütte. Jugendfeuerwehr ab 10 Jahren.', 47],
  ['LJ', 'Landjugend Kelchsau', 'Jugend · Brauchtum', 'Organisiert das Maibaumaufstellen und hilft bei Festen im Tal mit.', 31],
  ['KT', 'Krafttal Kelchsau', 'Initiative · Themenweg · Kurse', 'Die Initiative hinter dieser App. Themenweg 5 Elemente, Kinderweg, Kurse und Workshops.', 12],
];

// Kürzel, Name, Zeile, Kurzbeschreibung, Text, Web, Adresse, Öffnungszeiten
const BETRIEBE = [
  ['F', 'Fuchswirt', 'Gasthof · Zimmer', 'Gasthof im Ortszentrum mit Tiroler Küche, Mittagsmenü unter der Woche, 14 Zimmer.', 'Familienbetrieb in dritter Generation. Stube für bis zu 60 Personen, Vereinsabende und Feiern nach Vereinbarung. Ruhetag Dienstag.', 'fuchswirt-kelchsau.at', 'Kelchsau 15', 'Mi–Mo 10–22 Uhr, Küche bis 21 Uhr'],
  ['M', 'Moderstock', 'Gasthof · Kegelbahn', 'Gasthof mit zwei Kegelbahnen, Gastgarten und Hausmannskost.', 'Kegelbahnen für Vereine und Firmen reservierbar. Sonntags Braten ab 11:30.', 'moderstock.at', 'Kelchsau 61', 'Do–Di ab 10 Uhr, Ruhetag Mittwoch'],
  ['S', 'Spar Kelchsau', 'Nahversorger · Post-Partner', 'Lebensmittel, Backwaren aus der Region, Post-Partner, Abholstelle für Fundsachen.', 'Einziger Nahversorger im Tal. Bestellungen fürs Wochenende bis Donnerstag. Zustellung für ältere Leute nach Absprache.', 'spar.at', 'Kelchsau 40', 'Mo–Fr 7–18, Sa 7–12 Uhr'],
  ['Z', 'Zimmerei Kelchsau', 'Holzbau · Dachstühle', 'Holzbau, Dachstühle, Sanierung und Balkone im Tal und im Brixental.', 'Sechs Mitarbeiter, eigene Abbundhalle. Bildet Zimmerer-Lehrlinge aus, Bewerbungen jederzeit.', 'zimmerei-kelchsau.at', 'Kelchsau 88', 'Mo–Fr 7–17 Uhr'],
  ['A', 'Autowerkstatt Kelchsau', 'Service · Reifen · §57a', 'Freie Werkstatt für alle Marken, Pickerl, Reifen, Klimaservice.', 'Ersatzauto nach Vereinbarung. Winterreifen-Einlagerung möglich.', '', 'Kelchsau 3', 'Mo–Fr 7:30–12, 13–17 Uhr'],
  ['E', 'Erla Brennhütte', 'Jausenstation', 'Jausenstation am Weg zur Alm, hausgemachter Speck und Käse, Mai bis Oktober.', 'Zu Fuß etwa 45 Minuten vom Parkplatz Wegscheid. Gruppen bitte anmelden.', '', 'Kelchsau, Langer Grund', 'Mai–Okt, Di–So 10–18 Uhr'],
  ['N', 'Niederkaseralm', 'Almgasthaus · Käserei', 'Bewirtschaftete Alm mit eigener Käserei, Almkäse und Butter ab Hof.', 'Almabtrieb Ende September. Käse gibt es im Sommer direkt auf der Alm, im Winter beim Spar.', 'niederkaseralm.at', 'Kelchsau, Kurzer Grund', 'Juni–Sept täglich 9–18 Uhr'],
  ['W', 'Gasthof Wegscheid', 'Gasthof · Talschluss', 'Gasthof am Talschluss, Ausgangspunkt für Touren zur Bamberger Hütte, Zimmer und Küche.', 'Großer Parkplatz, Sonnenterrasse, Wanderkarten und Tourentipps.', 'gasthof-wegscheid.at', 'Kelchsau, Wegscheid 1', 'täglich 9–21 Uhr, Nov. geschlossen'],
  ['B', 'Bamberger Hütte', 'Schutzhütte · 1 756 m', 'Alpenvereinshütte im Talschluss, 80 Schlafplätze, Sommer- und Winterbetrieb.', 'Aufstieg von Wegscheid etwa 2 Stunden. Übernachtung reservieren, für Einheimische Vereinsrabatt.', 'alpenverein.at', 'Kelchsau, Talschluss', 'Sommer Juni–Okt, Winter Dez–April'],
];

// Datum, Zeit, Kategorie, Titel, Ort, Veranstalter (Org-Name oder Text), Text, hervorgehoben
const TERMINE = [
  ['2026-09-05', 'ab 18 Uhr', 'fest', 'Hoamfohrfest der Musikkapelle', 'Dorfplatz Kelchsau', 'Bundesmusikkapelle Kelchsau', 'Frühschoppen am Samstag, Festbetrieb ab Freitagabend.', 0],
  ['2026-09-09', '20:00', 'verein', 'Probe Bundesmusikkapelle', 'Musikheim', 'Bundesmusikkapelle Kelchsau', 'Wöchentliche Probe. Neue Musikantinnen und Musikanten sind willkommen.', 0],
  ['2026-09-11', '16–18 Uhr', 'gemeinde', 'Sprechstunde Bürgermeister in der Kelchsau', 'Gemeindestube, Volksschule', 'Gemeinde Hopfgarten', 'Ohne Anmeldung.', 0],
  ['2026-09-13', '9–16 Uhr', 'verein', 'Nachwuchsturnier Fußball', 'Sportplatz', 'Sportverein Kelchsau', 'U8 bis U12, sechs Mannschaften aus dem Brixental. Kuchentheke und Grill.', 0],
  ['2026-09-17', '17:00', 'kurs', 'Achtsamkeit am Wasser, Themenweg 5 Elemente', 'Treffpunkt Fuchswirt', 'Krafttal Kelchsau', 'Geführte Runde über den Themenweg, etwa 90 Minuten, festes Schuhwerk.', 0],
  ['2026-09-26', 'ab 11 Uhr', 'fest', 'Almabtrieb & Hoamfohrfest', 'Ortszentrum', 'Krafttal Kelchsau', 'Die Kühe kommen von der Niederkaseralm herunter. Festbetrieb im Ort, Musik, regionale Küche.', 1],
  ['2026-09-26', '16:00', 'verein', 'Ringer: Auswärtskampf in Inzing, Fanbus', 'Abfahrt Sportplatz', 'Ringerverein Kelchsau', 'Fanbus zum Auswärtskampf, Rückfahrt gegen 23 Uhr.', 0],
  ['2026-10-03', '19:30', 'verein', 'Ringer: Heimkampf gegen Inzing', 'Turnhalle', 'Ringerverein Kelchsau', 'Bundesliga-Heimkampf. Kantine ab 18 Uhr.', 0],
  ['2026-10-04', '9:30', 'fest', 'Erntedank mit Frühschoppen', 'Kirche, danach Fuchswirt', 'Landjugend Kelchsau', 'Messe um 9:30, anschließend Frühschoppen.', 0],
  ['2026-10-13', '19:00', 'gemeinde', 'Bauausschuss: Kinderspielplatz', 'Gemeindeamt Hopfgarten', 'Gemeinde Hopfgarten', 'Ergebnis der Abstimmung zum Standort wird vorgelegt. Öffentlich.', 0],
  ['2026-10-24', '19:30', 'verein', 'Herbstkonzert Kirchenchor', 'Pfarrkirche', 'Kirchenchor Kelchsau', 'Chormusik aus drei Jahrhunderten, freiwillige Spenden.', 0],
];

export function seed() {
  const orgsLeer = db.prepare(`SELECT COUNT(*) AS c FROM orgs`).get().c === 0;

  if (orgsLeer) {
    const einVerein = db.prepare(`
      INSERT INTO orgs (type, short, name, sub, text, members) VALUES ('verein', ?, ?, ?, ?, ?)
    `);
    const einBetrieb = db.prepare(`
      INSERT INTO orgs (type, short, name, sub, intro, text, web, address, hours)
      VALUES ('betrieb', ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    db.transaction(() => {
      for (const v of VEREINE) einVerein.run(...v);
      for (const b of BETRIEBE) einBetrieb.run(...b);
    })();
    console.log(`Grunddaten: ${VEREINE.length} Vereine, ${BETRIEBE.length} Betriebe angelegt`);
  }

  if (process.env.SEED_DEMO === 'false') return;

  const termineLeer = db.prepare(`SELECT COUNT(*) AS c FROM events`).get().c === 0;
  if (termineLeer) {
    const findeOrg = db.prepare(`SELECT id FROM orgs WHERE name = ?`);
    const einTermin = db.prepare(`
      INSERT INTO events (date, time_text, cat, title, place, text, org_id, by_text, highlight)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    db.transaction(() => {
      for (const [datum, zeit, kat, titel, ort, wer, text, hl] of TERMINE) {
        const org = findeOrg.get(wer);
        einTermin.run(datum, zeit, kat, titel, ort, text, org?.id ?? null, org ? '' : wer, hl);
      }
    })();
    console.log(`Grunddaten: ${TERMINE.length} Beispieltermine angelegt (SEED_DEMO=false schaltet das ab)`);
  }
}
