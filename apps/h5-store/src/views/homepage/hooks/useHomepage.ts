import {
  HomepageSectionType,
  type PublicHomepageView,
} from '@bake-mall/contracts';
import { ref, type Ref } from 'vue';

import { homepageApi } from '../api/index.js';

export type UseHomepageResult = {
  readonly data: Ref<PublicHomepageView | null>;
  readonly loading: Ref<boolean>;
  readonly loaded: Ref<boolean>;
  readonly error: Ref<string | null>;
  readonly load: () => Promise<void>;
};

export function useHomepage(): UseHomepageResult {
  const data = ref<PublicHomepageView | null>(null);
  const loading = ref(false);
  const loaded = ref(false);
  const error = ref<string | null>(null);

  async function load(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      const view = await homepageApi.get();
      if (view) {
        const { config } = view;
        const validSectionTypes =
          config.schemaVersion === 1 &&
          config.hero.type === HomepageSectionType.HERO_CAROUSEL &&
          config.customerService.type === HomepageSectionType.CUSTOMER_SERVICE &&
          config.shortcutGrid.type === HomepageSectionType.SHORTCUT_GRID &&
          config.imageBlocks.every(
            ({ type }) => type === HomepageSectionType.IMAGE_BLOCK,
          );
        if (!validSectionTypes) {
          throw new Error('首页配置版本或区块类型暂不受支持');
        }
      }
      data.value = view;
      loaded.value = true;
    } catch (loadError) {
      error.value =
        loadError instanceof Error ? loadError.message : '首页加载失败，请稍后重试';
      throw loadError;
    } finally {
      loading.value = false;
    }
  }

  return { data, loading, loaded, error, load };
}
