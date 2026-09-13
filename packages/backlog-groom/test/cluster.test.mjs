// cluster.test.mjs — the unit glob and lane clustering.
//
// The profile's unit globs are operator-authored, so their semantics have to be
// predictable: `packages/x/**` must match `packages/x/lib/a.mjs` and must NOT
// match `packages/xyz/a.mjs`. Clustering is what `issue-lanes` consumes, and a
// wrong unit sends an issue to the wrong lane.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { clusterIssues, globMatch, unitFor, unitsForIssue } from '../lib/cluster.mjs';

test('** spans separators; * does not', () => {
  assert.ok(globMatch('packages/x/**', 'packages/x/lib/deep/a.mjs'));
  assert.ok(globMatch('packages/*/lib/a.mjs', 'packages/x/lib/a.mjs'));
  assert.equal(globMatch('packages/*/a.mjs', 'packages/x/lib/a.mjs'), false, 'a single star must not cross a slash');
});

test('a prefix is not a match — packages/x/** does not capture packages/xyz', () => {
  assert.equal(globMatch('packages/x/**', 'packages/xyz/a.mjs'), false);
});

test('**/ matches zero directories as well as many', () => {
  assert.ok(globMatch('packages/**/a.mjs', 'packages/a.mjs'), 'zero intervening directories');
  assert.ok(globMatch('packages/**/a.mjs', 'packages/x/y/a.mjs'), 'several');
});

test('a literal dot is a dot, not any character', () => {
  assert.ok(globMatch('lib/a.mjs', 'lib/a.mjs'));
  assert.equal(globMatch('lib/a.mjs', 'lib/axmjs'), false);
});

test('? matches one character but never a separator', () => {
  assert.ok(globMatch('lib/?.mjs', 'lib/a.mjs'));
  assert.equal(globMatch('lib/?.mjs', 'lib/ab.mjs'), false);
  assert.equal(globMatch('lib?a.mjs', 'lib/a.mjs'), false, '? must not swallow a slash');
});

test('unitFor returns the first declared unit that matches, or null', () => {
  const units = [
    { name: 'parallax', paths: ['packages/parallax/**'] },
    { name: 'core', paths: ['packages/core/**'] },
  ];
  assert.equal(unitFor('packages/core/lib/text.mjs', units), 'core');
  assert.equal(unitFor('scripts/thing.mjs', units), null);
});

test('only VERIFIED locations contribute a unit', () => {
  const units = [{ name: 'parallax', paths: ['packages/parallax/**'] }];
  const classified = { references: [{ path: 'packages/parallax/lib/a.mjs' }] };
  assert.deepEqual(unitsForIssue({ verdict: 'valid' }, classified, units), ['parallax']);
  for (const verdict of ['moved', 'unverified', 'unverifiable']) {
    assert.deepEqual(
      unitsForIssue({ verdict }, classified, units),
      [],
      `a ${verdict} location is not evidence about where the work is`
    );
  }
});

test('issues group by unit, and those with no unit are reported unclustered rather than dropped', () => {
  const units = [{ name: 'parallax', paths: ['packages/parallax/**'] }];
  const rows = [
    { number: 1, verified: { verdict: 'valid' }, classified: { references: [{ path: 'packages/parallax/a.mjs' }] } },
    { number: 2, verified: { verdict: 'valid' }, classified: { references: [{ path: 'packages/parallax/b.mjs' }] } },
    { number: 3, verified: { verdict: 'valid' }, classified: { references: [{ path: 'scripts/c.mjs' }] } },
  ];
  const { clusters, unclustered } = clusterIssues(rows, units);
  assert.deepEqual(clusters, [{ unit: 'parallax', issues: [1, 2] }]);
  assert.deepEqual(unclustered, [3], 'an unclustered issue is still in the backlog');
});
