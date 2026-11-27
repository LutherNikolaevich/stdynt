// Browser-based performance audit for the built app.
//
//   npm run build && node scripts/audit.mjs [--url http://localhost:3000] [--no-throttle]
//
// Without --url it serves ./dist itself, brotli files included, so the numbers
// match what Vercel ships. It then loads the app in Chromium at a 390x844 phone
// viewport with a 4x CPU slowdown and a slow 4G profile, and reports the
// paint metrics, layout shift, the worst interaction (INP), DOM size, the
// critical request chain, and every third-party request (there should be none
// without consent).
//
// It fails the run when a Core Web Vital is over budget (FCP 1.8s, LCP 2.5s,
// CLS 0.1, INP 200ms), when the full load takes over 3s, or when an interaction
// it needs to tap can no longer be found.
//
// Service workers are blocked: this measures the first visit, where the network
// is the whole story. Later visits are served from the cache and are not a
// network problem.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name, fallback) => {
  const at = args.indexOf(name);
  return at >= 0 && args[at + 1] ? args[at + 1] : fallback;
};

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

const serveDist = async () => {
  const root = resolve('dist');
  const server = createServer(async (req, res) => {
    const wanted = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    // A second document to navigate to, for the back/forward cache check.
    if (wanted === '/__away.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><title>away</title><p>away</p>');
      return;
    }
    let file = normalize(join(root, wanted === '/' ? 'index.html' : wanted));
    if (!file.startsWith(root)) {
      res.writeHead(403).end();
      return;
    }
    try {
      if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
    } catch {
      // fall through to the read below, which 404s
    }
    try {
      const accepts = String(req.headers['accept-encoding'] || '');
      const encoded = accepts.includes('br') ? `${file}.br` : accepts.includes('gzip') ? `${file}.gz` : null;
      const body = encoded ? await readFile(encoded) : await readFile(file);
      res.writeHead(200, {
        'Content-Type': TYPES[extname(file)] || 'application/octet-stream',
        ...(encoded ? { 'Content-Encoding': encoded.endsWith('.br') ? 'br' : 'gzip' } : {})
      });
      res.end(body);
    } catch {
      res.writeHead(404).end('Not found');
    }
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  return { server, url: `http://127.0.0.1:${server.address().port}/` };
};

const local = value('--url', null) ? null : await serveDist();
const url = value('--url', local?.url);

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  serviceWorkers: 'block'
});
const page = await context.newPage();
const cdp = await context.newCDPSession(page);

const requests = [];
cdp.on('Network.requestWillBeSent', (e) => {
  requests.push({
    requestId: e.requestId,
    url: e.request.url,
    type: e.type,
    initiator: e.initiator.type,
    depth: e.initiator.type === 'parser' ? 1 : 2
  });
});
cdp.on('Network.loadingFinished', (e) => {
  const hit = requests.find((r) => r.requestId === e.requestId);
  if (hit) hit.bytes = e.encodedDataLength;
});

await cdp.send('Network.enable');
if (!flag('--no-throttle')) {
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 150,
    downloadThroughput: (1.6 * 1024 * 1024) / 8,
    uploadThroughput: (750 * 1024) / 8
  });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
}

await page.addInitScript(() => {
  window.__perf = { lcp: 0, lcpEl: '', cls: 0, shifts: [], unloadListeners: [], interactions: new Map() };
  // `unload` (and, for the cache, `beforeunload`) makes a page ineligible for
  // the back/forward cache. Record any registration so the audit can fail.
  const on = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (type, ...rest) {
    if (type === 'unload' || type === 'beforeunload') window.__perf.unloadListeners.push(type);
    return on.call(this, type, ...rest);
  };
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      window.__perf.lcp = entry.startTime;
      const node = entry.element;
      window.__perf.lcpEl = node
        ? `${node.tagName.toLowerCase()}${node.className ? `.${String(node.className).trim().split(/\s+/).join('.')}` : ''}`
        : entry.url
          ? 'image'
          : 'text';
    }
  }).observe({ type: 'largest-contentful-paint', buffered: true });
  // Event Timing: one entry per interaction (plus per-event ones that share an
  // interactionId). The interaction's duration is input delay + handler +
  // presentation, which is what INP scores, so keep the worst per interaction.
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (!entry.interactionId) continue;
      const prev = window.__perf.interactions.get(entry.interactionId) || { duration: 0, name: '' };
      if (entry.duration > prev.duration) prev.duration = entry.duration;
      prev.name = entry.name;
      prev.label = window.__perf.tapLabel || prev.label || entry.name;
      window.__perf.interactions.set(entry.interactionId, prev);
    }
  }).observe({ type: 'event', buffered: true, durationThreshold: 16 });
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (entry.hadRecentInput) continue;
      window.__perf.cls += entry.value;
      window.__perf.shifts.push({
        value: Number(entry.value.toFixed(4)),
        at: Math.round(entry.startTime),
        sources: entry.sources?.map((s) => s.node?.nodeName).filter(Boolean).slice(0, 3)
      });
    }
  }).observe({ type: 'layout-shift', buffered: true });
});

