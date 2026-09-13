/**
 * Code-grounded verification (spec §3.3).
 *
 * THE RULE THAT MATTERS MOST: **the cited line number is a hint, never an
 * identity.** `fixed` requires the snippet to be absent from the ENTIRE file.
 * Any unrelated edit above a citation shifts every line below it, so a
 * line-anchored comparison reports `fixed` for live bugs — the single most
 * likely wrong close in this design, and the one that autonomously closes
 * someone's open bug.
 *
 * The aggregation is deliberately conservative in one direction. Across several
 * citations the order is `moved` > `valid` > `fixed`:
 *  - a missing PATH means the claim may still hold somewhere else, so it is a
 *    re-locate rather than a close;
 *  - any citation still present means the issue still has live evidence, so it
 *    is not fixed.
 * Both tie-breaks fail towards NOT closing, because a wrong close removes a real
 * issue from the backlog and nobody re-reads closed issues.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

/**
 * Normalise for comparison: trim each line and collapse internal whitespace
 * runs, dropping blank lines.
 *
 * Reindentation and re-wrapping are edits that leave the code's identity intact
 * but defeat a byte comparison, and treating them as deletions would be the same
 * false `fixed` the line-number rule guards against.
 */
function normaliseLines(text) {
  return String(text)
    .split('\n')
    .map((l) => l.trim().replace(/\s+/g, ' '))
    .filter((l) => l.length > 0);
}

/**
 * Find `snippet` anywhere in `content`, returning the 1-based line where it
 * starts, or -1.
 *
 * Matching is on normalised lines, so the result is the line of the first
 * normalised line of the snippet.
 */
export function findSnippet(content, snippet) {
  const hay = normaliseLines(content);
  const needle = normaliseLines(snippet);
  if (needle.length === 0) return -1;

  // Map normalised-line index back to the original 1-based line number.
  const originalLineOf = [];
  String(content).split('\n').forEach((l, i) => {
    if (l.trim().length > 0) originalLineOf.push(i + 1);
  });

  outer: for (let i = 0; i + needle.length <= hay.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) {
      if (hay[i + j] !== needle[j]) continue outer;
    }
    return originalLineOf[i] ?? -1;
  }
  return -1;
}

/** The commit that last touched `path`, or null when git cannot say. */
function defaultLastCommitFor(path, run = execFileSync) {
  try {
    return String(run('git', ['log', '-1', '--format=%h', '--', path], { encoding: 'utf8' })).trim() || null;
  } catch {
    return null;
  }
}

/**
 * Verify one classified issue.
 *
 * @param {{number:number, route:string, references:object[]}} classified
 * @param {object} [io] - injected filesystem/git seams
 * @returns {{number:number, route:string, verdict:string, evidence:object|null, reason?:string}}
 */
export function verifyIssue(classified, io = {}) {
  const {
    readFile = (p) => readFileSync(p, 'utf8'),
    pathExists = (p) => existsSync(p),
    lastCommitFor = (p) => defaultLastCommitFor(p),
  } = io;

  const { number, route, references = [] } = classified;

  // The model route is judged by the skill, not here. It is returned as
  // `unverified` — explicitly NOT `valid` — so nothing downstream can mistake
  // "we have not looked" for "we looked and it holds".
  if (route === 'model') return { number, route, verdict: 'unverified', evidence: null };
  if (route === 'unverifiable') return { number, route, verdict: 'unverifiable', evidence: null };

  const outcomes = [];
  for (const ref of references) {
    if (!pathExists(ref.path)) {
      outcomes.push({ verdict: 'moved', evidence: { path: ref.path, citedLine: ref.line, reason: 'the cited path no longer exists' } });
      continue;
    }
    if (!ref.snippet) {
      outcomes.push({ verdict: 'unverifiable', reason: `no snippet to compare for ${ref.path}` });
      continue;
    }
    let content;
    try {
      content = readFile(ref.path);
    } catch (err) {
      outcomes.push({ verdict: 'unverifiable', reason: `${ref.path} is unreadable: ${err.code ?? err.message}` });
      continue;
    }
    const foundAtLine = findSnippet(content, ref.snippet);
    if (foundAtLine === -1) {
      outcomes.push({
        verdict: 'fixed',
        evidence: {
          path: ref.path,
          citedLine: ref.line,
          commit: lastCommitFor(ref.path),
          reason: 'the cited snippet is absent from the entire file',
        },
      });
    } else {
      outcomes.push({
        verdict: 'valid',
        evidence: {
          path: ref.path,
          citedLine: ref.line,
          foundAtLine,
          movedWithinFile: ref.line != null && foundAtLine !== ref.line,
        },
      });
    }
  }

  for (const want of ['moved', 'valid', 'fixed']) {
    const hit = outcomes.find((o) => o.verdict === want);
    if (hit) return { number, route, verdict: want, evidence: hit.evidence ?? null };
  }

  const why = outcomes.find((o) => o.reason)?.reason ?? 'no citation could be checked';
  return { number, route, verdict: 'unverifiable', evidence: null, reason: why };
}

/** Verify a whole classified backlog. */
export function verifyAll(classified, io = {}) {
  return classified.map((c) => verifyIssue(c, io));
}
