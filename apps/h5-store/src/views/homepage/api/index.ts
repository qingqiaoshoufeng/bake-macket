import type { PublicHomepageView } from '@bake-mall/contracts';

import { apiClient } from '../../../api/http.js';

export const homepageApi = {
  get: (): Promise<PublicHomepageView | null> =>
    apiClient.get('/public/homepage'),
};
