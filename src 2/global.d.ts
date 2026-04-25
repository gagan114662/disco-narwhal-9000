export {}

// React Compiler emits `import { c as _c } from "react/compiler-runtime"` and
// then calls `_c(N)` to allocate a memo cache of size N indexed numerically.
// `@types/react/compiler-runtime.d.ts` ships an empty `export {}` (intentional —
// they don't expose `c` for direct consumption), so every compiler-emitted
// file fails type checking without this augmentation.
//
// Slot returns are framework-internal; `unknown[]` is the safest viable shape
// (the cache values are arbitrary by design — props, derived values, JSX, etc.)
// and `_c(31)[0]` index-access typechecks correctly under strict null checks.
declare module 'react/compiler-runtime' {
  export function c(slotCount: number): unknown[]
}
