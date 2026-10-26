import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  maskiere, inlineMarkdown, konvertiere, zuText, pruefeFussnoten,
  pruefeFelder, pruefeBaende, baueDatei, laufe, liesAbschnitte, ArtikelFehler,
} from '../scripts/fetch-notion.mjs';

// --- kleine Bauhelfer für Notion-Daten ---------------------------------------
const ann = (o = {}) => ({ bold: false, italic: false, underline: false, strikethrough: false, code: false, color: 'default', ...o });
const rt = (text, o = {}, href = null) => ({ type: 'text', plain_text: text, href, annotations: ann(o), text: { content: text } });
const block = (type, rich, extra = {}) => ({ id: `b${Math.random()}`, type, has_children: false, [type]: { rich_text: rich, ...extra.inhalt }, ...extra.block });
const ctxNeu = (kinder = {}) => ({ definitionen: [], verweise: [], alleKinder: async (id) => kinder[id] ?? [] });

// --- Text ----------------------------------------------------------------------
test('maskiere entschärft Sonderzeichen, lässt Fußnotenmarken stehen', () => {
  assert.equal(maskiere('a*b_c[d]'), 'a\\*b\\_c\\[d\\]');
  assert.equal(maskiere('Text[^1] und [^2]'), 'Text[^1] und [^2]');
});

test('inlineMarkdown: fett, kursiv, Link, Leerzeichen am Rand', () => {
  const s = inlineMarkdown([rt('Hallo '), rt(' fett ', { bold: true }), rt('kursiv', { italic: true }), rt('Link', {}, 'https://example.org/a_(b)')]);
  assert.equal(s, 'Hallo  **fett** *kursiv*[Link](https://example.org/a_%28b%29)');
});

test('inlineMarkdown: Code, Durchstreichen, Unterstreichen und Notion-Links sind Fehler', () => {
  assert.throws(() => inlineMarkdown([rt('x', { code: true })]), ArtikelFehler);
  assert.throws(() => inlineMarkdown([rt('x', { strikethrough: true })]), ArtikelFehler);
  assert.throws(() => inlineMarkdown([rt('x', { underline: true })]), ArtikelFehler);
  assert.throws(() => inlineMarkdown([rt('x', {}, 'https://www.notion.so/abc')]), ArtikelFehler);
  assert.throws(() => inlineMarkdown([{ type: 'mention', plain_text: '@x', annotations: ann() }]), ArtikelFehler);
});

// --- Blöcke --------------------------------------------------------------------
test('konvertiere: Absatz, Überschriften, Listen verschachtelt, Zitat, Trennlinie', async () => {
  const ctx = ctxNeu({
    l1: [block('bulleted_list_item', [rt('unter')])],
  });
  const bloecke = [
    block('paragraph', [rt('Anfang[^1]')]),
    block('heading_2', [rt('Titel')]),
    { ...block('bulleted_list_item', [rt('eins')]), id: 'l1', has_children: true },
    block('numbered_list_item', [rt('a')]),
    block('numbered_list_item', [rt('b')]),
    block('quote', [rt('Zitat')]),
    block('divider', []),
    block('callout', [rt('Hinweis')]),
    block('paragraph', []),
    block('paragraph', [rt('[^1]: Text')]),
  ];
  const text = zuText(await konvertiere(bloecke, ctx));
  assert.equal(text, [
    'Anfang[^1]', '', '## Titel', '', '- eins\n    - unter\n1. a\n2. b', '', '> Zitat', '', '---', '', '[^1]: Text',
  ].join('\n'));
  pruefeFussnoten(ctx, 'Deutscher Text');
});

test('konvertiere: unbekannter Block und H1 im Text sind Fehler', async () => {
  await assert.rejects(konvertiere([block('image', [])], ctxNeu()), /image/);
  await assert.rejects(konvertiere([block('table', [])], ctxNeu()), /table/);
  await assert.rejects(konvertiere([block('heading_1', [rt('x')])], ctxNeu()), /Überschrift 1/);
  await assert.rejects(konvertiere([block('code', [rt('x')])], ctxNeu()), /code/);
});

test('Fußnotenprüfung', () => {
  assert.throws(() => pruefeFussnoten({ definitionen: [], verweise: ['1'] }, 'X'), /keinen Fußnotentext/);
  assert.throws(() => pruefeFussnoten({ definitionen: ['1'], verweise: [] }, 'X'), /keine Marke/);
  assert.throws(() => pruefeFussnoten({ definitionen: ['1', '1'], verweise: ['1'] }, 'X'), /doppelt/);
});