await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(2500);

// Read the metrics before touching the app: switching views animates, and
// those shifts belong to navigation, not to the first load.
const report = await page.evaluate(() => {
  const nav = performance.getEntriesByType('navigation')[0];
  const paint = Object.fromEntries(performance.getEntriesByType('paint').map((p) => [p.name, p.startTime]));
  const all = document.getElementsByTagName('*');
  let depth = 0;
  const walk = (node, level) => {
    depth = Math.max(depth, level);
    for (const child of node.children) walk(child, level + 1);
  };
  walk(document.documentElement, 0);
  return {
    ttfb: nav.responseStart - nav.startTime,
    domContentLoaded: nav.domContentLoadedEventEnd - nav.startTime,
    load: nav.loadEventEnd - nav.startTime,
    fcp: paint['first-contentful-paint'] || null,
    lcp: window.__perf.lcp,
    lcpEl: window.__perf.lcpEl,
    cls: Number(window.__perf.cls.toFixed(4)),
    shifts: window.__perf.shifts,
    domNodes: all.length,
    domDepth: depth,
    bodyNodes: document.body.getElementsByTagName('*').length
  };
});

// INP: tap the controls a first-time visitor actually meets, in the order they
// meet them (open the allowance step, go back, dismiss the intro, switch tabs,
// open the add sheet and close it). Each tap's Event Timing entry is read by
// the page's observer above; the worst one is the interaction number.
const taps = [
  ['allowance step', 'dialog[open] .btn.ink'],
  ['step back', 'dialog[open] .text-btn'],
  ['set up later', 'dialog[open] .text-btn'],
  ['categories tab', '.bottom-nav a[href="#/categories"]'],
  ['today tab', '.bottom-nav a[href="#/today"]'],
  ['add sheet', '.fab'],
  ['close sheet', 'dialog[open] .icon-btn']
];
const missedTaps = [];
for (const [label, selector] of taps) {
  try {
    await page.evaluate((l) => {
      window.__perf.tapLabel = l;
    }, label);
    await page.locator(selector).first().tap({ timeout: 4000 });
    await page.waitForTimeout(400);
  } catch {
    missedTaps.push(label);
  }
}
const inp = await page.evaluate(() => {
  const list = [...window.__perf.interactions.values()];
  const worst = list.reduce((a, b) => (b.duration > a.duration ? b : a), { duration: 0, name: '', label: '' });
  return {
    worst: Math.round(worst.duration),
    label: `${worst.label || worst.name}`.trim(),
    count: list.length
  };
});

// The app renders one view at a time, so the DOM cost is per screen: sample
// each one and report the worst.
const routes = ['today', 'categories', 'subs', 'loans', 'accounts', 'settings'];
const dom = [];
for (const route of routes) {
  await page.evaluate((r) => {
    window.location.hash = `#/${r}`;
  }, route);
  await page.waitForTimeout(400);
  dom.push({ route, nodes: await page.evaluate(() => document.getElementsByTagName('*').length) });
}
const heaviest = dom.reduce((a, b) => (b.nodes > a.nodes ? b : a));

// What blocks the first render is decided by the markup, not by network
// priority: a module script is deferred, and a stylesheet with a
// non-matching media is not render-blocking.
const html = (await (await fetch(url)).text()).replace(/<noscript>[\s\S]*?<\/noscript>/g, '');
const renderBlocking = [];
for (const tag of html.match(/<(?:script|link)\b[^>]*>/g) || []) {
  if (/^<script/.test(tag)) {
    if (/\bsrc=/.test(tag) && !/type="module"|\basync\b|\bdefer\b/.test(tag)) renderBlocking.push(tag);
  } else if (/rel="stylesheet"/.test(tag) && !/media="(?:print|[^"]*and[^"]*)"/.test(tag)) {
    renderBlocking.push(tag);
  }
}

// Leave the app with a full navigation and come back with the browser's Back
// button, then ask the new document whether it was resumed from memory and
// whether the scroll position came back with it.
// Everything up to here is the first visit; the cache test below navigates
// away and back, and its requests do not belong in the chain report.
const firstVisitRequests = requests.slice();
const awayUrl = new URL('__away.html', url).href;
await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(600);
const scrollTarget = await page.evaluate(() => {
  window.scrollTo(0, 400);
  return window.scrollY;
});
await page.goto(awayUrl, { waitUntil: 'load' });
await page.waitForTimeout(200);
await page.goBack({ waitUntil: 'load' });
await page.waitForTimeout(400);
const bfcache = await page.evaluate(() => {
  const nav = performance.getEntriesByType('navigation')[0];
  const reasons = nav?.notRestoredReasons ?? null;
  const collect = (node) => [
    ...(node?.reasons || []),
    ...(node?.children || []).flatMap(collect)
  ];
  return {
    type: nav?.type,
    reasons: reasons ? collect(reasons) : [],
    restored: nav?.type === 'back_forward' && reasons === null,
    scrollY: window.scrollY,
    unloadListeners: window.__perf.unloadListeners
  };
});
const scrollRestored = Math.abs(bfcache.scrollY - scrollTarget) <= 2;

