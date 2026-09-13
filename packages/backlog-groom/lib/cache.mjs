/**
 * The incrementality cache (spec §4).
 *
 * Keyed per issue on `(updatedAt, contentHash)`: an issue is re-verified when
 * either its own text or the code it cites has changed.
 *
 * THE RULE THAT KEEPS THE CACHE HONEST: an issue with no referenced paths has no
 * contentHash, and is NEVER stored as `valid`. Degrading its key to `updatedAt`
 * alone would mean code changes never invalidate it — the issue gets fixed,
 * nothing about the issue changes, and the cache keeps answering `valid`
 * forever. That is precisely the decay this package exists to detect,
 * reintroduced inside its own cache, so the entry is refused at write time
 * rather than filtered at read time.
 *
 * A miss is the ABSENCE of an answer, never an optimistic one.
 */

/**
 * Bump when verification, parsing or verdict semantics change.
 *
 * Raised in cross-model review, and it is the same failure this package exists
 * to detect, turned inward: without it, an older release stores a wrong verdict,
 * a newer release fixes the verifier, and the fixed code never runs — the issue
 * text and the file bytes are unchanged, so the key still matches and the stale
 * verdict is served indefinitely. Every fix to the verifier that this version
 * does not accompany is a fix that does not reach a cached backlog.
 *
 * 2: excerpts became a list per citation and are aggregated conservatively, so
 *    verdicts computed under the single-excerpt rule are no longer trustworthy.
 */
export const CACHE_SCHEMA_VERSION = 2;

/** Unambiguous composite key: length-delimited so two fields cannot alias. */
export function cacheKeyFor({ updatedAt, contentHash }) {
  const u = String(updatedAt ?? '');
  const c = contentHash == null ? '' : String(contentHash);
  const v = String(CACHE_SCHEMA_VERSION);
  return `v${v.length}:${v}|${u.length}:${u}|${c.length}:${c}`;
}

/**
 * Read a cached verdict, or null.
 *
 * A malformed entry — not an object, or carrying no verdict — is a MISS rather
 * than a hit, so a corrupted cache degrades into extra work instead of into
 * fabricated conclusions.
 */
export function cacheGet(store, key) {
  const entry = store?.[String(key.number)];
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
  if (typeof entry.verdict !== 'string') return null;
  if (entry.key !== cacheKeyFor(key)) return null;
  return entry;
}

/**
 * Store a verdict, unless doing so would create an entry that cannot be
 * invalidated by a code change.
 *
 * Returns whether the entry was stored, so a caller can report the refusal
 * rather than silently believing it cached.
 */
export function cachePut(store, key, value) {
  if (key.contentHash == null && value?.verdict === 'valid') return false;
  store[String(key.number)] = { ...value, key: cacheKeyFor(key) };
  return true;
}
