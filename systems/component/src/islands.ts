// @place/component/islands — the islands API.
//
// `island()` registers an island; `<Island>` is the JSX form;
// `ISLAND_BRAND` tags island components. An island's sub-tree is
// mounted/hydrated at runtime through `@place/component/client`;
// this entry is the authoring + build-time surface.
//
// Curated re-export of `./index.ts` — additive (see ./server.ts).
export {
  island,
  Island,
  ISLAND_BRAND,
  type IslandComponent,
  type IslandProps,
  type IslandOptions,
  type ClientStrategy,
  type IslandSsrContext,
  type IslandSsrResult,
  type IslandSsrPropsResolver,
  type IslandRegistration,
} from './index.ts'
