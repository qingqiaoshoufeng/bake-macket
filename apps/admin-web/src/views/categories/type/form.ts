/**
 * View-layer form shape for the category management view.
 *
 * The form carries every editable field used by the create dialog and the
 * inline edit draft. Kept separate from {@link CreateCategoryRequest} so
 * the view can hold presentation-only fields (e.g. `isActive` as a draft
 * before the merchant saves) without polluting the wire contract.
 */

import type {
  AdminCategoryView,
  CreateCategoryRequest,
} from '../../../api/catalog.js';

export type CategoryFormShape = {
  name: string;
  imageUrl: string;
  sortOrder: number;
  isActive: boolean;
};

export type CategoryInlineEdit = CategoryFormShape;

export type CategoryFormSubmit = CreateCategoryRequest;

export type { AdminCategoryView };
