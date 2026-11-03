import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  dateiKennung, liesVarianten, liesKurzerklaerung, wer, pruefeSchema, pruefeEintrag,
  pruefeGlossar, liesDetail, baueDatei, laufe,
} from '../scripts/fetch-glossar.mjs';
import { ArtikelFehler, NotionFehler } from '../scripts/fetch-notion.mjs';

// --- kleine Bauhelfer für Notion-Daten ---------------------------------------
const ann = (o = {}) => ({ bold: false, italic: false, underline: false, strikethrough: false, code: false, color: 'default', ...o });
const rt = (text, o = {}, href = null) => ({ type: 'text', plain_text: text, href, annotations: ann(o), text: { content: text } });
const block = (type, rich, extra = {}) => ({ id: `b${Math.random()}`, type, has_children: false, [type]: { rich_text: rich, ...extra.inhalt }, ...extra.block });
const feld = {
  titel: (s) => ({ type: 'title', title: s ? [rt(s)] : [] }),
  text: (s) => ({ type: 'rich_text', rich_text: s ? [rt(s)] : [] }),
  auswahl: (s) => ({ type: 'select', select: s ? { name: s } : null }),
  mehr: (a) => ({ type: 'multi_select', multi_select: a.map((name) => ({ name })) }),
  leute: (ids) => ({ type: 'people', people: ids.map((id) => ({ id })) }),
};
const seite = (o = {}, id = 'p1') => ({
  id,
  last_edited_time: '2026-11-03T10:00:00.000Z',
  properties: {
    Begriff: feld.titel('Versammlung'),
    Schreibvarianten: feld.text('Versammlungen, Versammlung'),
    Kurzerklärung: feld.text('Kurze Erklärung.'),
    Status: feld.auswahl('Freigegeben'),
    Autor: feld.leute(['u1']),
    Zweitkorrektor: feld.leute(['u2']),
    ...o,
  },
});
const schemaEigenschaften = (o = {}) => ({
  Begriff: { type: 'title' }, Schreibvarianten: { type: 'rich_text' }, Kurzerklärung: { type: 'rich_text' },
  Status: { type: 'select' }, Autor: { type: 'people' }, Zweitkorrektor: { type: 'people' }, ...o,
});

// --- Helfer ---------------------------------------------------------------------
test('dateiKennung: Umlaute, Leerzeichen, Sonderzeichen', () => {
  assert.equal(dateiKennung('Menschensohn'), 'menschensohn');
  assert.equal(dateiKennung('Sühne & Gnade'), 'suehne-gnade');
  assert.equal(dateiKennung('Fußtritt'), 'fusstritt');
  assert.equal(dateiKennung('Café'), 'cafe'); // Akzente fallen weg
  assert.equal(dateiKennung('Ἰησοῦς'), ''); // nicht-lateinische Schrift ergibt keine Kennung (wird als Fehler gemeldet)
  assert.equal(dateiKennung('!!!'), '');
});

test('liesVarianten: Trennzeichen, Leerzeichen, Doppelte, Begriff selbst', () => {
  assert.deepEqual(liesVarianten('Bundes, Bunde;  Bünde\nBunde, Bund', 'Bund'), ['Bundes', 'Bunde', 'Bünde']);
  assert.deepEqual(liesVarianten('Sohn  des   Menschen', 'Menschensohn'), ['Sohn des Menschen']);
  assert.deepEqual(liesVarianten('', 'X'), []);
});

test('liesKurzerklaerung: Zeilenumbrüche werden Absätze', () => {
  assert.equal(liesKurzerklaerung('Eins.\nZwei.\n\n  Drei. '), 'Eins.\n\nZwei.\n\nDrei.');
});

test('wer: Personen, Text und Auswahl', () => {
  assert.deepEqual(wer(feld.leute(['a', 'b'])), ['a', 'b']);
  assert.deepEqual(wer(feld.text('Anna Muster;  Ben Test')), ['anna muster', 'ben test']);
  assert.deepEqual(wer(feld.auswahl('Anna')), ['anna']);
  assert.deepEqual(wer(feld.mehr(['Anna', 'Ben'])), ['anna', 'ben']);
  assert.deepEqual(wer(feld.leute([])), []);
});

// --- Schema ------------------------------------------------------------------------
test('pruefeSchema: gültig, auch mit anderem Namen der Titelspalte und Status-Typ', () => {
  assert.equal(pruefeSchema(schemaEigenschaften()).statusArt, 'select');
  const e = schemaEigenschaften({ Status: { type: 'status' } });
  assert.equal(pruefeSchema(e).statusArt, 'status');
  const anders = { ...schemaEigenschaften(), Name: { type: 'title' } };
  delete anders.Begriff;
  assert.equal(pruefeSchema(anders).titelName, 'Name');
});

