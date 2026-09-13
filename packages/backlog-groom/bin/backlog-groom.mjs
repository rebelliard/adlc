#!/usr/bin/env node
/**
 * backlog-groom — the read path.
 *
 * Grooms a GitHub issue backlog against the code and emits a ranked, clustered,
 * premise-verified set. This half WRITES NOTHING: the gate, the autonomy floor
 * and execution live in the write path, and proposals are emitted for it rather
 * than applied here.
 *
 * Exit codes follow the toolkit convention: 0 = ran, 1 = operational error.
 * There is no gate-fail exit, because a read-only sweep has no verdict to fail.
 */

import { parseArgs } from 'node:util';
import { writeFileSync } from 'node:fs';

import { groom } from '../lib/groom.mjs';
import { renderReport } from '../lib/report.mjs';
import { renderUsage, parseOptions, validateThreshold } from '../lib/usage.mjs';
import { loadProfile, loadCache, saveCache, serialiseJson } from '../lib/io.mjs';

process.on('uncaughtException', (err) => {
  // An opError has already printed its message and set the exit code; a stack
  // trace on top of it is noise the operator has to read past.
  if (err?.handled) return;
  console.error(`backlog-groom: ${err?.stack ?? err}`);
  process.exitCode = 1;
});

const USAGE = renderUsage();


/**
 * Report an operational error and stop.
 *
 * `process.exitCode` plus a thrown sentinel rather than `process.exit`: an
 * explicit exit can terminate the process while stdout is still draining, which
 * truncates a piped payload. Nothing here is large, but the rule is uniform so
 * the dangerous case below cannot be the exception nobody noticed.
 */
function opError(message) {
  console.error(`backlog-groom: ${message}`);
  process.exitCode = 1;
  throw Object.assign(new Error(message), { handled: true });
}

let values;
try {
  ({ values } = parseArgs({ options: parseOptions() }));
} catch (err) {
  opError(err.message);
}

if (values.help) {
  console.log(USAGE);
  process.exit(0);
}

let threshold;
try {
  threshold = validateThreshold(values.threshold);
} catch (err) {
  opError(err.message);
}

const profilePath = values.profile ?? '.claude/backlog-groom-profile.json';
let profile;
try {
  profile = loadProfile(profilePath);
} catch (err) {
  opError(err.isOpError ? err.message : `could not read ${profilePath}: ${err.message}`);
}

const cachePath = values.cache ?? '.adlc/backlog-groom-cache.json';
const cache = values['no-cache'] ? null : loadCache(cachePath);

// No `judge` is wired here. Relation judgment is a model call the SKILL supplies
// (§3.4); the CLI alone surfaces candidates and reports what the filter excluded,
// so a bare CLI run never emits a relation it did not have judgment for.
const result = groom({ profile, cache, io: {}, relationThreshold: threshold });

if (!result.ok) opError(result.unconsultable);

const cacheWarning = saveCache(cachePath, cache);
if (cacheWarning) console.error(`backlog-groom: warning — ${cacheWarning}`);

if (values.out) {
  try {
    writeFileSync(values.out, serialiseJson(result.set));
  } catch (err) {
    opError(`could not write ${values.out}: ${err.message}`);
  }
}

// NO `process.exit(0)` HERE. `console.log` to a PIPE is asynchronous, and a
// 500-issue groomed set comfortably exceeds the pipe buffer; forcing exit
// terminates the process before stdout drains and the consumer receives a
// truncated, unparseable payload. Setting the code and letting the event loop
// finish is what guarantees the whole document arrives.
if (values.json) console.log(serialiseJson(result.set).trimEnd());
else console.log(renderReport(result.set));

process.exitCode = 0;
