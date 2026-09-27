# Design Tools

**Full rewrite in progress on branch `rewrite`** (the old app is tag `v1-final` on `main`).
Don't push to GitHub without asking Luap.

Read before touching anything:
1. `docs/superpowers/specs/2026-09-27-rewrite-foundation-design.md`: architecture, Library, Send to, undo, keyboard
2. `docs/rewrite/design-brief.md`: the look (direction C "Instrument", dark default) and the hard rules
3. `docs/rewrite/decisions.md`: why each dependency exists; add an entry before adding one
4. `docs/rewrite/2026-09-27-inventory.md`: the old app and what broke (reference only)

Porting reads from the tag: `git show v1-final:src/lib/dither.js`. Don't copy old files in wholesale.

## graphify

The graph in graphify-out/ describes the **old** app until the rewrite replaces `src/`. Rebuild it
with `graphify update .` once the new code lands.

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
