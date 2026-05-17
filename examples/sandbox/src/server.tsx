// sandbox — `serve()` HTTP entry. Replaces Vite with the framework's
// own pipeline (Bun.build for bundling, auto-Tailwind, security
// headers, design tokens). One `theme: tokens` line registers the
// tokens with Tailwind AND prefixes the active theme class onto every
// page's `<html>`. `tailwind.content` defaults to the clientEntry's
// directory, which is exactly where the app source lives.

import { serve } from '@place/component'
import { sandboxPage } from './page.tsx'
import { tokens } from './theme.ts'

const PORT = Number.parseInt(process.env['PORT'] ?? '5173', 10)

await serve({
  name: '@place/sandbox',
  port: PORT,
  clientEntry: `${import.meta.dir}/client.tsx`,
  tailwind: true,
  theme: tokens,
  security: 'standard',
  routes: {
    '/': sandboxPage,
  },
})
