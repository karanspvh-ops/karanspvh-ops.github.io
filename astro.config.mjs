import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const stripDataPs = {
  name: 'strip-data-ps',
  hooks: {
    'astro:build:done': async ({ dir }) => {
      const { glob } = await import('glob');
      const fs = await import('node:fs/promises');
      const root = fileURLToPath(dir);
      const files = await glob('**/*.html', { cwd: root, absolute: true });
      const re = /\s+data-ps="[^"]*"/g;
      for (const f of files) {
        const html = await fs.readFile(f, 'utf-8');
        await fs.writeFile(f, html.replace(re, ''));
      }
    },
  },
};

export default defineConfig({
  site: 'https://spvhgroup.com',
  output: 'static',
  integrations: [
    sitemap({
      changefreq: 'weekly',
      priority: 0.8,
      lastmod: new Date(),
    }),
    stripDataPs,
  ],
  vite: {
    plugins: [tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
      },
    },
  },
});
