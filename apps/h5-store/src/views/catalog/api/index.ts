import { catalogApi } from '../../../api/catalog.js';

export const catalogFeatureApi = {
  listBanners: catalogApi.listBanners.bind(catalogApi),
  listCategories: catalogApi.listCategories.bind(catalogApi),
  listProducts: catalogApi.listProducts.bind(catalogApi),
  getProduct: catalogApi.getProduct.bind(catalogApi),
};
