import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { transform as minifyCss } from 'lightningcss';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { brotliCompressSync, constants as zlibConstants, gzipSync } from 'node:zlib';

// Replaced by inlineCriticalCss with the hash of the inlined <style> block.
const STYLE_HASH = '__CRITICAL_CSS_HASH__';

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  `style-src 'self' ${STYLE_HASH}`,
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

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]
  );

const precacheManifest = () => {
  let outDir = 'dist';
  let swTemplate = 'public/sw.js';
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
        .filter(
          (file) =>
            file !== swPath &&
            !file.endsWith('.map') &&
            !file.endsWith('.gz') &&
            !file.endsWith('.br') &&
            !file.startsWith(join(outDir, 'splash'))
        )
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

const minifyCssAssets = () => ({
  name: 'stdynt-minify-css',
  apply: 'build',
  generateBundle(_options, bundle) {
    for (const asset of Object.values(bundle)) {
      if (asset.type !== 'asset' || !asset.fileName.endsWith('.css')) continue;
      const source = Buffer.from(asset.source);
      asset.source = minifyCss({ filename: asset.fileName, code: source, minify: true }).code;
    }
  }
});

// Critical CSS (tokens, reset, the shell, and every rule the first screen
// paints) is inlined into the head so the first paint needs no stylesheet
// request. Everything else is a second stylesheet linked with media="print":
// the browser fetches it without blocking rendering, a preload raises its
// priority, and main.jsx switches the media to "all" once the app mounts. The
// <style> element needs a CSP hash to run under style-src 'self', and that hash
// covers the exact text between the tags — so the HTML is rewritten here, after
// Vite has written both files, rather than through transformIndexHtml. The
// inlined .css file is deleted so it is not shipped and not precached as dead
// weight.
const inlineCriticalCss = () => {
  let outDir = 'dist';
  return {
    name: 'stdynt-inline-css',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    writeBundle() {
      const htmlPath = join(outDir, 'index.html');
      let html = readFileSync(htmlPath, 'utf8');
      const hashes = [];
      html = html.replace(
        /[ \t]*<link rel="stylesheet"(?![^>]*data-deferred-css)[^>]*?href="([^"]+)"[^>]*>[ \t]*\n?/g,
        (_tag, href) => {
          const file = resolve(outDir, href);
          const body = readFileSync(file, 'utf8');
          if (body.includes('</style')) {
            throw new Error(`Cannot inline ${href}: it contains a </style sequence`);
          }
          // The CSS file's relative url()s would resolve against the document
          // once it is inlined, so rebase them on the stylesheet's directory.
          const cssDir = relative(outDir, dirname(file)).split(sep).join('/');
          const rebased = cssDir
            ? body.replace(
                /url\(\s*(['"]?)(?!data:|[a-z][a-z0-9+.-]*:|\/|#|%)([^)'"]*)\1\s*\)/gi,
                (_url, quote, path) => `url(${quote}${cssDir}/${path.replace(/^\.\//, '')}${quote})`
              )
            : body;
          const css = `\n${rebased}\n`;
          const digest = createHash('sha256').update(css).digest('base64');
          hashes.push(`'sha256-${digest}'`);
          rmSync(file);
          return `  <style>${css}</style>\n`;
        }
      );
      if (!hashes.length) throw new Error(`No stylesheet to inline in ${htmlPath}`);

      const deferred = html.match(/[ \t]*<link\b[^>]*data-deferred-css[^>]*>[ \t]*\n?/);
      if (!deferred) throw new Error(`No deferred stylesheet in ${htmlPath}`);
      const href = deferred[0].match(/href="([^"]+)"/)?.[1];
      if (!href) throw new Error('Deferred stylesheet is missing its href');
      html = html.replace(
        deferred[0],
        `  <link rel="preload" as="style" href="${href}" />\n` +
          `  ${deferred[0].trim()}\n` +
          `  <noscript><link rel="stylesheet" href="${href}" data-deferred-css /></noscript>\n`
      );

      const scripts = [];
      html = html.replace(/[ \t]*<script\b[^>]*\btype="module"[^>]*><\/script>[ \t]*\n?/g, (tag) => {
        scripts.push(tag.trim());
        return '';
      });
      if (scripts.length) {
        html = html.replace('</head>', `${scripts.map((tag) => `  ${tag}\n`).join('')}</head>`);
      }

      const policy = html.replace(STYLE_HASH, hashes.join(' '));
      if (policy.includes(STYLE_HASH)) throw new Error(`CSP is missing the ${STYLE_HASH} placeholder`);
      writeFileSync(htmlPath, policy);
    }
  };
};

const precompress = () => {
  let outDir = 'dist';
  const compressible = /\.(?:css|html|js|json|svg|txt|webmanifest)$/;
  return {
    name: 'stdynt-precompress',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    writeBundle() {
      for (const file of walk(outDir)) {
        if (!compressible.test(file)) continue;
        const source = readFileSync(file);
        const gzip = gzipSync(source, { level: 9 });
        if (gzip.length < source.length) writeFileSync(`${file}.gz`, gzip);
        const brotli = brotliCompressSync(source, {
          params: { [zlibConstants.BROTLI_PARAM_QUALITY]: zlibConstants.BROTLI_MAX_QUALITY }
        });
        if (brotli.length < source.length) writeFileSync(`${file}.br`, brotli);
      }
    }
  };
};

// The dev server hands a bare .css request back as a JS module; `?direct`
// makes it serve the stylesheet itself, which is what a <link> needs.
const deferredCssDev = () => ({
  name: 'stdynt-deferred-css-dev',
  apply: 'serve',
  transformIndexHtml(html) {
    return html.replace('href="/src/deferred.css"', 'href="/src/deferred.css?direct"');
  }
});

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
  plugins: [
    react(),
    contentSecurityPolicy(),
    deferredCssDev(),
    preloadFont(),
    minifyCssAssets(),
    inlineCriticalCss(),
    precompress(),
    precacheManifest()
  ],
  server: {
    port: 3000
  }
});
