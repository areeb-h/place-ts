// @vitest-environment happy-dom

import { describe, expect, test } from 'vitest'
import { action, Form, mount, renderToString, shape } from '../../src/index.ts'

// `<Form>` ties together action() submission. Tests the JSX wrapper +
// progressive-enhancement form-encoded action handler path.

describe('action.handler — body parsing', () => {
  test('JSON body still works (the action.call path)', async () => {
    // Pre-bind so TS infers `fn`'s param type from the validator's
    // result (the same dance documented in the dx-helpers test).
    type Echo = { msg: string }
    const validator = shape({ msg: 'string' })
    const a = action({
      path: 'POST /api/echo',
      input: validator,
      fn: ({ msg }: Echo) => ({ echoed: msg }),
    })
    const handler = a.handler['POST /api/echo']
    if (!handler) throw new Error('handler not found')
    const res = await handler(
      new Request('http://x/api/echo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ msg: 'hi' }),
      }),
      {},
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ echoed: 'hi' })
  })

  test('form-encoded body works (no-JS form submission path)', async () => {
    // Pre-bind so TS infers `fn`'s param type from the validator's
    // result (the same dance documented in the dx-helpers test).
    type Echo = { msg: string }
    const validator = shape({ msg: 'string' })
    const a = action({
      path: 'POST /api/echo',
      input: validator,
      fn: ({ msg }: Echo) => ({ echoed: msg }),
    })
    const handler = a.handler['POST /api/echo']
    if (!handler) throw new Error('handler not found')
    const fd = new FormData()
    fd.set('msg', 'from-form')
    const res = await handler(new Request('http://x/api/echo', { method: 'POST', body: fd }), {})
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ echoed: 'from-form' })
  })

  test('url-encoded body works', async () => {
    // Pre-bind so TS infers `fn`'s param type from the validator's
    // result (the same dance documented in the dx-helpers test).
    type Echo = { msg: string }
    const validator = shape({ msg: 'string' })
    const a = action({
      path: 'POST /api/echo',
      input: validator,
      fn: ({ msg }: Echo) => ({ echoed: msg }),
    })
    const handler = a.handler['POST /api/echo']
    if (!handler) throw new Error('handler not found')
    const res = await handler(
      new Request('http://x/api/echo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'msg=urlencoded',
      }),
      {},
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ echoed: 'urlencoded' })
  })
})

describe('Form — JSX form-submission helper', () => {
  // Make a fake action that captures input + lets us control resolution.
  function makeFakeAction<I, R>() {
    let lastInput: I | null = null
    let resolveCall: (r: R) => void = () => {}
    let rejectCall: (e: unknown) => void = () => {}
    const a = {
      // `action.path` is the URL path WITHOUT a method prefix; the
      // method comes from `parsePath` and is encoded in `handler` keys.
      path: '/api/x',
      handler: {},
      call: (input: I): Promise<R> => {
        lastInput = input
        return new Promise<R>((resolve, reject) => {
          resolveCall = resolve
          rejectCall = reject
        })
      },
    } as unknown as ReturnType<typeof action<I, R>>
    return {
      action: a,
      getLastInput: () => lastInput,
      resolve: (r: R) => resolveCall(r),
      reject: (e: unknown) => rejectCall(e),
    }
  }

  test('renders a <form> with method=post + action=path', () => {
    const fake = makeFakeAction<{ id: string }, { ok: boolean }>()
    const html = renderToString(Form({ action: fake.action, children: 'go' }))
    expect(html).toContain('<form')
    expect(html).toContain('method="post"')
    expect(html).toContain('action="/api/x"')
    expect(html).toContain('go')
    expect(html).toContain('</form>')
  })

  test('mount(): submit calls action.call with form data', async () => {
    const fake = makeFakeAction<Record<string, string>, { ok: boolean }>()
    let submittingCalled = false
    let successResult: { ok: boolean } | null = null
    const root = document.createElement('div')
    document.body.appendChild(root)
    try {
      mount(
        Form({
          action: fake.action,
          onSubmitting: () => {
            submittingCalled = true
          },
          onSuccess: (r) => {
            successResult = r
          },
          children: '<input name="id" value="abc" /><button>Go</button>',
        }),
        root,
      )
      const form = root.querySelector('form') as HTMLFormElement
      // happy-dom doesn't auto-render the children-as-string; manually
      // populate the form for the test.
      form.innerHTML = '<input name="id" value="abc" /><button>Go</button>'
      // Dispatch submit (preventDefault is on the framework's handler).
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      // onSubmitting fires synchronously before the call.
      expect(submittingCalled).toBe(true)
      expect(fake.getLastInput()).toEqual({ id: 'abc' })
      // Resolve the call; onSuccess fires.
      fake.resolve({ ok: true })
      await new Promise((r) => setTimeout(r, 0))
      expect(successResult).toEqual({ ok: true })
    } finally {
      root.remove()
    }
  })

  test('mount(): error path fires onError + onDone, not onSuccess', async () => {
    const fake = makeFakeAction<Record<string, string>, { ok: boolean }>()
    let errorMsg: string | null = null
    let doneCalled = false
    let successCalled = false
    const root = document.createElement('div')
    document.body.appendChild(root)
    try {
      mount(
        Form({
          action: fake.action,
          onSuccess: () => {
            successCalled = true
          },
          onError: (e) => {
            errorMsg = e.message
          },
          onDone: () => {
            doneCalled = true
          },
          children: '',
        }),
        root,
      )
      const form = root.querySelector('form') as HTMLFormElement
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      fake.reject(new Error('boom'))
      // onError fires after the rejected promise settles.
      await new Promise((r) => setTimeout(r, 0))
      expect(errorMsg).toBe('boom')
      expect(doneCalled).toBe(true)
      expect(successCalled).toBe(false)
    } finally {
      root.remove()
    }
  })

  test('custom input mapper transforms FormData', async () => {
    const fake = makeFakeAction<{ id: string; count: number }, { ok: boolean }>()
    const root = document.createElement('div')
    document.body.appendChild(root)
    try {
      mount(
        Form({
          action: fake.action,
          input: (fd) => ({
            id: String(fd.get('id') ?? ''),
            count: Number(fd.get('count') ?? 0),
          }),
          children: '',
        }),
        root,
      )
      const form = root.querySelector('form') as HTMLFormElement
      form.innerHTML = '<input name="id" value="a" /><input name="count" value="42" />'
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      expect(fake.getLastInput()).toEqual({ id: 'a', count: 42 })
    } finally {
      root.remove()
    }
  })
})
