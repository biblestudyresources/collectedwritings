// scripts/notion-test.mjs
// Mini-Test der Notion-Anbindung. Dieses Skript LIEST nur und schreibt nichts.
//
// Aufruf:  npm run notion:test
// Benötigt die Umgebungsvariablen NOTION_TOKEN und NOTION_DATABASE_ID
// (lokal aus der Datei .env, auf GitHub aus den Secrets).

const NOTION_VERSION = '2025-09-03';
const API = 'https://api.notion.com/v1';

const token = process.env.NOTION_TOKEN;
const databaseId = process.env.NOTION_DATABASE_ID;

// Felder und Status-Werte laut Spezifikation
const ERWARTETE_FELDER = [
  'Name', 'ID', 'Titel (DE)', 'Titel (EN)', 'Band',
  'Stichwörter', 'Status', 'Übersetzt von', 'Geprüft von',
];
const ERWARTETE_STATUS = [
  'Übersetzung', 'Zweitprüfung ausstehend',
  'Überarbeitung d. Rückmeldung', 'Freigegeben',
];

if (!token || !databaseId) {
  console.error('NOTION_TOKEN und/oder NOTION_DATABASE_ID fehlen.');
  console.error('Lokal: beide Zeilen in die Datei .env schreiben (siehe Anleitung).');
  process.exit(1);
}

// Ein Aufruf an die Notion-Schnittstelle; bei Fehlern kommt eine verständliche Meldung.
async function notion(pfad, optionen = {}) {
  const antwort = await fetch(API + pfad, {
    ...optionen,
    headers: {
      Authorization: `Bearer ${token}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
  });
  const daten = await antwort.json().catch(() => ({}));
  if (!antwort.ok) {
    const fehler = new Error(`Notion antwortet mit ${antwort.status}: ${daten.message ?? 'ohne Text'}`);
    fehler.status = antwort.status;
    throw fehler;
  }
  return daten;
}

// Notion liefert Text in Stücken; hier werden sie zusammengesetzt.
const text = (teile) => (teile ?? []).map((t) => t.plain_text).join('');

// Liest den Wert eines Feldes, egal welchen Typs.
function wert(feld) {
  switch (feld?.type) {
    case 'title': return text(feld.title);
    case 'rich_text': return text(feld.rich_text);
    case 'select': return feld.select?.name ?? '';
    case 'status': return feld.status?.name ?? '';
    case 'multi_select': return feld.multi_select.map((o) => o.name).join(', ');
    case 'people': return feld.people.map((p) => p.name ?? '(Person)').join(', ');
    default: return '';
  }
}

async function main() {
  console.log('1) Verbindung prüfen …');
  const ich = await notion('/users/me');
  console.log(`   OK, verbunden als: ${ich.name ?? '(ohne Namen)'}`);

  console.log('2) Datenbank lesen …');
  const db = await notion(`/databases/${databaseId}`);
  const quelle = db.data_sources?.[0];
  if (!quelle) throw new Error('Die Datenbank hat keine Datenquelle.');
  console.log(`   OK: „${text(db.title) || '(ohne Titel)'}“`);
  if (db.data_sources.length > 1) {
    console.log('   Achtung: mehrere Datenquellen, es wird die erste benutzt.');
  }

  console.log('3) Felder und Status-Werte prüfen …');
  const info = await notion(`/data_sources/${quelle.id}`);
  const vorhanden = Object.keys(info.properties);
  const fehlendeFelder = ERWARTETE_FELDER.filter((f) => !vorhanden.includes(f));
  if (fehlendeFelder.length) {
    console.log(`   FEHLT: ${fehlendeFelder.join(', ')}`);
  } else {
    console.log('   OK, alle erwarteten Felder sind da.');
  }
  const statusFeld = info.properties['Status'];
  const statusWerte = (statusFeld?.status?.options ?? statusFeld?.select?.options ?? []).map((o) => o.name);
  const fehlendeStatus = ERWARTETE_STATUS.filter((s) => !statusWerte.includes(s));
  console.log(`   Status-Werte in Notion: ${statusWerte.join(' | ') || '(keine)'}`);
  if (fehlendeStatus.length) console.log(`   FEHLT bei Status: ${fehlendeStatus.join(', ')}`);

  console.log('4) Artikel lesen …');
  const abfrage = await notion(`/data_sources/${quelle.id}/query`, {
    method: 'POST',
    body: JSON.stringify({ page_size: 100 }),
  });
  const seiten = abfrage.results;
  if (seiten.length === 0) {
    console.log('   Die Datenbank ist leer. Bitte einen Probeartikel anlegen und erneut testen.');
    return;
  }
  console.log(`   ${seiten.length} Artikel gelesen${abfrage.has_more ? ' (es gibt mehr, der Test liest nur die ersten 100)' : ''}.`);
  const proStatus = {};
  for (const s of seiten) {
    const status = wert(s.properties['Status']) || '(leer)';
    proStatus[status] = (proStatus[status] ?? 0) + 1;
  }
  for (const [status, anzahl] of Object.entries(proStatus)) {
    console.log(`   ${status}: ${anzahl}`);
  }

  console.log('5) Seiteninhalt lesen …');
  const probe = seiten.find((s) => wert(s.properties['Status']) === 'Freigegeben') ?? seiten[0];
  const name = wert(probe.properties['Name']) || wert(probe.properties['Titel (DE)']) || '(ohne Namen)';
  const bloecke = await notion(`/blocks/${probe.id}/children?page_size=100`);
  const ueberschriften = bloecke.results
    .filter((b) => b.type === 'heading_1')
    .map((b) => text(b.heading_1.rich_text));
  console.log(`   Seite „${name}“: ${bloecke.results.length} Blöcke auf oberster Ebene.`);
  console.log(`   H1-Überschriften: ${ueberschriften.join(' | ') || '(keine)'}`);

  console.log('\nTest bestanden: Token, Datenbank und Seiteninhalt sind lesbar.');
}

main().catch((fehler) => {
  console.error(`\nFehler: ${fehler.message}`);
  if (fehler.status === 401) console.error('Hinweis: Das Token ist falsch oder abgelaufen.');
  if (fehler.status === 404) {
    console.error('Hinweis: Entweder stimmt die Datenbank-ID nicht, oder die Datenbank ist für die Verbindung nicht freigegeben.');
  }
  if (fehler.status === 403) console.error('Hinweis: Der Verbindung fehlen Rechte (sie braucht „Inhalt lesen“).');
  process.exit(1);
});
