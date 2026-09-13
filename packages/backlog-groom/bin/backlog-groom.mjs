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
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

import { parseProfile } from '../lib/profile.mjs';
import { groom } from '../lib/groom.mjs';
import { renderReport } from '../lib/report.mjs';
import { renderUsage } from '../lib/usage.mjs';

const USAGE = renderUsage();


function opError(message) {
  console.error(`backlog-groom: ${message}`);
  process.exit(1);
}

let values;
try {
  ({ values } = parseArgs({
    options: {
      profile: { type: 'string' },
      cache: { type: 'string' },
      'no-cache': { type: 'boolean', default: false },
      threshold: { type: 'string', default: '0.2' },
      json: { type: 'boolean', default: false },
      out: { type: 'string' },
      help: { type: 'boolean', default: false },
    },
  }));
} catch (err) {
  opError(err.message);
}

if (values.help) {
  console.log(USAGE);
  process.exit(0);
}

const threshold = Number(values.threshold);
if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
  opError(`--threshold must be a number between 0 and 1, got: ${values.threshold}`);
}

const profilePath = values.profile ?? '.claude/backlog-groom-profile.json';
let profile;
try {
  // A MISSING profile is not an error: the documented defaults are a complete,
  // conservative profile, and requiring the file would make the tool unusable on
  // a repo that has not adopted it yet. A malformed one IS an error — that is a
  // statement the operator made and got wrong.
  const raw = existsSync(profilePath) ? JSON.parse(readFileSync(profilePath, 'utf8')) : { schemaVersion: 1 };
  profile = parseProfile(raw);
} catch (err) {
  opError(err.isOpError ? err.message : `could not read ${profilePath}: ${err.message}`);
}

const cachePath = values.cache ?? '.adlc/backlog-groom-cache.json';
let cache = null;
if (!values['no-cache']) {
  try {
    cache = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, 'utf8')) : {};
  } catch {
    // A corrupt cache costs a slow run, never a wrong answer: start empty.
    cache = {};
  }
}

// No `judge` is wired here. Relation judgment is a model call the SKILL supplies
// (§3.4); the CLI alone surfaces candidates and reports what the filter excluded,
// so a bare CLI run never emits a relation it did not have judgment for.
const result = groom({ profile, cache, io: {}, relationThreshold: threshold });

if (!result.ok) opError(result.unconsultable);

if (cache) {
  try {
    writeFileSync(cachePath, `${JSON.stringify(cache, null, 2)}\n`);
  } catch (err) {
    console.error(`backlog-groom: warning — could not write the cache at ${cachePath}: ${err.message}`);
  }
}

if (values.out) {
  try {
    writeFileSync(values.out, `${JSON.stringify(result.set, null, 2)}\n`);
  } catch (err) {
    opError(`could not write ${values.out}: ${err.message}`);
  }
}

if (values.json) console.log(JSON.stringify(result.set, null, 2));
else console.log(renderReport(result.set));

process.exit(0);
