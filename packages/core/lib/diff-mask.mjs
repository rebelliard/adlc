// Mask credentials on the REMOVED side of a unified diff before it is sent to a
// review model. A change that deletes a hardcoded secret still carries the value
// on its `-` lines, so a raw `git diff` hands it to every lens provider even
// though the change exists to get rid of it. Added and context lines are left
// alone: they are in the tree at HEAD, and a reviewer must still be able to flag
// a secret the change ADDS.
//
// Best-effort by construction (see secret-shapes.mjs): it covers the known
// provider shapes, `name = value` credential assignments, high-entropy tokens,
// and private key blocks. A short, low-entropy password with no telltale name
// is not caught. Over-masking only hides removed text from the reviewer, so
// every ambiguous case masks.

import { SECRET_PATTERNS, TOKEN_SEPARATORS, isRandomSecretToken } from './secret-shapes.mjs';

export const MASKED_SECRET = '[redacted]';
export const MASKED_PRIVATE_KEY = '[redacted private key]';

const PEM_BEGIN = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;
const PEM_END = /-----END [A-Z ]*PRIVATE KEY-----/;
// A PEM body line: base64 only, optionally padded.
const PEM_BODY = /^[A-Za-z0-9+/]+={0,2}$/;

// Env-style names the shared list misses because `\b` does not split on `_`:
// `API_TOKEN=…`, `DB_PASSWORD: …`. Mask-only: the ledger check does not need it.
const ENV_ASSIGNMENT = /\b([A-Z][A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD|PASSWD|PWD|CREDENTIALS?)[A-Z0-9_]*\s*[:=]\s*["']?)[^\s"']{8,}/g;

// Every shared shape, made global so one line can hold several.
const MASK_RULES = [...SECRET_PATTERNS.map(([pattern]) => new RegExp(pattern.source, `${pattern.flags}g`)), ENV_ASSIGNMENT];

function maskTokens(text) {
  return text
    .split(new RegExp(`(${TOKEN_SEPARATORS.source})`))
    .map((part) => (isRandomSecretToken(part) ? MASKED_SECRET : part))
    .join('');
}

/** Mask every credential shape in one line of removed content. */
export function maskSecretText(text) {
  let out = String(text);
  for (const rule of MASK_RULES) {
    out = out.replace(rule, (_match, prefix) => (typeof prefix === 'string' ? `${prefix}${MASKED_SECRET}` : MASKED_SECRET));
  }
  return maskTokens(out);
}

/**
 * Return `diff` with credentials masked on its removed lines.
 *
 * The diff is walked per file section. Only lines inside a hunk (after `@@`)
 * are content; `---`/`+++` headers are never touched. Private key blocks are
 * tracked on the OLD side of the file (removed and context lines): an added
 * END line cannot close a block that is still being removed. A block whose
 * BEGIN line falls outside the diff context is caught at its END line, which
 * masks the run of removed base64 lines directly above it.
 *
 * @param {string} diff  unified diff text (`git diff` output)
 * @returns {string}
 */
export function maskRemovedSecrets(diff) {
  if (typeof diff !== 'string' || diff === '') return diff;
  const lines = diff.split('\n');
  const out = lines.slice();
  let inHunk = false;
  let inKey = false;
  // Output indices of old-side lines since the last hunk header, for the END back-fill.
  let oldSide = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.startsWith('diff --git ')) {
      inHunk = false;
      inKey = false;
      oldSide = [];
      continue;
    }
    if (line.startsWith('@@')) {
      inHunk = true;
      oldSide = [];
      continue;
    }
    if (!inHunk) continue;

    const marker = line[0];
    if (marker !== '-' && marker !== ' ') continue; // added lines and `\ No newline` markers
    const content = line.slice(1);
    const removed = marker === '-';

    if (PEM_BEGIN.test(content)) inKey = true;
    if (inKey) {
      if (removed) out[i] = `-${MASKED_PRIVATE_KEY}`;
      if (PEM_END.test(content)) inKey = false;
      oldSide.push(i);
      continue;
    }
    if (PEM_END.test(content)) {
      // BEGIN was outside the diff context: mask the base64 run above the END line.
      for (let j = oldSide.length - 1; j >= 0; j -= 1) {
        const k = oldSide[j];
        if (!PEM_BODY.test(lines[k].slice(1).trim())) break;
        if (lines[k][0] === '-') out[k] = `-${MASKED_PRIVATE_KEY}`;
      }
      if (removed) out[i] = `-${MASKED_PRIVATE_KEY}`;
      oldSide.push(i);
      continue;
    }
    if (removed) out[i] = `-${maskSecretText(content)}`;
    oldSide.push(i);
  }
  return out.join('\n');
}
