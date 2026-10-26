import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

// Die Artikeldateien entstehen später aus Notion (nur zur Build-Zeit).
// Im Prototyp liegen Testartikel in content-test/.
const articles = defineCollection({
  loader: glob({ pattern: '*.md', base: './content-test' }),
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

export const collections = { articles };
