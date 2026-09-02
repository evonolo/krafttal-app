'use strict';

// ---------- Werkzeug ----------

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

// Links im Text anklickbar machen - erst nach dem Maskieren, damit
// Fremdtext kein HTML einschleusen kann.
const linkify = (t) => esc(t).replace(/(https?:\/\/[^\s<]+|www\.[^\s<]+)/g,
  (u) => `<a href="${u.startsWith('http') ? u : 'https://' + u}" target="_blank" rel="noopener">${u}</a>`);

async function api(methode, pfad, daten) {
  const r = await fetch(pfad, {
    method: methode,
    headers: { 'content-type': 'application/json' },
    body: daten === undefined ? undefined : JSON.stringify(daten),
  });
  let body = null;
  try { body = await r.json(); } catch {}
  if (!r.ok) throw new Error(body?.error || `Fehler ${r.status}`);
  return body;
}

function melde(text, art = 'fehler') {
  $('#meldung').innerHTML = text ? `<div class="meldung ${art}">${esc(text)}</div>` : '';
}

// "vor 2 Std." statt eines Zeitstempels
function seit(iso) {
  const d = new Date(iso.replace(' ', 'T') + (iso.endsWith('Z') ? '' : 'Z'));
  const min = Math.round((Date.now() - d.getTime()) / 60000);
  if (min < 2) return 'gerade eben';
  if (min < 60) return `vor ${min} Min.`;
  const std = Math.round(min / 60);
  if (std < 24) return `vor ${std} Std.`;
  const tage = Math.round(std / 24);
  if (tage === 1) return 'gestern';
  if (tage < 30) return `vor ${tage} Tagen`;
  return d.toLocaleDateString('de-AT', { day: 'numeric', month: 'long' });
}

const MONATE = ['Jänner','Februar','März','April','Mai','Juni','Juli','August',
                'September','Oktober','November','Dezember'];
const KURZMONAT = ['Jän','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez'];
const KAT_ANL = { hilfe:'Hilfe gesucht', biete:'Biete', hinweis:'Hinweis', fund:'Verloren / Gefunden' };
const KAT_EV = { fest:'Fest', verein:'Verein', gemeinde:'Gemeinde', kurs:'Kurs' };

// ---------- Zustand ----------

const zustand = {
  ich: null,
  tab: 'anliegen',
  filterAnl: 'alle',
  filterKal: 'alle',
  filterDorf: 'verein',
  adminStatus: 'pending',
  monat: new Date().getMonth(),
  jahr: new Date().getFullYear(),
  gewaehlterTag: null,
  termine: [],
  meineOrgs: [],
};

const SEITEN = ['start','register','login','warten','anliegen','kalender','dorf','profil'];
function zeigeSeite(name) {
  for (const s of SEITEN) $('#s-' + s).hidden = (s !== name);
}

// ---------- Anmeldung und Grundzustand ----------

function nachAnmeldung(user) {
  zustand.ich = user;
  melde('');

  const drin = !!user;
  $('#signet').hidden = !drin;
  $('#fuss').hidden = !drin || user.status !== 'active';
  $('#neuKnopf').hidden = true;

  if (!drin) { zeigeSeite('start'); return; }

  $('#signet').textContent = user.initialen;

  if (user.status === 'pending') {
    $('#wartenName').textContent = user.name.split(' ')[0];
    zeigeSeite('warten');
    ladeWartenKalender();
    return;
  }

  api('GET', '/api/orgs/meine/posten')
    .then((d) => { zustand.meineOrgs = d.orgs; })
    .catch(() => {});

  zeigeTab(zustand.tab);
}

function zeigeTab(name) {
  zustand.tab = name;
  for (const b of $('#fuss').children) b.setAttribute('aria-selected', String(b.dataset.tab === name));
  $('#neuKnopf').hidden = !(name === 'anliegen' || name === 'kalender');
  zeigeSeite(name);
  melde('');
  if (name === 'anliegen') ladeAnliegen();
  if (name === 'kalender') ladeTermine();
  if (name === 'dorf') ladeOrgs();
  if (name === 'profil') ladeProfil();
}