test('pruefeSchema: fehlende Spalten und falsche Typen', () => {
  const ohne = schemaEigenschaften(); delete ohne.Zweitkorrektor;
  assert.throws(() => pruefeSchema(ohne), (e) => e instanceof NotionFehler && /Zweitkorrektor/.test(e.message));
  assert.throws(() => pruefeSchema(schemaEigenschaften({ Kurzerklärung: { type: 'number' } })), /Typ „number“/);
  assert.throws(() => pruefeSchema(schemaEigenschaften({ Status: { type: 'checkbox' } })), /Status/);
  assert.throws(() => pruefeSchema(schemaEigenschaften({ Autor: { type: 'date' } })), /Autor/);
  assert.throws(() => pruefeSchema(schemaEigenschaften({ Autor: { type: 'rich_text' } })), /denselben Spaltentyp/);
});

// --- Pflichtfelder und Zweitkorrektur ----------------------------------------------
test('pruefeEintrag: gültiger Eintrag', () => {
  const m = pruefeEintrag(seite());
  assert.equal(m.begriff, 'Versammlung');
  assert.deepEqual(m.varianten, ['Versammlungen']);
  assert.equal(m.kennung, 'versammlung');
  assert.equal(m.kurz, 'Kurze Erklärung.');
});

test('pruefeEintrag: Autor und Zweitkorrektor sind Pflicht', () => {
  assert.throws(() => pruefeEintrag(seite({ Autor: feld.leute([]) })), /Pflichtfeld.*Autor/);
  assert.throws(() => pruefeEintrag(seite({ Zweitkorrektor: feld.leute([]) })), /Pflichtfeld.*Zweitkorrektor/);
  assert.throws(() => pruefeEintrag(seite({ Autor: feld.leute([]), Zweitkorrektor: feld.leute([]) })), /Autor, Zweitkorrektor/);
});

test('pruefeEintrag: dieselbe Person ist ein Fehler (Personen, auch bei mehreren, und Text)', () => {
  assert.throws(() => pruefeEintrag(seite({ Zweitkorrektor: feld.leute(['u1']) })), /nicht dieselbe Person/);
  assert.throws(() => pruefeEintrag(seite({ Autor: feld.leute(['u1', 'u3']), Zweitkorrektor: feld.leute(['u3']) })), /nicht dieselbe Person/);
  assert.throws(() => pruefeEintrag(seite({ Autor: feld.text('Anna Muster'), Zweitkorrektor: feld.text('anna  MUSTER') })), /nicht dieselbe Person/);
  assert.doesNotThrow(() => pruefeEintrag(seite({ Autor: feld.text('Anna'), Zweitkorrektor: feld.text('Ben') })));
});

test('pruefeEintrag: weitere Pflichtfelder, Status, Hinweis bei langer Kurzerklärung', () => {
  assert.throws(() => pruefeEintrag(seite({ Begriff: feld.titel('') })), /Pflichtfeld.*Begriff/);
  assert.throws(() => pruefeEintrag(seite({ Kurzerklärung: feld.text('   ') })), /Pflichtfeld.*Kurzerklärung/);
  assert.throws(() => pruefeEintrag(seite({ Status: feld.auswahl('Entwurf') })), /Status ist „Entwurf“/);
  assert.throws(() => pruefeEintrag(seite({ Begriff: feld.titel('???') })), /Dateikennung/);
  const lang = pruefeEintrag(seite({ Kurzerklärung: feld.text('x'.repeat(401)) }));
  assert.equal(lang.hinweise.length, 1);
});

test('pruefeGlossar: doppelter Begriff, gemeinsame Schreibweise, gleiche Dateikennung', () => {
  const e = (begriff, varianten = []) => ({ begriff, varianten, kennung: dateiKennung(begriff) });
  assert.deepEqual(pruefeGlossar([e('Bund', ['Bundes']), e('Gnade', ['Gnaden'])]).fehler, []);
  assert.ok(pruefeGlossar([e('Bund'), e('Bund')]).fehler.some((f) => /doppelt/.test(f)));
  const gemeinsam = pruefeGlossar([e('Bund', ['Bünde']), e('Bündnis', ['Bünde'])]).fehler;
  assert.equal(gemeinsam.length, 1);
  assert.match(gemeinsam[0], /„Bünde“ gehört auch zu „Bund“/);
  assert.ok(pruefeGlossar([e('Bund'), e('Bündnis', ['Bund'])]).fehler.length === 1);
  assert.ok(pruefeGlossar([e('Gott'), e('gott')]).fehler.some((f) => /Dateikennung/.test(f)));
});

