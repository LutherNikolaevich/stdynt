// WebPageTest run for the deployed app.
//
//   WPT_API_KEY=... WPT_URL=https://stdynt.example node scripts/wpt.mjs
//
// Optional: WPT_LOCATION (default Dulles_MotoG4), WPT_RUNS (default 3).
// Get a key at https://www.webpagetest.org/getkey.php; the free tier is
// rate-limited, which is why this is a manual command and not part of CI.
//
// The run asks for three runs on a Moto G4 over 4G with video and the
// Lighthouse pass on, then prints the median of the filmstrip metrics — the
// same numbers the WebPageTest result page leads with.

const key = process.env.WPT_API_KEY;
const target = process.env.WPT_URL;
if (!key || !target) {
  console.error('Set WPT_API_KEY and WPT_URL. See the header of scripts/wpt.mjs.');
  process.exit(1);
}

const location = process.env.WPT_LOCATION || 'Dulles_MotoG4';
const runs = process.env.WPT_RUNS || '3';
const api = 'https://www.webpagetest.org';

const submit = new URL(`${api}/runtest.php`);
for (const [name, value] of Object.entries({
  k: key,
  f: 'json',
  url: target,
  location,
  runs,
  video: '1',
  lighthouse: '1',
  mobile: '1',
  connectivity: '4G',
  medianMetric: 'SpeedIndex',
  label: 'stdynt perf'
})) {
  submit.searchParams.set(name, value);
}

const submitted = await (await fetch(submit)).json();
if (submitted.statusCode !== 200) {
  console.error(`WebPageTest refused the test: ${submitted.statusText}`);
  process.exit(1);
}
const testId = submitted.data.testId;
console.log(`submitted ${testId} (${location}, ${runs} runs, 4G)\n${submitted.data.userUrl}`);

const wait = (ms) => new Promise((done) => setTimeout(done, ms));
for (;;) {
  await wait(15_000);
  const result = await (await fetch(`${api}/jsonResult.php?test=${testId}&f=json`)).json();
  if (result.statusCode === 100 || result.statusCode === 101) {
    process.stdout.write(`  ${result.data.statusText}\r`);
    continue;
  }
  if (result.statusCode !== 200) {
    console.error(`\ntest failed: ${result.statusText}`);
    process.exit(1);
  }

  const { runs: all, median, location: where } = result.data;
  const firstView = all[median.firstView];
  const summary = firstView.firstView;

  const rows = [
    ['Location', `${where}, r${median.firstView + 1} of ${all.length}`],
    ['TTFB', `${summary.TTFB} ms`],
    ['First Contentful Paint', `${summary.firstContentfulPaint} ms`],
    ['Largest Contentful Paint', `${summary.largestContentfulPaint ?? '—'} ms`],
    ['Speed Index', `${summary.SpeedIndex} ms`],
    ['Cumulative Layout Shift', String(summary['chromeUserTiming.CumulativeLayoutShift'] ?? '—')],
    ['Start Render', `${summary.render} ms`],
    ['Load', `${summary.loadTime} ms`],
    ['Bytes', `${Math.round(summary.bytesIn / 1024)} KB in`],
    ['Requests', String(summary.requestsFull ?? summary.requests)],
    ['Report', `https://www.webpagetest.org/result/${testId}/`]
  ];

  console.log(`\ntest ${testId}`);
  for (const [label, value] of rows) console.log(`  ${label.padEnd(26)} ${value}`);

  // The app is same-origin, so a third party in a build without consent
  // configured is a regression.
  const listed = Array.isArray(summary.requests) ? summary.requests : [];
  const origin = new URL(target).origin;
  const thirdParty = listed.filter((r) => {
    try {
      return /^https?:/.test(r.full_url || '') && new URL(r.full_url).origin !== origin;
    } catch {
      return false;
    }
  });
  console.log(`  Third-party requests       ${thirdParty.length ? thirdParty.map((r) => new URL(r.full_url).host).join(', ') : 'none'}`);
  break;
}
