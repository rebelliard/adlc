// review-calibration/test/invalid-plants.test.mjs — a planted mutant that does
// not parse is discarded (#312).
//
// A witness "discriminates" when it passes on the original and exits non-zero on
// the mutant. A file that does not parse also exits non-zero, so an unparseable
// plant was scored as a valid, discriminating test case — and recall was then
// measured over mutants no reviewer could meaningfully catch, because they were
// not code. hollow-test discards them since #306; this is the same rule, through
// the same check in @adlc/core.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gitRepo } from '@adlc/core/test-kit';
import { filterEquivalentMutants } from '../lib/verify.mjs';
import { runCli, writePlantsFile } from './cli-fixtures.mjs';

const REAL_TS = resolve(dirname(fileURLToPath(import.meta.url)), '../../../node_modules/typescript');
const NO_TS = !existsSync(join(REAL_TS, 'package.json')) && 'typescript is not installed';

// The exact #293 reproduction: null-return on a multiline `return {` strands the
// object literal's remaining lines.
const SHAPE = [
  'export function shape(a) {',
  '  return {',
  '    ok: a > 1,',
  '  };',
  '}',
  '',
].join('\n');

const STRANDED = Object.freeze({
  file: 'src/shape.mjs',
  line: 2,
  original: '  return {',
  mutated: '  return null;',
  category: 'null-handling',
  defect: 'returns null instead of the shape',
});

const BOUNDARY = Object.freeze({
  file: 'src/shape.mjs',
  line: 3,
  original: '    ok: a > 1,',
  mutated: '    ok: a >= 1,',
  category: 'boundary',
  defect: 'inclusive bound admits one',
});

// Passes on the original and fails on ANY broken import, which is exactly why an
// unparseable plant looked like a discriminating one.
const WITNESS = {
  cmd: 'node',
  args: ['--input-type=module', '-e', "import('./src/shape.mjs').then((m) => process.exit(m.shape(1).ok === false ? 0 : 1), () => process.exit(1))"],
};

function shapeRepo(t, files = { 'src/shape.mjs': SHAPE }, setup = () => {}) {
  const repo = gitRepo(t, { prefix: 'rc-invalid-' });
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(repo.dir, rel)), { recursive: true });
    writeFileSync(join(repo.dir, rel), text);
  }
  writeFileSync(join(repo.dir, 'package.json'), '{ "name": "fixture", "type": "module" }\n');
  writeFileSync(join(repo.dir, '.gitignore'), 'node_modules\n');
  setup(repo.dir);
  repo.git('add', '-A');
  repo.git('commit', '-q', '-m', 'initial');
  return repo;
}

const plantIn = (dir, plant, extra = {}) => ({ ...plant, absolutePath: join(dir, plant.file), operator: plant.category, ...extra });

const cli = (dir, plants, extra = []) => runCli([
  '--review-cmd', 'node -e "0"', '--plants-file', plants,
  '--min-plants', '1', '--min-recall', '0', '--scorer', 'string', ...extra,
], dir);

