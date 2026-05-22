// Home page — landing for an interactive app. Links into the
// dashboard where the heavy interactivity lives.

import { page } from '@place-ts/component'

export default page('/', {
  meta: { title: 'Home' },
  view: () => (
    <div class="space-y-6">
      <h1 class="text-4xl font-semibold tracking-tight">welcome to __APP_NAME__</h1>
      <p class="text-muted max-w-prose">
        a place-ts interactive app — islands for the parts that need it, server-rendered HTML for
        everything else.
      </p>
      <p>
        <Link
          to="/dashboard"
          class="inline-flex items-center gap-2 rounded-md bg-accent text-accent-fg px-4 py-2 text-sm font-medium no-underline hover:opacity-90 transition-opacity"
        >
          Open the dashboard →
        </Link>
      </p>
    </div>
  ),
})
