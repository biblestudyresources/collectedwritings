import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanTags, countTags, matchesAllTags } from '../src/lib/tags.mjs';

test('cleanTags entfernt Leerzeichen, Leeres und Doppeltes', () => {
  assert.deepEqual(cleanTags([' Gnade ', 'Bund', '', 'Gnade', '  ']), ['Gnade', 'Bund']);
  assert.deepEqual(cleanTags([]), []);
  assert.deepEqual(cleanTags(), []);
});

test('countTags zählt jedes Schlagwort einmal je Artikel und sortiert deutsch', () => {
  const result = countTags([['Bund', 'Ärger'], ['Bund'], [], ['Zorn', 'Bund', 'Bund']]);
  assert.deepEqual(result, [
    { tag: 'Ärger', count: 1 },
    { tag: 'Bund', count: 3 },
    { tag: 'Zorn', count: 1 },
  ]);
});

test('countTags ohne Schlagwörter liefert eine leere Liste', () => {
  assert.deepEqual(countTags([[], []]), []);
  assert.deepEqual(countTags([]), []);
});

test('matchesAllTags ist eine UND-Verknüpfung', () => {
  assert.equal(matchesAllTags(['Gnade', 'Bund'], ['Gnade']), true);
  assert.equal(matchesAllTags(['Gnade', 'Bund'], ['Bund', 'Gnade']), true);
  assert.equal(matchesAllTags(['Gnade'], ['Gnade', 'Bund']), false);
  assert.equal(matchesAllTags([], ['Gnade']), false); // Artikel ohne Schlagwörter passt nie
  assert.equal(matchesAllTags(['Gnade'], []), true); // ohne Auswahl wird nichts ausgeschlossen
});
