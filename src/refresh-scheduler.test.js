// BB_Maps | src/refresh-scheduler.test.js | v1.2.0 | 2026-10-10 | BB
// v1.2.0 (Devin, PR #11 reds 18 + 20): version.json going live is the commit
//         point; Compose keeps styles on their own volume.
// v1.1.0 (Devin round 1): republish versioning, pinned-by-build, mid-swap and
//         killed-run rollback, Dockerfile/compose /data wiring.
// Monthly map release: isRefreshDue() against the PT schedule (first Sunday
// 2:00 AM America/Los_Angeles), incl. the DST fall-back night and the evening-PT
// hours when UTC is already in the next month. Then refresh-maps.sh itself, with
// stub pmtiles/wget on PATH: a failed extract must leave version.json untouched,
// a good run must publish tiles + fonts + sprites and write version.json last.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, mkdirSync, chmodSync, readdirSync } from 'node:fs';
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

test('pinned build vs a republished version (BUILD.N): compares "build", not "version"', () => {
  const m = built('2026-10-08T09:00:00Z', { version: '20261007.1', build: '20261007' });
  assert.equal(due(m, '2026-10-10T12:00:00Z', { pinned: '20261007' }), false);
  assert.equal(due(m, '2026-10-10T12:00:00Z', { pinned: '20261008' }), true);
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
  assert.equal(existsSync(join(data, '.prev')), false, 'committed: no .prev left');
});

test('refresh-maps.sh: republishing the same build bumps the version (BUILD.1, BUILD.2)', { skip: !hasSh && 'no POSIX sh/GNU date' }, (t) => {
  const { data, env } = stubEnv(t, { extractFails: false });
  const run = () => {
    const r = spawnSync('sh', [SCRIPT], { env, encoding: 'utf-8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    return JSON.parse(readFileSync(join(data, 'version.json'), 'utf-8'));
  };
  assert.deepEqual([run().version, run().version, run().version], ['20261007', '20261007.1', '20261007.2']);
  assert.equal(run().build, '20261007');
});

test('refresh-maps.sh: auto mode never publishes a build older than the live one', { skip: !hasSh && 'no POSIX sh/GNU date' }, (t) => {
  const { data, env } = stubEnv(t, { extractFails: false });
  const live = '{"version":"20261009","build":"20261009","updatedAt":"2026-10-09T09:00:00Z"}';
  writeFileSync(join(data, 'version.json'), live);
  const r = spawnSync('sh', [SCRIPT], { env, encoding: 'utf-8' }); // stub's newest is 20261007
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /not downgrading/);
  assert.equal(readFileSync(join(data, 'version.json'), 'utf-8'), live);
  // A pinned date may go back on purpose.
  const pinned = spawnSync('sh', [SCRIPT], { env: { ...env, TILES_BUILD_DATE: '20261007' }, encoding: 'utf-8' });
  assert.equal(pinned.status, 0, pinned.stdout + pinned.stderr);
});

test('refresh-maps.sh: a failure mid-swap restores EVERY piece of the old release', { skip: !hasSh && 'no POSIX sh/GNU date' }, (t) => {
  const { data, env } = stubEnv(t, { extractFails: false });
  // Release A, already live.
  const old = {
    'version.json': '{"version":"20260701","updatedAt":"2026-07-04T01:27:22Z"}',
    'tiles/bay-area.pmtiles': 'OLD-TILES',
    'assets/fonts.tar': 'OLD-FONTS-TAR',
    'assets/sprites.tar': 'OLD-SPRITES-TAR',
    'fonts/Noto Sans Regular/0-255.pbf': 'OLD-FONT',
    'sprites/light.json': 'OLD-SPRITE',
  };
  for (const [p, body] of Object.entries(old)) {
    mkdirSync(join(data, p, '..'), { recursive: true });
    writeFileSync(join(data, p), body);
  }
  // mv fails only when moving the staged tile file in: fonts, sprites and both
  // tars are already swapped by then, so all four must come back.
  const realMv = spawnSync('sh', ['-c', 'command -v mv'], { encoding: 'utf-8' }).stdout.trim();
  const bin = join(data, '..', 'bin');
  writeFileSync(join(bin, 'mv'), `#!/bin/sh
case "$*" in *.staging*bay-area.pmtiles*) echo "stub mv: disk error" >&2; exit 1 ;; esac
exec "${realMv}" "$@"
`);
  chmodSync(join(bin, 'mv'), 0o755);
  const r = spawnSync('sh', [SCRIPT], { env, encoding: 'utf-8' });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /FAILED mid-swap: tile swap/);
  for (const [p, body] of Object.entries(old)) {
    assert.equal(readFileSync(join(data, p), 'utf-8'), body, `${p} restored`);
  }
  assert.equal(existsSync(join(data, '.prev')), false, '.prev cleaned up');
  assert.equal(existsSync(join(data, '.staging')), false);
});

