---
name: js-functional-style
description: 在编写或审查 JavaScript / TypeScript（Vue / React / Node）代码时使用此 skill。规则是函数式、不可变数据风格；优先使用 ES6 语法（数组的 map/filter/reduce/find/some/every 等）代替 `for`/`push` 等命令式写法，避免就地变更；推荐只使用 `const`、解构、扩展运算符；命名收集有意义的小工具到 `src/utils/` 共享。浏览器、微信 web-view 或原生小程序代码必须同时使用 frontend-runtime-compat，现代写法不得凌驾于目标运行时兼容性。
---

# JS Functional Style

Use whenever writing or reviewing JavaScript / TypeScript anywhere in the Bake Mall MVP (Vue, React, NestJS specs, scripts). It formalises the developer muscle memory you asked for.

## When to use

- Editing `.ts` / `.vue` / `.tsx` / `.mjs` files.
- Reviewing PRs or own code.
- Teaching helpers (project rules).
- 浏览器、微信 `web-view` 或原生小程序代码必须同时读取 `../frontend-runtime-compat/SKILL.md`；函数式风格不等于运行时兼容。

## When not to use

- Generated GraphQL schemas, raw SQL, or HTML-only edits where mutation is the natural shape.
- One-line, throwaway scripts in `node -e` shebang context.

## Hard rules

### 1. Immutability by default

- `const` everywhere, including in `for` loops (`for (const x of xs)` not `for (let i=0;...)`).
- Treat all updates as "return a new value":
  - arrays → spread `[...arr, item]`, `[arr.filter(x => …)]`, never `arr.push(item)` when the function name implies a transform.
  - objects → `{ ...obj, key: value }`, never `obj.key = value` mid-pipeline.
- Avoid mutating parameters inside helpers; either clone first or return derived.

### 2. ES6-first iteration

Prefer in this order:

| Need              | Prefer                                                                 | Avoid                    |
| ----------------- | ---------------------------------------------------------------------- | ------------------------ |
| Build a new array | `xs.map(fn)`                                                           | `for` + `arr.push`       |
| Filter            | `xs.filter(pred)`                                                      | `for` + `if (pred) push` |
| Reduce            | `xs.reduce(fn, init)`                                                  | manual accumulators      |
| Search            | `xs.find` / `xs.some` / `xs.every`                                     | `for` + index tracking   |
| Sort immutably    | `[...xs].sort(cmp)`                                                    | `xs.sort()` in-place     |
| Group             | `xs.reduce((m, x) => ({ ...m, [k(x)]: [...(m[k(x)] ?? []), x] }), {})` | mutation map             |
| Dedupe by key     | `Array.from(new Map(xs.map(x => [k(x), x])).values())`                 | `Set + filter`           |
| Flatten           | `xs.flat()`                                                            | recursive reduce         |

Helper collector: when you reuse a pattern across modules, add it to `src/utils/array.ts` (e.g. `groupBy`, `sortBy`, `partition`, `pluck`). No copy-pasted reducer literals.

### 3. Composition over mutation

- Pipeline style: `pipe(map, filter, take)`.
- Prefer `Promise.all([...])` to parallelise independent side effects.
- 浏览器/WebView/小程序代码不得默认直接使用 `structuredClone`；先遵循 `frontend-runtime-compat` 的目标基线，优先领域构造、浅拷贝或经过测试的兼容 helper。Node-only 代码可在 Node 基线支持时使用。

### 4. Function style

- Prefer small named functions with explicit inputs/returns.
- Side effects (logging, persistence, navigation) live at the edges of the pipeline, not inside helpers.
- Avoid anonymous `=>` for anything that a reader cannot understand in 1 line; prefer `function name(...)` declarations for top-level named helpers.

### 5. Avoid

- `array.push(x)` when the surrounding function is named `create*`/`build*`/`map*`/`transform*`.
- `for (let i = 0; i < arr.length; i++)` loops purely for filtering or mapping.
- Mutating variables inside `Array.reduce` callbacks.
- Returning mutated references (`return cache`) from helpers unless the type is `Readonly<>`.

## Helper recipes

```ts
export const groupBy = <T, K extends string>(
  xs: readonly T[],
  key: (x: T) => K,
): Record<K, T[]> =>
  xs.reduce(
    (m, x) => ({ ...m, [key(x)]: [...(m[key(x)] ?? []), x] }),
    {} as Record<K, T[]>,
  );

export const sortBy = <T>(
  xs: readonly T[],
  key: (x: T) => number | string,
  dir: 'asc' | 'desc' = 'asc',
): T[] =>
  [...xs].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    if (ka === kb) return 0;
    return (ka > kb ? 1 : -1) * (dir === 'asc' ? 1 : -1);
  });
```

These belong under `src/utils/` in each app (H5, admin-web) and `packages/shared-contracts/src` only when truly cross-package.

## Reviewer checklist (apply during code review)

- [ ] No `arr.push` / `obj.x = y` inside helpers named `create*`/`map*`/`filter*`/`reduce*`/`merge*`.
- [ ] At least one `map`/`filter`/`reduce`/`find` per iteration instead of `for`.
- [ ] At least one helper collected into `src/utils/` for repeated patterns.
- [ ] No anonymous multi-line arrows; prefer named functions.
- [ ] No `let` that does not need mutation; prefer `const` or destructure.
- [ ] Side-effect calls (`showToast`, `router.push`, `localStorage.setItem`, fetch) sit at the edge of the call chain.
- [ ] 浏览器/WebView/小程序生产代码已同时执行 `frontend-runtime-compat` 清单；没有用“更现代”作为跳过目标宿主兼容性的理由。
