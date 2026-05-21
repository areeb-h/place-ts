// About page. `Link` is auto-imported via the @place-ts/component
// preload plugin (bunfig.toml); `page` stays explicit (common
// parameter name, prone to local shadowing). Demonstrates multi-page
// routing — `discoverPages('./src/pages')` in `app.ts` picks this
// file up automatically.
//
// Layouts persist across navigation: clicking the home Link in the
// header swaps only `{children}` in `src/layouts/main.layout.tsx`,
// not the header/footer chrome.

import { page } from '@place-ts/component'
import { Prose } from '@place-ts/design'

export default page('/about', {
  meta: { title: 'About' },
  view: () => (
    <Prose>
      <h1>About __APP_NAME__</h1>
      <p>
        This page lives at <code>src/pages/about.page.tsx</code>. Adding a new page is the same
        shape: drop a <code>*.page.tsx</code> file under <code>src/pages/</code> with a default
        export of <code>page('/path', {'{ view }'})</code> and the router picks it up.
      </p>

      <h2>Layouts persist across navigation</h2>
      <p>
        Click <Link to="/">Home</Link> in the header. Only the <code>{'{children}'}</code> slot
        re-renders — the header, footer, and any reactive state in <code>main.layout.tsx</code> stay
        alive. Same for going back here.
      </p>

      <h2>Where to look next</h2>
      <p>
        <code>src/app.ts</code> wires everything together — pages, layout, theme, styles, islands
        dir, router. Comments inline tell you what each option does.
      </p>
    </Prose>
  ),
})