test('refresh-maps.sh: a run killed mid-swap (.prev left behind) is restored by the next run', { skip: !hasSh && 'no POSIX sh/GNU date' }, (t) => {
  const { data, env } = stubEnv(t, { extractFails: true });
  // Killed after fonts moved to .prev and the new fonts moved in; version.json never swapped.
  mkdirSync(join(data, 'fonts'), { recursive: true });
  writeFileSync(join(data, 'fonts', 'x'), 'NEW');
  mkdirSync(join(data, '.prev', 'fonts'), { recursive: true });
  writeFileSync(join(data, '.prev', 'fonts', 'x'), 'OLD');
  writeFileSync(join(data, '.prev', 'sprites.created'), '');
  mkdirSync(join(data, 'sprites'));
  const r = spawnSync('sh', [SCRIPT], { env, encoding: 'utf-8' });
  assert.equal(r.status, 1, r.stdout + r.stderr); // extract stub fails afterwards
  assert.match(r.stdout, /interrupted release/);
  assert.equal(readFileSync(join(data, 'fonts', 'x'), 'utf-8'), 'OLD');
  assert.equal(existsSync(join(data, 'sprites')), false, 'piece the killed run created is removed');
  assert.equal(existsSync(join(data, '.prev')), false);
});

test('refresh-maps.sh: an interrupted release that cannot be restored stops the run and keeps .prev', { skip: !hasSh && 'no POSIX sh/GNU date' }, (t) => {
  const { data, env } = stubEnv(t, { extractFails: false });
  mkdirSync(join(data, 'fonts'), { recursive: true });
  writeFileSync(join(data, 'fonts', 'x'), 'NEW');
  mkdirSync(join(data, '.prev', 'fonts'), { recursive: true });
  writeFileSync(join(data, '.prev', 'fonts', 'x'), 'OLD');
  const realMv = spawnSync('sh', ['-c', 'command -v mv'], { encoding: 'utf-8' }).stdout.trim();
  const bin = join(data, '..', 'bin');
  writeFileSync(join(bin, 'mv'), `#!/bin/sh
case "$*" in *.prev/fonts*) echo "stub mv: disk error" >&2; exit 1 ;; esac
exec "${realMv}" "$@"
`);
  chmodSync(join(bin, 'mv'), 0o755);
  const r = spawnSync('sh', [SCRIPT], { env, encoding: 'utf-8' });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /could not restore the interrupted release/);
  assert.doesNotMatch(r.stdout + r.stderr, /not found/);
  assert.doesNotMatch(r.stdout, /build 2026/, 'no new build was started');
  assert.equal(readFileSync(join(data, '.prev', 'fonts', 'x'), 'utf-8'), 'OLD', 'last good copy kept');
  assert.equal(existsSync(join(data, 'version.json')), false);
});

