// scripts/fetch-notion.mjs
// Holt die freigegebenen Artikel aus Notion und schreibt sie als Markdown-Dateien.
// Regeln: siehe Dokument „Spezifikation: Felder, Seitenaufbau und Prüfregeln“.
//
// Aufruf:  npm run fetch:notion            (schreibt nach content-notion/)
//          node scripts/fetch-notion.mjs mein-ordner
//
// Bei jedem Fehler wird NICHTS geschrieben und das Skript endet mit Fehlercode 1,
// damit der Build abbricht und die bisherige Website online bleibt.
// Dieses Skript liest nur aus Notion. Es schreibt nie nach Notion.

import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const NOTION_VERSION = '2025-09-03';
const API = 'https://api.notion.com/v1';
const FREIGEGEBEN = 'Freigegeben';

const ABSCHNITT_DEUTSCH = 'Deutscher Text';
const ABSCHNITT_ENGLISCH = 'English';
const ABSCHNITT_EILIG = 'Für den eiligen Leser';

const PFLICHTFELDER = ['Name', 'ID', 'Titel (DE)', 'Titel (EN)', 'Band', 'Übersetzt von', 'Status'];
const ALLE_FELDER = [...PFLICHTFELDER, 'Stichwörter', 'Geprüft von'];

// Fehler, die zu genau einem Artikel gehören (mit verständlicher Meldung)
export class ArtikelFehler extends Error {}
// Fehler bei der Verbindung zu Notion
export class NotionFehler extends Error {}

const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const kurz = (s) => (s.length > 40 ? `${s.slice(0, 40)}…` : s);

// ---------------------------------------------------------------------------
// Notion-Schnittstelle
// ---------------------------------------------------------------------------

function erzeugeClient(token) {
  async function notion(pfad, optionen = {}) {
    for (let versuch = 1; versuch <= 5; versuch++) {
      let antwort;
      try {
        antwort = await fetch(API + pfad, {
          ...optionen,
          headers: {
            Authorization: `Bearer ${token}`,
            'Notion-Version': NOTION_VERSION,
            'Content-Type': 'application/json',
          },
        });
      } catch (e) {
        if (versuch === 5) {
          throw new NotionFehler(`Die Notion-Schnittstelle ist nicht erreichbar (${e.cause?.code ?? e.message}).`);
        }
        await warte(1000 * versuch);
        continue;
      }
      if ([429, 500, 502, 503, 504].includes(antwort.status) && versuch < 5) {
        const sekunden = Number(antwort.headers.get('retry-after')) || versuch;
        await warte(sekunden * 1000);
        continue;
      }
      const daten = await antwort.json().catch(() => ({}));
      if (!antwort.ok) {
        throw new NotionFehler(`Notion antwortet mit ${antwort.status}: ${daten.message ?? 'ohne Text'}`);
      }
      return daten;
    }
  }

  async function alleKinder(blockId) {
    const ergebnis = [];
    let cursor;
    do {
      const frage = `?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`;
      const antwort = await notion(`/blocks/${blockId}/children${frage}`);
      ergebnis.push(...antwort.results);
      cursor = antwort.has_more ? antwort.next_cursor : undefined;
    } while (cursor);
    return ergebnis;
  }

  return { notion, alleKinder };
}

// ---------------------------------------------------------------------------
// Feldwerte lesen
// ---------------------------------------------------------------------------

const plain = (teile) => (teile ?? []).map((t) => t.plain_text).join('');

export function wert(feld) {
  switch (feld?.type) {
    case 'title': return plain(feld.title).trim();
    case 'rich_text': return plain(feld.rich_text).trim();
    case 'select': return feld.select?.name ?? '';
    case 'status': return feld.status?.name ?? '';
    default: return '';
  }
}
const personen = (feld) => (feld?.type === 'people' ? feld.people.map((p) => p.id) : []);
const mehrfach = (feld) => (feld?.type === 'multi_select' ? feld.multi_select.map((o) => o.name) : []);

