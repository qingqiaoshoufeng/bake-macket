/**
 * Local mock fixtures for the category management view.
 *
 * Used by unit tests and as a stand-in when the backend is unavailable.
 * The fixtures conform to {@link AdminCategoryView} so the real `api/`
 * layer can swap in for the mock without changing the view's typing.
 */

import type { AdminCategoryView } from '../../../api/catalog.js';

export const categoryListMock: readonly AdminCategoryView[] = [
  {
    id: 'cat-birthday',
    name: '生日蛋糕',
    imageUrl: 'https://cdn.example.com/categories/birthday.png',
    sortOrder: 0,
    isActive: true,
    createdAt: '2026-07-01T09:00:00.000Z',
    updatedAt: '2026-07-08T10:00:00.000Z',
  },
  {
    id: 'cat-bread',
    name: '现烤面包',
    imageUrl: 'https://cdn.example.com/categories/bread.png',
    sortOrder: 1,
    isActive: true,
    createdAt: '2026-07-01T09:00:00.000Z',
    updatedAt: '2026-07-08T10:00:00.000Z',
  },
  {
    id: 'cat-snack',
    name: '下午茶点心',
    imageUrl: undefined,
    sortOrder: 2,
    isActive: false,
    createdAt: '2026-07-02T09:00:00.000Z',
    updatedAt: '2026-07-08T10:00:00.000Z',
  },
] as const;
