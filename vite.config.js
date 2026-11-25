import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "manifest-src 'self'",
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'"
].join('; ');

const contentSecurityPolicy = () => ({
  name: 'stdynt-csp',
  apply: 'build',
  transformIndexHtml: () => [
    { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head-prepend' }
  ]
});

const precacheManifest = () => {
  let outDir = 'dist';
  let swTemplate = 'public/sw.js';
  const walk = (dir) =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]
    );
  return {
    name: 'stdynt-precache',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
      if (config.publicDir) swTemplate = join(config.publicDir, 'sw.js');
    },
    writeBundle() {
      const swPath = join(outDir, 'sw.js');
      const hash = createHash('sha256');
      const urls = walk(outDir)
        .filter((file) => file !== swPath && !file.endsWith('.map') && !file.startsWith(join(outDir, 'splash')))
        .sort()
        .map((file) => {
          const url = `./${relative(outDir, file).split(sep).join('/')}`;
          hash.update(url).update(readFileSync(file));
          return url;
        });
      const source = readFileSync(swTemplate, 'utf8');
      if (!source.includes("'__VERSION__'") || !source.includes('__PRECACHE__')) {
        throw new Error(`sw.js template is missing its placeholders: ${swTemplate}`);
      }
      const filled = source
        .replace("'__VERSION__'", JSON.stringify(hash.digest('hex').slice(0, 12)))
        .replace('__PRECACHE__', JSON.stringify(urls, null, 2));
      writeFileSync(swPath, filled);
    }
  };
};

const preloadFont = () => ({
  name: 'stdynt-preload-font',
  apply: 'build',
  transformIndexHtml(_html, ctx) {
    const font = Object.keys(ctx.bundle || {}).find((name) => /-latin-wdth-normal-.*\.woff2$/.test(name));
    if (!font) return [];
    return [
      {
        tag: 'link',
        attrs: { rel: 'preload', as: 'font', type: 'font/woff2', href: `./${font}`, crossorigin: '' },
        injectTo: 'head'
      }
    ];
  }
});

export default defineConfig({
  base: './',
  plugins: [react(), contentSecurityPolicy(), preloadFont(), precacheManifest()],
  server: {
    port: 3000
  }
});
