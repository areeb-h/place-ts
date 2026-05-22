// Interactive prompt primitives — hand-rolled, no external deps.
//
// `create-app` must stay zero-install-time-dep (every `bunx
// @place-ts/create-app` invocation downloads the package and its
// transitive deps fresh; one prompt-library dep adds seconds and a
// new failure surface). The trade-off: we own ~150 lines of TTY
// handling instead. Worth it.
//
// Three primitives:
//   text(label, default?) → string
//   select(label, options) → string  (single choice)
//   multiSelect(label, options) → string[]  (zero or more)
//   confirm(label, default?) → boolean
//
// All four require a TTY. Callers must check `process.stdin.isTTY`
// and feed defaults / explicit-flags when running headless (CI, log
// capture, piped). The TTY-or-bust contract keeps the picker code
// dead-simple — no async-iterable stdin chunking, no signal mux.

import { bold, cyan, dim, gray, green, magenta, symbols } from './style.ts'

interface PromptIO {
  out: NodeJS.WritableStream
  err: NodeJS.WritableStream
  stdin: NodeJS.ReadStream
}

const defaultIo = (): PromptIO => ({
  out: process.stdout,
  err: process.stderr,
  stdin: process.stdin,
})

const write = (io: PromptIO, s: string): void => {
  io.out.write(s)
}

const newline = (io: PromptIO): void => {
  io.out.write('\n')
}

// Rail line shown between prompts — borrowed from clack's vertical-
// flow aesthetic. Print after each completed prompt to visually
// connect them.
export const railLine = (io: PromptIO = defaultIo()): void => {
  write(io, `${gray(symbols.rail)}\n`)
}

// Render a "done" marker for a completed prompt: the active diamond
// turns muted, the label is dim, the chosen value is highlighted.
const renderDone = (io: PromptIO, label: string, value: string): void => {
  write(io, `${green(symbols.active)}  ${dim(label)} ${cyan(value)}\n`)
}

// Read a single keypress as a 1-3 byte sequence. Returns the raw
// chunk. The caller distinguishes keys by inspecting the bytes.
const readKey = (stdin: NodeJS.ReadStream): Promise<string> => {
  return new Promise((resolve) => {
    const onData = (chunk: Buffer): void => {
      stdin.off('data', onData)
      resolve(chunk.toString('utf8'))
    }
    stdin.on('data', onData)
  })
}

interface Keys {
  isUp: boolean
  isDown: boolean
  isLeft: boolean
  isRight: boolean
  isEnter: boolean
  isSpace: boolean
  isEsc: boolean
  isCtrlC: boolean
  isBackspace: boolean
  isPrintable: boolean
  raw: string
}

const parseKey = (raw: string): Keys => ({
  isUp: raw === '\x1b[A',
  isDown: raw === '\x1b[B',
  isRight: raw === '\x1b[C',
  isLeft: raw === '\x1b[D',
  isEnter: raw === '\r' || raw === '\n',
  isSpace: raw === ' ',
  isEsc: raw === '\x1b',
  isCtrlC: raw === '\x03',
  isBackspace: raw === '\x7f' || raw === '\b',
  isPrintable: raw.length === 1 && raw >= ' ' && raw < '\x7f',
  raw,
})

// Switch stdin to raw mode (one keypress = one event, no line
// buffering) for the duration of `fn`. Restores on exit so subsequent
// `bun install` etc. behave normally.
const withRawMode = async <T>(stdin: NodeJS.ReadStream, fn: () => Promise<T>): Promise<T> => {
  if (!stdin.isTTY) {
    throw new Error('prompt: stdin is not a TTY — cannot enter raw mode')
  }
  const wasRaw = stdin.isRaw
  stdin.setRawMode(true)
  stdin.resume()
  try {
    return await fn()
  } finally {
    stdin.setRawMode(wasRaw ?? false)
    stdin.pause()
  }
}

class PromptCancelled extends Error {
  constructor() {
    super('prompt cancelled')
    this.name = 'PromptCancelled'
  }
}

export const isPromptCancelled = (err: unknown): boolean =>
  err instanceof Error && err.name === 'PromptCancelled'

// Free-text input. Default appears greyed-in; pressing enter on an
// empty input accepts the default.
export async function text(
  label: string,
  options: { default?: string; validate?: (s: string) => string | null } = {},
  io: PromptIO = defaultIo(),
): Promise<string> {
  const def = options.default ?? ''
  let buf = ''
  let error = ''
  write(io, `${magenta(symbols.active)}  ${bold(label)}${def ? dim(` (${def})`) : ''} `)

  return withRawMode(io.stdin, async () => {
    while (true) {
      const key = parseKey(await readKey(io.stdin))
      if (key.isCtrlC || key.isEsc) throw new PromptCancelled()
      if (key.isEnter) {
        const value = buf.length === 0 ? def : buf
        if (options.validate) {
          const err = options.validate(value)
          if (err !== null) {
            error = err
            write(
              io,
              `\r\x1b[K${magenta(symbols.active)}  ${bold(label)}${def ? dim(` (${def})`) : ''} ${buf}  ${dim(`✗ ${error}`)}\r`,
            )
            // Re-render the prompt cleanly on next line.
            newline(io)
            write(
              io,
              `${magenta(symbols.active)}  ${bold(label)}${def ? dim(` (${def})`) : ''} ${buf}`,
            )
            continue
          }
        }
        newline(io)
        // Re-render the completed prompt for clean scrollback.
        write(io, `\x1b[1A\r\x1b[K`)
        renderDone(io, label, value)
        return value
      }
      if (key.isBackspace) {
        if (buf.length > 0) {
          buf = buf.slice(0, -1)
          write(io, '\b \b')
        }
        continue
      }
      if (key.isPrintable) {
        buf += key.raw
        write(io, key.raw)
      }
    }
  })
}

