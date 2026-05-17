// @place/component/adapters/node — Node.js HTTP adapter.
//
// Translates the framework's Web-fetch-shaped dispatch (`(req: Request)
// => Promise<Response>`) into Node's `http.IncomingMessage`/`ServerResponse`
// pair. Use with `serve({ adapter: nodeAdapter() })` when running on
// Node instead of Bun.
//
//   import { serve } from '@place/component'
//   import { nodeAdapter } from '@place/component/adapters/node'
//
//   await serve({
//     adapter: nodeAdapter({ port: 3000 }),
//     clientJs: '/* … pre-built bundle … */',  // or omit for SSR-only
//     routes: { '/': home },
//   })
//
// Pre-build constraint: Node has no `Bun.build`. Pre-build your client
// entry with esbuild/Vite/Rollup and pass the result via `clientJs`.
// Without it, hydration is impossible (the SSR HTML references a
// `/client.js` that doesn't exist).
//
// What this adapter does NOT do:
//   - WebSocket upgrade (the framework's WebSocket support is Bun-only
//     today; Node+ws integration is a future cut).
//   - HTTPS termination (run behind a reverse proxy or extend with
//     `https.createServer`).
//   - Process management (use pm2 / systemd / k8s for production).

import { Buffer } from 'node:buffer'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { Readable } from 'node:stream'
import type { Adapter, Builder } from '../index.ts'

export interface NodeAdapterOptions {
  /** Port to listen on. Default: `process.env.PORT` parsed, else 3000. */
  port?: number
  /** Hostname to bind. Default: `0.0.0.0` (all interfaces). */
  hostname?: string
  /** Called once the server is listening. Useful for tests. */
  onListen?: (info: { port: number; hostname: string }) => void
}

export function nodeAdapter(options: NodeAdapterOptions = {}): Adapter {
  return {
    name: 'node',
    async adapt(builder: Builder): Promise<void> {
      const port = options.port ?? Number.parseInt(process.env['PORT'] ?? '3000', 10)
      const hostname = options.hostname ?? '0.0.0.0'

      const server = createServer(async (nodeReq, nodeRes) => {
        try {
          const req = await toWebRequest(nodeReq)
          const res = await builder.dispatch(req)
          await writeWebResponse(res, nodeRes)
        } catch (err) {
          // Last-resort error response. The framework's dispatch already
          // catches handler-level throws and returns 500s; this guard
          // covers translation failures + truly unexpected throws.
          if (!nodeRes.headersSent) {
            nodeRes.statusCode = 500
            nodeRes.setHeader('Content-Type', 'text/plain; charset=utf-8')
            nodeRes.end(err instanceof Error ? err.message : String(err))
          } else {
            nodeRes.end()
          }
        }
      })

      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(port, hostname, () => {
          server.removeListener('error', reject)
          options.onListen?.({ port, hostname })
          resolve()
        })
      })

      // Hold the server open for the process's lifetime. Node's
      // garbage-collector won't reap a listening server, but tests
      // benefit from a way to stop it — expose via builder's outDir
      // or by holding the reference. For now: trust the host.
      // (A `.stop()` exposure is a Phase 5.x cut once we have a
      // shared Server-handle interface across adapters.)
    },
  }
}

// ===== Node http.IncomingMessage → Web Request =====
//
// Builds a real Web `Request` (using Node's global Request constructor,
// available since Node 18). The body is wrapped as a Web ReadableStream
// drawing from the IncomingMessage; methods without bodies (GET/HEAD)
// pass body=null per spec.

async function toWebRequest(nodeReq: IncomingMessage): Promise<Request> {
  // Reconstruct the URL. Node doesn't provide an absolute URL on
  // IncomingMessage — only the path. We use Host header + scheme for
  // the origin. https detection uses the X-Forwarded-Proto header for
  // reverse-proxy scenarios; default http otherwise.
  const host = (nodeReq.headers['host'] as string) ?? 'localhost'
  const scheme = (nodeReq.headers['x-forwarded-proto'] as string)?.split(',')[0]?.trim() ?? 'http'
  const url = `${scheme}://${host}${nodeReq.url ?? '/'}`

  const headers: Record<string, string> = {}
  for (const [k, v] of Object.entries(nodeReq.headers)) {
    if (Array.isArray(v)) headers[k] = v.join(', ')
    else if (typeof v === 'string') headers[k] = v
  }

  const method = nodeReq.method ?? 'GET'
  const init: RequestInit = { method, headers }
  if (method !== 'GET' && method !== 'HEAD') {
    // Convert IncomingMessage (a Node Readable) into a Web ReadableStream.
    // Most Node versions ≥17 have `Readable.toWeb`, but it's not
    // universally present; build manually for portability.
    init.body = nodeReadableToWebStream(nodeReq)
    // Web Request requires duplex: 'half' when sending a stream body
    // (Node 22+ enforces this).
    ;(init as RequestInit & { duplex?: 'half' }).duplex = 'half'
  }
  return new Request(url, init)
}

function nodeReadableToWebStream(nodeStream: Readable): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      nodeStream.on('data', (chunk) => {
        controller.enqueue(chunk instanceof Uint8Array ? chunk : new Uint8Array(Buffer.from(chunk)))
      })
      nodeStream.on('end', () => controller.close())
      nodeStream.on('error', (e) => controller.error(e))
    },
    cancel() {
      nodeStream.destroy()
    },
  })
}

// ===== Web Response → Node http.ServerResponse =====

async function writeWebResponse(res: Response, nodeRes: ServerResponse): Promise<void> {
  nodeRes.statusCode = res.status
  // Headers: copy verbatim. Note: `res.headers.forEach` doesn't visit
  // `set-cookie` multiple-instance forms reliably across runtimes; for
  // most cases (one Set-Cookie per response) this is fine, and we
  // expose `getSetCookie()` if a future caller needs multi-cookie.
  res.headers.forEach((v, k) => {
    nodeRes.setHeader(k, v)
  })
  if (res.body === null) {
    nodeRes.end()
    return
  }
  // Pipe the response body. The Web ReadableStream → Node Writable
  // pipe is supported via async iteration; chunk by chunk for
  // backpressure.
  const reader = res.body.getReader()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      // ServerResponse.write returns false when the internal buffer is
      // full; we should wait for 'drain' before writing more. For
      // correctness (not just throughput) — without this, large
      // responses can OOM under slow clients.
      const ok = nodeRes.write(value)
      if (!ok) {
        await new Promise<void>((r) => nodeRes.once('drain', r))
      }
    }
  } finally {
    reader.releaseLock()
  }
  nodeRes.end()
}
