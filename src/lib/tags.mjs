// Reine Hilfsfunktionen für Schlagwörter, ohne Astro-Abhängigkeit.
// So laufen sie beim Bauen der Seite, im Browser (Schlagwort-Seite) und in den Tests.

/** Bereinigt die Schlagwörter eines Artikels: Leerzeichen am Rand weg, Leeres und Doppeltes weglassen. */
export function cleanTags(tags = []) {
  return [...new Set(tags.map((t) => String(t).trim()).filter(Boolean))];
}

/** Alle vorkommenden Schlagwörter mit Zahl der Artikel, alphabetisch (deutsche Sortierung). */
export function countTags(tagLists) {
  const counts = new Map();
  for (const list of tagLists)
    for (const tag of cleanTags(list)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  return [...counts]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => a.tag.localeCompare(b.tag, 'de'));
}

/** UND-Verknüpfung: wahr, wenn der Artikel ALLE gewählten Schlagwörter hat. */
export function matchesAllTags(articleTags, selected) {
  return selected.every((tag) => articleTags.includes(tag));
}
