import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';
import { mkdirSync } from 'node:fs';
import { cleanTags } from './lib/tags.mjs';

// Quelle der Artikeldateien. Standard: die erfundenen Testartikel im Prototyp.
// Für Artikel aus Notion: Umgebungsvariable CONTENT_DIR=content-notion setzen.
// Die Texte „Für den eiligen Leser“ liegen im gleichnamigen Ordner mit Endung -eilig,
// die Glossareinträge im Ordner mit Endung -glossar.
const contentDir = (process.env.CONTENT_DIR ?? 'content-test').replace(/\/$/, '');
const eiligDir = `${contentDir}-eilig`;
const glossarDir = `${contentDir}-glossar`;
mkdirSync(eiligDir, { recursive: true }); // darf leer sein
mkdirSync(glossarDir, { recursive: true }); // darf leer sein

const articles = defineCollection({
  loader: glob({ pattern: '*.md', base: `./${contentDir}` }),
  schema: z.object({
    id: z.string().regex(/^\d+_[A-Za-z]+_\d+$/),
    title: z.string().min(1),
    volume: z.number().int().positive(),
    volumeTitle: z.string().min(1),
    position: z.number().int().positive(),
    tags: z.array(z.string()).default([]).transform(cleanTags),
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

// Glossar: eine Datei pro Begriff. „summary“ ist die Kurzerklärung für das kleine Fenster (reiner Text,
// Absätze durch Leerzeile). Der Text unter den Kopfdaten ist die optionale ausführliche Erklärung
// (Markdown), sie erscheint nur auf der Seite /glossar/.
// „variants“ enthält weitere Formen, die ebenfalls markiert werden sollen (Mehrzahl, Beugung usw.).
const glossar = defineCollection({
  loader: glob({ pattern: '*.md', base: `./${glossarDir}` }),
  schema: z.object({
    term: z.string().min(1),
    variants: z.array(z.string().min(1)).default([]),
    summary: z.string().min(1),
    status: z.string(),
  }),
});

export const collections = { articles, eilig, glossar };