export interface SelectOption {
  value: string
  label: string
  hint?: string
}

// Single-choice picker. Up/down navigates, enter selects.
export async function select(
  label: string,
  opts: readonly SelectOption[],
  options: { default?: string } = {},
  io: PromptIO = defaultIo(),
): Promise<string> {
  if (opts.length === 0) throw new Error('select: at least one option required')
  const defaultIdx =
    options.default !== undefined ? opts.findIndex((o) => o.value === options.default) : 0
  let idx = defaultIdx < 0 ? 0 : defaultIdx
  const totalLines = opts.length + 1

  const render = (): void => {
    // Move to top of block + clear `totalLines` lines, then redraw.
    write(io, `${magenta(symbols.active)}  ${bold(label)}\n`)
    for (let i = 0; i < opts.length; i++) {
      const o = opts[i] as SelectOption
      const cursor = i === idx ? magenta(symbols.caret) : ' '
      const labelTxt = i === idx ? cyan(o.label) : o.label
      const hint = o.hint ? dim(`  ${o.hint}`) : ''
      write(io, `   ${cursor} ${labelTxt}${hint}\n`)
    }
  }

  render()

  return withRawMode(io.stdin, async () => {
    while (true) {
      const key = parseKey(await readKey(io.stdin))
      if (key.isCtrlC || key.isEsc) throw new PromptCancelled()
      if (key.isUp) {
        idx = (idx - 1 + opts.length) % opts.length
      } else if (key.isDown) {
        idx = (idx + 1) % opts.length
      } else if (key.isEnter) {
        // Clear the rendered block + reprint the done line.
        write(io, `\x1b[${totalLines}A\r\x1b[J`)
        const chosen = opts[idx] as SelectOption
        renderDone(io, label, chosen.label)
        return chosen.value
      } else {
        continue
      }
      // Redraw: move cursor up, clear, render.
      write(io, `\x1b[${totalLines}A\r\x1b[J`)
      render()
    }
  })
}

// Multi-choice toggle. Space toggles, enter confirms. Options can be
// pre-checked via `defaultChecked`.
export async function multiSelect(
  label: string,
  opts: readonly SelectOption[],
  options: { defaultChecked?: readonly string[] } = {},
  io: PromptIO = defaultIo(),
): Promise<string[]> {
  if (opts.length === 0) return []
  const checked = new Set<string>(options.defaultChecked ?? [])
  let idx = 0
  const totalLines = opts.length + 2

  const render = (): void => {
    write(io, `${magenta(symbols.active)}  ${bold(label)}\n`)
    write(io, `${dim('   space to toggle · enter to continue')}\n`)
    for (let i = 0; i < opts.length; i++) {
      const o = opts[i] as SelectOption
      const cursor = i === idx ? magenta(symbols.caret) : ' '
      const box = checked.has(o.value) ? green('[x]') : dim('[ ]')
      const labelTxt = i === idx ? cyan(o.label) : o.label
      const hint = o.hint ? dim(`  ${o.hint}`) : ''
      write(io, `   ${cursor} ${box} ${labelTxt}${hint}\n`)
    }
  }

  render()

  return withRawMode(io.stdin, async () => {
    while (true) {
      const key = parseKey(await readKey(io.stdin))
      if (key.isCtrlC || key.isEsc) throw new PromptCancelled()
      if (key.isUp) {
        idx = (idx - 1 + opts.length) % opts.length
      } else if (key.isDown) {
        idx = (idx + 1) % opts.length
      } else if (key.isSpace) {
        const o = opts[idx] as SelectOption
        if (checked.has(o.value)) checked.delete(o.value)
        else checked.add(o.value)
      } else if (key.isEnter) {
        write(io, `\x1b[${totalLines}A\r\x1b[J`)
        const picked = opts.filter((o) => checked.has(o.value)).map((o) => o.value)
        const summary = picked.length === 0 ? dim('(none)') : picked.join(', ')
        renderDone(io, label, summary)
        return picked
      } else {
        continue
      }
      write(io, `\x1b[${totalLines}A\r\x1b[J`)
      render()
    }
  })
}

// y/n confirm. Default is shown capitalized: `(Y/n)` if true, `(y/N)` if false.
export async function confirm(
  label: string,
  options: { default?: boolean } = {},
  io: PromptIO = defaultIo(),
): Promise<boolean> {
  const def = options.default ?? true
  const hint = def ? '(Y/n)' : '(y/N)'
  write(io, `${magenta(symbols.active)}  ${bold(label)} ${dim(hint)} `)

  return withRawMode(io.stdin, async () => {
    while (true) {
      const key = parseKey(await readKey(io.stdin))
      if (key.isCtrlC || key.isEsc) throw new PromptCancelled()
      let answer: boolean | null = null
      if (key.raw === 'y' || key.raw === 'Y') answer = true
      else if (key.raw === 'n' || key.raw === 'N') answer = false
      else if (key.isEnter) answer = def
      if (answer === null) continue
      newline(io)
      write(io, `\x1b[1A\r\x1b[K`)
      renderDone(io, label, answer ? 'yes' : 'no')
      return answer
    }
  })
}
