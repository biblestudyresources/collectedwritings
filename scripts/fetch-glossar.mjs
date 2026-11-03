// scripts/fetch-glossar.mjs
// Holt die freigegebenen Glossareinträge aus Notion und schreibt sie als Markdown-Dateien.
// Arbeitet nach demselben Muster wie fetch-notion.mjs (Artikel).
//
// Aufruf:  npm run fetch:glossar            (schreibt nach content-notion-glossar/)
//          node scripts/fetch-glossar.mjs mein-ordner
//
// Bei jedem Fehler wird NICHTS geschrieben und das Skript endet mit Fehlercode 1,
// damit der Build abbricht und die bisherige Website online bleibt.
// Dieses Skript liest nur aus Notion. Es schreibt nie nach Notion.
//
// Pflicht für jeden freigegebenen Eintrag: Begriff, Kurzerklärung, Autor und Zweitkorrektor,
// wobei Autor und Zweitkorrektor verschiedene Personen sein müssen.
// Die Namen werden nur geprüft, sie erscheinen nicht auf der Website.

import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  ArtikelFehler, NotionFehler, erzeugeClient, konvertiere, zuText, wert,
} from './fetch-notion.mjs';

const FREIGEGEBEN = 'Freigegeben';

export const FELD = {
  varianten: 'Schreibvarianten',
  kurz: 'Kurzerklärung',
  status: 'Status',
  autor: 'Autor',
  korrektor: 'Zweitkorrektor',
};
const ALLE_SPALTEN = Object.values(FELD);
const PERSONENTYPEN = ['people', 'rich_text', 'select', 'multi_select'];
const KURZ_ZU_LANG = 400; // nur ein Hinweis: das Fenster soll kurz bleiben

// ---------------------------------------------------------------------------
// Kleine Helfer (exportiert, damit sie getestet werden können)
// ---------------------------------------------------------------------------

