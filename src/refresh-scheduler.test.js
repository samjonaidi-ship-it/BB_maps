// BB_Maps | src/refresh-scheduler.test.js | v1.0.0 | 2026-10-10 | BB
// Monthly map release: isRefreshDue() against the PT schedule (first Sunday
// 2:00 AM America/Los_Angeles), incl. the DST fall-back night and the evening-PT
// hours when UTC is already in the next month. Then refresh-maps.sh itself, with
// stub pmtiles/wget on PATH: a failed extract must leave version.json untouched,
// a good run must publish tiles + fonts + sprites and write version.json last.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, mkdirSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { isRefreshDue, firstSundayOfMonth, pacificParts } from './refresh-scheduler.js';

const BBOX = '-122.6,36.4,-121.2,37.95';
const built = (updatedAt, extra = {}) => ({ version: '20261004', updatedAt, bbox: BBOX, ...extra });
const due = (manifest, iso, opts = {}) => isRefreshDue({ manifest, now: new Date(iso), bbox: BBOX, ...opts }).due;

test('firstSundayOfMonth', () => {
  assert.equal(firstSundayOfMonth({ day: 10, weekday: 6 }), 4); // Sat 2026-10-10 -> Sun 10/4
  assert.equal(firstSundayOfMonth({ day: 1, weekday: 0 }), 1);  // Sun 2026-11-01
  assert.equal(firstSundayOfMonth({ day: 1, weekday: 2 }), 6);  // Tue 2026-12-01 -> Sun 12/6
  assert.equal(firstSundayOfMonth({ day: 31, weekday: 4 }), 6); // Thu 2026-12-31 -> Sun 12/6
});

test('pacificParts reads wall-clock PT, not UTC', () => {
  const p = pacificParts(new Date('2026-12-01T05:00:00Z')); // Nov 30, 9:00 PM PST
  assert.deepEqual([p.year, p.month, p.day, p.hour, p.weekday], [2026, 11, 30, 21, 1]);
});

test('no release yet / placeholder / unreadable build time -> due', () => {
  assert.equal(due(null, '2026-10-10T12:00:00Z'), true);
  assert.equal(due({ version: '0.0.0' }, '2026-10-10T12:00:00Z'), true);
  assert.equal(due(built('garbage'), '2026-10-10T12:00:00Z'), true);
});

test('coverage box changed -> due now, whatever the date', () => {
  assert.equal(due(built('2026-10-04T09:30:00Z', { bbox: '-122.5,37,-121.5,37.5' }), '2026-10-05T12:00:00Z'), true);
});

test('pinned build: due only when the live one differs', () => {
  const m = built('2026-07-04T01:27:22Z', { version: '20260701' });
  assert.equal(due(m, '2026-10-10T12:00:00Z', { pinned: '20260701' }), false);
  assert.equal(due(m, '2026-10-10T12:00:00Z', { pinned: '20261005' }), true);
  assert.equal(due(m, '2026-10-10T12:00:00Z', { pinned: 'auto' }), true); // auto = monthly rule
});

test('live today: the July release is overdue (October slot was Sun 10/4)', () => {
  assert.equal(due(built('2026-07-04T01:27:22Z', { version: '20260701' }), '2026-10-10T19:00:00Z'), true);
});

test('already built this PT month -> not due', () => {
  assert.equal(due(built('2026-10-04T09:30:00Z'), '2026-10-28T12:00:00Z'), false);
});

test('evening PT on the last day: UTC says next month, PT does not -> not due', () => {
  // built Nov 1 PT; now Nov 30 9:00 PM PST = Dec 1 05:00Z
  assert.equal(due(built('2026-11-01T10:05:00Z'), '2026-12-01T05:00:00Z'), false);
});

test('waits for the first Sunday 2:00 AM PT, then catches up', () => {
  const nov = built('2026-11-01T10:05:00Z');
  assert.equal(due(nov, '2026-12-03T20:00:00Z'), false); // Thu 12/3, slot is Sun 12/6
  assert.equal(due(nov, '2026-12-06T09:59:00Z'), false); // Sun 1:59 AM PST
  assert.equal(due(nov, '2026-12-06T10:00:00Z'), true);  // Sun 2:00 AM PST
  assert.equal(due(nov, '2026-12-20T10:00:00Z'), true);  // missed slot still catches up
});

test('DST fall-back night (Sun 2026-11-01): 1 AM happens twice, 2:00 AM PST is the slot', () => {
  const oct = built('2026-10-04T09:30:00Z');
  assert.equal(due(oct, '2026-11-01T08:30:00Z'), false); // 1:30 AM PDT
  assert.equal(due(oct, '2026-11-01T09:30:00Z'), false); // 1:30 AM PST (the repeat)
  assert.equal(due(oct, '2026-11-01T10:00:00Z'), true);  // 2:00 AM PST
});

