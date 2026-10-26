import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validate } from '../scripts/validate.mjs';

const base = { id: '1_Ecc_1', title: 'T', volume: 1, volumeTitle: 'Ecclesiastical (1)', position: 1, tags: [], status: 'freigegeben' };

function run(files) {
  const dir = mkdtempSync(join(tmpdir(), 'val-'));
  for (const [name, { meta = {}, body = 'Text.', omit = [] }] of Object.entries(files)) {
    const data = { ...base, ...meta };
    omit.forEach((k) => delete data[k]);
    const head = Object.entries(data).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join('\n');
    writeFileSync(join(dir, name), `---\n${head}\n---\n${body}\n`);
  }
  return validate(dir);
}
const has = (r, text) => r.errors.some((e) => e.includes(text));

test('gültiger Artikel besteht', () => {
  const r = run({ 'a.md': {} });
  assert.deepEqual(r.errors, []);
  assert.equal(r.approved, 1);
});
test('Entwurf wird ignoriert, auch wenn er fehlerhaft ist', () => {
  const r = run({ 'a.md': {}, 'b.md': { meta: { status: 'entwurf', id: 'kaputt' }, omit: ['title'] } });
  assert.deepEqual(r.errors, []);
  assert.equal(r.warnings.length, 1);
});
test('fehlendes Pflichtfeld', () => assert.ok(has(run({ 'a.md': { omit: ['title'] } }), 'Pflichtfeld „title“')));
test('ungültiges ID-Format', () => assert.ok(has(run({ 'a.md': { meta: { id: 'abc' } } }), 'Format')));
test('Bandnummer passt nicht zur ID', () => assert.ok(has(run({ 'a.md': { meta: { volume: 2 } } }), 'Bandnummer')));
test('doppelte ID', () => {
  const r = run({ 'a.md': {}, 'b.md': { meta: { position: 1 } } });
  assert.ok(has(r, 'doppelt vor'));
});
test('doppelte Position im Band', () => {
  const r = run({ 'a.md': {}, 'b.md': { meta: { id: '1_Abc_1' } } });
  assert.ok(has(r, 'Position 1 in Band 1'));
});
test('uneinheitliche Kürzel in einem Band', () => {
  const r = run({ 'a.md': {}, 'b.md': { meta: { id: '1_Abc_2', position: 2 } } });
  assert.ok(has(r, 'Kürzel'));
});
test('Fußnote ohne Text und Text ohne Fußnote', () => {
  assert.ok(has(run({ 'a.md': { body: 'Text.[^1]' } }), 'Fußnotentext fehlt'));
  assert.ok(has(run({ 'a.md': { body: 'Text.\n\n[^1]: Nur Text.' } }), 'keine Markierung'));
});
test('H1 im Artikeltext', () => assert.ok(has(run({ 'a.md': { body: '# Titel\n\nText.' } }), 'Ebene 1')));
test('leerer Artikeltext', () => assert.ok(has(run({ 'a.md': { body: '   ' } }), 'leer')));
