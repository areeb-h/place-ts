// @vitest-environment node

import { describe, expect, test } from 'vitest'
import {
  DEFAULT_FEATURES,
  parseArgs,
  resolveFeatures,
  slugifyBasename,
  USAGE,
  validateName,
} from '../../src/args.ts'

describe('parseArgs', () => {
  test('positional name is captured', () => {
    const a = parseArgs(['my-app'])
    expect(a.name).toBe('my-app')
    expect(a.targetDir).toBe('my-app')
  })

  test('--template via space form', () => {
    const a = parseArgs(['my-app', '--template', 'minimal'])
    expect(a.variant).toBe('minimal')
  })

  test('--template via = form', () => {
    const a = parseArgs(['my-app', '--template=content'])
    expect(a.variant).toBe('content')
  })

  test('--template rejects unknown', () => {
    expect(() => parseArgs(['x', '--template', 'nope'])).toThrow(/unknown template 'nope'/)
  })

  test('--with adds features (repeatable)', () => {
    const a = parseArgs(['x', '--with', 'tests', '--with', 'ci'])
    expect(a.withFeatures).toEqual(['tests', 'ci'])
  })

  test('--with via = form', () => {
    const a = parseArgs(['x', '--with=tests'])
    expect(a.withFeatures).toEqual(['tests'])
  })

  test('--without removes default-on features', () => {
    const a = parseArgs(['x', '--without', 'theme-toggle'])
    expect(a.withoutFeatures).toEqual(['theme-toggle'])
  })

  test('--with rejects unknown feature', () => {
    expect(() => parseArgs(['x', '--with', 'eslint'])).toThrow(/unknown feature 'eslint'/)
  })

  test('--with deduplicates', () => {
    const a = parseArgs(['x', '--with', 'tests', '--with', 'tests'])
    expect(a.withFeatures).toEqual(['tests'])
  })

  test('--no-install flips the install flag', () => {
    const a = parseArgs(['my-app', '--no-install'])
    expect(a.skipInstall).toBe(true)
  })

  test('--no-git flips the skipGit flag', () => {
    const a = parseArgs(['my-app', '--no-git'])
    expect(a.skipGit).toBe(true)
  })

  test('--yes / -y flip the auto-yes flag', () => {
    expect(parseArgs(['x', '--yes']).yes).toBe(true)
    expect(parseArgs(['x', '-y']).yes).toBe(true)
  })

  test('--list flips the list flag', () => {
    expect(parseArgs(['--list']).list).toBe(true)
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
    const a = parseArgs([])
    expect(a.name).toBe('')
    expect(a.variant).toBe('')
  })

  test('`.` positional captured as name', () => {
    expect(parseArgs(['.']).name).toBe('.')
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

describe('slugifyBasename', () => {
  test('lowercases', () => {
    expect(slugifyBasename('MyDir')).toBe('mydir')
  })

  test('replaces invalid chars with dashes', () => {
    expect(slugifyBasename('hello world!')).toBe('hello-world')
  })

  test('strips leading dot/underscore', () => {
    expect(slugifyBasename('.config')).toBe('config')
    expect(slugifyBasename('_app')).toBe('app')
  })

  test('falls back to place-app on empty', () => {
    expect(slugifyBasename('')).toBe('place-app')
    expect(slugifyBasename('---')).toBe('place-app')
  })
})

describe('resolveFeatures', () => {
  test('returns variant defaults when no overrides', () => {
    expect(resolveFeatures('minimal', [], [])).toEqual([...DEFAULT_FEATURES.minimal])
  })

  test('--with adds beyond defaults', () => {
    const result = resolveFeatures('minimal', ['tests'], [])
    expect(result).toContain('tests')
    for (const def of DEFAULT_FEATURES.minimal) {
      expect(result).toContain(def)
    }
  })

  test('--without removes from defaults', () => {
    const result = resolveFeatures('minimal', [], ['theme-toggle'])
    expect(result).not.toContain('theme-toggle')
  })

  test('--without wins over --with', () => {
    // edge case: both flags name the same feature → without wins
    expect(resolveFeatures('minimal', ['tests'], ['tests'])).not.toContain('tests')
  })

  test('app variant carries persistence + design-system by default', () => {
    const result = resolveFeatures('app', [], [])
    expect(result).toContain('persistence')
    expect(result).toContain('design-system')
  })
})

describe('USAGE', () => {
  test('mentions key options', () => {
    expect(USAGE).toContain('--template')
    expect(USAGE).toContain('--with')
    expect(USAGE).toContain('--without')
    expect(USAGE).toContain('--no-install')
    expect(USAGE).toContain('--no-git')
    expect(USAGE).toContain('--yes')
    expect(USAGE).toContain('--list')
    expect(USAGE).toContain('--help')
  })

  test('mentions every template + feature', () => {
    for (const v of ['minimal', 'content', 'app']) {
      expect(USAGE).toContain(v)
    }
    for (const f of ['theme-toggle', 'tests', 'ci', 'design-system', 'persistence']) {
      expect(USAGE).toContain(f)
    }
  })
})
