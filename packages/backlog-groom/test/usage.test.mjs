// usage.test.mjs — the CLI's documented surface.
//
// Help text written as one prose literal can only be asserted against itself,
// which is a source-text test and worth nothing. Rendering it from the flag
// table makes it a function of the option set, so these assertions are about
// behaviour: every flag the CLI accepts is documented, and each one that takes a
// value says so.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { FLAGS, renderUsage } from '../lib/usage.mjs';

test('every flag is documented, and value-taking flags show their placeholder', () => {
  const usage = renderUsage();
  for (const f of FLAGS) {
    assert.match(usage, new RegExp(`--${f.name}\\b`), `--${f.name} is undocumented`);
    if (f.arg) assert.ok(usage.includes(`--${f.name} <${f.arg}>`), `--${f.name} must show <${f.arg}>`);
    else assert.ok(!usage.includes(`--${f.name} <`), `--${f.name} takes no value and must not show one`);
  }
});

test('the placeholder is angle-bracketed — the convention the rest of the toolkit uses', () => {
  const usage = renderUsage([{ name: 'x', arg: 'path', help: 'h' }]);
  assert.match(usage, /--x <path>/);
});

test('help states plainly that the command never writes to GitHub', () => {
  // The read-only boundary is the whole reason this half can run unattended.
  assert.match(renderUsage(), /never writes to GitHub/);
});

test('the usage block separates its header from the flag list with a blank line', () => {
  // Rendered layout, not prose: the flag list must be visually distinct from the
  // summary line or the help reads as one wall of text.
  const lines = renderUsage([{ name: 'x', arg: null, help: 'h' }]).split('\n');
  assert.match(lines[0], /backlog-groom/);
  assert.equal(lines[1], '', 'a blank line must follow the header');
  assert.match(lines[2], /--x/);
});
