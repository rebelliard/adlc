// text.mjs — shared text-shaping helpers for capping prompt payloads.
// Zero third-party dependencies; fence() draws entropy from node:crypto.

import { randomUUID } from 'node:crypto';

/**
 * Tail the last `maxChars` characters of a string. Used across the toolkit
 * (consensus-fix's test output, parallax's route context, fence()'s
 * untrusted-content wrapping) wherever the END of a string is more likely
 * to matter than the start — a stack trace's failure line, a log's most
 * recent output.
 *
 * @param {string} str
 * @param {number} [maxChars]
 * @returns {string}
 */
export function tail(str, maxChars = 4000) {
  if (str.length <= maxChars) return str;
  return str.slice(str.length - maxChars);
}

/**
 * Wrap untrusted content (prior failure logs, prosecution findings, mined
 * PR text — anything not authored by the current agent) in an unguessable
 * fence so a prompt-construction site can declare it inert data, never
 * instructions (issue #281's broader concern; this is the mechanical half
 * already in use by packages/fleet).
 *
 * maxChars is REQUIRED (issue #280) — every existing call site had no cap,
 * so a single pathological log could blow a downstream context. Content is
 * tail()-biased when it needs truncation: for a build/gate/prosecution log,
 * the FAILURE is almost always at the end, not the start.
 *
 * @param {string} label
 * @param {string} content
 * @param {number} maxChars
 * @returns {string}
 */
export function fence(label, content, maxChars) {
  if (!Number.isInteger(maxChars) || maxChars < 0) {
    throw new Error('fence: maxChars must be a non-negative integer');
  }
  const raw = content ?? '';
  const capped = tail(raw, maxChars);
  const truncated = capped.length < raw.length;
  // The tag is a per-call nonce (#1005). It was previously derived from the
  // capped length, which made it computable by whoever wrote the content:
  // `label` is a literal at every call site and `capped.length` equals
  // `maxChars` exactly whenever the content is capped, so the content author
  // could emit the closing marker themselves and escape the fence. Un-capped
  // content was forgeable too — the tag was then a fixed point on the author's
  // own payload length, solvable by padding. A nonce is unguessable by
  // construction, which is the property the fence needs and the only one it
  // ever claimed.
  const tag = randomUUID();
  const marker = truncated ? `${label} (truncated, showing last ${maxChars} of ${raw.length} chars)` : label;
  return `<<UNTRUSTED:${marker}:${tag}>>\n${capped}\n<<END:${label}:${tag}>>`;
}
