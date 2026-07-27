/**
 * Default form values for the category management view.
 *
 * The create dialog uses a fresh blank shape; the inline edit draft is
 * built per-row from {@link AdminCategoryView} in `hooks/useCategories`.
 * Sorting defaults to placing the new category at the end of the table —
 * the parent view passes `nextSortOrder()` as the initial value so the
 * merchant sees a stable numeric ordering.
 */

import type { CategoryFormShape } from '../type/form.js';
import type { CategoryFilterForm } from '../type/list.js';

export const createCategoryFilterDefaults = (): CategoryFilterForm => ({
  q: '',
  isActive: '',
  hasImage: '',
  hasProducts: '',
  createdAtRange: null,
});

export const createCategoryDefaults = (): CategoryFormShape => ({
  name: '',
  imageUrl: '',
  sortOrder: 0,
  isActive: true,
});

export const ACTIVE_LABEL = '已启用';
export const INACTIVE_LABEL = '已停用';
