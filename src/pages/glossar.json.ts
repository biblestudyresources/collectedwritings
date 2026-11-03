// Wird beim Build zu /glossar.json. Das Skript im Browser lädt diese Datei einmal und
// markiert damit die Begriffe im Artikeltext. Nur freigegebene Einträge sind enthalten.
// Das Fenster zeigt nur die Kurzerklärung; die ausführliche Erklärung steht nur auf /glossar/.
import type { APIRoute } from 'astro';
import { loadGlossar, glossarUrl } from '../lib/library';

export const GET: APIRoute = async () => {
  const eintraege = await loadGlossar();
  const daten = eintraege.map((e) => ({
    id: e.id,
    term: e.data.term,
    forms: [e.data.term, ...e.data.variants],
    text: e.data.summary.trim(),
    url: glossarUrl(e.id),
  }));
  return new Response(JSON.stringify(daten), { headers: { 'Content-Type': 'application/json' } });
};