// ---------- Anliegen ----------

async function ladeAnliegen() {
  try {
    const d = await api('GET', '/api/anliegen?filter=' + zustand.filterAnl);
    $('#anlListe').innerHTML = d.anliegen.length
      ? d.anliegen.map(anlKarte).join('')
      : `<div class="leerhinweis">${zustand.filterAnl === 'abgelehnt'
          ? 'Du hast nichts weggelegt.'
          : 'Hier ist gerade nichts. Leg das erste Anliegen an.'}</div>`;
  } catch (e) { melde(e.message); }
}

function anlKarte(a) {
  const balken = a.bedarf > 0 ? `
    <div class="balken"><i style="width:${Math.min(100, a.zusagenAnzahl / a.bedarf * 100)}%"></i></div>
    <div class="mini">${a.zusagenAnzahl} von ${a.bedarf} zugesagt</div>` : '';
  const zusagen = a.zusagenAnzahl && a.bedarf === 0
    ? `<div class="mini">${a.zusagenAnzahl} ${a.zusagenAnzahl === 1 ? 'Zusage' : 'Zusagen'}</div>` : '';

  return `<article class="karte anl klickbar" data-anl="${a.id}">
    <div class="kopfzeile">
      <span class="marker ${a.kategorie}">${KAT_ANL[a.kategorie]}</span>
      <span class="mini">${seit(a.erstellt)}</span>
    </div>
    <h3>${esc(a.titel)}</h3>
    <div class="wer">${esc(a.autor.name)}</div>
    ${a.text ? `<p class="klein" style="margin:.5rem 0 0">${esc(a.text.slice(0, 140))}${a.text.length > 140 ? '…' : ''}</p>` : ''}
    ${balken}${zusagen}
    ${a.kommentarAnzahl ? `<div class="mini">${a.kommentarAnzahl} ${a.kommentarAnzahl === 1 ? 'Kommentar' : 'Kommentare'}</div>` : ''}
  </article>`;
}

async function oeffneAnliegen(id) {
  try {
    const { anliegen: a } = await api('GET', '/api/anliegen/' + id);
    const kommentare = a.kommentare.map((k) => `
      <div class="kommentar">
        <b class="klein">${esc(k.wer)}</b> <span class="mini">${seit(k.wann)}</span>
        <div>${linkify(k.text)}</div>
      </div>`).join('') || '<div class="mini">Noch keine Kommentare.</div>';

    const alsOrg = zustand.meineOrgs.length
      ? `<select id="kAlsOrg" style="margin-bottom:.4rem">
           <option value="">Als ${esc(zustand.ich.name)}</option>
           ${zustand.meineOrgs.map((o) => `<option value="${o.id}">Als ${esc(o.name)}</option>`).join('')}
         </select>` : '';

    blattAuf(`
      <span class="marker ${a.kategorie}">${KAT_ANL[a.kategorie]}</span>
      <h2 style="margin-top:.5rem">${esc(a.titel)}</h2>
      <div class="klein">${esc(a.autor.name)} · ${seit(a.erstellt)}</div>
      ${a.text ? `<p>${linkify(a.text)}</p>` : ''}
      ${a.link ? `<p><a href="${esc(a.link.url)}" target="_blank" rel="noopener">${esc(a.link.titel || a.link.url)}</a></p>` : ''}
      ${a.bedarf > 0 ? `
        <div class="balken"><i style="width:${Math.min(100, a.zusagenAnzahl / a.bedarf * 100)}%"></i></div>
        <div class="mini">${a.zusagenAnzahl} von ${a.bedarf} zugesagt</div>` : ''}
      ${a.zusagen.length ? `<p class="klein">Dabei: ${a.zusagen.map(esc).join(', ')}</p>` : ''}

      <div class="knoepfe">
        ${!a.eigenes ? `<button class="kompakt ${a.ichDabei ? 'leer' : ''}" data-tu="zusage" data-id="${a.id}">
          ${a.ichDabei ? 'Doch nicht' : 'Ich bin dabei'}</button>` : ''}
        ${!a.eigenes && !a.abgelehnt ? `<button class="kompakt leer" data-tu="absage" data-id="${a.id}">Absagen</button>` : ''}
        ${a.abgelehnt ? `<button class="kompakt leer" data-tu="zurueckholen" data-id="${a.id}">Zurückholen</button>` : ''}
        ${a.eigenes ? `<button class="kompakt warn" data-tu="zurueckziehen" data-id="${a.id}">Zurückziehen</button>` : ''}
      </div>

      <h3 style="margin-top:1.2rem">Kommentare</h3>
      ${kommentare}
      ${alsOrg}
      <div style="display:flex;gap:.4rem;margin-top:.5rem">
        <input id="kText" placeholder="Etwas dazu schreiben…" style="flex:1">
        <button class="kompakt" data-tu="kommentar" data-id="${a.id}">Senden</button>
      </div>
      <button class="text" data-tu="melden" data-id="${a.id}">Beitrag melden</button>
    `);
  } catch (e) { melde(e.message); }
}

