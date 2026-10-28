import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validate } from '../scripts/validate.mjs';

function articleText(position, tags) {
  const lines = [
    '---',
    `id: "01_Ecc_0${position}"`,
    'title: "Test"',
    'volume: 1',
    'volumeTitle: "Ecclesiastical (1)"',
    `position: ${position}`,
  ];
  if (tags !== undefined) lines.push(`tags: ${tags}`);
  lines.push('status: "freigegeben"', '---', '', 'Text.', '');
  return lines.join('\n');
}

/** Legt je Eintrag einen Artikel mit den angegebenen tags-Zeilen an und prüft das Verzeichnis. */
function run(...tagsPerArticle) {
  const dir = mkdtempSync(join(tmpdir(), 'tags-'));
  tagsPerArticle.forEach((tags, i) => writeFileSync(join(dir, `a${i + 1}.md`), articleText(i + 1, tags)));
  return validate(dir);
}

test('Artikel ohne Schlagwörter sind erlaubt', () => {
  assert.deepEqual(run('[]').errors, []);
  assert.deepEqual(run(undefined).errors, []);
});

test('normale Schlagwörter sind erlaubt', () => {
  assert.deepEqual(run('["Gnade", "Bund"]').errors, []);
});

test('leere, doppelte oder falsch geschriebene tags-Angaben sind Fehler', () => {
  assert.equal(run('["Gnade", ""]').errors.length, 1);
  assert.equal(run('["Gnade", "Gnade"]').errors.length, 1);
  assert.equal(run('"Gnade"').errors.length, 1);
});

test('Schlagwörter, die sich nur in der Schreibweise unterscheiden, geben einen Hinweis', () => {
  const result = run('["Gnade"]', '["gnade"]');
  assert.deepEqual(result.errors, []);
  assert.equal(result.warnings.length, 1);
});
