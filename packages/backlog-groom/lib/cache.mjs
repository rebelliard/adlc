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

/** Unambiguous composite key: length-delimited so two fields cannot alias. */
export function cacheKeyFor({ updatedAt, contentHash }) {
  const u = String(updatedAt ?? '');
  const c = contentHash == null ? '' : String(contentHash);
  return `${u.length}:${u}|${c.length}:${c}`;
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