// ---------- Kalender ----------

async function ladeTermine() {
  try {
    const d = await api('GET', '/api/events');
    zustand.termine = d.events;
    zeichneRaster();
    zeichneTerminliste();
  } catch (e) { melde(e.message); }
}

async function ladeWartenKalender() {
  try {
    const d = await api('GET', '/api/events');
    const naechste = d.events.slice(0, 5);
    $('#wartenKalender').innerHTML = `<div class="karte"><h3>Demnächst im Tal</h3>${
      naechste.map(terminZeile).join('') || '<div class="mini">Noch keine Termine.</div>'}</div>`;
  } catch { /* Wartende ohne Termine: nicht schlimm */ }
}

function zeichneRaster() {
  const { jahr, monat } = zustand;
  $('#monatName').textContent = `${MONATE[monat]} ${jahr}`;

  const ersterTag = new Date(jahr, monat, 1);
  // Montag als erster Tag der Woche
  const versatz = (ersterTag.getDay() + 6) % 7;
  const tageImMonat = new Date(jahr, monat + 1, 0).getDate();

  const mitTerminen = new Set(
    zustand.termine
      .filter((e) => e.datum.startsWith(`${jahr}-${String(monat + 1).padStart(2, '0')}`))
      .map((e) => Number(e.datum.slice(8, 10))));

  let html = ['Mo','Di','Mi','Do','Fr','Sa','So'].map((w) => `<div class="wt">${w}</div>`).join('');
  for (let i = 0; i < versatz; i++) html += '<button class="tag" disabled></button>';
  for (let t = 1; t <= tageImMonat; t++) {
    const hat = mitTerminen.has(t);
    const gewaehlt = zustand.gewaehlterTag === t;
    html += `<button class="tag ${hat ? 'hat' : ''}" data-tag="${t}"
             aria-pressed="${gewaehlt}">${t}</button>`;
  }
  $('#raster').innerHTML = html;
}

function terminZeile(e) {
  const [j, m, t] = e.datum.split('-');
  return `<div class="termin" data-ev="${e.id}">
    <div class="datum"><b>${Number(t)}</b><span>${KURZMONAT[Number(m) - 1]}</span></div>
    <div style="flex:1">
      <b>${esc(e.titel)}</b>
      <div class="mini">${esc([e.zeit, e.ort].filter(Boolean).join(' · '))}</div>
      <div class="mini">${esc(e.veranstalter)}${e.kommen ? ` · ${e.kommen} kommen` : ''}</div>
    </div>
  </div>`;
}

function zeichneTerminliste() {
  let liste = zustand.termine;
  if (zustand.filterKal !== 'alle') liste = liste.filter((e) => e.kategorie === zustand.filterKal);
  if (zustand.gewaehlterTag) {
    const p = `${zustand.jahr}-${String(zustand.monat + 1).padStart(2,'0')}-${String(zustand.gewaehlterTag).padStart(2,'0')}`;
    liste = liste.filter((e) => e.datum === p);
  }
  $('#terminListe').innerHTML = liste.length
    ? liste.map(terminZeile).join('')
    : '<div class="leerhinweis">Keine Termine.</div>';
}

