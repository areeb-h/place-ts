// @vitest-environment happy-dom

import { describe, expect, test } from 'vitest'
import { mount, renderToString } from '@place/component'
import { Avatar, Badge, Card } from '../../src/presentational.tsx'

describe('Avatar', () => {
  test('falls back to initials from name when no src', () => {
    const html = renderToString(Avatar({ name: 'Ada Lovelace' }))
    expect(html).toContain('>AL<')
  })

  test('takes max 2 initials', () => {
    const html = renderToString(Avatar({ name: 'Margaret Hamilton Apollo' }))
    expect(html).toContain('>MH<')
  })

  test('single-word name yields a single initial', () => {
    const html = renderToString(Avatar({ name: 'Grace' }))
    expect(html).toContain('>G<')
  })

  test('renders an <img> tag when src provided', () => {
    const html = renderToString(Avatar({ name: 'Ada', src: '/a.png' }))
    expect(html).toContain('<img')
    expect(html).toContain('src="/a.png"')
    expect(html).toContain('alt="Ada"')
  })

  test('size variants control width/height', () => {
    expect(renderToString(Avatar({ name: 'X', size: 'sm' }))).toContain('w-7')
    expect(renderToString(Avatar({ name: 'X', size: 'lg' }))).toContain('w-12')
    expect(renderToString(Avatar({ name: 'X', size: 'xl' }))).toContain('w-16')
  })

  test('default size is md (w-9)', () => {
    expect(renderToString(Avatar({ name: 'X' }))).toContain('w-9')
  })

  test('aria-label uses the full name', () => {
    const html = renderToString(Avatar({ name: 'Grace Hopper' }))
    expect(html).toContain('aria-label="Grace Hopper"')
  })

  test('additive class composes with the base recipe', () => {
    const html = renderToString(Avatar({ name: 'X', class: 'border-2' }))
    expect(html).toContain('border-2')
    expect(html).toContain('rounded-full')
  })

  // ===== Tier 17-E — img onError fallback to initials =====
  test('img onError swaps to initials text', () => {
    const root = document.createElement('div')
    mount(Avatar({ name: 'Grace Hopper', src: 'https://broken.example/x.png' }), root)
    const span = root.querySelector('span') as HTMLElement
    const img = span.querySelector('img') as HTMLImageElement
    expect(img).not.toBeNull()
    // Simulate the browser firing `error` on the img (e.g. 404 /
    // decode failure). The handler should replace the parent span's
    // contents with the initials text.
    img.dispatchEvent(new Event('error'))
    expect(span.textContent).toBe('GH')
    expect(span.querySelector('img')).toBeNull()
  })
})

describe('Badge', () => {
  test('renders a <span> with neutral default classes', () => {
    const html = renderToString(Badge({ children: 'New' }))
    expect(html).toMatch(/^<span/)
    expect(html).toContain('New')
    expect(html).toContain('rounded-full')
  })

  test('intent variants apply the right color classes', () => {
    expect(renderToString(Badge({ intent: 'accent', children: 'x' }))).toContain('text-accent')
    expect(renderToString(Badge({ intent: 'destructive', children: 'x' }))).toContain(
      'text-destructive',
    )
  })

  test('size sm and md both use tokenized type scale (text-xs)', () => {
    const sm = renderToString(Badge({ size: 'sm', children: 'x' }))
    const md = renderToString(Badge({ size: 'md', children: 'x' }))
    // Tier 15-D: Badge sizes use tokenized `text-xs` instead of
    // arbitrary `text-[10px]` / `text-[11px]`. Visual hierarchy is
    // now expressed via padding (`px-1.5 py-0` vs `px-2 py-0.5`),
    // not font-size pixel deltas.
    expect(sm).toContain('text-xs')
    expect(md).toContain('text-xs')
    expect(sm).toContain('px-1.5')
    expect(md).toContain('px-2')
  })

  test('renders children verbatim', () => {
    const html = renderToString(Badge({ children: 'Beta' }))
    expect(html).toContain('Beta')
  })
})

