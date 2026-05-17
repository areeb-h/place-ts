// Barrel: `routes('/api', […])` composes each page's local path with
// the `/api` prefix.

import { routes } from '@place/component'
import apiAction from './action.page.tsx'
import apiApp from './app.page.tsx'
import apiComponents from './components.page.tsx'
import apiDefineCapability from './define-capability.page.tsx'
import apiDesign from './design.page.tsx'
import apiLayout from './layout.page.tsx'
import apiMotion from './motion.page.tsx'
import apiPage from './page.page.tsx'
import apiSecurity from './security.page.tsx'
import apiState from './state.page.tsx'

export default routes('/api', [
  apiPage,
  apiApp,
  apiLayout,
  apiState,
  apiComponents,
  apiAction,
  apiDefineCapability,
  apiMotion,
  apiDesign,
  apiSecurity,
])
