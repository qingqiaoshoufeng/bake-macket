import type {
  AdminCategoryView,
  AdminProductSummaryView,
  HomepageDraftConfig,
  HomepageValidationIssue,
} from '@bake-mall/contracts';

export type HomepageEditorOptions = {
  readonly categories: readonly AdminCategoryView[];
  readonly products: readonly AdminProductSummaryView[];
};

export type HomepageEditorState = {
  readonly draft: HomepageDraftConfig;
  readonly version: number;
  readonly publishedVersion?: number;
  readonly publishedAt?: string;
  readonly issues: readonly HomepageValidationIssue[];
};
