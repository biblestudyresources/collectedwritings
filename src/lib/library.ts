import { getCollection, type CollectionEntry } from 'astro:content';

export type Article = CollectionEntry<'articles'>;

/** Stabile URL-Kennung aus der Artikel-ID, z. B. 30_Exp_10 -> 30-exp-10 */
export const slugOf = (id: string) => id.toLowerCase().replace(/_/g, '-');

/** Hängt den Basispfad an (nötig für GitHub Pages unter /repo-name/). */
export const withBase = (path: string) =>
  import.meta.env.BASE_URL.replace(/\/$/, '') + path;

export const articleUrl = (a: Article) => withBase(`/artikel/${slugOf(a.data.id)}/`);
export const volumeUrl = (volume: number) => withBase(`/band/${volume}/`);

/** Zweite Sicherung: nur freigegebene Artikel, geordnet nach Band und Position. */
export async function loadArticles(): Promise<Article[]> {
  const all = await getCollection('articles');
  return all
    .filter((a) => a.data.status === 'freigegeben')
    .sort((a, b) => a.data.volume - b.data.volume || a.data.position - b.data.position);
}

export type Volume = { volume: number; title: string; articles: Article[] };

export function groupByVolume(articles: Article[]): Volume[] {
  const map = new Map<number, Volume>();
  for (const a of articles) {
    const v = map.get(a.data.volume) ?? { volume: a.data.volume, title: a.data.volumeTitle, articles: [] };
    v.articles.push(a);
    map.set(a.data.volume, v);
  }
  return [...map.values()];
}
