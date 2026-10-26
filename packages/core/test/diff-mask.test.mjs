// diff-mask.test.mjs — maskRemovedSecrets / maskSecretText: credentials on the
// REMOVED side of a unified diff are masked before a review model sees them;
// added and context lines, and diff headers, pass through unchanged.
// Pure — no I/O, no network. Credential literals are assembled at runtime so
// this file does not itself hold a scanner-shaped secret.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maskRemovedSecrets, maskSecretText, MASKED_SECRET, MASKED_PRIVATE_KEY } from '../lib/diff-mask.mjs';
import * as core from '../index.mjs';

const GH_TOKEN = ['gh', 'p_', 'aB3dE5fG7hI9jK1lM3nO5pQ7rS9tU1vW3xY5'].join('');
const AWS_KEY = ['AK', 'IA', 'Q4ZR7XK2M9TPLW3N'].join('');
const RANDOM = 'Zx9Qm2Lp7Vt4Rk8Wn3Hb6Yc1Fd5Gs0Ja';
const SHA = '1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b';
const KEY_BODY = [
  'MIIEowIBAAKCAQEAu7Ld2Qx9Vb3Np5Rt7Wz1Ac4Ef6Gh8Jk0Lm2Nq4Ps6Ru8Tw0Yx',
  'Kq3Zs5Ub7Wd9Yf1Ah3Cj5El7Gn9Ip1Kr3Mt5Ov7Qx9Sz1Ub3Wd5Yf7Ah9Cj1El3G',
  'Rt2Yw4==',
];
const BEGIN = ['-----BEGIN RSA ', 'PRIVATE KEY-----'].join('');
const END = ['-----END RSA ', 'PRIVATE KEY-----'].join('');

function fileDiff(path, hunk) {
  return [`diff --git a/${path} b/${path}`, 'index 1111111..2222222 100644', `--- a/${path}`, `+++ b/${path}`, '@@ -1,4 +1,4 @@', ...hunk].join('\n');
}

test('core re-exports the diff mask from its public surface', () => {
  assert.equal(core.maskRemovedSecrets, maskRemovedSecrets);
  assert.equal(core.maskSecretText, maskSecretText);
  assert.equal(core.MASKED_SECRET, '[redacted]');
  assert.equal(core.MASKED_PRIVATE_KEY, '[redacted private key]');
});

test('a removed provider token is masked; the same token added or as context is kept', () => {
  const diff = fileDiff('a.mjs', [
    `-const t = "${GH_TOKEN}";`,
    `+const t = "${GH_TOKEN}";`,
    ` // ${GH_TOKEN}`,
  ]);
  const lines = maskRemovedSecrets(diff).split('\n');
  assert.equal(lines[5], `-const t = "${MASKED_SECRET}";`);
  assert.equal(lines[6], `+const t = "${GH_TOKEN}";`, 'an added secret must stay visible so a lens can flag it');
  assert.equal(lines[7], ` // ${GH_TOKEN}`, 'context is already at HEAD');
});

test('every shape on one removed line is masked, and nothing else on it changes', () => {
  assert.equal(maskSecretText(`aws=${AWS_KEY} gh=${GH_TOKEN} n=42`), `aws=${MASKED_SECRET} gh=${MASKED_SECRET} n=42`);
});

test('an inline credential assignment keeps its name and loses its value', () => {
  assert.equal(maskSecretText('password: hunter2supersecret'), `password: ${MASKED_SECRET}`);
  assert.equal(maskSecretText('const token = "abcd1234efgh";'), `const token = ${MASKED_SECRET}`);
});

test('env-style secret names the word-boundary pattern misses are masked', () => {
  assert.equal(maskSecretText('API_TOKEN=abcd1234efgh'), `API_TOKEN=${MASKED_SECRET}`);
  assert.equal(maskSecretText('DB_PASSWORD: "letmein-now"'), `DB_PASSWORD: "${MASKED_SECRET}"`);
  assert.equal(maskSecretText('AWS_SECRET_ACCESS_KEY=short'), 'AWS_SECRET_ACCESS_KEY=short', 'under 8 chars is not a credential value');
  assert.equal(maskSecretText('MAX_TOKENS = 4096'), 'MAX_TOKENS = 4096', 'a short numeric setting is kept');
});

test('a high-entropy token is masked; a git sha and ordinary code are kept', () => {
  assert.equal(maskSecretText(`key("${RANDOM}")`), `key("${MASKED_SECRET}")`);
  assert.equal(maskSecretText(`revert ${SHA}`), `revert ${SHA}`);
  assert.equal(maskSecretText('return computeTheThingQuicklyPlease(x);'), 'return computeTheThingQuicklyPlease(x);');
});

