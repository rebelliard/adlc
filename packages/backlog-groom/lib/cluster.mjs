/**
 * Lane clusters (spec §3.4).
 *
 * Issues whose VERIFIED locations fall in the same profile-declared unit form
 * one cluster — the grouping `issue-lanes` consumes to take N issues from one
 * package.
 *
 * Only verified locations count. An unverified location is not evidence about
 * where the work actually is, and clustering on an unchecked claim would hand a
 * lane a grouping built from what an issue asserted rather than what the code
 * shows.
 */

/**
 * Minimal glob match: `**` spans separators, `*` does not.
 *
 * Written out rather than pulled from a dependency because the profile's unit
 * globs are operator-authored and must behave predictably; `packages/x/**` has
 * to match `packages/x/lib/a.mjs` and not `packages/xyz/a.mjs`.
 */
export function globMatch(glob, path) {
  let re = '';
  const g = String(glob);
  for (let i = 0; i < g.length; i += 1) {
    const c = g[i];
    if (c === '*' && g[i + 1] === '*') {
      i += 1;
      if (g[i + 1] === '/') {
        i += 1;
        re += '(?:.*/)?';
      } else {
        re += '.*';
      }
    } else if (c === '*') {
      re += '[^/]*';
    } else if (c === '?') {
      re += '[^/]';
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${re}$`).test(String(path));
}

/** The profile unit a path belongs to, or null. */
export function unitFor(path, units) {
  for (const u of units ?? []) {
    for (const g of u.paths ?? []) if (globMatch(g, path)) return u.name;
  }
  return null;
}

/**
 * The units an issue's VERIFIED locations sit in.
 *
 * A `moved` verdict carries a real observation — the path is gone — but gives no
 * current location, so it contributes no unit.
 */
export function unitsForIssue(verified, classified, units) {
  if (!verified || !['valid', 'fixed'].includes(verified.verdict)) return [];
  const paths = (classified?.references ?? []).map((r) => r.path);
  return [...new Set(paths.map((p) => unitFor(p, units)).filter(Boolean))];
}

/** Group issues into lane clusters by unit. Issues with no unit are unclustered. */
export function clusterIssues(rows, units) {
  const byUnit = new Map();
  const unclustered = [];
  for (const row of rows ?? []) {
    const [first] = unitsForIssue(row.verified, row.classified, units);
    if (!first) {
      unclustered.push(row.number);
      continue;
    }
    if (!byUnit.has(first)) byUnit.set(first, []);
    byUnit.get(first).push(row.number);
  }
  return {
    clusters: [...byUnit.entries()]
      .map(([unit, issues]) => ({ unit, issues }))
      .sort((a, b) => a.unit.localeCompare(b.unit)),
    unclustered,
  };
}
