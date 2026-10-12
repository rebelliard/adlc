// Concern: the recorder and `tier-check` pass the ticket under prosecution to
// classifyTrustRootTier as `ownTicket` (#1180), end-to-end at the process
// boundary in a real git repo.
//
// Properties pinned:
//   - `tier-check --ticket T2` on a change that adds T2 with a rail and edits
//     that rail does NOT tier; stderr names the skipped rail and --json lists it;
//   - the same change without --ticket still tiers (the CI form is unchanged);
//   - --ticket naming ANOTHER ticket still tiers on T2's rail;
//   - an own rail already on the base still tiers, and the base copy's rails
//     still apply when HEAD narrows them;
//   - the recorder on an own-new-rail change with a dry panel and no attestation
//     exits 0 and writes no p5-cross-model-missing entry.
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { sha256 } from '@adlc/core';
import { resolveProsecutionRevision } from '../lib/run.mjs';

const fixtureDirs = new Set();
after(() => { for (const dir of fixtureDirs) rmSync(dir, { recursive: true, force: true }); });

const BIN = new URL('../bin/adlc-prosecute.mjs', import.meta.url).pathname;

process.env.ADLC_MANIFEST_KEY = 'test-tier-own-ticket-signing-key';

// spawnSync so stderr is captured on the exit-0 path too (the skipped-rail line).
function runBin(args, cwd, env = {}) {
  const r = spawnSync(process.execPath, [BIN, ...args], {
    cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env },
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

const PINNED_GIT_DATE = '2026-01-01T00:00:00Z';

const T = (over = {}) => ({ id: 'T1', title: 'x', scope: ['src/**'], rails: [], edges: [], ...over });

const writeTickets = (dir, tickets) => writeFileSync(join(dir, '.adlc', 'tickets.json'), JSON.stringify({ tickets }));

function writeFile(dir, rel, content) {
  const abs = join(dir, ...rel.split('/'));
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, content);
}

// Scratch repo: `baseTickets` and `baseFiles` committed on main, then on a feat
// branch `headTickets` replaces the table and `headFiles` are written and
// committed. The review-packet placeholders are committed on main so no
// untracked evidence file perturbs the changed-file set.
function scratchRepo({ baseTickets, headTickets, baseFiles = {}, headFiles = {} }) {
  const dir = mkdtempSync(join(tmpdir(), 'adlc-tier-own-ticket-'));
  fixtureDirs.add(dir);
  const g = (...a) => execFileSync('git', a, {
    cwd: dir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    env: { ...process.env, GIT_AUTHOR_DATE: PINNED_GIT_DATE, GIT_COMMITTER_DATE: PINNED_GIT_DATE },
  });
  g('init', '-q', '-b', 'main');
  g('config', 'user.email', 't@t.co');
  g('config', 'user.name', 'tester');
  g('config', 'commit.gpgsign', 'false');
  writeFile(dir, 'README.md', 'baseline\n');
  mkdirSync(join(dir, '.adlc'), { recursive: true });
  writeTickets(dir, baseTickets);
  for (const [rel, content] of Object.entries(baseFiles)) writeFile(dir, rel, content);
  writeFile(dir, '.adlc/review.txt', 'placeholder\n');
  writeFile(dir, '.adlc/prompt.txt', 'review prompt\n');
  writeFile(dir, '.adlc/inputs.txt', 'reviewed input packet\n');
  g('add', '-A'); g('commit', '-qm', 'baseline');
  g('checkout', '-q', '-b', 'feat');
  writeTickets(dir, headTickets);
  for (const [rel, content] of Object.entries(headFiles)) writeFile(dir, rel, content);
  g('add', '-A'); g('commit', '-qm', 'feat change');
  return dir;
}

// The bounded-ticket shape from #1180: the change ADDS ticket T2, declares its
// RED test as a rail, and writes that test.
const ownNewRailRepo = () => scratchRepo({
  baseTickets: [T()],
  headTickets: [T(), T({ id: 'T2', rails: ['test/own/**'] })],
  headFiles: { 'test/own/red.test.mjs': 'export const red = 1;\n' },
});

const tierCheck = (dir, extra = []) =>
  runBin(['tier-check', '--base', 'main', '--author-provider', 'anthropic', '--dir', '.adlc', ...extra], dir);

const SKIP_LINE = 'tier: skipped own new rail of ticket T2: test/own/** (not on base main)';

describe('tier-check --ticket skips only that ticket\'s own new rails (#1180)', () => {
  it('an own new rail does not tier; stderr names it and --json lists it', () => {
    const dir = ownNewRailRepo();
    const r = tierCheck(dir, ['--ticket', 'T2', '--json']);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout), {
      trustRootTier: false, reasons: [], crossModelRequired: false, satisfied: true, skippedOwnRails: ['test/own/**'],
    });
    assert.ok(r.stderr.includes(SKIP_LINE), r.stderr);
  });

  it('without --ticket the same change still tiers (unchanged CI behaviour)', () => {
    const dir = ownNewRailRepo();
    const r = tierCheck(dir, ['--json']);
    assert.equal(r.status, 2);
    const out = JSON.parse(r.stdout);
    assert.equal(out.trustRootTier, true);
    assert.deepEqual(out.reasons, ['touches rails deny-path of ticket T2: test/own/**']);
    assert.deepEqual(out.skippedOwnRails, []);
    assert.ok(!r.stderr.includes('skipped own new rail'), r.stderr);
  });

  it('--ticket naming another ticket still tiers on the added ticket\'s rail', () => {
    const dir = ownNewRailRepo();
    const r = tierCheck(dir, ['--ticket', 'T1', '--json']);
    assert.equal(r.status, 2);
    assert.deepEqual(JSON.parse(r.stdout).reasons, ['touches rails deny-path of ticket T2: test/own/**']);
  });

  it('own ticket on the base with rail a, HEAD adds rail b: a tiers, b does not', () => {
    const repo = (file) => scratchRepo({
      baseTickets: [T({ rails: ['src/a/**'] })],
      headTickets: [T({ rails: ['src/a/**', 'src/b/**'] })],
      baseFiles: { 'src/a/x.mjs': 'v1\n', 'src/b/x.mjs': 'v1\n' },
      headFiles: { [file]: 'v2\n' },
    });
    const a = tierCheck(repo('src/a/x.mjs'), ['--ticket', 'T1', '--json']);
    assert.equal(a.status, 2);
    assert.deepEqual(JSON.parse(a.stdout).reasons, ['touches rails deny-path of ticket T1: src/a/**']);
    const b = tierCheck(repo('src/b/x.mjs'), ['--ticket', 'T1', '--json']);
    assert.equal(b.status, 0, b.stderr);
    assert.deepEqual(JSON.parse(b.stdout).skippedOwnRails, ['src/b/**']);
  });

  it('a base rail still tiers when HEAD narrows the ticket\'s rails', () => {
    const dir = scratchRepo({
      baseTickets: [T({ rails: ['src/a/**', 'src/b/**'] })],
      headTickets: [T({ rails: ['src/a/**'] })],
      baseFiles: { 'src/b/x.mjs': 'v1\n' },
      headFiles: { 'src/b/x.mjs': 'v2\n' },
    });
    const r = tierCheck(dir, ['--ticket', 'T1', '--json']);
    assert.equal(r.status, 2);
    assert.deepEqual(JSON.parse(r.stdout).reasons, ['touches rails deny-path of ticket T1: src/b/**']);
  });

  it('an in-repo --dir table is read at the base too: its base rail tiers, its new rail is skipped', () => {
    const table = (rails) => JSON.stringify({ tickets: [T({ rails })] });
    const repo = (file) => scratchRepo({
      baseTickets: [],
      headTickets: [],
      baseFiles: { 'custom/tickets.json': table(['src/a/**']), 'src/a/x.mjs': 'v1\n', 'src/b/x.mjs': 'v1\n' },
      headFiles: { 'custom/tickets.json': table(['src/a/**', 'src/b/**']), [file]: 'v2\n' },
    });
    const custom = (dir) => runBin(['tier-check', '--base', 'main', '--author-provider', 'anthropic', '--dir', 'custom', '--ticket', 'T1', '--json'], dir);
    const a = custom(repo('src/a/x.mjs'));
    assert.equal(a.status, 2, 'a rail the base --dir table already declares must still tier');
    assert.deepEqual(JSON.parse(a.stdout).reasons, ['touches rails deny-path of ticket T1: src/a/**']);
    const b = custom(repo('src/b/x.mjs'));
    assert.equal(b.status, 0, b.stderr);
    assert.deepEqual(JSON.parse(b.stdout).skippedOwnRails, ['src/b/**']);
  });

  it('a malformed --dir table at the base fails closed (exit 1) instead of reading as "no base rails"', () => {
    const dir = scratchRepo({
      baseTickets: [],
      headTickets: [],
      baseFiles: { 'custom/tickets.json': '{"tickets": null}' },
      headFiles: { 'custom/tickets.json': JSON.stringify({ tickets: [T({ rails: ['src/**'] })] }), 'src/app.mjs': 'v2\n' },
    });
    const r = runBin(['tier-check', '--base', 'main', '--author-provider', 'anthropic', '--dir', 'custom', '--ticket', 'T1'], dir);
    assert.equal(r.status, 1, r.stderr);
    assert.match(r.stderr, /non-array `tickets` field/);
  });
});

