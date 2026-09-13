/**
 * The emitted groomed set (spec §3.9).
 *
 * This is the ONLY external contract this half has: `issue-lanes` adoption is a
 * separate ticket, so there is no live consumer to validate against yet. That is
 * why the set carries a schema version and is pinned against a committed
 * fixture — a shape change without a version bump has to fail loudly here, or
 * the handoff drifts silently until the day someone tries to consume it.
 */

/** Bump when the emitted shape changes. AC12 pins this against a fixture. */
export const EMIT_SCHEMA_VERSION = 1;

/** The exact top-level key set of an emitted document, in order. */
export const EMIT_KEYS = Object.freeze([
  'schemaVersion',
  'generatedFor',
  'coverage',
  'truncated',
  'issues',
  'clusters',
  'unclustered',
  'relations',
  'relationFilter',
  'proposals',
]);

/** The exact key set of one emitted issue row. */
export const ISSUE_KEYS = Object.freeze(['number', 'title', 'url', 'route', 'verdict', 'evidence', 'rank', 'labels', 'units']);

/**
 * Build the groomed set.
 *
 * Key order is fixed and every key is always present — an emitted document with
 * an absent key would let a consumer distinguish "no relations" from "relations
 * not computed" only by guessing.
 */
export function emitGroomedSet({
  generatedFor = null,
  coverage,
  truncated = null,
  rows = [],
  clusters = [],
  unclustered = [],
  relations = [],
  relationFilter = null,
  proposals = [],
} = {}) {
  return {
    schemaVersion: EMIT_SCHEMA_VERSION,
    generatedFor,
    coverage,
    truncated,
    issues: rows.map((r) => ({
      number: r.number,
      title: r.title ?? '',
      url: r.url ?? null,
      route: r.verified?.route ?? r.classified?.route ?? 'unverifiable',
      verdict: r.verified?.verdict ?? 'unverifiable',
      evidence: r.verified?.evidence ?? null,
      rank: r.rank ?? null,
      labels: r.labels ?? [],
      units: r.units ?? [],
    })),
    clusters,
    unclustered,
    relations,
    relationFilter,
    proposals,
  };
}
