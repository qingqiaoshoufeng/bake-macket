import type { AdminProductImageView, MediaAsset } from '@bake-mall/contracts';

export type SkuAttributeRow = {
  readonly key: string;
  readonly value: string;
};

export type SkuFormRow = {
  readonly rowId: string;
  readonly id?: string;
  readonly stockVersion?: number;
  readonly name: string;
  readonly attributes: readonly SkuAttributeRow[];
  readonly priceYuan: string;
  readonly stock: number;
  readonly isActive: boolean;
  readonly image: MediaAsset | null;
};

export type ProductImageFormRow = Omit<AdminProductImageView, 'id'> & {
  readonly localId: string;
  readonly id?: string;
};

export type ProductFormShape = {
  readonly name: string;
  readonly summary: string;
  readonly categoryId: string;
  readonly coverImage: MediaAsset | null;
  readonly images: readonly ProductImageFormRow[];
  readonly detailHtml: string;
  readonly skus: readonly SkuFormRow[];
  readonly sortOrder: number;
  readonly isActive: boolean;
};