// --- Seiteninhalt (ausführliche Erklärung) ---------------------------------------------
test('liesDetail: Absätze, Liste, Zitat, Callout wird ignoriert', async () => {
  const kinder = { p: [block('callout', [rt('Notiz')]), block('paragraph', [rt('Erster '), rt('Absatz', { italic: true }), rt('.')]), block('bulleted_list_item', [rt('a')]), block('quote', [rt('Zitat')])] };
  const client = { alleKinder: async (id) => kinder[id] ?? [] };
  assert.equal(await liesDetail('p', client), 'Erster *Absatz*.\n\n- a\n\n> Zitat');
});

test('liesDetail: leer ist erlaubt, Überschriften, Fußnoten und fremde Blöcke sind Fehler', async () => {
  const mit = (bloecke) => ({ alleKinder: async () => bloecke });
  assert.equal(await liesDetail('p', mit([])), '');
  await assert.rejects(liesDetail('p', mit([block('heading_2', [rt('Titel')])])), /keine Überschriften/);
  await assert.rejects(liesDetail('p', mit([block('paragraph', [rt('Text[^1]')]), block('paragraph', [rt('[^1]: Fußnote')])])), /Fußnoten sind im Glossar nicht erlaubt/);
  await assert.rejects(liesDetail('p', mit([block('image', [])])), /image/);
  await assert.rejects(liesDetail('p', mit([block('paragraph', [rt('x', { code: true })])])), ArtikelFehler);
});

test('baueDatei: Kopfdaten im JSON-Format, mit und ohne ausführlichen Text', () => {
  const meta = { begriff: 'Menschensohn', varianten: ['Sohn des Menschen'], kurz: 'Eins.\n\nZwei "x".' };
  assert.equal(
    baueDatei(meta, 'Mehr Text.\n'),
    '---\nterm: "Menschensohn"\nvariants: ["Sohn des Menschen"]\nsummary: "Eins.\\n\\nZwei \\"x\\"."\nstatus: "freigegeben"\n---\n\nMehr Text.\n',
  );
  assert.equal(baueDatei(meta, ''), '---\nterm: "Menschensohn"\nvariants: ["Sohn des Menschen"]\nsummary: "Eins.\\n\\nZwei \\"x\\"."\nstatus: "freigegeben"\n---\n\n');
});

