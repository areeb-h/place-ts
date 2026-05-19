// Barrel: `routes('/recipes', […])` composes each page's local path
// with the `/recipes` prefix. The folder's `index.page.tsx` declares
// path `/` and resolves to `/recipes` (directory-index semantics).

import { routes } from '@place/component/server'
import recipeAuth from './auth.page.tsx'
import recipeData from './data-fetching.page.tsx'
import recipeForms from './forms.page.tsx'
import recipeIndex from './index.page.tsx'
import recipeStreaming from './streaming.page.tsx'
import recipeTheming from './theming.page.tsx'

export default routes('/recipes', [
  recipeIndex,
  recipeForms,
  recipeData,
  recipeAuth,
  recipeStreaming,
  recipeTheming,
])