// Bind the transcript to `revision` and write a dry, converging passes input
// (all under .adlc/, so the resolved revision stays stable).
function writePasses(dir, ticket, revision) {
  const adlc = join(dir, '.adlc');
  writeFileSync(join(adlc, 'review.txt'), [
    `ticket: ${ticket}`,
    `reviewed revision: ${revision}`,
    'review transcript fixture with enough detail to be accepted as evidence',
    'review transcript fixture with enough detail to be accepted as evidence',
  ].join('\n'));
  const prompt = join(adlc, 'prompt.txt');
  const inputs = join(adlc, 'inputs.txt');
  writeFileSync(join(adlc, 'passes.json'), JSON.stringify({
    provenance: { reviewer: 'r', session: 's', command: 'c', transcript: join(adlc, 'review.txt') },
    review_packet: {
      prompt, prompt_hash: sha256(readFileSync(prompt)),
      inputs, inputs_hash: sha256(readFileSync(inputs)),
      clean_worktree: revision,
    },
    no_findings_attestation: { reason: 'none', method: 'audit', evidence: 'review.txt' },
    passes: [
      { lens: 'security', findings: [], dry_evidence: 'no security findings' },
      { lens: 'correctness', findings: [], dry_evidence: 'no correctness findings' },
      { lens: 'tests', findings: [], dry_evidence: 'no test findings' },
    ],
  }));
}

