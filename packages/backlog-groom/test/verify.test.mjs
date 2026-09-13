// verify.test.mjs — AC1, AC3, AC13.
//
// THE DEFECT THIS FILE EXISTS TO PREVENT (spec §3.3): a mechanical check
// anchored to the cited LINE number closes live bugs. Any unrelated edit above
// the citation shifts every line below it, the snippet stops matching AT THAT
// LINE, and a live issue verdicts `fixed` and is autonomously closed. The line
// is a HINT; `fixed` requires the snippet to be absent from the WHOLE file.
//
// Everything is injected, so these tests assert the decision logic rather than
// the state of this repository's working tree.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { verifyIssue } from '../lib/verify.mjs';

const SNIPPET = "const code = typeof res?.code === 'number' ? res.code : 1;";

/** A world where `files` maps path → contents; anything else does not exist. */
function world(files, lastCommit = 'abc1234') {
  return {
    readFile: (p) => {
      if (!(p in files)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return files[p];
    },
    pathExists: (p) => p in files,
    lastCommitFor: () => lastCommit,
  };
}

function mechanical(references) {
  return { number: 1, route: 'mechanical', references };
}

test('AC1: a cited snippet still present at HEAD verifies valid', () => {
  const files = { 'lib/a.mjs': `line one\n${SNIPPET}\nline three\n` };
  const v = verifyIssue(mechanical([{ path: 'lib/a.mjs', line: 2, snippet: SNIPPET }]), world(files));
  assert.equal(v.verdict, 'valid');
  assert.equal(v.evidence.foundAtLine, 2);
});

test('AC1: a snippet absent from the whole file verifies fixed, with the changing commit as evidence', () => {
  const files = { 'lib/a.mjs': 'something else entirely\n' };
  const v = verifyIssue(mechanical([{ path: 'lib/a.mjs', line: 2, snippet: SNIPPET }]), world(files, 'deadbee'));
  assert.equal(v.verdict, 'fixed');
  assert.equal(v.evidence.commit, 'deadbee', 'a close must cite the commit that changed the code');
  assert.ok(v.evidence.path === 'lib/a.mjs');
});

test('AC13: a snippet that MOVED within its file verifies valid, never fixed', () => {
  // The citation says line 2. An unrelated edit inserted 40 lines above it, so
  // the snippet now sits at line 42. A line-anchored check would call this
  // `fixed` and close a live bug. This is the single most likely wrong close in
  // the design.
  const padding = Array.from({ length: 40 }, (_, i) => `// inserted line ${i}`).join('\n');
  const files = { 'lib/a.mjs': `line one\n${padding}\n${SNIPPET}\ntail\n` };
  const v = verifyIssue(mechanical([{ path: 'lib/a.mjs', line: 2, snippet: SNIPPET }]), world(files));
  assert.equal(v.verdict, 'valid', 'the line is a hint; the snippet is the identity');
  assert.equal(v.evidence.citedLine, 2);
  assert.equal(v.evidence.foundAtLine, 42, 'the evidence records where it actually is now');
  assert.equal(v.evidence.movedWithinFile, true, 'and states plainly that it moved');
});

test('AC13: whitespace and indentation changes do not make a live snippet look fixed', () => {
  // Reindentation is the other shift that looks like a deletion to a naive
  // comparison.
  const files = { 'lib/a.mjs': `if (x) {\n      ${SNIPPET.replace(/ +/g, '  ')}\n}\n` };
  const v = verifyIssue(mechanical([{ path: 'lib/a.mjs', line: 1, snippet: `  ${SNIPPET}` }]), world(files));
  assert.equal(v.verdict, 'valid');
});

test('AC3: a cited path that no longer exists verifies moved, never fixed', () => {
  const v = verifyIssue(mechanical([{ path: 'lib/gone.mjs', line: 3, snippet: SNIPPET }]), world({}));
  assert.equal(v.verdict, 'moved', 'the claim may still hold elsewhere — this is a re-locate, not a close');
  assert.notEqual(v.verdict, 'fixed');
});

test('AC3: a missing path outranks a fixed snippet elsewhere — moved wins', () => {
  const files = { 'lib/a.mjs': 'nothing here\n' };
  const v = verifyIssue(
    mechanical([
      { path: 'lib/a.mjs', line: 1, snippet: SNIPPET },
      { path: 'lib/gone.mjs', line: 1, snippet: SNIPPET },
    ]),
    world(files)
  );
  assert.equal(v.verdict, 'moved');
});

test('AC1: one live citation outranks another that reads fixed — valid wins, so nothing closes', () => {
  // Conservative by construction: an issue with any citation still present is
  // not fixed, and closing it would be the expensive error.
  const files = { 'lib/a.mjs': `${SNIPPET}\n`, 'lib/b.mjs': 'gone\n' };
  const v = verifyIssue(
    mechanical([
      { path: 'lib/b.mjs', line: 1, snippet: SNIPPET },
      { path: 'lib/a.mjs', line: 1, snippet: SNIPPET },
    ]),
    world(files)
  );
  assert.equal(v.verdict, 'valid');
});

test('AC1: a reference with no snippet cannot conclude — the issue is unverifiable, never valid', () => {
  // A path that exists tells us nothing about whether the described defect is
  // still there. Calling that `valid` would be a false green in the safe
  // direction, and calling it `fixed` would be one in the dangerous direction.
  const files = { 'lib/a.mjs': 'anything\n' };
  const v = verifyIssue(mechanical([{ path: 'lib/a.mjs', line: 9, snippet: null }]), world(files));
  assert.equal(v.verdict, 'unverifiable');
  assert.match(v.reason, /no snippet/i);
});

test('AC1: an unreadable file is unverifiable, not fixed', () => {
  const w = world({ 'lib/a.mjs': 'x' });
  w.readFile = () => { throw Object.assign(new Error('EACCES'), { code: 'EACCES' }); };
  const v = verifyIssue(mechanical([{ path: 'lib/a.mjs', line: 1, snippet: SNIPPET }]), w);
  assert.equal(v.verdict, 'unverifiable', 'a read error is not evidence that the code changed');
  assert.match(v.reason, /EACCES|unreadable/i);
});

test('the model route is never verified mechanically — it is returned for the skill to judge', () => {
  const v = verifyIssue({ number: 2, route: 'model', references: [] }, world({}));
  assert.equal(v.verdict, 'unverified');
  assert.equal(v.route, 'model', 'the route survives so the report can count it');
});

test('the unverifiable route stays unverifiable and carries no evidence', () => {
  const v = verifyIssue({ number: 3, route: 'unverifiable', references: [] }, world({}));
  assert.equal(v.verdict, 'unverifiable');
  assert.equal(v.evidence, null, 'no evidence means nothing downstream can cite it as a reason to act');
});

test('a verdict is always one of the declared values', () => {
  const files = { 'lib/a.mjs': `${SNIPPET}\n` };
  const cases = [
    mechanical([{ path: 'lib/a.mjs', line: 1, snippet: SNIPPET }]),
    mechanical([{ path: 'nope.mjs', line: 1, snippet: SNIPPET }]),
    mechanical([{ path: 'lib/a.mjs', line: 1, snippet: null }]),
    { number: 4, route: 'model', references: [] },
    { number: 5, route: 'unverifiable', references: [] },
  ];
  for (const c of cases) {
    const v = verifyIssue(c, world(files));
    assert.ok(['valid', 'fixed', 'moved', 'unverifiable', 'unverified'].includes(v.verdict), `unexpected verdict ${v.verdict}`);
  }
});
