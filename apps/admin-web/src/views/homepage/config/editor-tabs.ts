export const HOMEPAGE_EDITOR_TABS = [
  { key: 'hero', label: '首屏轮播', eyebrow: '01' },
  { key: 'customer-service', label: '客服信息', eyebrow: '02' },
  { key: 'shortcut-grid', label: '宫格入口', eyebrow: '03' },
  { key: 'image-blocks', label: '配图区', eyebrow: '04' },
] as const satisfies readonly {
  readonly key: string;
  readonly label: string;
  readonly eyebrow: string;
}[];

export type HomepageEditorTab = (typeof HOMEPAGE_EDITOR_TABS)[number]['key'];
