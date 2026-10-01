import fs from 'node:fs/promises';
import path from 'node:path';

const PREFIX = '/api/secondhandsongs';
const UPSTREAM = 'https://api.secondhandsongs.com';
const ALLOWED_PATH = /^\/(artist|performance|work|release|label|search)(\/[\w+%-]*)*(\?[\w=&%+.-]*)?$/;
// Anonymous limits from https://secondhandsongs.com/page/API/RateLimits: [window ms, max requests]
const WINDOWS = [
  [60e3, 20],
  [3600e3, 200],
  [86400e3, 1000],
];
const BACKOFF_MS = 60e3;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export default function shsApi({ apiKey, cacheDir }) {
  const stampsFile = path.join(cacheDir, '_sent.json');
  const inFlight = new Map();
  let sent = [];
  let queue = Promise.resolve();
  let pending = 0;

  const cacheFile = (endpoint) =>
    path.join(cacheDir, `${endpoint.replace(/[^\w.-]+/g, '_').replace(/^_/, '')}.json`);

  function waitTime(now) {
    sent = sent.filter((t) => now - t < WINDOWS[WINDOWS.length - 1][0]);
    let wait = 0;
    for (const [ms, max] of WINDOWS) {
      const inWindow = sent.filter((t) => now - t < ms);
      if (inWindow.length >= max) wait = Math.max(wait, inWindow[inWindow.length - max] + ms - now);
    }
    return wait;
  }

  async function fetchUpstream(endpoint) {
    for (;;) {
      const wait = waitTime(Date.now());
      if (wait > 0) {
        console.log(`[shs] ${pending} queued, waiting ${Math.ceil(wait / 1000)}s for rate limit`);
        await sleep(wait);
      }
      sent.push(Date.now());
      await fs.writeFile(stampsFile, JSON.stringify(sent));

      const res = await fetch(UPSTREAM + endpoint, {
        headers: { Accept: 'application/json', ...(apiKey && { 'X-API-Key': apiKey }) },
      });
      const body = await res.text();
      if (res.ok) return body;
      if (res.status === 429 || /too many requests/i.test(body)) {
        console.log(`[shs] rate limited by API, retrying ${endpoint} in ${BACKOFF_MS / 1000}s`);
        await sleep(BACKOFF_MS);
        continue;
      }
      throw Object.assign(new Error(body.slice(0, 200)), { status: res.status });
    }
  }

  async function load(endpoint) {
    const file = cacheFile(endpoint);
    try {
      return await fs.readFile(file, 'utf8');
    } catch {}

    pending++;
    const job = queue.then(async () => {
      const body = await fetchUpstream(endpoint);
      await fs.writeFile(file, body);
      console.log(`[shs] fetched ${endpoint} (${pending - 1} left)`);
      return body;
    });
    queue = job.catch(() => {}).finally(() => pending--);
    return job;
  }

  return {
    name: 'shs-api',
    async configureServer(server) {
      await fs.mkdir(cacheDir, { recursive: true });
      try {
        sent = JSON.parse(await fs.readFile(stampsFile, 'utf8'));
      } catch {}

      server.middlewares.use(PREFIX, async (req, res) => {
        const endpoint = req.url;
        if (req.method !== 'GET' || !ALLOWED_PATH.test(endpoint)) {
          res.statusCode = 400;
          return res.end();
        }
        if (!inFlight.has(endpoint)) {
          inFlight.set(endpoint, load(endpoint).finally(() => inFlight.delete(endpoint)));
        }
        try {
          const body = await inFlight.get(endpoint);
          res.setHeader('Content-Type', 'application/json');
          res.end(body);
        } catch (err) {
          res.statusCode = err.status || 502;
          res.end(JSON.stringify({ error: err.message }));
        }
      });
    },
  };
}
