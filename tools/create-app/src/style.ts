// ANSI style helpers for create-app's interactive output. Duplicated
// (not shared) from `@place-ts/component/logging.ts` on purpose —
// create-app must stay zero-dep at install time, and a cross-package
// import would force `bun install` to fetch a workspace-resolved dep
// before scaffolding can run.
//
// TTY detection: when stdout isn't a real terminal (CI, log capture,
// pipe), every helper returns the raw string. The output stays human-
// readable even without colour support.

const isTty = (): boolean => Boolean(process.stdout.isTTY)

const wrap =
  (open: string, close: string) =>
  (s: string): string =>
    isTty() ? `\x1b[${open}m${s}\x1b[${close}m` : s

export const bold = wrap('1', '22')
export const dim = wrap('2', '22')
export const red = wrap('31', '39')
export const green = wrap('32', '39')
export const yellow = wrap('33', '39')
export const magenta = wrap('35', '39')
export const cyan = wrap('36', '39')
export const gray = wrap('90', '39')

// Standard symbol set used throughout the prompt/scaffold UI. Diamond
// bullets give the flow a clear vertical rail (◇ for in-progress,
// ◆ for headline beats, ✓ for success, ✗ for failure).
export const symbols = {
  active: '◇',
  done: '◆',
  ok: '✓',
  err: '✗',
  bullet: '◦',
  info: 'i',
  caret: '›',
  rail: '│',
} as const

// Indent helper — every line of `text` gets the prefix.
export const indent = (text: string, by = 4): string => {
  const pad = ' '.repeat(by)
  return text
    .split('\n')
    .map((line) => (line.length === 0 ? line : pad + line))
    .join('\n')
}
