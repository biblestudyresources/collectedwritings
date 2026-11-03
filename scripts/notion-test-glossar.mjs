// scripts/notion-test-glossar.mjs
// Mini-Test der Glossar-Datenbank in Notion. Dieses Skript LIEST nur und schreibt nichts.
//
// Aufruf:  npm run notion:test:glossar
// Benötigt NOTION_TOKEN und NOTION_GLOSSAR_DATABASE_ID
// (lokal aus der Datei .env, auf GitHub aus den Secrets).

import { FELD, pruefeEintrag, pruefeGlossar, pruefeSchema } from './fetch-glossar.mjs';
import { ArtikelFehler, plain, wert } from './fetch-notion.mjs';

const NOTION_VERSION = '2025-09-03';
const API = 'https://api.notion.com/v1';
const token = process.env.NOTION_TOKEN;
const databaseId = process.env.NOTION_GLOSSAR_DATABASE_ID;
const ERWARTETE_STATUS = ['Freigegeben'];

if (!token || !databaseId) {
  console.error('NOTION_TOKEN und/oder NOTION_GLOSSAR_DATABASE_ID fehlen.');
  console.error('Lokal: beide Zeilen in die Datei .env schreiben (siehe Anleitung).');
  process.exit(1);
}

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

async function main() {
  console.log('1) Verbindung prüfen …');
  const ich = await notion('/users/me');
  console.log(`   OK, verbunden als: ${ich.name ?? '(ohne Namen)'}`);

  console.log('2) Glossar-Datenbank lesen …');
  const db = await notion(`/databases/${databaseId}`);
  const quelle = db.data_sources?.[0];
  if (!quelle) throw new Error('Die Datenbank hat keine Datenquelle.');
  console.log(`   OK: „${plain(db.title) || '(ohne Titel)'}“`);

  console.log('3) Spalten und Status-Werte prüfen …');
  const info = await notion(`/data_sources/${quelle.id}`);
  const typen = Object.entries(info.properties).map(([n, f]) => `${n} (${f.type})`);
  console.log(`   Spalten in Notion: ${typen.join(' | ')}`);
  try {
    pruefeSchema(info.properties);
    console.log('   OK, alle erwarteten Spalten sind da und haben passende Typen.');
  } catch (e) {
    console.log(`   PROBLEM: ${e.message}`);
  }
  const statusFeld = info.properties[FELD.status];
  const statusWerte = (statusFeld?.status?.options ?? statusFeld?.select?.options ?? []).map((o) => o.name);
  console.log(`   Status-Werte in Notion: ${statusWerte.join(' | ') || '(keine)'}`);
  const fehlendeStatus = ERWARTETE_STATUS.filter((s) => !statusWerte.includes(s));
  if (fehlendeStatus.length) console.log(`   FEHLT bei Status: ${fehlendeStatus.join(', ')}`);

  console.log('4) Einträge lesen …');
  const abfrage = await notion(`/data_sources/${quelle.id}/query`, {
    method: 'POST',
    body: JSON.stringify({ page_size: 100 }),
  });
  const seiten = abfrage.results;
  if (seiten.length === 0) {
    console.log('   Die Datenbank ist leer. Bitte Probeeinträge anlegen und erneut testen.');
    return;
  }
  console.log(`   ${seiten.length} Einträge gelesen${abfrage.has_more ? ' (es gibt mehr, der Test liest nur die ersten 100)' : ''}.`);

  console.log('5) Prüfung der freigegebenen Einträge (so, wie sie der Abruf prüfen würde) …');
  const gueltig = [];
  let probleme = 0;
  for (const s of seiten) {
    if (wert(s.properties[FELD.status]) !== 'Freigegeben') continue;
    const titel = Object.values(s.properties).find((f) => f.type === 'title');
    const name = wert(titel) || '(ohne Begriff)';
    try {
      const meta = pruefeEintrag(s);
      gueltig.push(meta);
      console.log(`   OK        ${meta.begriff}${meta.varianten.length ? ` (auch: ${meta.varianten.join(', ')})` : ''}`);
    } catch (e) {
      if (!(e instanceof ArtikelFehler)) throw e;
      probleme++;
      console.log(`   PROBLEM   ${name}: ${e.message}`);
    }
  }
  for (const f of pruefeGlossar(gueltig).fehler) {
    probleme++;
    console.log(`   PROBLEM   ${f}`);
  }
  const entwuerfe = seiten.filter((s) => wert(s.properties[FELD.status]) !== 'Freigegeben').length;
  console.log(`   ${gueltig.length} fehlerfrei, ${probleme} Problem(e), ${entwuerfe} noch nicht freigegeben (werden nicht geprüft).`);

  console.log('\nTest beendet. Der Seiteninhalt der Einträge wird erst beim Abruf (npm run fetch:glossar) geprüft.');
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