async function oeffneTermin(id) {
  try {
    const { event: e } = await api('GET', '/api/events/' + id);
    const [j, m, t] = e.datum.split('-');
    blattAuf(`
      <span class="marker hinweis">${KAT_EV[e.kategorie]}</span>
      <h2 style="margin-top:.5rem">${esc(e.titel)}</h2>
      <div class="klein">${Number(t)}. ${MONATE[Number(m)-1]} ${j}${e.zeit ? ' · ' + esc(e.zeit) : ''}</div>
      <div class="klein">${esc(e.ort)}</div>
      <div class="klein">${esc(e.veranstalter)}${e.wiederholung ? ' · ' + esc(e.wiederholung) : ''}</div>
      ${e.text ? `<p>${linkify(e.text)}</p>` : ''}
      <p class="klein">${e.kommen} ${e.kommen === 1 ? 'Person kommt' : 'Personen kommen'}</p>
      <div class="knoepfe">
        <button class="kompakt ${e.ichKomme ? 'leer' : ''}" data-tu="komme" data-id="${e.id}">
          ${e.ichKomme ? 'Doch nicht' : 'Ich komme'}</button>
        ${e.darfBearbeiten ? `
          <button class="kompakt leer" data-tu="terminBearbeiten" data-id="${e.id}">Bearbeiten</button>
          <button class="kompakt warn" data-tu="terminLoeschen" data-id="${e.id}">Löschen</button>` : ''}
      </div>`);
  } catch (err) { melde(err.message); }
}

// ---------- Dorf ----------

async function ladeOrgs() {
  try {
    const d = await api('GET', '/api/orgs?art=' + zustand.filterDorf);
    $('#orgListe').innerHTML = d.orgs.map((o) => `
      <div class="org ${o.art}" data-org="${o.id}">
        <div class="kuerzel">${esc(o.kuerzel)}</div>
        <div style="flex:1">
          <b>${esc(o.name)}</b>
          <div class="mini">${esc(o.zeile)}</div>
        </div>
        ${o.meineRolle ? '<span class="marker frei">dabei</span>'
          : o.meinAntrag ? '<span class="marker offen">angefragt</span>' : ''}
      </div>`).join('');
  } catch (e) { melde(e.message); }
}

async function oeffneOrg(id) {
  try {
    const { org: o } = await api('GET', '/api/orgs/' + id);
    const istVerein = o.art === 'verein';
    const kontakt = [
      o.adresse && `Adresse: ${o.adresse}`,
      o.telefon && `Telefon: ${o.telefon}`,
      o.mail && `E-Mail: ${o.mail}`,
      o.web && `Web: ${o.web}`,
      o.zeiten && `Offen: ${o.zeiten}`,
      o.kontakt && `Kontakt: ${o.kontakt}`,
    ].filter(Boolean).map((z) => `<div class="klein">${esc(z)}</div>`).join('');

    blattAuf(`
      <h2>${esc(o.name)}</h2>
      <div class="klein">${esc(o.zeile)}</div>
      ${o.kurz ? `<p>${esc(o.kurz)}</p>` : ''}
      ${o.text ? `<p class="klein">${esc(o.text)}</p>` : ''}
      ${kontakt}
      ${o.dktPosten.length ? `<p class="klein" style="margin-top:.8rem">Darf im Namen posten:
        ${o.dktPosten.map((p) => esc(p.name)).join(', ')}</p>` : ''}
      <div class="knoepfe">
        ${o.meineRolle
          ? `<button class="kompakt leer" data-tu="austreten" data-id="${o.id}">Austreten</button>`
          : o.meinAntrag
            ? `<button class="kompakt leer" data-tu="austreten" data-id="${o.id}">Anfrage zurückziehen</button>`
            : `<button class="kompakt" data-tu="beitreten" data-id="${o.id}">
                 ${istVerein ? 'Mitglied werden' : 'Zugehörigkeit anfragen'}</button>`}
        <button class="kompakt leer" data-tu="folgen" data-id="${o.id}">
          ${o.folgeIch ? 'Nicht mehr folgen' : 'Folgen'}</button>
      </div>
      <p class="mini">${istVerein
        ? 'Die Vereinsleitung bestätigt die Mitgliedschaft.'
        : 'Das Krafttal-Team bestätigt nach Rücksprache mit dem Betrieb.'}</p>`);
  } catch (e) { melde(e.message); }
}