// ---------------------------------------------------------------------------
// Text und Blöcke in Markdown umwandeln
// ---------------------------------------------------------------------------

// Sonderzeichen entschärfen, aber Fußnotenmarken wie [^1] stehen lassen.
export function maskiere(text) {
  return text
    .split(/(\[\^[^\]\s]+\])/)
    .map((teil, i) => (i % 2 === 1 ? teil : teil.replace(/([\\`*_\[\]<>])/g, '\\$1')))
    .join('');
}

function pruefeLink(href) {
  if (/^(https?:\/\/|mailto:)/i.test(href) && !/notion\.(so|site)/i.test(href)) {
    return href.replace(/\(/g, '%28').replace(/\)/g, '%29');
  }
  throw new ArtikelFehler(`Nicht erlaubter Link („${kurz(href)}“). Erlaubt sind nur Web- und Mail-Adressen, keine Links auf Notion-Seiten.`);
}

export function inlineMarkdown(teile) {
  return teile
    .map((t) => {
      if (t.type !== 'text') {
        throw new ArtikelFehler(`Nicht unterstützter Textbestandteil („${t.type}“, zum Beispiel Erwähnung oder Formel) bei „${kurz(t.plain_text)}“.`);
      }
      const a = t.annotations ?? {};
      if (a.code || a.strikethrough || a.underline) {
        throw new ArtikelFehler(`Nicht unterstützte Formatierung (Code, durchgestrichen oder unterstrichen) bei „${kurz(t.plain_text)}“.`);
      }
      const maskiert = maskiere(t.plain_text);
      const kern = maskiert.trim();
      if (!kern) return maskiert;
      const vor = maskiert.match(/^\s*/)[0];
      const nach = maskiert.match(/\s*$/)[0];
      let r = kern;
      if (a.bold && a.italic) r = `***${r}***`;
      else if (a.bold) r = `**${r}**`;
      else if (a.italic) r = `*${r}*`;
      if (t.href) r = `[${r}](${pruefeLink(t.href)})`;
      return vor + r + nach;
    })
    .join('');
}

// Absatztext mit Zeilenumbrüchen; Zeilenanfänge, die Markdown als Liste oder Überschrift lesen würde, werden entschärft.
function absatzText(teile) {
  let s = inlineMarkdown(teile);
  s = s.replace(/^(#{1,6}\s|[-+]\s|\d+[.)]\s)/gm, '\\$1');
  return s.replace(/\n/g, '  \n');
}

function nichtUnterstuetzt(art) {
  return new ArtikelFehler(`Nicht unterstützter Block („${art}“).`);
}

// Wandelt eine Liste von Notion-Blöcken in Teile um: { typ: 'absatz' | 'liste', text }
export async function konvertiere(bloecke, ctx, tiefe = 0) {
  const teile = [];
  let nummer = 0;
  for (const b of bloecke) {
    if (b.type !== 'numbered_list_item') nummer = 0;
    switch (b.type) {
      case 'paragraph': {
        const klar = plain(b.paragraph.rich_text);
        if (!klar.trim()) break; // leere Absätze ignorieren
        if (b.has_children) throw nichtUnterstuetzt('Absatz mit eingerückten Unterblöcken');
        const definition = klar.match(/^\[\^([^\]\s]+)\]:\s*\S/);
        if (definition) ctx.definitionen.push(definition[1]);
        else for (const m of klar.matchAll(/\[\^([^\]\s]+)\]/g)) ctx.verweise.push(m[1]);
        teile.push({ typ: 'absatz', text: absatzText(b.paragraph.rich_text) });
        break;
      }
      case 'heading_1':
        throw new ArtikelFehler('Überschrift 1 ist im veröffentlichten Text nicht erlaubt (nur Überschrift 2 bis 4).');
      case 'heading_2':
      case 'heading_3':
      case 'heading_4': {
        if (b.has_children) throw nichtUnterstuetzt('aufklappbare Überschrift');
        const stufe = Number(b.type.slice(-1));
        const klar = plain(b[b.type].rich_text);
        for (const m of klar.matchAll(/\[\^([^\]\s]+)\]/g)) ctx.verweise.push(m[1]);
        teile.push({ typ: 'absatz', text: `${'#'.repeat(stufe)} ${inlineMarkdown(b[b.type].rich_text).replace(/\n/g, ' ')}` });
        break;
      }
      case 'bulleted_list_item':
      case 'numbered_list_item': {
        const nr = b.type === 'numbered_list_item' ? ++nummer : 0;
        const marke = nr ? `${nr}. ` : '- ';
        const klar = plain(b[b.type].rich_text);
        for (const m of klar.matchAll(/\[\^([^\]\s]+)\]/g)) ctx.verweise.push(m[1]);
        const zeilen = inlineMarkdown(b[b.type].rich_text).split('\n');
        let text = marke + zeilen.map((z, i) => (i === 0 ? z : `    ${z}`)).join('\n');
        if (b.has_children) {
          const kinder = await ctx.alleKinder(b.id);
          const unter = await konvertiere(kinder, ctx, tiefe + 1);
          if (unter.some((u) => u.typ !== 'liste')) {
            throw nichtUnterstuetzt('Unterblock in einer Liste, der keine Liste ist');
          }
          if (unter.length) {
            text += `\n${unter.map((u) => u.text.split('\n').map((z) => `    ${z}`).join('\n')).join('\n')}`;
          }
        }
        teile.push({ typ: 'liste', text });
        break;
      }
      case 'quote': {
        if (b.has_children) throw nichtUnterstuetzt('Zitat mit Unterblöcken');
        const klar = plain(b.quote.rich_text);
        for (const m of klar.matchAll(/\[\^([^\]\s]+)\]/g)) ctx.verweise.push(m[1]);
        const text = inlineMarkdown(b.quote.rich_text).split('\n').map((z) => `> ${z}`).join('\n');
        teile.push({ typ: 'absatz', text });
        break;
      }
      case 'divider':
        teile.push({ typ: 'absatz', text: '---' });
        break;
      case 'callout':
        break; // Callouts sind Hinweise für die Redaktion und werden nie übernommen
      default:
        throw nichtUnterstuetzt(b.type);
    }
  }
  return teile;
}

export function zuText(teile) {
  let ergebnis = '';
  teile.forEach((t, i) => {
    if (i > 0) ergebnis += teile[i - 1].typ === 'liste' && t.typ === 'liste' ? '\n' : '\n\n';
    ergebnis += t.text;
  });
  return ergebnis;
}

// Prüft Fußnoten: jede Marke hat einen Text, jeder Text eine Marke, keine doppelten Nummern.
export function pruefeFussnoten(ctx, abschnitt) {
  const doppelt = ctx.definitionen.filter((n, i) => ctx.definitionen.indexOf(n) !== i);
  if (doppelt.length) throw new ArtikelFehler(`Fußnote [^${doppelt[0]}] ist im Abschnitt „${abschnitt}“ doppelt definiert.`);
  for (const n of new Set(ctx.verweise)) {
    if (!ctx.definitionen.includes(n)) throw new ArtikelFehler(`Fußnotenmarke [^${n}] hat im Abschnitt „${abschnitt}“ keinen Fußnotentext.`);
  }
  for (const n of ctx.definitionen) {
    if (!ctx.verweise.includes(n)) throw new ArtikelFehler(`Fußnotentext [^${n}]: hat im Abschnitt „${abschnitt}“ keine Marke im Text.`);
  }
}

// ---------------------------------------------------------------------------
// Ein Artikel
// ---------------------------------------------------------------------------

const ID_FORMAT = /^(\d+)_([A-Za-z]+)_(\d+)$/;

export function pruefeFelder(seite) {
  const p = seite.properties;
  const werte = {
    name: wert(p['Name']),
    id: wert(p['ID']),
    titelDe: wert(p['Titel (DE)']),
    titelEn: wert(p['Titel (EN)']),
    band: wert(p['Band']),
    status: wert(p['Status']),
    uebersetzer: personen(p['Übersetzt von']),
    pruefer: personen(p['Geprüft von']),
    tags: mehrfach(p['Stichwörter']),
  };
  const leer = [];
  if (!werte.name) leer.push('Name');
  if (!werte.id) leer.push('ID');
  if (!werte.titelDe) leer.push('Titel (DE)');
  if (!werte.titelEn) leer.push('Titel (EN)');
  if (!werte.band) leer.push('Band');
  if (!werte.uebersetzer.length) leer.push('Übersetzt von');
  if (!werte.status) leer.push('Status');
  if (leer.length) throw new ArtikelFehler(`Pflichtfeld fehlt oder ist leer: ${leer.join(', ')}.`);

  if (werte.status !== FREIGEGEBEN) {
    throw new ArtikelFehler(`Status ist „${werte.status}“, obwohl nur freigegebene Artikel übertragen werden sollten.`);
  }
  const m = werte.id.match(ID_FORMAT);
  if (!m) throw new ArtikelFehler(`Die ID „${werte.id}“ hat nicht das Format <Band>_<Kürzel>_<Position>, zum Beispiel 30_Exp_10.`);
  const bandNummer = Number(m[1]);
  const bm = werte.band.match(/^Vol\.?\s*(\d+)/i);
  if (!bm || Number(bm[1]) !== bandNummer) {
    throw new ArtikelFehler(`Die Bandnummer in der ID (${bandNummer}) passt nicht zum Feld „Band“ („${werte.band}“).`);
  }
  if (werte.pruefer.some((id) => werte.uebersetzer.includes(id))) {
    throw new ArtikelFehler('„Geprüft von“ darf nicht dieselbe Person sein wie „Übersetzt von“.');
  }
  const titelTeil = werte.band.match(/^Vol\.?\s*\d+\s*:\s*(.+)$/i);
  return {
    ...werte,
    bandNummer,
    kuerzel: m[2],
    position: Number(m[3]),
    bandTitel: titelTeil ? titelTeil[1].trim() : werte.band,
  };
}

// Liest die Abschnitte (H1-Toggles) einer Seite und wandelt „Deutscher Text“ und „Für den eiligen Leser“ um.
export async function liesAbschnitte(seiteId, client) {
  const oben = await client.alleKinder(seiteId);
  const gesehen = new Set();
  const ergebnis = { deutsch: '', eilig: '' };
  for (const b of oben) {
    if (b.type === 'callout') continue;
    if (b.type === 'paragraph' && !plain(b.paragraph.rich_text).trim() && !b.has_children) continue;
    if (b.type !== 'heading_1') {
      throw new ArtikelFehler(`Auf oberster Ebene steht ein Block („${b.type}“) außerhalb der drei Abschnitte. Erlaubt sind nur Callouts und die drei Überschriften 1.`);
    }
    const name = plain(b.heading_1.rich_text).trim();
    if (![ABSCHNITT_DEUTSCH, ABSCHNITT_ENGLISCH, ABSCHNITT_EILIG].includes(name)) {
      throw new ArtikelFehler(`Unbekannter Abschnitt „${name}“. Erlaubt sind „${ABSCHNITT_DEUTSCH}“, „${ABSCHNITT_ENGLISCH}“ und „${ABSCHNITT_EILIG}“.`);
    }
    if (gesehen.has(name)) throw new ArtikelFehler(`Der Abschnitt „${name}“ kommt doppelt vor.`);
    gesehen.add(name);
    if (name === ABSCHNITT_ENGLISCH) continue; // wird nicht gelesen und nicht abgerufen
    if (!b.heading_1.is_toggleable) {
      throw new ArtikelFehler(`Die Überschrift „${name}“ muss eine aufklappbare Überschrift (Toggle) sein, sonst liegt der Text nicht darunter.`);
    }
    const ctx = { definitionen: [], verweise: [], alleKinder: client.alleKinder };
    const kinder = b.has_children ? await client.alleKinder(b.id) : [];
    const teile = await konvertiere(kinder, ctx);
    if (name === ABSCHNITT_EILIG && (ctx.definitionen.length || ctx.verweise.length)) {
      // Beide Texte stehen auf derselben Seite; gleiche Fußnotennummern würden sich überschneiden.
      throw new ArtikelFehler(`Im Abschnitt „${ABSCHNITT_EILIG}“ sind keine Fußnoten erlaubt.`);
    }
    pruefeFussnoten(ctx, name);
    ergebnis[name === ABSCHNITT_DEUTSCH ? 'deutsch' : 'eilig'] = zuText(teile);
  }
  if (!gesehen.has(ABSCHNITT_DEUTSCH)) throw new ArtikelFehler(`Der Abschnitt „${ABSCHNITT_DEUTSCH}“ fehlt.`);
  if (!ergebnis.deutsch.trim()) throw new ArtikelFehler(`Der Abschnitt „${ABSCHNITT_DEUTSCH}“ ist leer.`);
  return ergebnis;
}

export function baueDatei(meta, text) {
  const kopf = [
    '---',
    `id: ${JSON.stringify(meta.id)}`,
    `title: ${JSON.stringify(meta.titelDe)}`,
    `volume: ${meta.bandNummer}`,
    `volumeTitle: ${JSON.stringify(meta.bandTitel)}`,
    `position: ${meta.position}`,
    `tags: ${JSON.stringify(meta.tags)}`,
    'status: "freigegeben"',
    '---',
    '',
  ];
  return `${kopf.join('\n')}\n${text.trim()}\n`;
}

// Prüfungen über alle Artikel hinweg. Gibt Fehler und Hinweise zurück.
export function pruefeBaende(artikel) {
  const fehler = [];
  const hinweise = [];
  const ids = new Map();
  for (const a of artikel) {
    if (ids.has(a.id)) fehler.push(`${a.id}: Die ID kommt doppelt vor (auch bei „${ids.get(a.id)}“).`);
    ids.set(a.id, a.name);
  }
  const baende = new Map();
  for (const a of artikel) {
    if (!baende.has(a.bandNummer)) baende.set(a.bandNummer, []);
    baende.get(a.bandNummer).push(a);
  }
  for (const [nr, liste] of baende) {
    const kuerzel = new Set(liste.map((a) => a.kuerzel));
    if (kuerzel.size > 1) {
      fehler.push(`Band ${nr}: Die Kürzel in den IDs sind nicht einheitlich (${[...kuerzel].join(', ')}).`);
    }
    const positionen = new Map();
    for (const a of liste) {
      if (positionen.has(a.position)) fehler.push(`${a.id}: Die Position ${a.position} kommt in Band ${nr} doppelt vor.`);
      positionen.set(a.position, true);
    }
    const sortiert = [...positionen.keys()].sort((x, y) => x - y);
    for (let i = 1; i < sortiert.length; i++) {
      if (sortiert[i] - sortiert[i - 1] > 10) {
        hinweise.push(`Band ${nr}: Lücke in der Positionszählung zwischen ${sortiert[i - 1]} und ${sortiert[i]}.`);
      }
    }
  }
  return { fehler, hinweise };
}

// ---------------------------------------------------------------------------
// Hauptablauf
// ---------------------------------------------------------------------------

export async function laufe({ token, databaseId, ausgabe, log = console.log }) {
  const client = erzeugeClient(token);
  const { notion } = client;

  const ziel = path.resolve(ausgabe);
  if (path.basename(ziel) === 'content-test' || ziel === process.cwd()) {
    throw new Error(`Der Ausgabeordner „${ausgabe}“ ist nicht erlaubt (er würde Testdaten oder das Projekt überschreiben).`);
  }
  const zielEilig = `${ziel}-eilig`;

  const db = await notion(`/databases/${databaseId}`);
  const quelle = db.data_sources?.[0];
  if (!quelle) throw new NotionFehler('Die Datenbank hat keine Datenquelle.');
  const schema = await notion(`/data_sources/${quelle.id}`);
  const fehlend = ALLE_FELDER.filter((f) => !(f in schema.properties));
  if (fehlend.length) throw new NotionFehler(`In der Datenbank fehlen Felder: ${fehlend.join(', ')}.`);

  const statusArt = schema.properties['Status'].type; // 'select' oder 'status'
  if (!['select', 'status'].includes(statusArt)) {
    throw new NotionFehler(`Das Feld „Status“ hat den Typ „${statusArt}“, erwartet wird „Auswahl“.`);
  }

  // Serverseitiger Filter, alle Seiten holen
  const seiten = [];
  let cursor;
  do {
    const antwort = await notion(`/data_sources/${quelle.id}/query`, {
      method: 'POST',
      body: JSON.stringify({
        page_size: 100,
        filter: { property: 'Status', [statusArt]: { equals: FREIGEGEBEN } },
        ...(cursor ? { start_cursor: cursor } : {}),
      }),
    });
    seiten.push(...antwort.results);
    cursor = antwort.has_more ? antwort.next_cursor : undefined;
  } while (cursor);
  log(`${seiten.length} freigegebene Artikel gefunden.`);

  const fehler = [];
  const artikel = [];
  for (const seite of seiten) {
    const bezeichnung = wert(seite.properties['ID']) || wert(seite.properties['Name']) || seite.id;
    try {
      const meta = pruefeFelder(seite);
      const abschnitte = await liesAbschnitte(seite.id, client);
      artikel.push({
        ...meta,
        deutsch: abschnitte.deutsch,
        eilig: abschnitte.eilig,
        zuletztBearbeitet: seite.last_edited_time,
      });
    } catch (e) {
      if (e instanceof ArtikelFehler) fehler.push(`${bezeichnung}: ${e.message}`);
      else throw e;
    }
  }

  const bandPruefung = pruefeBaende(artikel);
  fehler.push(...bandPruefung.fehler);
  for (const h of bandPruefung.hinweise) log(`Hinweis: ${h}`);

  if (fehler.length) return { ok: false, fehler, artikel: [] };

  // Alles in Ordnung: jetzt erst schreiben
  await rm(ziel, { recursive: true, force: true });
  await rm(zielEilig, { recursive: true, force: true });
  await mkdir(ziel, { recursive: true });
  for (const a of artikel) {
    await writeFile(path.join(ziel, `${a.id}.md`), baueDatei(a, a.deutsch), 'utf8');
    if (a.eilig.trim()) {
      await mkdir(zielEilig, { recursive: true });
      await writeFile(path.join(zielEilig, `${a.id}.md`), `${a.eilig.trim()}\n`, 'utf8');
    }
  }
  const protokoll = {
    erzeugt: new Date().toISOString(),
    artikel: artikel.map((a) => ({ id: a.id, zuletztBearbeitet: a.zuletztBearbeitet })),
  };
  await writeFile('notion-manifest.json', `${JSON.stringify(protokoll, null, 2)}\n`, 'utf8');
  return { ok: true, fehler: [], artikel };
}

// Nur ausführen, wenn die Datei direkt gestartet wird (nicht beim Import in Tests)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const token = process.env.NOTION_TOKEN;
  const databaseId = process.env.NOTION_DATABASE_ID;
  if (!token || !databaseId) {
    console.error('NOTION_TOKEN und/oder NOTION_DATABASE_ID fehlen.');
    process.exit(1);
  }
  try {
    const ergebnis = await laufe({ token, databaseId, ausgabe: process.argv[2] ?? 'content-notion' });
    if (!ergebnis.ok) {
      console.error(`\n${ergebnis.fehler.length} Fehler. Es wurde nichts geschrieben:\n`);
      for (const f of ergebnis.fehler) console.error(`  • ${f}`);
      process.exit(1);
    }
    console.log(`${ergebnis.artikel.length} Artikel übernommen: ${ergebnis.artikel.map((a) => a.id).join(', ') || '(keine)'}`);
  } catch (e) {
    console.error(`\nFehler: ${e.message}`);
    if (e instanceof NotionFehler) console.error('Die bisherige Website bleibt online.');
    process.exit(1);
  }
}
