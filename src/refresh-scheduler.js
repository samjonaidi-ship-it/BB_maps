// BB_Maps | src/refresh-scheduler.js | v1.0.2 | 2026-10-10 | BB
// Monthly map release. Every CHECK_MS it asks isRefreshDue(); when due it runs
// refresh-maps.sh (tiles + fonts + sprites + version.json as one release).
// Phones see the new version on their next daily check and re-download every
// installed pack together (CalExp5 tile-download-manager applyUpdate).
//
// Schedule (Sam, 2026-10-10): monthly, first Sunday 2:00 AM Pacific. Wall-clock
// is America/Los_Angeles, never UTC (Railway runs UTC). A missed slot (service
// down, failed run) catches up on the next check, retried every RETRY_MS.
// TILES_BUILD_DATE=YYYYMMDD pins a build: due only when the live one differs.
// MAPS_AUTO_REFRESH=0 turns the scheduler off.

import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout, setInterval, clearTimeout, clearInterval } from 'node:timers';

const TZ = 'America/Los_Angeles';
const CHECK_MS = 15 * 60_000;
const RETRY_MS = 6 * 60 * 60_000;
const RUN_HOUR_PT = 2;

const DEFAULT_BBOX = '-122.6,36.4,-121.2,37.95';

/** {year, month, day, weekday 0=Sun, hour} of an instant, in Pacific time. */
export function pacificParts(date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', hourCycle: 'h23', weekday: 'short',
  }).formatToParts(date).map(p => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday),
    hour: Number(parts.hour),
  };
}

/** Day of the month of the first Sunday, given any PT date in that month. */
export function firstSundayOfMonth({ day, weekday }) {
  const weekdayOfFirst = ((weekday - (day - 1)) % 7 + 7) % 7;
  return ((7 - weekdayOfFirst) % 7) + 1;
}

/**
 * Should a new map release be built now?
 * @param {object} o
 * @param {object|null} o.manifest - parsed version.json, null when missing/unreadable
 * @param {Date} o.now
 * @param {string} [o.pinned] - TILES_BUILD_DATE; '' / 'auto' = follow the monthly schedule
 * @param {string} [o.bbox] - TILES_BBOX the service is configured for
 * @returns {{due: boolean, reason: string}}
 */
export function isRefreshDue({ manifest, now, pinned = '', bbox = DEFAULT_BBOX }) {
  if (!manifest?.version || manifest.version === '0.0.0') return { due: true, reason: 'no release yet' };
  if (manifest.bbox && manifest.bbox !== bbox) return { due: true, reason: `coverage changed (${manifest.bbox} -> ${bbox})` };
  if (pinned && pinned !== 'auto') {
    // A republish of a build is versioned BUILD.N; "build" is the Protomaps date.
    const live = manifest.build ?? manifest.version;
    return live === pinned
      ? { due: false, reason: `pinned to ${pinned}` }
      : { due: true, reason: `pinned build ${pinned} differs from live ${live}` };
  }
  const pt = pacificParts(now);
  const builtAt = Date.parse(manifest.updatedAt);
  if (!Number.isFinite(builtAt)) return { due: true, reason: 'release has no build time' };
  const built = pacificParts(new Date(builtAt));
  if (built.year === pt.year && built.month === pt.month) return { due: false, reason: 'this month already built' };
  const first = firstSundayOfMonth(pt);
  const slotPassed = pt.day > first || (pt.day === first && pt.hour >= RUN_HOUR_PT);
  return slotPassed
    ? { due: true, reason: `monthly slot (first Sunday ${pt.month}/${first} ${RUN_HOUR_PT}:00 PT) passed` }
    : { due: false, reason: `waiting for first Sunday ${pt.month}/${first} ${RUN_HOUR_PT}:00 PT` };
}

async function readManifest(file) {
  try { return JSON.parse(await readFile(file, 'utf-8')); } catch { return null; }
}

/**
 * Start the monthly check. Returns a stop() for tests / shutdown.
 * @param {{log: object, script?: string, versionFile?: string, now?: () => Date}} opts
 */
export function startRefreshScheduler({ log, script = resolve('refresh-maps.sh'), versionFile, now = () => new Date() }) {
  if (process.env.MAPS_AUTO_REFRESH === '0') {
    log.info('[refresh] scheduler off (MAPS_AUTO_REFRESH=0)');
    return () => {};
  }
  // Same default as refresh-maps.sh ($DATA_DIR/version.json), not ./data under WORKDIR.
  const file = versionFile || process.env.VERSION_FILE || join(process.env.DATA_DIR || '/data', 'version.json');
  let running = false;
  let lastFailureAt = 0;

  const tick = async () => {
    if (running || Date.now() - lastFailureAt < RETRY_MS) return;
    const { due, reason } = isRefreshDue({
      manifest: await readManifest(file),
      now: now(),
      pinned: process.env.TILES_BUILD_DATE || '',
      bbox: process.env.TILES_BBOX || DEFAULT_BBOX,
    });
    if (!due) return;
    running = true;
    log.info(`[refresh] starting map release: ${reason}`);
    const child = spawn('sh', [script], { stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', d => log.info(String(d).trim()));
    child.stderr.on('data', d => log.warn(String(d).trim()));
    child.on('close', (code, signal) => {
      running = false;
      if (code === 0) {
        log.info('[refresh] map release published');
      } else {
        lastFailureAt = Date.now();
        log.error(`[refresh] map release FAILED (${signal ? `killed by ${signal}` : `exit ${code}`}) - live map unchanged, retry in 6 h`);
      }
    });
    child.on('error', (err) => {
      running = false;
      lastFailureAt = Date.now();
      log.error(`[refresh] could not start ${script}: ${err.message}`);
    });
  };

  const first = setTimeout(tick, 60_000);
  const timer = setInterval(tick, CHECK_MS);
  first.unref?.();
  timer.unref?.();
  return () => { clearTimeout(first); clearInterval(timer); };
}