test('spring-forward month (Sun 2027-03-07, 2 AM skipped): due from 3:00 AM PDT', () => {
  const feb = built('2027-02-07T10:05:00Z');
  assert.equal(due(feb, '2027-03-07T09:59:00Z'), false); // 1:59 AM PST
  assert.equal(due(feb, '2027-03-07T10:00:00Z'), true);  // 3:00 AM PDT (2 AM does not exist)
});

// ── refresh-maps.sh with stub tools ───────────────────────────────────────
const SCRIPT = resolve('refresh-maps.sh');
const hasSh = spawnSync('sh', ['-c', 'command -v tar && date -u -d 2026-10-10 +%Y'], { encoding: 'utf-8' }).status === 0;

// Git Bash on Windows: GNU tar reads "C:\x" as a remote host, so hand sh POSIX paths.
const sh = (p) => (process.platform === 'win32' ? p.replace(/^([A-Za-z]):/, (_, d) => `/${d.toLowerCase()}`).replace(/\\/g, '/') : p);

function stubEnv(t, { extractFails }) {
  const root = mkdtempSync(join(tmpdir(), 'bbrefresh-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = join(root, 'bin');
  const data = join(root, 'data');
  mkdirSync(bin); mkdirSync(data);
  // pmtiles: extract writes 2 KB (or fails), show succeeds.
  writeFileSync(join(bin, 'pmtiles'), `#!/bin/sh
case "$1" in
  extract) ${extractFails ? 'echo "stub: upstream 404" >&2; exit 1' : 'head -c 2048 /dev/zero > "$3"'} ;;
  show) exit 0 ;;
esac
`);
  // wget: --spider succeeds only for 20261007; -O builds a basemaps-assets tarball.
  writeFileSync(join(bin, 'wget'), `#!/bin/sh
for a in "$@"; do last="$a"; done
case " $* " in
  *" --spider "*) case "$last" in *20261007.pmtiles) exit 0 ;; *) exit 8 ;; esac ;;
esac
out=""; while [ $# -gt 0 ]; do [ "$1" = "-O" ] && out="$2"; shift; done
s=$(mktemp -d); mkdir -p "$s/basemaps-assets-main/fonts/Noto Sans Regular" "$s/basemaps-assets-main/sprites/v4"
echo f > "$s/basemaps-assets-main/fonts/Noto Sans Regular/0-255.pbf"
echo '{}' > "$s/basemaps-assets-main/sprites/v4/light.json"
tar -czf "$out" -C "$s" basemaps-assets-main; rm -rf "$s"
`);
  chmodSync(join(bin, 'pmtiles'), 0o755); chmodSync(join(bin, 'wget'), 0o755);
  const sep = process.platform === 'win32' ? ';' : ':';
  return {
    data,
    env: {
      ...process.env, PATH: `${bin}${sep}${process.env.PATH}`, DATA_DIR: sh(data),
      PMTILES_BIN: sh(join(bin, 'pmtiles')), TILES_MIN_BYTES: '1000', REFRESH_TODAY: '2026-10-10', TILES_BUILD_DATE: 'auto',
    },
  };
}

test('refresh-maps.sh: failed extract leaves the live release and version.json untouched', { skip: !hasSh && 'no POSIX sh/GNU date' }, (t) => {
  const { data, env } = stubEnv(t, { extractFails: true });
  const before = '{"version":"20260701","updatedAt":"2026-07-04T01:27:22Z"}';
  writeFileSync(join(data, 'version.json'), before);
  const r = spawnSync('sh', [SCRIPT], { env, encoding: 'utf-8' });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.equal(readFileSync(join(data, 'version.json'), 'utf-8'), before);
  assert.equal(existsSync(join(data, 'tiles', 'bay-area.pmtiles')), false);
  assert.equal(existsSync(join(data, '.staging')), false, 'staging cleaned up');
  assert.equal(existsSync(join(data, '.refresh.lock')), false, 'lock released');
});

test('refresh-maps.sh: newest existing build, all pieces swapped in, version.json last', { skip: !hasSh && 'no POSIX sh/GNU date' }, (t) => {
  const { data, env } = stubEnv(t, { extractFails: false });
  const r = spawnSync('sh', [SCRIPT], { env, encoding: 'utf-8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const v = JSON.parse(readFileSync(join(data, 'version.json'), 'utf-8'));
  assert.equal(v.version, '20261007'); // 10/10, 10/9, 10/8 missing upstream
  assert.equal(v.bbox, BBOX);
  assert.equal(v.tiles['bay-area.pmtiles'].bytes, 2048);
  assert.ok(v.assets['fonts.tar'].bytes > 0 && v.assets['sprites.tar'].bytes > 0);
  assert.equal(v.totalSize, 2048 + v.assets['fonts.tar'].bytes + v.assets['sprites.tar'].bytes);
  assert.ok(existsSync(join(data, 'fonts', 'Noto Sans Regular', '0-255.pbf')));
  assert.ok(existsSync(join(data, 'sprites', 'light.json')));
  assert.ok(existsSync(join(data, 'assets', 'fonts.tar')));
  assert.equal(existsSync(join(data, '.refresh.lock')), false);
});
