import { defineConfig } from 'astro/config';
import { satteri } from '@astrojs/markdown-satteri';

// Für GitHub Pages werden SITE_URL und BASE_PATH im Workflow gesetzt,
// zum Beispiel SITE_URL=https://name.github.io und BASE_PATH=/repo-name
export default defineConfig({
  site: process.env.SITE_URL || 'http://localhost:4321',
  base: process.env.BASE_PATH || '/',
  trailingSlash: 'always',
  markdown: {
    processor: satteri({
      features: {
        gfm: {
          footnotes: {
            label: 'Fußnoten',
            backLabel: 'Zurück zur Fußnote {reference} im Text',
          },
        },
      },
    }),
  },
});
