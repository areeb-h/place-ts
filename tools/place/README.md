# `place` — the diagnostics CLI

> What JavaScript does each route ship, and why?

`place` is a read-only analyzer of a finished static export. It runs
no build and imports no framework code — it reads the emitted HTML +
JavaScript and the build's view manifest, and reports. Running it can
never perturb a build.

## Usage

```sh
# 1. Produce a production build (writes ./dist)
bun run build

# 2. Ask place what shipped
place explain                  # table of every route's JS cost
place explain /api/components  # per-script breakdown for one route
place why-js  /                # WHY the home page ships what it does
```

Inside this monorepo, before publish:

```sh
bun tools/place/src/cli.ts explain --dist examples/docs/dist
```

## Commands

| Command | Answers |
|---|---|
| `place explain [route]` | What JavaScript a route ships — per-route table, or a per-script breakdown for one route. |
| `place why-js [route]` | *Why* a route ships its JavaScript — names the island and the effect (`onMount`, `state`, `setInterval`, …) that forced a client bundle. A static route's answer is **"Nothing."** |

## Options

| Option | Default | Meaning |
|---|---|---|
| `--dist <dir>` | `./dist` | Static-export directory to analyze. |
| `--manifest <file>` | `./.place/island-entries/view-manifest.json` | Classifier output — supplies the level + reason per island. Optional; `explain` works without it. |
| `--help` | — | Usage. |

## What it reads

- `<dist>/**/index.html` — each route's HTML; `<script>` tags are the
  JavaScript it ships. Non-JS scripts (`application/json` data) are
  excluded from the count.
- `<dist>/islands/<name>-<hash>.js` — per-island bundles. Files that
  don't match an island name are shared framework chunks.
- `view-manifest.json` — the build classifier's per-island level and
  the human reason for it.

A route that ships **0 B** of island JavaScript is the goal. `place`
makes that visible — and, when a route *isn't* zero, names exactly
what made it so.
