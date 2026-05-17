// sandbox — browser entry. Bundled by serve()'s `clientEntry` and served
// at /client.js. Mounts <Layout>{dispatch}</Layout> into the empty `#app`
// div the server-rendered page emits.

import { mount } from '@place/component'
import { hashRouter } from '@place/routing'
import { Layout } from './components/Layout.tsx'
import { dispatch } from './pages.tsx'

mount(<Layout>{dispatch}</Layout>, '#app', { provide: [hashRouter()] })
