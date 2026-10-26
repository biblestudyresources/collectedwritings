import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';
import { mkdirSync } from 'node:fs';

// Quelle der Artikeldateien. Standard: die erfundenen Testartikel im Prototyp.
// Für Artikel aus Notion: Umgebungsvariable CONTENT_DIR=content-notion setzen.
// Die Texte „Für den eiligen Leser“ liegen im gleichnamigen Ordner mit Endung -eilig.
const contentDir = (process.env.CONTENT_DIR ?? 'content-test').replace(/\/$/, '');
const eiligDir = `${contentDir}-eilig`;
mkdirSync(eiligDir, { recursive: true }); // darf leer sein

const articles = defineCollection({
  loader: glob({ pattern: '*.md', base: `./${contentDir}` }),
  schema: z.object({
    id: z.string().regex(/^\d+_[A-Za-z]+_\d+$/),
    title: z.string().min(1),
    volume: z.number().int().positive(),
    volumeTitle: z.string().min(1),
    position: z.number().int().positive(),
    tags: z.array(z.string()).default([]),
    status: z.string(),
  }),
});

// Kurzfassung der Redaktion; Dateiname (ohne .md) ist die Artikel-ID, zum Beispiel 30_Exp_10.
const eilig = defineCollection({
  loader: glob({
    pattern: '*.md',
    base: `./${eiligDir}`,
    generateId: ({ entry }) => entry.replace(/\.md$/, ''),
  }),
});

export const collections = { articles, eilig };
