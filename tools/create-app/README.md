# `@place-ts/create-app`

Scaffolder. Creates a new place-ts project from a starter template.

## Usage

```sh
bunx @place-ts/create-app my-app
```

Walks you through prompts (project name, template), copies the template into `./my-app/`, and runs `bun install`.

### Flags

```
bunx @place-ts/create-app <name> [options]

Options:
  --template <name>   Template to scaffold. Default: minimal.
                      Available: minimal.
  --no-install        Skip running 'bun install' after scaffolding.
  --yes               Skip prompts; use defaults for missing values.
                      Required when stdin is not a TTY (CI, etc.).
  --help              Show usage.
```

## Templates

- **`minimal`** — single-route SSR app: `serve()` + one `page()` + `boot()`. ~30 lines of code.

(Future: `commonplace` — the reference app shape with theming + ISR; `sandbox` — playground with the reactivity demos. Add when there's a concrete demand.)

## What it does NOT do

- **No `upgrade` / `migrate` subcommand.** Per the [stability covenant](../../docs/stability-covenant.md), no breaking changes means no migrations. If migration tooling is ever needed, it lives in a separate package so its existence doesn't undermine the covenant.
- **No degit / fetch-from-repo.** Templates ship inline in this package — hermetic, version-locked, offline-capable. Bumping a template means a CLI release, which is the right rhythm for a stable surface.
- **No package-manager detection.** This is a Bun framework; we use `bun install`. If you need to install a different way, pass `--no-install` and run your own.

## Implementation notes

- `src/cli.ts` — entry point + main loop
- `src/args.ts` — argument parsing + TTY-aware prompts + name validation
- `templates/<name>/` — template files. `__APP_NAME__` is replaced with the user's project name during copy.

Per the research in [`research-img-vt-cli.md`](../../research-img-vt-cli.md) §3, the canonical pattern is "single npm package per scope, inline templates, TTY-detected prompts." We follow it directly — no abstractions over `bun create` / `npm create`, just a branded UX wrapper.
