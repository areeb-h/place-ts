// Barrel: `routes('/api', […])` composes each page's local path with
// the `/api` prefix.

import { routes } from '@place/component/server'
import apiAction from './action.page.tsx'
import apiApp from './app.page.tsx'
import apiComponents from './components.page.tsx'
import apiCriticalAction from './critical-action.page.tsx'
import apiData from './data.page.tsx'
import apiDefineCapability from './define-capability.page.tsx'
import apiDesign from './design.page.tsx'
import apiLayout from './layout.page.tsx'
import apiMotion from './motion.page.tsx'
import apiPage from './page.page.tsx'
import apiPersistence from './persistence.page.tsx'
import apiSearch from './search.page.tsx'
import apiSecurity from './security.page.tsx'
import apiState from './state.page.tsx'

export default routes('/api', [
  apiPage,
  apiApp,
  apiLayout,
  apiState,
  apiComponents,
  apiAction,
  apiCriticalAction,
  apiDefineCapability,
  apiMotion,
  apiDesign,
  apiSecurity,
  apiPersistence,
  apiData,
  apiSearch,
])
