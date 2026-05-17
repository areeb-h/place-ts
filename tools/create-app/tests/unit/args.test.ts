// @vitest-environment node

import { describe, expect, test } from 'vitest'
import { parseArgs, USAGE, validateName } from '../../src/args.ts'

describe('parseArgs', () => {
  test('positional name is captured', () => {
    const a = parseArgs(['my-app'])
    expect(a.name).toBe('my-app')
    expect(a.targetDir).toBe('my-app')
  })

  test('--template via space form', () => {
    const a = parseArgs(['my-app', '--template', 'minimal'])
    expect(a.template).toBe('minimal')
  })

  test('--template via = form', () => {
    const a = parseArgs(['my-app', '--template=minimal'])
    expect(a.template).toBe('minimal')
  })

  test('--no-install flips the install flag', () => {
    const a = parseArgs(['my-app', '--no-install'])
    expect(a.skipInstall).toBe(true)
  })

  test('--yes / -y flip the auto-yes flag', () => {
    expect(parseArgs(['x', '--yes']).yes).toBe(true)
    expect(parseArgs(['x', '-y']).yes).toBe(true)
  })

  test('--help / -h flip the help flag', () => {
    expect(parseArgs(['--help']).help).toBe(true)
    expect(parseArgs(['-h']).help).toBe(true)
  })

  test('unknown option throws', () => {
    expect(() => parseArgs(['my-app', '--unknown'])).toThrow(/unknown option: --unknown/)
  })

  test('extra positional throws', () => {
    expect(() => parseArgs(['a', 'b'])).toThrow(/unexpected positional argument: b/)
  })

  test('empty argv → empty name (prompted later)', () => {
    expect(parseArgs([]).name).toBe('')
  })
})

describe('validateName — npm-shaped rules', () => {
  test('lowercase alphanum + dash + underscore: ok', () => {
    expect(validateName('my-app')).toBeNull()
    expect(validateName('foo_bar')).toBeNull()
    expect(validateName('a1b2')).toBeNull()
  })

  test('rejects empty', () => {
    expect(validateName('')).toMatch(/empty/)
  })

  test('rejects uppercase', () => {
    expect(validateName('MyApp')).toMatch(/lowercase/)
  })

  test('rejects whitespace', () => {
    expect(validateName('my app')).toMatch(/whitespace/)
  })

  test('rejects leading dot or underscore', () => {
    expect(validateName('.app')).toMatch(/start with/)
    expect(validateName('_app')).toMatch(/start with/)
  })

  test('rejects symbol characters', () => {
    expect(validateName('my$app')).toMatch(/invalid characters/)
    expect(validateName('my!app')).toMatch(/invalid characters/)
  })

  test('rejects names longer than 214 chars', () => {
    expect(validateName('a'.repeat(215))).toMatch(/214/)
  })

  test('@scope/name shape allowed', () => {
    expect(validateName('@org/app')).toBeNull()
  })
})

describe('USAGE', () => {
  test('mentions key options', () => {
    expect(USAGE).toContain('--template')
    expect(USAGE).toContain('--no-install')
    expect(USAGE).toContain('--yes')
    expect(USAGE).toContain('--help')
  })
})
