/**
 * Filesystem wiring for the CLI, in lib so it can be tested.
 *
 * Left in the binary, these branches are only reachable by spawning the process
 * with a live `gh` behind it, so they go untested and a flipped guard — writing
 * the cache only when there is no cache, say — passes every suite.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';

import { parseProfile } from './profile.mjs';

/** The profile schema version a bare, profile-less repo is treated as declaring. */
export const IMPLIED_SCHEMA_VERSION = 1;

/**
 * Load and validate the profile.
 *
 * A MISSING profile is not an error: the documented defaults are a complete,
 * conservative profile, and demanding the file would make the tool unusable on a
 * repo that has not adopted it. A MALFORMED one is an error — that is a
 * statement the operator made and got wrong.
 */
export function loadProfile(path, io = {}) {
  const { exists = existsSync, readFile = (p) => readFileSync(p, 'utf8') } = io;
  const raw = exists(path) ? JSON.parse(readFile(path)) : { schemaVersion: IMPLIED_SCHEMA_VERSION };
  return parseProfile(raw);
}

/**
 * Load the cache, or `{}`.
 *
 * A corrupt cache costs a slow run, never a wrong answer, so it degrades to
 * empty rather than throwing.
 */
export function loadCache(path, io = {}) {
  const { exists = existsSync, readFile = (p) => readFileSync(p, 'utf8') } = io;
  try {
    if (!exists(path)) return {};
    const parsed = JSON.parse(readFile(path));
    // A valid JSON PRIMITIVE is not a cache. `"bad"` and `7` are truthy and
    // parse cleanly, so a hand-edited or partially-replaced file would sail past
    // a truthiness check and then throw on the first assignment — crashing a run
    // that had a perfectly good answer to give.
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    return parsed;
  } catch {
    return {};
  }
}

/** Serialise a JSON artifact the way the rest of the repo writes them. */
export function serialiseJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/**
 * Persist the cache, returning a warning string rather than throwing.
 *
 * An unwritable cache must not fail a run that already produced its answer.
 */
export function saveCache(path, cache, io = {}) {
  if (!cache) return null;
  const { write = writeFileSync } = io;
  try {
    write(path, serialiseJson(cache));
    return null;
  } catch (err) {
    return `could not write the cache at ${path}: ${err.message}`;
  }
}