/** Dateiname und Sprungmarke aus dem Begriff: „Menschensohn“ -> menschensohn, „Gnadenzeit“ -> gnadenzeit */
export function dateiKennung(begriff) {
  return begriff
    .normalize('NFC')
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const leerzeichen = (s) => s.replace(/\s+/g, ' ').trim();

/** Schreibvarianten: durch Komma, Semikolon oder Zeilenumbruch getrennt; ohne Doppelte und ohne den Begriff selbst. */
export function liesVarianten(text, begriff) {
  const teile = text.split(/[,;\n]/).map(leerzeichen).filter(Boolean);
  return [...new Set(teile)].filter((v) => v !== begriff);
}

/** Kurzerklärung: Zeilenumbrüche im Notion-Feld werden zu Absätzen (Leerzeile dazwischen). */
export function liesKurzerklaerung(text) {
  return text.split('\n').map((z) => z.trim()).filter(Boolean).join('\n\n');
}

/** Wer steht im Feld? Gibt vergleichbare Schlüssel zurück (Notion-Konto-ID oder Name in Kleinbuchstaben). */
export function wer(feld) {
  switch (feld?.type) {
    case 'people': return feld.people.map((p) => p.id);
    case 'rich_text': return (feld.rich_text ?? []).map((t) => t.plain_text).join('').split(/[,;\n]/).map((n) => leerzeichen(n).toLowerCase()).filter(Boolean);
    case 'select': return feld.select?.name ? [leerzeichen(feld.select.name).toLowerCase()] : [];
    case 'multi_select': return feld.multi_select.map((o) => leerzeichen(o.name).toLowerCase());
    default: return [];
  }
}

// ---------------------------------------------------------------------------
// Datenbank-Aufbau prüfen
// ---------------------------------------------------------------------------

export function pruefeSchema(properties) {
  const titelName = Object.keys(properties).find((n) => properties[n].type === 'title');
  if (!titelName) throw new NotionFehler('Die Datenbank hat keine Titelspalte.');
  const fehlend = ALLE_SPALTEN.filter((f) => !(f in properties));
  if (fehlend.length) throw new NotionFehler(`In der Glossar-Datenbank fehlen Spalten: ${fehlend.join(', ')}.`);

  for (const f of [FELD.varianten, FELD.kurz]) {
    if (properties[f].type !== 'rich_text') {
      throw new NotionFehler(`Die Spalte „${f}“ hat den Typ „${properties[f].type}“, erwartet wird „Text“.`);
    }
  }
  const statusArt = properties[FELD.status].type;
  if (!['select', 'status'].includes(statusArt)) {
    throw new NotionFehler(`Die Spalte „Status“ hat den Typ „${statusArt}“, erwartet wird „Auswahl“.`);
  }
  for (const f of [FELD.autor, FELD.korrektor]) {
    if (!PERSONENTYPEN.includes(properties[f].type)) {
      throw new NotionFehler(`Die Spalte „${f}“ hat den Typ „${properties[f].type}“. Erlaubt sind Person, Text oder Auswahl.`);
    }
  }
  if (properties[FELD.autor].type !== properties[FELD.korrektor].type) {
    throw new NotionFehler('„Autor“ und „Zweitkorrektor“ müssen denselben Spaltentyp haben, damit sie verglichen werden können.');
  }
  return { titelName, statusArt };
}

// ---------------------------------------------------------------------------
// Ein Eintrag
// ---------------------------------------------------------------------------

export function pruefeEintrag(seite) {
  const p = seite.properties;
  const titel = Object.values(p).find((f) => f.type === 'title');
  const begriff = leerzeichen(wert(titel));
  const werte = {
    begriff,
    kurz: liesKurzerklaerung(wert(p[FELD.kurz])),
    status: wert(p[FELD.status]),
    autor: wer(p[FELD.autor]),
    korrektor: wer(p[FELD.korrektor]),
  };
  const leer = [];
  if (!werte.begriff) leer.push('Begriff');
  if (!werte.kurz) leer.push(FELD.kurz);
  if (!werte.status) leer.push(FELD.status);
  if (!werte.autor.length) leer.push(FELD.autor);
  if (!werte.korrektor.length) leer.push(FELD.korrektor);
  if (leer.length) throw new ArtikelFehler(`Pflichtfeld fehlt oder ist leer: ${leer.join(', ')}.`);

  if (werte.status !== FREIGEGEBEN) {
    throw new ArtikelFehler(`Status ist „${werte.status}“, obwohl nur freigegebene Einträge übertragen werden sollten.`);
  }
  if (werte.korrektor.some((k) => werte.autor.includes(k))) {
    throw new ArtikelFehler(`„${FELD.korrektor}“ darf nicht dieselbe Person sein wie „${FELD.autor}“.`);
  }
  const kennung = dateiKennung(begriff);
  if (!kennung) throw new ArtikelFehler('Der Begriff enthält keine lateinischen Buchstaben oder Ziffern, daraus lässt sich keine Dateikennung bilden.');

  const hinweise = [];
  if (werte.kurz.length > KURZ_ZU_LANG) {
    hinweise.push(`${begriff}: Die Kurzerklärung hat ${werte.kurz.length} Zeichen. Sie erscheint im kleinen Fenster; Ausführliches gehört in den Seiteninhalt.`);
  }
  return {
    begriff,
    varianten: liesVarianten(wert(p[FELD.varianten]), begriff),
    kurz: werte.kurz,
    kennung,
    hinweise,
  };
}

/** Seiteninhalt = ausführliche Erklärung (optional). Erlaubt: Absätze, Listen, Zitate, Trennlinien. */
export async function liesDetail(seiteId, client) {
  const oben = await client.alleKinder(seiteId);
  if (oben.some((b) => ['heading_2', 'heading_3', 'heading_4'].includes(b.type))) {
    throw new ArtikelFehler('Im Seiteninhalt eines Glossareintrags sind keine Überschriften vorgesehen (erlaubt: Absätze, Listen, Zitate, Trennlinien).');
  }
  const ctx = { definitionen: [], verweise: [], alleKinder: client.alleKinder };
  const teile = await konvertiere(oben, ctx);
  if (ctx.definitionen.length || ctx.verweise.length) {
    throw new ArtikelFehler('Fußnoten sind im Glossar nicht erlaubt.');
  }
  return zuText(teile);
}

export function baueDatei(meta, detail) {
  const kopf = [
    '---',
    `term: ${JSON.stringify(meta.begriff)}`,
    `variants: ${JSON.stringify(meta.varianten)}`,
    `summary: ${JSON.stringify(meta.kurz)}`,
    'status: "freigegeben"',
    '---',
    '',
  ];
  const text = (detail ?? '').trim();
  return `${kopf.join('\n')}\n${text ? `${text}\n` : ''}`;
}

/** Prüfungen über alle Einträge hinweg: Doppelte erkennen, bevor sie beim Markieren im Text stören. */
export function pruefeGlossar(eintraege) {
  const fehler = [];
  const begriffe = new Map();
  const kennungen = new Map();
  for (const e of eintraege) {
    if (begriffe.has(e.begriff)) fehler.push(`${e.begriff}: Der Begriff kommt doppelt vor.`);
    begriffe.set(e.begriff, true);
    if (kennungen.has(e.kennung) && kennungen.get(e.kennung) !== e.begriff) {
      fehler.push(`${e.begriff}: Ergibt dieselbe Dateikennung wie „${kennungen.get(e.kennung)}“ (nur Groß-/Kleinschreibung oder Sonderzeichen unterscheiden sich).`);
    }
    kennungen.set(e.kennung, e.begriff);
  }
  const formen = new Map(); // Schreibweise -> Begriff, zu dem sie gehört
  for (const e of eintraege) {
    for (const f of new Set([e.begriff, ...e.varianten])) {
      const besitzer = formen.get(f);
      if (besitzer !== undefined && besitzer !== e.begriff) {
        fehler.push(`${e.begriff}: Die Schreibweise „${f}“ gehört auch zu „${besitzer}“ (Begriff oder Schreibvariante). Im Text wäre nicht klar, welche Erklärung gemeint ist.`);
      } else {
        formen.set(f, e.begriff);
      }
    }
  }
  return { fehler };
}

// ---------------------------------------------------------------------------
// Hauptablauf
// ---------------------------------------------------------------------------

export async function laufe({ token, databaseId, ausgabe, log = console.log }) {
  const client = erzeugeClient(token);
  const { notion } = client;

  const ziel = path.resolve(ausgabe);
  if (['content-test-glossar', 'content-test'].includes(path.basename(ziel)) || ziel === process.cwd()) {
    throw new Error(`Der Ausgabeordner „${ausgabe}“ ist nicht erlaubt (er würde Testdaten oder das Projekt überschreiben).`);
  }

  const db = await notion(`/databases/${databaseId}`);
  const quelle = db.data_sources?.[0];
  if (!quelle) throw new NotionFehler('Die Glossar-Datenbank hat keine Datenquelle.');
  const schema = await notion(`/data_sources/${quelle.id}`);
  const { statusArt } = pruefeSchema(schema.properties);

  // Serverseitiger Filter, alle Seiten holen
  const seiten = [];
  let cursor;
  do {
    const antwort = await notion(`/data_sources/${quelle.id}/query`, {
      method: 'POST',
      body: JSON.stringify({
        page_size: 100,
        filter: { property: FELD.status, [statusArt]: { equals: FREIGEGEBEN } },
        ...(cursor ? { start_cursor: cursor } : {}),
      }),
    });
    seiten.push(...antwort.results);
    cursor = antwort.has_more ? antwort.next_cursor : undefined;
  } while (cursor);
  log(`${seiten.length} freigegebene Glossareinträge gefunden.`);

  const fehler = [];
  const eintraege = [];
  for (const seite of seiten) {
    const titel = Object.values(seite.properties).find((f) => f.type === 'title');
    const bezeichnung = leerzeichen(wert(titel)) || seite.id;
    try {
      const meta = pruefeEintrag(seite);
      const detail = await liesDetail(seite.id, client);
      meta.hinweise.forEach((h) => log(`Hinweis: ${h}`));
      eintraege.push({ ...meta, detail });
    } catch (e) {
      if (e instanceof ArtikelFehler) fehler.push(`${bezeichnung}: ${e.message}`);
      else throw e;
    }
  }
  fehler.push(...pruefeGlossar(eintraege).fehler);
  if (fehler.length) return { ok: false, fehler, eintraege: [] };

  // Alles in Ordnung: jetzt erst schreiben. Ein leeres Glossar leert den Ordner,
  // damit zurückgesetzte Einträge bei der nächsten Veröffentlichung verschwinden.
  await rm(ziel, { recursive: true, force: true });
  await mkdir(ziel, { recursive: true });
  for (const e of eintraege) {
    await writeFile(path.join(ziel, `${e.kennung}.md`), baueDatei(e, e.detail), 'utf8');
  }
  return { ok: true, fehler: [], eintraege };
}

// Nur ausführen, wenn die Datei direkt gestartet wird (nicht beim Import in Tests)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const token = process.env.NOTION_TOKEN;
  const databaseId = process.env.NOTION_GLOSSAR_DATABASE_ID;
  if (!token || !databaseId) {
    console.error('NOTION_TOKEN und/oder NOTION_GLOSSAR_DATABASE_ID fehlen.');
    process.exit(1);
  }
  try {
    const ergebnis = await laufe({ token, databaseId, ausgabe: process.argv[2] ?? 'content-notion-glossar' });
    if (!ergebnis.ok) {
      console.error(`\n${ergebnis.fehler.length} Fehler im Glossar. Es wurde nichts geschrieben:\n`);
      for (const f of ergebnis.fehler) console.error(`  • ${f}`);
      process.exit(1);
    }
    console.log(`${ergebnis.eintraege.length} Glossareinträge übernommen: ${ergebnis.eintraege.map((e) => e.begriff).join(', ') || '(keine)'}`);
  } catch (e) {
    console.error(`\nFehler: ${e.message}`);
    if (e instanceof NotionFehler) console.error('Die bisherige Website bleibt online.');
    process.exit(1);
  }
}