// ---------- Profil und Admin ----------

async function ladeProfil() {
  const u = zustand.ich;
  $('#profilName').textContent = u.name;
  $('#profilInfo').textContent =
    `${u.email} · ${u.rolle}${u.admin ? ' · Krafttal-Team' : ''}`;
  $('#adminKarte').hidden = !u.admin;
  if (u.admin) ladeAdmin();
}

async function ladeAdmin() {
  try {
    const d = await api('GET', '/api/admin/users?status=' + zustand.adminStatus);
    const z = d.zaehler;
    $('#adminZaehler').textContent =
      `${z.offen} offen · ${z.frei} freigeschaltet · ${z.gesperrt} gesperrt · ${z.admins} im Team`;
    $('#adminListe').innerHTML = d.users.length
      ? d.users.map(adminZeile).join('')
      : '<div class="leerhinweis">Hier ist gerade nichts.</div>';
  } catch (e) { melde(e.message); }
}

function adminZeile(u) {
  const marker = u.status === 'pending' ? '<span class="marker offen">offen</span>'
    : u.status === 'blocked' ? '<span class="marker gesperrt">gesperrt</span>'
    : '<span class="marker frei">frei</span>';
  const selbst = u.id === zustand.ich.id;
  const zeilen = [u.email, u.adresse, u.telefon, u.rolle].filter(Boolean).map(esc).join(' · ');

  let k = '';
  if (u.status === 'pending') k += `<button class="kompakt" data-au="freischalten" data-id="${u.id}">Freischalten</button>`;
  if (u.status === 'blocked') k += `<button class="kompakt" data-au="entsperren" data-id="${u.id}">Entsperren</button>`;
  if (u.status === 'active' && !selbst) k += `<button class="kompakt warn" data-au="sperren" data-id="${u.id}">Sperren</button>`;
  if (u.status === 'active') k += u.admin
    ? `<button class="kompakt leer" data-au="absetzen" data-id="${u.id}">Aus dem Team</button>`
    : `<button class="kompakt zweit" data-au="ernennen" data-id="${u.id}">Ins Team</button>`;

  return `<div class="kommentar">
    <div class="kopfzeile"><b>${esc(u.name)}${selbst ? ' (du)' : ''}</b>
      <span>${marker}${u.admin ? ' <span class="marker team">Team</span>' : ''}</span></div>
    <div class="mini">${zeilen}</div>
    ${u.referenz ? `<div class="mini">Kennt: ${esc(u.referenz)}</div>` : ''}
    ${u.grund ? `<div class="mini">Grund: ${esc(u.grund)}</div>` : ''}
    <div class="knoepfe">${k}</div>
  </div>`;
}

// ---------- Blatt ----------

function blattAuf(html) {
  $('#blattInhalt').innerHTML = html;
  $('#blatt').classList.add('offen');
}
function blattZu() {
  $('#blatt').classList.remove('offen');
  $('#blattInhalt').innerHTML = '';
}

// ---------- Neues Anliegen / neuer Termin ----------

function formularNeuesAnliegen() {
  const alsOrg = zustand.meineOrgs.length
    ? `<label>Veröffentlichen als</label>
       <select id="n-org">
         <option value="">${esc(zustand.ich.name)}</option>
         ${zustand.meineOrgs.map((o) => `<option value="${o.id}">${esc(o.name)}</option>`).join('')}
       </select>` : '';
  blattAuf(`
    <h2>Neues Anliegen</h2>
    <label>Was ist es?</label>
    <select id="n-kat">
      <option value="hilfe">Hilfe gesucht</option>
      <option value="biete">Biete</option>
      <option value="hinweis">Hinweis</option>
      <option value="fund">Verloren / Gefunden</option>
    </select>
    <label>Titel</label><input id="n-titel" maxlength="200">
    <label>Beschreibung</label><textarea id="n-text"></textarea>
    <label>Wie viele Leute brauchst du? <span class="klein">(0 = keine Zusagen nötig)</span></label>
    <input id="n-bedarf" type="number" min="0" max="999" value="0">
    ${alsOrg}
    <div class="knoepfe">
      <button data-tu="anlegenAnliegen">Veröffentlichen</button>
      <button class="leer" data-tu="blattZu">Abbrechen</button>
    </div>`);
}