// --- Felder ----------------------------------------------------------------------
const feld = {
  titel: (s) => ({ type: 'title', title: [rt(s)] }),
  text: (s) => ({ type: 'rich_text', rich_text: s ? [rt(s)] : [] }),
  auswahl: (s) => ({ type: 'select', select: s ? { name: s } : null }),
  mehr: (a) => ({ type: 'multi_select', multi_select: a.map((name) => ({ name })) }),
  leute: (ids) => ({ type: 'people', people: ids.map((id) => ({ id })) }),
};
const seite = (o = {}, id = 'p1') => ({
  id,
  last_edited_time: '2026-10-26T10:00:00.000Z',
  properties: {
    Name: feld.titel('30_Exp_10 Psalm 8'),
    ID: feld.text('30_Exp_10'),
    'Titel (DE)': feld.text('Psalm 8'),
    'Titel (EN)': feld.text('Psalm 8'),
    Band: feld.auswahl('Vol. 30: Expository (2)'),
    Stichwörter: feld.mehr(['Psalmen']),
    Status: feld.auswahl('Freigegeben'),
    'Übersetzt von': feld.leute(['u1']),
    'Geprüft von': feld.leute([]),
    ...o,
  },
});

test('pruefeFelder: gültiger Artikel ohne Zweitprüfung', () => {
  const m = pruefeFelder(seite());
  assert.equal(m.bandNummer, 30);
  assert.equal(m.kuerzel, 'Exp');
  assert.equal(m.position, 10);
  assert.equal(m.bandTitel, 'Expository (2)');
});

test('pruefeFelder: Fehlerfälle', () => {
  assert.throws(() => pruefeFelder(seite({ 'Titel (DE)': feld.text('') })), /Pflichtfeld/);
  assert.throws(() => pruefeFelder(seite({ ID: feld.text('30-Exp-10') })), /Format/);
  assert.throws(() => pruefeFelder(seite({ Band: feld.auswahl('Vol. 24: Expository (2)') })), /Bandnummer/);
  assert.throws(() => pruefeFelder(seite({ 'Geprüft von': feld.leute(['u1']) })), /dieselbe Person/);
  assert.throws(() => pruefeFelder(seite({ Status: feld.auswahl('Zweitprüfung ausstehend') })), /Status/);
  // Zweitprüfung mit anderer Person ist in Ordnung
  assert.doesNotThrow(() => pruefeFelder(seite({ 'Geprüft von': feld.leute(['u2']) })));
});

test('pruefeBaende: doppelte ID, doppelte Position, uneinheitliches Kürzel, Lücke', () => {
  const a = (id, bandNummer, kuerzel, position) => ({ id, name: id, bandNummer, kuerzel, position });
  const r = pruefeBaende([a('30_Exp_10', 30, 'Exp', 10), a('30_Exp_10', 30, 'Exp', 10), a('30_Doc_20', 30, 'Doc', 20), a('30_Exp_50', 30, 'Exp', 50)]);
  assert.ok(r.fehler.some((f) => /doppelt/.test(f)));
  assert.ok(r.fehler.some((f) => /Kürzel/.test(f)));
  assert.ok(r.hinweise.length >= 1);
});

test('baueDatei: Kopfdaten im JSON-Format', () => {
  const meta = { id: '30_Exp_10', titelDe: 'Psalm "8"', bandNummer: 30, bandTitel: 'Expository (2)', position: 10, tags: ['A', 'B'] };
  const d = baueDatei(meta, 'Text\n');
  assert.equal(d, '---\nid: "30_Exp_10"\ntitle: "Psalm \\"8\\""\nvolume: 30\nvolumeTitle: "Expository (2)"\nposition: 10\ntags: ["A","B"]\nstatus: "freigegeben"\n---\n\nText\n');
});

// --- Gesamtablauf mit nachgebautem Notion ------------------------------------------
function baueNotion({ seiten, kinder, queryFilter }) {
  const aufrufe = [];
  globalThis.fetch = async (url, opt = {}) => {
    const pfad = url.replace('https://api.notion.com/v1', '');
    aufrufe.push(`${opt.method ?? 'GET'} ${pfad}`);
    const antwort = (daten, status = 200) => ({ ok: status < 400, status, headers: { get: () => null }, json: async () => daten });
    if (pfad === '/databases/DB') return antwort({ title: [], data_sources: [{ id: 'DS' }] });
    if (pfad === '/data_sources/DS') {
      const eig = Object.fromEntries(['Name', 'ID', 'Titel (DE)', 'Titel (EN)', 'Band', 'Stichwörter', 'Status', 'Übersetzt von', 'Geprüft von'].map((n) => [n, { type: n === 'Status' ? 'select' : 'x' }]));
      return antwort({ properties: eig });
    }
    if (pfad === '/data_sources/DS/query') {
      queryFilter?.(JSON.parse(opt.body));
      return antwort({ results: seiten, has_more: false });
    }
    const m = pfad.match(/^\/blocks\/([^/]+)\/children/);
    if (m) return antwort({ results: kinder[m[1]] ?? [], has_more: false });
    return antwort({ message: 'unbekannt' }, 404);
  };
  return aufrufe;
}

