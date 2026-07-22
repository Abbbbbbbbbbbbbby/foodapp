# Pattern-regression baseline (graphify)

`graphify-out/` holds a knowledge graph of this codebase, generated 2026-07-22 from commit `4548d93` (the first full app push). It is the baseline for graph-backed regression detection in future reviews: when `/review-pr-plus` runs on later changes, the deterministic regression engine compares the new code's structure against this graph and flags structural regressions, repo-rule violations, and duplicate-reuse drift.

## Contents

- `graph.json` — the graph itself: 312 nodes, 462 edges, 36 communities. Nodes are functions, tables, components, and design-doc concepts; edges are calls, imports, shared-data relationships, and spec-to-code references, each tagged EXTRACTED, INFERRED, or AMBIGUOUS with a confidence score.
- `graph.html` — interactive visualization. Open in any browser, no server needed.
- `GRAPH_REPORT.md` — audit report: god nodes (most-connected abstractions), community cohesion scores, surprising cross-file connections.
- `manifest.json`, `cost.json` — file manifest for incremental `--update` runs and cumulative token accounting.

Not committed: `graphify-out/cache/` (extraction cache, machine-local) and `.graphify_python` (interpreter pointer).

## Updating the baseline

After significant code changes land on `main`, refresh incrementally from the repo root:

```
/graphify /Users/jboles/vibe-projects/foodbox-data-app --update
```

Code-only changes rebuild without any LLM cost (AST extraction only). The review tooling refreshes its own copy automatically during `/review-pr-plus` runs, so this is optional hygiene rather than a required step.