// Dasselbe Formular fuer neue und bestehende Termine. Ohne Argument leer,
// mit Termin vorausgefuellt.
function formularTermin(e = null) {
  const wert = (v) => esc(v ?? '');
  const gewaehlt = (v, soll) => (v === soll ? ' selected' : '');
  const alsOrg = zustand.meineOrgs.length
    ? `<label>Veranstalter</label>
       <select id="t-org">
         <option value="">${esc(zustand.ich.name)}</option>
         ${zustand.meineOrgs.map((o) =>
           `<option value="${o.id}"${e && e.orgId === o.id ? ' selected' : ''}>${esc(o.name)}</option>`).join('')}
       </select>` : '';
  blattAuf(`
    <h2>${e ? 'Termin bearbeiten' : 'Neuer Termin'}</h2>
    <label>Datum</label><input id="t-datum" type="date" value="${wert(e?.datum)}">
    <label>Uhrzeit <span class="klein">(als Text, z. B. „ab 18 Uhr")</span></label>
    <input id="t-zeit" maxlength="60" value="${wert(e?.zeit)}">
    <label>Art</label>
    <select id="t-kat">
      <option value="fest"${gewaehlt(e?.kategorie,'fest')}>Fest</option>
      <option value="verein"${gewaehlt(e?.kategorie,'verein')}>Verein</option>
      <option value="gemeinde"${gewaehlt(e?.kategorie,'gemeinde')}>Gemeinde</option>
      <option value="kurs"${gewaehlt(e?.kategorie,'kurs')}>Kurs</option>
    </select>
    <label>Titel</label><input id="t-titel" maxlength="200" value="${wert(e?.titel)}">
    <label>Ort</label><input id="t-ort" maxlength="200" value="${wert(e?.ort)}">
    <label>Beschreibung</label><textarea id="t-text">${wert(e?.text)}</textarea>
    ${alsOrg}
    <div class="knoepfe">
      <button data-tu="${e ? 'speichernTermin' : 'anlegenTermin'}"${e ? ` data-id="${e.id}"` : ''}>
        ${e ? 'Änderung speichern' : 'Veröffentlichen'}</button>
      <button class="leer" data-tu="blattZu">Abbrechen</button>
    </div>`);
}

// Liest die Felder des Terminformulars aus.
function terminFelder() {
  return {
    datum: $('#t-datum').value,
    zeit: $('#t-zeit').value,
    kategorie: $('#t-kat').value,
    titel: $('#t-titel').value,
    ort: $('#t-ort').value,
    text: $('#t-text').value,
    alsOrg: $('#t-org')?.value || null,
  };
}

// ---------- Ereignisse ----------

$('#zuRegister').onclick = () => { melde(''); zeigeSeite('register'); };
$('#zuLogin').onclick = () => { melde(''); zeigeSeite('login'); };
$$('[data-zurueck]').forEach((b) => b.onclick = () => { melde(''); zeigeSeite('start'); });

$('#fRegister').onsubmit = async (e) => {
  e.preventDefault();
  const knopf = e.target.querySelector('button[type=submit]');
  knopf.disabled = true;
  try {
    const d = await api('POST', '/api/register', Object.fromEntries(new FormData(e.target)));
    nachAnmeldung(d.user);
    if (d.ersterAdmin) melde('Du bist die erste Person hier und damit im Krafttal-Team.', 'gut');
  } catch (err) { melde(err.message); }
  finally { knopf.disabled = false; }
};

