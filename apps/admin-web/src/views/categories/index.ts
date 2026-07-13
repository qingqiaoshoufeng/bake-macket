/**
 * Barrel export for the category management view.
 *
 * `router/index.ts` imports the entry view through this file. Internal
 * callers prefer the deep imports so the bundler can tree-shake unused
 * components / hooks.
 */

export { default as CategoriesView } from '../CategoriesView.vue';