// Devin, PR #11 red 20: once version.json is live, phones may already have the
// new version - a later failure must never roll the files back under it.
test('refresh-maps.sh: a failure AFTER version.json went live keeps the new release', { skip: !hasSh && 'no POSIX sh/GNU date' }, (t) => {
  const { data, env } = stubEnv(t, { extractFails: false });
  writeFileSync(join(data, 'version.json'), '{"version":"20260701","updatedAt":"2026-07-04T01:27:22Z"}');
  mkdirSync(join(data, 'fonts')); writeFileSync(join(data, 'fonts', 'old'), 'OLD');
  // Only the .prev cleanup rename fails.
  const realMv = spawnSync('sh', ['-c', 'command -v mv'], { encoding: 'utf-8' }).stdout.trim();
  const bin = join(data, '..', 'bin');
  writeFileSync(join(bin, 'mv'), `#!/bin/sh
case "$*" in *.prev*.prev.done*) echo "stub mv: disk error" >&2; exit 1 ;; esac
exec "${realMv}" "$@"
`);
  chmodSync(join(bin, 'mv'), 0o755);
  const r = spawnSync('sh', [SCRIPT], { env, encoding: 'utf-8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /could not be cleared/);
  assert.doesNotMatch(r.stdout, /rolled back/);
  assert.equal(JSON.parse(readFileSync(join(data, 'version.json'), 'utf-8')).version, '20261007');
  assert.ok(existsSync(join(data, 'fonts', 'Noto Sans Regular', '0-255.pbf')), 'new fonts stay live');
  assert.equal(readFileSync(join(data, 'tiles', 'bay-area.pmtiles')).length, 2048, 'new tiles stay live');
  assert.ok(existsSync(join(data, '.prev', 'version.json')), 'old release left for the next run to clear');
});

test('refresh-maps.sh: next run finds a committed release (.prev + live version.json) and clears .prev, no rollback', { skip: !hasSh && 'no POSIX sh/GNU date' }, (t) => {
  const { data, env } = stubEnv(t, { extractFails: true });
  const live = '{"version":"20261007","build":"20261007","updatedAt":"2026-10-11T04:37:10Z"}';
  writeFileSync(join(data, 'version.json'), live);
  mkdirSync(join(data, 'fonts')); writeFileSync(join(data, 'fonts', 'x'), 'NEW');
  mkdirSync(join(data, '.prev', 'fonts'), { recursive: true });
  writeFileSync(join(data, '.prev', 'fonts', 'x'), 'OLD');
  writeFileSync(join(data, '.prev', 'version.json'), '{"version":"20260701"}');
  const r = spawnSync('sh', [SCRIPT], { env, encoding: 'utf-8' });
  assert.equal(r.status, 1, r.stdout + r.stderr); // extract stub fails afterwards
  assert.match(r.stdout, /committed release/);
  assert.doesNotMatch(r.stdout, /interrupted release|rolled back/);
  assert.equal(readFileSync(join(data, 'version.json'), 'utf-8'), live);
  assert.equal(readFileSync(join(data, 'fonts', 'x'), 'utf-8'), 'NEW');
  assert.equal(existsSync(join(data, '.prev')), false);
});

test('refresh-maps.sh: a rollback that was already under way is finished, never read as committed', { skip: !hasSh && 'no POSIX sh/GNU date' }, (t) => {
  const { data, env } = stubEnv(t, { extractFails: true });
  // A previous rollback marked .prev, then stopped before restoring version.json.
  writeFileSync(join(data, 'version.json'), '{"version":"20261007"}');
  mkdirSync(join(data, '.prev'));
  writeFileSync(join(data, '.prev', '.rollback'), '');
  writeFileSync(join(data, '.prev', 'version.json'), '{"version":"20260701"}');
  const r = spawnSync('sh', [SCRIPT], { env, encoding: 'utf-8' });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /interrupted release/);
  assert.equal(readFileSync(join(data, 'version.json'), 'utf-8'), '{"version":"20260701"}');
  assert.equal(existsSync(join(data, '.prev')), false);
});

test('refresh-maps.sh: a rollback marker that cannot be written still restores every piece', { skip: !hasSh && 'no POSIX sh/GNU date' }, (t) => {
  const { data, env } = stubEnv(t, { extractFails: true });
  mkdirSync(join(data, 'fonts')); writeFileSync(join(data, 'fonts', 'x'), 'NEW');
  mkdirSync(join(data, '.prev', 'fonts'), { recursive: true });
  writeFileSync(join(data, '.prev', 'fonts', 'x'), 'OLD');
  mkdirSync(join(data, '.prev', '.rollback')); // a directory: `: > .rollback` fails
  const r = spawnSync('sh', [SCRIPT], { env, encoding: 'utf-8' });
  assert.equal(r.status, 1, r.stdout + r.stderr); // extract stub fails afterwards
  assert.match(r.stdout, /could not mark .* restoring anyway/);
  assert.equal(readFileSync(join(data, 'fonts', 'x'), 'utf-8'), 'OLD');
  assert.equal(existsSync(join(data, '.prev')), false);
});

// ── image / compose wiring: the routes must read where the release is written ──
test('Dockerfile sets every data path the routes read, all under /data', () => {
  const docker = readFileSync(resolve('Dockerfile'), 'utf-8');
  const envs = Object.fromEntries([...docker.matchAll(/\b([A-Z_]+(?:_DIR|_FILE))=(\S+)/g)].map(m => [m[1], m[2]]));
  const routes = join(resolve('src'), 'routes');
  const read = new Set();
  for (const f of readdirSync(routes).filter(f => f.endsWith('.js') && !f.endsWith('.test.js'))) {
    for (const m of readFileSync(join(routes, f), 'utf-8').matchAll(/process\.env\.([A-Z_]+(?:_DIR|_FILE))/g)) read.add(m[1]);
  }
  assert.ok(read.size >= 6, `found ${[...read]}`);
  for (const name of read) {
    assert.ok(envs[name], `Dockerfile has no ENV ${name} - the route falls back to /app/data`);
    assert.match(envs[name], /^\/data\//, `${name}=${envs[name]} is not on the /data volume`);
  }
});

test('docker-compose: one release volume at /data, styles kept on its own volume, no release piece mounted', () => {
  const compose = readFileSync(resolve('docker-compose.yml'), 'utf-8');
  const svc = compose.split(/\n {2}photon:/)[0]; // bb-maps service block only
  const mounts = Object.fromEntries([...svc.matchAll(/^\s+- ([\w.-]+):(\/\S*)\s*$/gm)].map(m => [m[2], m[1]]));
  assert.deepEqual(Object.keys(mounts).sort(), ['/data', '/data/styles']);
  // styles-data is the pre-#11 volume: existing Compose styles must survive the upgrade.
  assert.equal(mounts['/data/styles'], 'styles-data');
  assert.match(compose, /\nvolumes:[\s\S]*\n {2}styles-data:/, 'styles-data declared');
  // refresh-maps.sh renames these; a mount point cannot be renamed.
  for (const piece of ['/data/tiles', '/data/fonts', '/data/sprites', '/data/assets']) {
    assert.equal(mounts[piece], undefined, `${piece} must not be a mount point`);
  }
});