$('#fLogin').onsubmit = async (e) => {
  e.preventDefault();
  const knopf = e.target.querySelector('button[type=submit]');
  knopf.disabled = true;
  try { nachAnmeldung((await api('POST', '/api/login', Object.fromEntries(new FormData(e.target)))).user); }
  catch (err) { melde(err.message); }
  finally { knopf.disabled = false; }
};

$('#abmelden').onclick = async () => {
  await api('POST', '/api/logout').catch(() => {});
  nachAnmeldung(null);
};

$('#signet').onclick = () => { if (zustand.ich?.status === 'active') zeigeTab('profil'); };

$('#fuss').onclick = (e) => {
  const b = e.target.closest('button[data-tab]');
  if (b) zeigeTab(b.dataset.tab);
};

$('#fAnliegen').onclick = (e) => {
  const b = e.target.closest('button[data-f]');
  if (!b) return;
  zustand.filterAnl = b.dataset.f;
  for (const x of $('#fAnliegen').children) x.setAttribute('aria-selected', String(x === b));
  ladeAnliegen();
};

$('#fKalender').onclick = (e) => {
  const b = e.target.closest('button[data-f]');
  if (!b) return;
  zustand.filterKal = b.dataset.f;
  for (const x of $('#fKalender').children) x.setAttribute('aria-selected', String(x === b));
  zeichneTerminliste();
};

$('#fDorf').onclick = (e) => {
  const b = e.target.closest('button[data-f]');
  if (!b) return;
  zustand.filterDorf = b.dataset.f;
  for (const x of $('#fDorf').children) x.setAttribute('aria-selected', String(x === b));
  ladeOrgs();
};

$('#fAdmin').onclick = (e) => {
  const b = e.target.closest('button[data-status]');
  if (!b) return;
  zustand.adminStatus = b.dataset.status;
  for (const x of $('#fAdmin').children) x.setAttribute('aria-selected', String(x === b));
  ladeAdmin();
};

$('#anlListe').onclick = (e) => {
  const k = e.target.closest('[data-anl]');
  if (k) oeffneAnliegen(Number(k.dataset.anl));
};

$('#monatZurueck').onclick = () => {
  if (--zustand.monat < 0) { zustand.monat = 11; zustand.jahr--; }
  zustand.gewaehlterTag = null;
  zeichneRaster(); zeichneTerminliste();
};
$('#monatVor').onclick = () => {
  if (++zustand.monat > 11) { zustand.monat = 0; zustand.jahr++; }
  zustand.gewaehlterTag = null;
  zeichneRaster(); zeichneTerminliste();
};

$('#raster').onclick = (e) => {
  const b = e.target.closest('button[data-tag]');
  if (!b || b.disabled) return;
  const t = Number(b.dataset.tag);
  zustand.gewaehlterTag = zustand.gewaehlterTag === t ? null : t;
  zeichneRaster(); zeichneTerminliste();
};

$('#terminListe').onclick = (e) => {
  const t = e.target.closest('[data-ev]');
  if (t) oeffneTermin(Number(t.dataset.ev));
};
$('#wartenKalender').onclick = (e) => {
  const t = e.target.closest('[data-ev]');
  if (t) oeffneTermin(Number(t.dataset.ev));
};

$('#orgListe').onclick = (e) => {
  const o = e.target.closest('[data-org]');
  if (o) oeffneOrg(Number(o.dataset.org));
};

$('#neuKnopf').onclick = () => {
  if (zustand.tab === 'kalender') formularTermin();
  else formularNeuesAnliegen();
};

// Klick außerhalb schließt das Blatt
$('#blatt').onclick = (e) => { if (e.target.id === 'blatt') blattZu(); };
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') blattZu(); });