// --- Gesamtablauf mit nachgebautem Notion ------------------------------------------------
function baueNotion({ seiten, kinder = {}, eigenschaften = schemaEigenschaften(), queryFilter }) {
  const aufrufe = [];
  globalThis.fetch = async (url, opt = {}) => {
    const pfad = url.replace('https://api.notion.com/v1', '');
    aufrufe.push(`${opt.method ?? 'GET'} ${pfad}`);
    const antwort = (daten, status = 200) => ({ ok: status < 400, status, headers: { get: () => null }, json: async () => daten });
    if (pfad === '/databases/DB') return antwort({ title: [], data_sources: [{ id: 'DS' }] });
    if (pfad === '/data_sources/DS') return antwort({ properties: eigenschaften });
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

async function imTempOrdner(fn) {
  const dir = await mkdtemp(path.join(tmpdir(), 'glossar-'));
  const alterOrdner = process.cwd();
  process.chdir(dir);
  try { await fn(dir); } finally {
    process.chdir(alterOrdner);
    await rm(dir, { recursive: true, force: true });
  }
}

test('laufe: schreibt Dateien, filtert serverseitig, Namen landen nicht in den Dateien', async () => {
  await imTempOrdner(async (dir) => {
    let filter;
    baueNotion({
      seiten: [seite(), seite({ Begriff: feld.titel('Menschensohn'), Schreibvarianten: feld.text('Sohn des Menschen') }, 'p2')],
      kinder: { p2: [block('paragraph', [rt('Ausführlicher Text.')])] },
      queryFilter: (b) => { filter = b.filter; },
    });
    const r = await laufe({ token: 't', databaseId: 'DB', ausgabe: 'out', log: () => {} });
    assert.equal(r.ok, true);
    assert.deepEqual(filter, { property: 'Status', select: { equals: 'Freigegeben' } });
    assert.deepEqual((await readdir(path.join(dir, 'out'))).sort(), ['menschensohn.md', 'versammlung.md']);
    const a = await readFile(path.join(dir, 'out', 'versammlung.md'), 'utf8');
    assert.match(a, /^---\nterm: "Versammlung"\nvariants: \["Versammlungen"\]\nsummary: "Kurze Erklärung\."\nstatus: "freigegeben"\n---\n/);
    assert.doesNotMatch(a, /u1|u2/);
    const b = await readFile(path.join(dir, 'out', 'menschensohn.md'), 'utf8');
    assert.match(b, /\n---\n\nAusführlicher Text\.\n$/);
  });
});

test('laufe: Status-Typ „status“ wird im Filter berücksichtigt', async () => {
  await imTempOrdner(async () => {
    let filter;
    baueNotion({ seiten: [], eigenschaften: schemaEigenschaften({ Status: { type: 'status' } }), queryFilter: (b) => { filter = b.filter; } });
    const r = await laufe({ token: 't', databaseId: 'DB', ausgabe: 'out', log: () => {} });
    assert.equal(r.ok, true);
    assert.deepEqual(filter, { property: 'Status', status: { equals: 'Freigegeben' } });
  });
});

test('laufe: ein leeres Glossar leert den Ordner (zurückgesetzte Einträge verschwinden)', async () => {
  await imTempOrdner(async (dir) => {
    baueNotion({ seiten: [seite()] });
    await laufe({ token: 't', databaseId: 'DB', ausgabe: 'out', log: () => {} });
    assert.deepEqual(await readdir(path.join(dir, 'out')), ['versammlung.md']);
    baueNotion({ seiten: [] });
    const r = await laufe({ token: 't', databaseId: 'DB', ausgabe: 'out', log: () => {} });
    assert.equal(r.ok, true);
    assert.deepEqual(await readdir(path.join(dir, 'out')), []);
  });
});

test('laufe: bei einem Fehler wird nichts geschrieben, alle Fehler werden gemeldet', async () => {
  await imTempOrdner(async (dir) => {
    baueNotion({
      seiten: [
        seite({}, 'p1'),
        seite({ Begriff: feld.titel('Bund'), Zweitkorrektor: feld.leute([]) }, 'p2'),
        seite({ Begriff: feld.titel('Gnade'), Zweitkorrektor: feld.leute(['u1']) }, 'p3'),
        seite({ Begriff: feld.titel('Zorn') }, 'p4'),
      ],
      kinder: { p4: [block('heading_2', [rt('Titel')])] },
    });
    const r = await laufe({ token: 't', databaseId: 'DB', ausgabe: 'out', log: () => {} });
    assert.equal(r.ok, false);
    assert.equal(r.fehler.length, 3);
    assert.match(r.fehler[0], /^Bund: Pflichtfeld fehlt oder ist leer: Zweitkorrektor/);
    assert.match(r.fehler[1], /^Gnade: „Zweitkorrektor“ darf nicht dieselbe Person sein/);
    assert.match(r.fehler[2], /^Zorn: .*keine Überschriften/);
    assert.deepEqual(await readdir(dir), []);
  });
});

test('laufe: Fehler über mehrere Einträge hinweg (gemeinsame Schreibweise) stoppt den Abruf', async () => {
  await imTempOrdner(async (dir) => {
    baueNotion({ seiten: [seite({}, 'p1'), seite({ Begriff: feld.titel('Zusammenkunft'), Schreibvarianten: feld.text('Versammlungen') }, 'p2')] });
    const r = await laufe({ token: 't', databaseId: 'DB', ausgabe: 'out', log: () => {} });
    assert.equal(r.ok, false);
    assert.match(r.fehler[0], /„Versammlungen“ gehört auch zu „Versammlung“/);
    assert.deepEqual(await readdir(dir), []);
  });
});

test('laufe: falsch aufgebaute Datenbank ist ein Notion-Fehler, nichts wird geschrieben', async () => {
  await imTempOrdner(async (dir) => {
    const ohne = schemaEigenschaften(); delete ohne.Autor;
    baueNotion({ seiten: [seite()], eigenschaften: ohne });
    await assert.rejects(laufe({ token: 't', databaseId: 'DB', ausgabe: 'out', log: () => {} }), (e) => e instanceof NotionFehler && /Autor/.test(e.message));
    assert.deepEqual(await readdir(dir), []);
  });
});

test('laufe: unzulässiger Ausgabeordner', async () => {
  await assert.rejects(laufe({ token: 't', databaseId: 'DB', ausgabe: 'content-test-glossar', log: () => {} }), /nicht erlaubt/);
});
