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

// Writes the list of built files, and a hash of their contents, into dist/sw.js.
// Any change to any file changes sw.js, which is what tells installed apps to update.
const precacheManifest = () => {
  let outDir = 'dist';
  const walk = (dir) =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]
    );
  return {
    name: 'stdynt-precache',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      const swPath = join(outDir, 'sw.js');
      const hash = createHash('sha256');
      const urls = walk(outDir)
        // Launch images are only read by iOS at install time; storing 12 of them offline is waste.
        .filter((file) => file !== swPath && !file.endsWith('.map') && !file.startsWith(join(outDir, 'splash')))
        .sort()
        .map((file) => {
          const url = `./${relative(outDir, file).split(sep).join('/')}`;
          hash.update(url).update(readFileSync(file));
          return url;
        });
      const source = readFileSync(swPath, 'utf8');
      const filled = source
        .replace("'__VERSION__'", JSON.stringify(hash.digest('hex').slice(0, 12)))
        .replace('[/*__PRECACHE__*/]', JSON.stringify(urls, null, 2));
      if (filled === source) throw new Error('sw.js placeholders not found; the app would not work offline');
      writeFileSync(swPath, filled);
    }
  };
};

// The font is only discovered after the stylesheet is parsed. Preloading the Latin subset
// lets it download alongside the CSS and JS, so first paint does not swap fonts late.
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