describe('unparseable plants are discarded', () => {
  it('a witnessed plant that does not parse is discarded', (t) => {
    const { dir } = shapeRepo(t);
    const out = filterEquivalentMutants([plantIn(dir, STRANDED, { witness: WITNESS })], dir);
    assert.deepEqual(out.valid, [], 'an unparseable plant is never a valid, discriminating plant');
    assert.deepEqual(out.equivalent, [], 'nor an equivalent mutant: it is not a mutant of the program at all');
    assert.equal(out.invalid.length, 1);
    assert.equal(out.invalid[0].line, 2);
    assert.equal(readFileSync(join(dir, 'src/shape.mjs'), 'utf8'), SHAPE, 'the file is restored');
  });

  it('an unwitnessed plant that does not parse is discarded', (t) => {
    const { dir } = shapeRepo(t);
    const out = filterEquivalentMutants([plantIn(dir, STRANDED), plantIn(dir, BOUNDARY)], dir);
    assert.ok(Array.isArray(out.invalid), 'filterEquivalentMutants returns the discarded plants');
    assert.deepEqual(out.invalid.map((p) => p.line), [2]);
    assert.deepEqual(out.valid.map((p) => p.line), [3]);
    assert.equal(readFileSync(join(dir, 'src/shape.mjs'), 'utf8'), SHAPE);
  });

  it('the JSON report counts discarded plants', (t) => {
    const { dir } = shapeRepo(t);
    const plants = writePlantsFile(t, [STRANDED, BOUNDARY]);
    const r = cli(dir, plants, ['--json']);
    assert.equal(r.status, 0, r.stderr);
    const report = JSON.parse(r.stdout);
    assert.equal(report.invalidDiscarded, 1);
    assert.equal(report.total, 1, 'recall is measured over the valid plant only');
    assert.match(r.stderr, /WARNING: discarded src\/shape\.mjs:2 — the planted mutant does not parse/);
    const human = cli(dir, plants);
    assert.match(human.stdout, /Discarded: +1 plant\(s\) that do not parse/);
  });

  it('a file that does not parse unmutated is not syntax-checked', (t) => {
    // JSX in a .js file: node --check rejects the ORIGINAL, so it cannot judge a
    // plant. Discarding every plant in such a file would empty the sample.
    const jsx = 'export const label = (n) => n > 1;\nexport const view = <b>{label(2)}</b>;\n';
    const { dir } = shapeRepo(t, { 'src/view.js': jsx });
    const plant = { file: 'src/view.js', line: 1, original: 'export const label = (n) => n > 1;', mutated: 'export const label = (n) => n >= 1;', category: 'boundary', defect: 'inclusive bound' };
    const r = cli(dir, writePlantsFile(t, [plant]), ['--json']);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).invalidDiscarded, 0);
    assert.equal(JSON.parse(r.stdout).total, 1);
    assert.match(r.stderr, /src\/view\.js.*not syntax-checked/);
  });

  it('a plant with no checker is not syntax-checked', (t) => {
    const { dir } = shapeRepo(t, { 'src/app.py': 'def f(a):\n    return a > 1\n' });
    const plant = { file: 'src/app.py', line: 2, original: '    return a > 1', mutated: '    return a >= 1', category: 'boundary', defect: 'inclusive bound' };
    const out = filterEquivalentMutants([plantIn(dir, plant)], dir);
    assert.equal(out.valid.length, 1);
    assert.equal(out.valid[0].line, 2);
  });
});

describe('a check that did not run is not evidence', () => {
  it('a witness that cannot start exits 1', (t) => {
    const { dir } = shapeRepo(t);
    const plants = writePlantsFile(t, [
      { ...BOUNDARY, witness: { cmd: join(dir, 'no-such-binary') } },
      { ...BOUNDARY, mutated: '    ok: a > 2,', defect: 'shifted bound' },
    ]);
    const r = cli(dir, plants);
    assert.equal(r.status, 1, r.stderr + r.stdout);
    assert.match(r.stderr, /src\/shape\.mjs:3/);
    assert.match(r.stderr, /could not start/);
  });

  it('an undetermined syntax check exits 1', { skip: NO_TS }, (t) => {
    // A typescript whose parser throws on the planted text only: the original
    // parses, the plant's check is unknown, and an unknown is not evidence.
    const { dir } = shapeRepo(t, { 'src/gate.ts': 'export const gate = (a: number): boolean => a > 1;\n' }, (root) => {
      const pkg = join(root, 'node_modules', 'typescript');
      mkdirSync(pkg, { recursive: true });
      writeFileSync(join(pkg, 'package.json'), '{ "name": "typescript", "version": "5.0.0", "main": "index.js" }\n');
      writeFileSync(join(pkg, 'index.js'), [
        `const real = require(${JSON.stringify(realpathSync(REAL_TS))});`,
        'module.exports = { ...real, createSourceFile(name, text, ...rest) {',
        "  if (text.includes('a >= 1')) throw new Error('parser exploded');",
        '  return real.createSourceFile(name, text, ...rest);',
        '} };',
        '',
      ].join('\n'));
    });
    const plant = { file: 'src/gate.ts', line: 1, original: 'export const gate = (a: number): boolean => a > 1;', mutated: 'export const gate = (a: number): boolean => a >= 1;', category: 'boundary', defect: 'inclusive' };
    const r = cli(dir, writePlantsFile(t, [plant]));
    assert.equal(r.status, 1, r.stderr + r.stdout);
    assert.match(r.stderr, /src\/gate\.ts:1/);
    assert.match(r.stderr, /could not syntax-check|undetermined/);
  });

  it('a TypeScript plant without typescript exits 1', (t) => {
    const { dir } = shapeRepo(t, { 'src/gate.ts': 'export const gate = (a: number): boolean => a > 1;\n' });
    const plant = { file: 'src/gate.ts', line: 1, original: 'export const gate = (a: number): boolean => a > 1;', mutated: 'export const gate = (a: number): boolean => a >= 1;', category: 'boundary', defect: 'inclusive' };
    const r = cli(dir, writePlantsFile(t, [plant]));
    assert.equal(r.status, 1, r.stderr + r.stdout);
    assert.match(r.stderr, /src\/gate\.ts/);
    assert.match(r.stderr, /npm i -D typescript/);
  });
});
