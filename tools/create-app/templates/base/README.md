# __APP_NAME__

A [place-ts](https://github.com/areeb-h/place-ts) app.

## Scripts

```sh
bun dev      # local server with HMR
bun run build  # static export to dist/
bun start    # production server
bun run typecheck
```

## Layout

```
src/
  app.ts                 # entry — pages, layout, theme, router
  theme.ts               # color tokens
  styles.css             # Tailwind input + globals
  layouts/main.layout.tsx
  pages/                 # auto-discovered by discoverPages()
  islands/               # auto-discovered interactive components
```

Add a page: drop a `*.page.tsx` in `src/pages/` with
`export default page('/path', { view: () => … })`. The router picks
it up on next request.

Add an interactive component: drop an island in `src/islands/`, then
import + render it from any page or layout. Only pages that actually
use an island ship its JS bundle.