describe('Card', () => {
  test('renders a <div> with default flat/md classes', () => {
    const html = renderToString(Card({ children: 'Body' }))
    expect(html).toMatch(/^<div/)
    expect(html).toContain('Body')
    expect(html).toContain('rounded-xl')
    expect(html).toContain('p-5')
  })

  test('intent=raised adds shadow size + shadow color', () => {
    const html = renderToString(Card({ intent: 'raised', children: 'x' }))
    const flat = renderToString(Card({ intent: 'flat', children: 'x' }))
    expect(html).toContain('shadow-lg')
    expect(html).toContain('shadow-bg/30')
    expect(flat).not.toMatch(/\bshadow-/)
  })

  test('intent=accent uses the accent border + tint', () => {
    const html = renderToString(Card({ intent: 'accent', children: 'x' }))
    expect(html).toContain('border-accent')
    expect(html).toContain('bg-accent')
  })

  test('padding variants change padding utility', () => {
    expect(renderToString(Card({ padding: 'none', children: 'x' }))).not.toMatch(/\bp-\d/)
    expect(renderToString(Card({ padding: 'sm', children: 'x' }))).toContain('p-3')
    expect(renderToString(Card({ padding: 'lg', children: 'x' }))).toContain('p-6')
  })

  test('interactive=true adds hover translate + cursor utilities', () => {
    const html = renderToString(Card({ interactive: true, children: 'x' }))
    expect(html).toContain('cursor-pointer')
    expect(html).toContain('hover:-translate-y-0.5')
  })

  test('interactive=false (default) does NOT add hover utilities', () => {
    const html = renderToString(Card({ children: 'x' }))
    expect(html).not.toContain('cursor-pointer')
    expect(html).not.toContain('hover:-translate-y-0.5')
  })

  test('onClick fires when clicked', () => {
    let clicked = false
    const root = document.createElement('div')
    mount(Card({ onClick: () => { clicked = true }, children: 'x' }), root)
    const el = root.firstChild as HTMLElement
    el.click()
    expect(clicked).toBe(true)
  })

  test('additive class composes with the base recipe', () => {
    const html = renderToString(Card({ class: 'min-h-32', children: 'x' }))
    expect(html).toContain('min-h-32')
    expect(html).toContain('rounded-xl')
  })

  // ===== Tier 17-E v2 — named children slots =====
  test('Card.Header / Body / Footer render with expected slot chrome', () => {
    const html = renderToString(
      Card({
        padding: 'none',
        children: [
          Card.Header({ children: 'Title' }),
          Card.Body({ children: 'Body content' }),
          Card.Footer({ children: 'Actions' }),
        ],
      }),
    )
    expect(html).toMatch(/<header[^>]*>[\s\S]*Title[\s\S]*<\/header>/)
    expect(html).toMatch(/<div[^>]*px-5 py-4[^>]*>[\s\S]*Body content/)
    expect(html).toMatch(/<footer[^>]*>[\s\S]*Actions[\s\S]*<\/footer>/)
  })

  test('Card.Header border-bottom matches Dialog.Header pattern', () => {
    const html = renderToString(Card.Header({ children: 'Hi' }))
    expect(html).toContain('border-b')
    expect(html).toContain('border-border/60')
  })

  test('Card.Footer subtle bg + border-top + right-justified actions', () => {
    const html = renderToString(Card.Footer({ children: 'OK' }))
    expect(html).toContain('border-t')
    expect(html).toContain('justify-end')
    expect(html).toContain('bg-bg/40')
  })

  test('slot class prop is additive on the slot chrome', () => {
    const html = renderToString(Card.Body({ class: 'min-h-64', children: 'x' }))
    expect(html).toContain('min-h-64')
    expect(html).toContain('px-5')
  })
})