test('file headers are never masked, even when they look like removed lines', () => {
  const path = `dir/${GH_TOKEN}.txt`;
  const diff = fileDiff(path, [`-x = "${GH_TOKEN}"`]);
  const lines = maskRemovedSecrets(diff).split('\n');
  assert.equal(lines[2], `--- a/${path}`);
  assert.equal(lines[3], `+++ b/${path}`);
  assert.equal(lines[5], `-x = "${MASKED_SECRET}"`);
});

test('a removed line whose content starts with "--" is still content inside a hunk', () => {
  const diff = fileDiff('a.sql', [`--- token=${GH_TOKEN}`]);
  assert.equal(maskRemovedSecrets(diff).split('\n')[5], `--- token=${MASKED_SECRET}`);
});

test('a fully removed private key block is masked line by line', () => {
  const diff = fileDiff('k.pem', [`-${BEGIN}`, ...KEY_BODY.map((l) => `-${l}`), `-${END}`, ' after']);
  const lines = maskRemovedSecrets(diff).split('\n').slice(5);
  assert.deepEqual(lines, [...Array(5).fill(`-${MASKED_PRIVATE_KEY}`), ' after']);
});

test('a removed key body under a context BEGIN line is masked', () => {
  const diff = fileDiff('k.pem', [` ${BEGIN}`, ...KEY_BODY.map((l) => `-${l}`), ` ${END}`]);
  const lines = maskRemovedSecrets(diff).split('\n').slice(5);
  assert.deepEqual(lines, [` ${BEGIN}`, ...Array(3).fill(`-${MASKED_PRIVATE_KEY}`), ` ${END}`]);
});

test('a key body whose BEGIN is outside the diff context is masked back from END, short last line included', () => {
  const diff = fileDiff('k.pem', [' keep me', ...KEY_BODY.map((l) => `-${l}`), `-${END}`]);
  const lines = maskRemovedSecrets(diff).split('\n').slice(5);
  assert.deepEqual(lines, [' keep me', ...Array(4).fill(`-${MASKED_PRIVATE_KEY}`)]);
});

test('an added END line does not close a key block that is still being removed', () => {
  const diff = fileDiff('k.pem', [`-${BEGIN}`, `-${KEY_BODY[0]}`, `+${END}`, '-plainbodyline']);
  const lines = maskRemovedSecrets(diff).split('\n').slice(5);
  assert.deepEqual(lines, [`-${MASKED_PRIVATE_KEY}`, `-${MASKED_PRIVATE_KEY}`, `+${END}`, `-${MASKED_PRIVATE_KEY}`]);
});

test('an open key block carries across hunks of one file and ends at the next file', () => {
  const diff = [
    fileDiff('k.pem', [`-${BEGIN}`, `-${KEY_BODY[0]}`]),
    '@@ -20,1 +20,0 @@',
    '-shortline',
    fileDiff('b.txt', ['-plain removed text']),
  ].join('\n');
  const lines = maskRemovedSecrets(diff).split('\n');
  assert.equal(lines[8], `-${MASKED_PRIVATE_KEY}`, 'same file, later hunk: still inside the block');
  assert.equal(lines.at(-1), '-plain removed text', 'a new file starts outside any block');
});

test('the END back-fill stops at the first non-base64 line and at the hunk header', () => {
  const diff = fileDiff('k.pem', ['-not base64 here', `-${KEY_BODY[1]}`, `-${END}`]);
  const lines = maskRemovedSecrets(diff).split('\n').slice(5);
  assert.deepEqual(lines, ['-not base64 here', `-${MASKED_PRIVATE_KEY}`, `-${MASKED_PRIVATE_KEY}`]);
  const split = [fileDiff('k.pem', ['-abcd']), '@@ -9,1 +9,0 @@', `-${END}`].join('\n');
  assert.equal(maskRemovedSecrets(split).split('\n')[5], '-abcd', 'a line from an earlier hunk is not back-filled');
});

test('the no-newline marker, added lines and blank lines pass through; line count and trailing newline are kept', () => {
  const diff = `${fileDiff('a.txt', [`-x=${GH_TOKEN}`, '\\ No newline at end of file', '+y', ''])}\n`;
  const out = maskRemovedSecrets(diff);
  assert.equal(out.split('\n').length, diff.split('\n').length);
  assert.ok(out.endsWith('\n'));
  assert.match(out, /\n\\ No newline at end of file\n\+y\n/);
  assert.ok(!out.includes(GH_TOKEN));
});

test('text before any hunk header is left alone', () => {
  assert.equal(maskRemovedSecrets(`-x=${GH_TOKEN}`), `-x=${GH_TOKEN}`);
});

test('non-string and empty input is returned unchanged', () => {
  assert.equal(maskRemovedSecrets(''), '');
  assert.equal(maskRemovedSecrets(undefined), undefined);
  assert.equal(maskRemovedSecrets(null), null);
});
