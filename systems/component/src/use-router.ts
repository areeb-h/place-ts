// Intentionally empty.
//
// `useRouter()` lives in `@place-ts/routing` next to `Router` +
// `RouterCap`. We tried briefly to re-export it from this package
// (0.10.8) and from a local copy here; both shapes were rejected for
// good reason — see the comment in `./index.ts` at the spot where
// the re-export USED to be. The file lingers as a no-op until
// dropped in a future patch; deleting it would force a cascading
// renumber on every test that imports from `./` paths.
export {}
