---
title: backlog-groom
description: Documentation for the backlog-groom tool in the ADLC toolkit.
---

# backlog-groom

**ADLC phase: maintenance / cross-phase — backlog hygiene**

A backlog's labels are stamped once at filing and then rot. Nothing re-checks
whether an issue is still true, so a mature backlog quietly fills with issues
whose premise the code has already outgrown. `backlog-groom` verifies each
issue's premise **against the code at HEAD**, clusters issues by the package
their verified locations sit in, ranks them from what it learned, and emits a
versioned set.

> **Not yet routed through `adlc`.** Registering the verb means editing
> `packages/cli/lib/registry.mjs`, which is a frozen rail of an in-flight ticket,
> so the tool is invoked by its own binary for now and the `adlc backlog-groom`
> verb lands once that rail expires.

This package is the **read path**: it writes nothing to GitHub. The adversarial
gate, the autonomy floor and execution are the write path.

## Usage

```
backlog-groom [--profile <path>] [--cache <path>] [--no-cache]
              [--threshold <n>] [--json] [--out <path>]
```

Exit codes: `0` ran, `1` operational error. A read-only sweep has no verdict to
fail, so there is no gate-fail exit.

## Routes and verdicts

Each issue is routed by what evidence its body carries — `mechanical` (a
parseable code reference), `model` (a checkable claim with nothing parseable),
or `unverifiable` (no claim about code at all). `unverifiable` is a first-class
outcome: collapsing it into "still valid" is the false green this tool exists to
detect.

Verdicts are `valid`, `fixed`, `moved`, `unverifiable`, and `unverified` for the
model route. Three rules keep `fixed` honest, since it is the verdict that leads
to a close:

- The cited **line is a hint, never an identity** — an unrelated edit above a
  citation shifts everything below it, and a line-anchored check would report
  `fixed` for live code.
- An **elided excerpt is still a citation**. Bodies routinely quote
  non-contiguous lines, so matching is an in-order subsequence; *partial*
  survival is `unverifiable`, because changed is not fixed.
- A path **git has never tracked is not a deleted file** — it is prose shaped
  like a path.

Across several citations the order is `moved` > `valid` > `fixed`, so every
tie-break fails towards not closing.

## Profile

`.claude/backlog-groom-profile.json` holds the repo-specific facts — units,
frozen paths, label conventions, the autonomy floor the write path reads, and
`providers.decider`. It **fails closed**: an unrecognised key at any depth is an
operational error, because a config that ignores what it does not understand
hands the operator a setting they believe is in force and is not. A missing
profile is fine; the defaults are complete and conservative.

## Incrementality

A gitignored cache keyed on `(updatedAt, contentHash)`. An issue with no
referenced paths has no `contentHash` and is **never cached as `valid`** — such a
key could never be invalidated by a code change, so the cache would answer
`valid` forever after the bug was fixed.

## Honesty

Every run leads with its route distribution, and a truncated fetch says so
loudly. Relation candidates come from a similarity **filter, never evidence**;
each run reports how many pairs it excluded, because those were never judged and
they bound what the run could have found.