// Alle Aktionen im Blatt
$('#blatt').addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-tu]');
  if (!b) return;
  const { tu, id } = b.dataset;
  b.disabled = true;
  try {
    if (tu === 'blattZu') { blattZu(); return; }

    if (tu === 'zusage')       { await api('POST', `/api/anliegen/${id}/zusage`); return oeffneAnliegen(id); }
    if (tu === 'absage')       { await api('POST', `/api/anliegen/${id}/absage`); blattZu(); return ladeAnliegen(); }
    if (tu === 'zurueckholen') { await api('DELETE', `/api/anliegen/${id}/absage`); blattZu(); return ladeAnliegen(); }
    if (tu === 'zurueckziehen'){ await api('DELETE', `/api/anliegen/${id}`); blattZu(); return ladeAnliegen(); }

    if (tu === 'kommentar') {
      const text = $('#kText').value.trim();
      if (!text) { b.disabled = false; return; }
      const alsOrg = $('#kAlsOrg')?.value || null;
      await api('POST', `/api/anliegen/${id}/kommentar`, { text, alsOrg });
      return oeffneAnliegen(id);
    }
    if (tu === 'melden') {
      const grund = prompt('Was stimmt mit dem Beitrag nicht?') ?? '';
      await api('POST', `/api/anliegen/${id}/melden`, { grund });
      blattZu();
      return melde('Danke, die Meldung ist beim Krafttal-Team.', 'gut');
    }

    if (tu === 'komme') { await api('POST', `/api/events/${id}/komme`); await ladeTermine(); return oeffneTermin(id); }

    if (tu === 'beitreten') {
      const r = await api('POST', `/api/orgs/${id}/beitreten`);
      await ladeOrgs();
      await oeffneOrg(id);
      return melde(r.hinweis, 'gut');
    }
    if (tu === 'austreten') { await api('DELETE', `/api/orgs/${id}/beitreten`); await ladeOrgs(); return oeffneOrg(id); }
    if (tu === 'folgen')    { await api('POST', `/api/orgs/${id}/folgen`); return oeffneOrg(id); }

    if (tu === 'anlegenAnliegen') {
      await api('POST', '/api/anliegen', {
        kategorie: $('#n-kat').value,
        titel: $('#n-titel').value,
        text: $('#n-text').value,
        bedarf: Number($('#n-bedarf').value) || 0,
        alsOrg: $('#n-org')?.value || null,
      });
      blattZu();
      return ladeAnliegen();
    }
    if (tu === 'terminBearbeiten') {
      const { event } = await api('GET', '/api/events/' + id);
      return formularTermin(event);
    }
    if (tu === 'terminLoeschen') {
      if (!confirm('Diesen Termin wirklich löschen? Auch die Zusagen sind dann weg.')) {
        b.disabled = false;
        return;
      }
      await api('DELETE', '/api/events/' + id);
      blattZu();
      await ladeTermine();
      return melde('Termin gelöscht.', 'gut');
    }
    if (tu === 'speichernTermin') {
      await api('PUT', '/api/events/' + id, terminFelder());
      blattZu();
      await ladeTermine();
      return melde('Änderung gespeichert.', 'gut');
    }
    if (tu === 'anlegenTermin') {
      await api('POST', '/api/events', terminFelder());
      blattZu();
      return ladeTermine();
    }
  } catch (err) {
    melde(err.message);
    b.disabled = false;
  }
});

// Admin-Aktionen
$('#adminListe').onclick = async (e) => {
  const b = e.target.closest('button[data-au]');
  if (!b) return;
  const { au, id } = b.dataset;
  b.disabled = true;
  try {
    if (au === 'freischalten') await api('POST', `/api/admin/users/${id}/freischalten`);
    if (au === 'entsperren')   await api('POST', `/api/admin/users/${id}/entsperren`);
    if (au === 'sperren') {
      const grund = prompt('Grund für die Sperre (optional):') ?? '';
      await api('POST', `/api/admin/users/${id}/sperren`, { grund });
    }
    if (au === 'ernennen') await api('POST', `/api/admin/users/${id}/admin`, { admin: true });
    if (au === 'absetzen') await api('POST', `/api/admin/users/${id}/admin`, { admin: false });
    melde('');
    zustand.ich = (await api('GET', '/api/me')).user;
    if (!zustand.ich?.admin) return ladeProfil();
    ladeAdmin();
  } catch (err) { melde(err.message); b.disabled = false; }
};

// ---------- Start ----------

api('GET', '/api/me')
  .then((d) => nachAnmeldung(d.user))
  .catch(() => { melde('Server nicht erreichbar.'); zeigeSeite('start'); });
