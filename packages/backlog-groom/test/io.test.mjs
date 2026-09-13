// io.test.mjs — the CLI's filesystem wiring.
//
// These branches used to live in the binary, where the only way to reach them
// was to spawn the process with a live `gh` behind it. A flipped guard — writing
// the cache only when there is NO cache — passed every suite.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { IMPLIED_SCHEMA_VERSION, loadCache, loadProfile, saveCache, serialiseJson } from '../lib/io.mjs';

test('a MISSING profile is not an error — the defaults are a complete profile', () => {
  const p = loadProfile('nope.json', { exists: () => false, readFile: () => { throw new Error('must not read'); } });
  assert.equal(p.schemaVersion, IMPLIED_SCHEMA_VERSION);
  assert.deepEqual(p.autonomyFloor, ['close'], 'and the implied profile is the conservative one');
});

test('the implied schema version is one this build supports', () => {
  // A default the parser would reject makes the tool unusable on exactly the
  // repos it is meant to work on out of the box.
  assert.equal(IMPLIED_SCHEMA_VERSION, 1);
  assert.doesNotThrow(() => loadProfile('x', { exists: () => false }));
});

test('a MALFORMED profile IS an error — that is a statement the operator got wrong', () => {
  assert.throws(() => loadProfile('p.json', { exists: () => true, readFile: () => '{ not json' }));
  const bad = loadProfileError('p.json', { exists: () => true, readFile: () => JSON.stringify({ schemaVersion: 1, nope: 1 }) });
  assert.equal(bad.isOpError, true);
});

function loadProfileError(path, io) {
  try {
    loadProfile(path, io);
  } catch (err) {
    return err;
  }
  return assert.fail('expected a throw');
}

test('a corrupt cache degrades to empty — a slow run, never a wrong answer', () => {
  assert.deepEqual(loadCache('c.json', { exists: () => true, readFile: () => 'not json' }), {});
});

test('an absent cache file is an empty cache, not an error', () => {
  assert.deepEqual(loadCache('c.json', { exists: () => false }), {});
});

test('a present cache is loaded', () => {
  const got = loadCache('c.json', { exists: () => true, readFile: () => JSON.stringify({ 1: { verdict: 'valid' } }) });
  assert.equal(got['1'].verdict, 'valid');
});

test('saveCache writes when there IS a cache, and does nothing when there is not', () => {
  const writes = [];
  assert.equal(saveCache('c.json', { a: 1 }, { write: (p, d) => writes.push([p, d]) }), null);
  assert.equal(writes.length, 1, 'a cache must be persisted');
  assert.equal(writes[0][0], 'c.json');

  const none = [];
  assert.equal(saveCache('c.json', null, { write: (p, d) => none.push([p, d]) }), null);
  assert.equal(none.length, 0, '--no-cache must not write a cache file');
});

test('an unwritable cache warns rather than failing a run that already has its answer', () => {
  const warning = saveCache('c.json', { a: 1 }, { write: () => { throw new Error('EROFS'); } });
  assert.match(warning, /EROFS/);
});

test('JSON artifacts are 2-space indented and newline-terminated, like the rest of the repo', () => {
  const out = serialiseJson({ a: { b: 1 } });
  assert.ok(out.endsWith('\n'));
  assert.match(out, /\n  "a"/, 'two spaces, so a diff of the cache or the emitted set reads like every other JSON here');
  assert.doesNotMatch(out, /\n {3}"a"/);
});