function record(dir, ticket) {
  writePasses(dir, ticket, 'placeholder');
  const input = JSON.parse(readFileSync(join(dir, '.adlc', 'passes.json'), 'utf8'));
  const revision = resolveProsecutionRevision({ cwd: dir, dir: '.adlc', input, inputPath: '.adlc/passes.json' });
  assert.ok(revision, 'the recorder resolves a revision');
  writePasses(dir, ticket, revision);
  return runBin(['--input', '.adlc/passes.json', '--ticket', ticket, '--base', 'main', '--dir', '.adlc', '--author-provider', 'anthropic', '--json'], dir);
}

const manifest = (dir) => {
  const path = join(dir, '.adlc', 'manifest.jsonl');
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
};

describe('the recorder passes its --ticket as ownTicket (#1180)', () => {
  it('an own-new-rail change with a dry panel and no attestation exits 0 with no p5-cross-model-missing', () => {
    const dir = ownNewRailRepo();
    const r = record(dir, 'T2');
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
    assert.ok(r.stderr.includes(SKIP_LINE), r.stderr);
    assert.doesNotMatch(r.stderr, /cross-model adversarial approve REQUIRED/);
    assert.doesNotMatch(manifest(dir), /"type":"p5-cross-model-missing"/);
    assert.match(manifest(dir), /"type":"p5-complete"/);
  });

  it('control: recording the same change under another ticket still requires cross-model (exit 2)', () => {
    const dir = ownNewRailRepo();
    const r = record(dir, 'T1');
    assert.equal(r.status, 2);
    assert.match(r.stderr, /touches rails deny-path of ticket T2: test\/own\/\*\*/);
    assert.match(manifest(dir), /"type":"p5-cross-model-missing"/);
  });
});