const origin = new URL(url).origin;
const external = firstVisitRequests.filter((r) => /^https?:/.test(r.url) && !r.url.startsWith(origin));
const total = firstVisitRequests.reduce((sum, r) => sum + (r.bytes || 0), 0);

await browser.close();
local?.server.close();

// The brief's thresholds: FCP 1.8s, LCP 2.5s, CLS 0.1, INP 200ms, and a full
// load under 3s. These are the numbers the run fails on, not decoration.
const BUDGETS = { fcp: 1800, lcp: 2500, cls: 0.1, inp: 200, load: 3000 };

const rows = [
  ['TTFB', `${Math.round(report.ttfb)} ms`],
  ['First Contentful Paint', report.fcp ? `${Math.round(report.fcp)} ms` : '—'],
  ['Largest Contentful Paint', `${Math.round(report.lcp)} ms  (${report.lcpEl || 'unknown'})`],
  ['Cumulative Layout Shift', String(report.cls)],
  [
    'Interaction to Next Paint',
    `${inp.count ? `${inp.worst} ms  (worst of ${inp.count}: ${inp.label})` : '—'}`
  ],
  ['DOMContentLoaded', `${Math.round(report.domContentLoaded)} ms`],
  ['Load', `${Math.round(report.load)} ms`],
  ['DOM nodes', `${report.domNodes} (depth ${report.domDepth}, body ${report.bodyNodes})`],
  ['DOM per route', dom.map((d) => `${d.route} ${d.nodes}`).join(' · ')],
  ['DOM heaviest route', `${heaviest.route} at ${heaviest.nodes}`],
  ['Requests', `${firstVisitRequests.length} (${Math.round(total / 1024)} KB encoded)`],
  ['Render-blocking tags', renderBlocking.length ? renderBlocking.length : 'none'],
  ['Third-party requests', external.length ? external.map((r) => r.url).join(', ') : 'none'],
  [
    'Back/forward cache',
    bfcache.restored ? `restored${scrollRestored ? '' : `, scroll ${bfcache.scrollY} of ${scrollTarget}`}` : `not restored (${bfcache.reasons.map((r) => r.reason).join(', ') || 'unknown'})`
  ],
  ['unload listeners', bfcache.unloadListeners.length ? bfcache.unloadListeners.join(', ') : 'none']
];

console.log(`\naudit: ${url}${flag('--no-throttle') ? ' (no throttling)' : ' (390x844, 4x CPU, slow 4G)'}\n`);
for (const [label, val] of rows) console.log(`  ${label.padEnd(26)} ${val}`);

if (report.shifts.length) {
  console.log('\n  layout shifts:');
  for (const shift of report.shifts) {
    console.log(`    ${shift.value} @ ${shift.at}ms  ${shift.sources?.join(', ') || ''}`);
  }
}

console.log('\n  request chain:');
for (const r of firstVisitRequests) {
  const size = r.bytes ? `${Math.round(r.bytes / 1024)} KB` : '—';
  console.log(`    [${String(r.depth)}] ${r.type.padEnd(9)} ${size.padStart(8)}  ${r.url.replace(origin, '')}`);
}

const overBudget = [];
if (report.fcp && report.fcp > BUDGETS.fcp) overBudget.push(`FCP ${Math.round(report.fcp)}ms > ${BUDGETS.fcp}`);
if (report.lcp > BUDGETS.lcp) overBudget.push(`LCP ${Math.round(report.lcp)}ms > ${BUDGETS.lcp}`);
if (report.cls > BUDGETS.cls) overBudget.push(`CLS ${report.cls} > ${BUDGETS.cls}`);
if (report.load > BUDGETS.load) overBudget.push(`Load ${Math.round(report.load)}ms > ${BUDGETS.load}`);

const failed =
  overBudget.length > 0 ||
  !inp.count ||
  inp.worst > BUDGETS.inp ||
  missedTaps.length > 0 ||
  external.length > 0 ||
  renderBlocking.length > 0 ||
  !bfcache.restored ||
  !scrollRestored ||
  bfcache.unloadListeners.length > 0;

for (const miss of overBudget) console.log(`    over budget: ${miss}`);
if (!inp.count) console.log('    over budget: no interactions were measured, so INP is unproven');
else if (inp.worst > BUDGETS.inp) console.log(`    over budget: INP ${inp.worst}ms > ${BUDGETS.inp}`);
if (missedTaps.length) console.log(`    interaction not found: ${missedTaps.join(', ')}`);
if (renderBlocking.length) for (const tag of renderBlocking) console.log(`    blocking: ${tag.slice(0, 140)}`);

if (failed) {
  console.error(
    '\naudit: FAIL (a metric over budget, INP unmeasured, an unexpected third-party/blocking request, or a back/forward cache regression)'
  );
  process.exitCode = 1;
} else {
  console.log('\naudit: OK');
}