const h1 = (id, name, toggle = true) => ({ id, type: 'heading_1', has_children: true, heading_1: { rich_text: [rt(name)], is_toggleable: toggle } });
const standardKinder = (pid = 'p1') => ({
  [pid]: [block('callout', [rt('Hinweis')]), h1(`${pid}-de`, 'Deutscher Text'), h1(`${pid}-en`, 'English'), h1(`${pid}-ei`, 'Für den eiligen Leser')],
  [`${pid}-de`]: [block('paragraph', [rt('Gott ist ', {}), rt('treu', { bold: true }), rt('.[^1]')]), block('paragraph', [rt('[^1]: Siehe 1. Kor 1,9.')])],
  [`${pid}-en`]: [block('image', [])], // darf nie gelesen werden
  [`${pid}-ei`]: [block('paragraph', [rt('Kurzfassung.')])],
});

test('laufe: schreibt Dateien, filtert serverseitig, liest English nicht', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'notion-'));
  const alterOrdner = process.cwd();
  process.chdir(dir);
  try {
    let filter;
    const aufrufe = baueNotion({ seiten: [seite()], kinder: standardKinder(), queryFilter: (b) => { filter = b.filter; } });
    const r = await laufe({ token: 't', databaseId: 'DB', ausgabe: 'out', log: () => {} });
    assert.equal(r.ok, true);
    assert.deepEqual(filter, { property: 'Status', select: { equals: 'Freigegeben' } });
    assert.ok(!aufrufe.some((a) => a.includes('p1-en')), 'English wurde abgerufen');
    const datei = await readFile(path.join(dir, 'out', '30_Exp_10.md'), 'utf8');
    assert.match(datei, /^---\nid: "30_Exp_10"/);
    assert.match(datei, /Gott ist \*\*treu\*\*\.\[\^1\]\n\n\[\^1\]: Siehe 1\. Kor 1,9\./);
    const eilig = await readFile(path.join(dir, 'out-eilig', '30_Exp_10.md'), 'utf8');
    assert.equal(eilig, 'Kurzfassung.\n');
    const manifest = JSON.parse(await readFile(path.join(dir, 'notion-manifest.json'), 'utf8'));
    assert.deepEqual(manifest.artikel, [{ id: '30_Exp_10', zuletztBearbeitet: '2026-10-26T10:00:00.000Z' }]);
  } finally {
    process.chdir(alterOrdner);
    await rm(dir, { recursive: true, force: true });
  }
});

test('laufe: bei einem Fehler wird nichts geschrieben, alle Fehler werden gemeldet', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'notion-'));
  const alterOrdner = process.cwd();
  process.chdir(dir);
  try {
    const kinder = { ...standardKinder('p1'), ...standardKinder('p2') };
    kinder['p2'] = [h1('p2-de', 'Deutscher Text'), h1('p2-x', 'Deutscher Test')]; // Tippfehler im Abschnittsnamen
    baueNotion({ seiten: [seite({}, 'p1'), seite({ ID: feld.text('30_Exp_20'), 'Titel (DE)': feld.text('Psalm 9') }, 'p2')], kinder });
    const r = await laufe({ token: 't', databaseId: 'DB', ausgabe: 'out', log: () => {} });
    assert.equal(r.ok, false);
    assert.equal(r.fehler.length, 1);
    assert.match(r.fehler[0], /30_Exp_20: Unbekannter Abschnitt „Deutscher Test“/);
    assert.deepEqual(await readdir(dir), []);
  } finally {
    process.chdir(alterOrdner);
    await rm(dir, { recursive: true, force: true });
  }
});

test('laufe: nicht erreichbares Notion führt zu einem eigenen Fehler', async () => {
  globalThis.fetch = async () => { throw Object.assign(new Error('fetch failed'), { cause: { code: 'ENOTFOUND' } }); };
  const alt = globalThis.setTimeout;
  globalThis.setTimeout = (f) => alt(f, 0); // Wartezeiten im Test überspringen
  try {
    await assert.rejects(laufe({ token: 't', databaseId: 'DB', ausgabe: 'out', log: () => {} }), /nicht erreichbar/);
  } finally {
    globalThis.setTimeout = alt;
  }
});

test('laufe: unzulässiger Ausgabeordner', async () => {
  await assert.rejects(laufe({ token: 't', databaseId: 'DB', ausgabe: 'content-test', log: () => {} }), /nicht erlaubt/);
});

test('liesAbschnitte: Fußnoten im Abschnitt „Für den eiligen Leser“ sind ein Fehler', async () => {
  const kinder = {
    p: [h1('de', 'Deutscher Text'), h1('ei', 'Für den eiligen Leser')],
    de: [block('paragraph', [rt('Text.')])],
    ei: [block('paragraph', [rt('Kurz.[^1]')]), block('paragraph', [rt('[^1]: Fußnote')])],
  };
  const client = { alleKinder: async (id) => kinder[id] ?? [] };
  await assert.rejects(liesAbschnitte('p', client), /keine Fußnoten erlaubt/);
});
