# @adlc/backlog-groom

Grooms a GitHub issue backlog **against the code**: verifies whether each issue's
premise still holds at HEAD, clusters issues by the package their verified
locations sit in, ranks them from what was learned, and emits a versioned set.

**This package is the READ path. It writes nothing to GitHub.** The adversarial
gate, the autonomy floor and execution are the write path, built separately.
Proposals are emitted for it to decide on; nothing here applies them.

```bash
backlog-groom                 # report
backlog-groom --json          # the groomed set
backlog-groom --out set.json  # write it to a file
```

## Why it exists

A backlog's labels are stamped once at filing and then rot. Nothing re-checks
whether an issue is still true. This package answers that question mechanically
where it can, says so plainly where it cannot, and never lets "we did not look"
read as "we looked and it holds".

## The three routes

| Route | Meaning |
|---|---|
| `mechanical` | The body carries a parseable code reference — a `path:line` and/or a fenced snippet attributed to it |
| `model` | A checkable claim about code, but nothing parseable to check against |
| `unverifiable` | No checkable claim about code at all |

`unverifiable` is a first-class outcome. Collapsing it into "still valid" is the
specific false green this package exists to avoid.

## The verdicts

`valid` · `fixed` · `moved` · `unverifiable` · `unverified` (model route, not yet judged)

Three rules keep `fixed` — the verdict that leads to a close — honest:

- **The cited line is a hint, never an identity.** Any unrelated edit above a
  citation shifts every line below it, so a line-anchored comparison reports
  `fixed` for live code.
- **An elided excerpt is still a citation.** Issue bodies routinely quote
  non-contiguous lines. Matching is an in-order subsequence, and *partial*
  survival is `unverifiable` — the code changed, and changed is not fixed.
- **A path git has never tracked is not a deleted file.** It is prose that looks
  like a path, and calling it `moved` floods the report with citations this
  repository never had.

Across several citations the order is `moved` > `valid` > `fixed`, so every
tie-break fails towards *not* closing.

## Profile

`.claude/backlog-groom-profile.json`, parsed by the core and **failing closed** —
an unrecognised key at any depth is an operational error, because a config that
silently ignores what it does not understand hands you a setting you believe is
in force and is not.

```jsonc
{
  "schemaVersion": 1,               // the only required key
  "autonomyFloor": ["close"],       // read by the write path
  "units": [{ "name": "parallax", "paths": ["packages/parallax/**"] }],
  "frozenPaths": ["packages/rails-guard/**"],
  "labels": { "priority": { "high": "P1-high" }, "areaPrefix": "area:" },
  "providers": { "decider": "anthropic", "reviewer": "openai" }
}
```

A missing profile is fine — the defaults are a complete, conservative profile.
A malformed one is not: that is a statement you made and got wrong.

## Incrementality

A gitignored cache at `.adlc/backlog-groom-cache.json`, keyed per issue on
`(updatedAt, contentHash)`. **An issue with no referenced paths is never cached
as `valid`** — a key with no code component can never be invalidated by a code
change, and the cache would answer `valid` forever after the bug was fixed.

## Relations

Similarity is a **candidate filter, never evidence**. Judgment decides each
candidate, and an emitted relation cites reasoning rather than a score. The
filter's recall is the ceiling on what can be found, so each run reports how many
pairs it excluded — those were never judged, and they bound what the run could
have found.

A true miss rate would need ground truth this tool does not have; reporting one
would be false precision. The excluded count is what is actually knowable.

## Honesty rules

Every run leads with its route distribution, and a truncated fetch says so
loudly. A sweep that mechanically verified 4% is still useful — but that number
sits next to the conclusions, because an incomplete examination must never
present as a complete one.
