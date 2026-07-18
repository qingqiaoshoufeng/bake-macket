import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { validateOrReject } from 'class-validator';
import { DataSource, Repository } from 'typeorm';

import {
  ApiErrorCode,
  type AdminProductDetailView,
  type AdminProductSummaryView,
  type PublicProductDetailView,
  type PublicProductSummaryView,
  type SaveProductRequest,
} from '@bake-mall/contracts';

import { HtmlSanitizerService } from '../content/html-sanitizer.service.js';
import { AuditLog } from '../database/entities/audit-log.entity.js';
import { Category } from '../database/entities/category.entity.js';
import { ProductImage } from '../database/entities/product-image.entity.js';
import { Product } from '../database/entities/product.entity.js';
import { Sku } from '../database/entities/sku.entity.js';
import { CreateCategoryDto, UpdateCategoryDto } from './dto/category.dto.js';
import { CreateProductDto, UpdateProductDto } from './dto/product.dto.js';
import { CreateSkuDto, UpdateSkuDto } from './dto/sku.dto.js';
import { PublicProductsQueryDto } from './dto/public-products-query.dto.js';
import { MediaAssetPolicyService } from './media-asset-policy.service.js';
import {
  toAdminProductDetailView,
  toAdminProductSummaryView,
  toPublicProductDetailView,
  toPublicProductSummaryView,
} from './product.mapper.js';

const hasNonEmptyId = <T extends { id?: unknown }>(
  value: T,
): value is T & { id: string } =>
  typeof value.id === 'string' && value.id.length > 0;

const hasSkuIdentity = (
  sku: SaveProductRequest['skus'][number],
): sku is Extract<SaveProductRequest['skus'][number], { id: string }> =>
  hasNonEmptyId(sku) && Number.isInteger(sku.stockVersion);

const hasInvalidSkuIdentity = (
  sku: SaveProductRequest['skus'][number],
): boolean => {
  const hasId = hasNonEmptyId(sku);
  const hasVersion = Number.isInteger(sku.stockVersion);
  return (
    hasId !== hasVersion ||
    (sku.id !== undefined && !hasId) ||
    (sku.stockVersion !== undefined && !hasVersion)
  );
};

@Injectable()
export class CatalogService {
  constructor(
    @InjectRepository(Category)
    private readonly categories: Repository<Category>,
    @InjectRepository(Product) private readonly products: Repository<Product>,
    @InjectRepository(Sku) private readonly skus: Repository<Sku>,
    @InjectRepository(ProductImage)
    private readonly images: Repository<ProductImage>,
    private readonly sanitizer: HtmlSanitizerService,
    private readonly mediaAssetPolicy: MediaAssetPolicyService,
    private readonly dataSource?: DataSource,
  ) {}

  listCategories(): Promise<Category[]> {
    return this.categories.find({
      order: { sortOrder: 'ASC', createdAt: 'DESC' },
    });
  }
  listPublicCategories(): Promise<Category[]> {
    return this.categories.find({
      where: { isActive: true },
      order: { sortOrder: 'ASC', createdAt: 'DESC' },
    });
  }
  createCategory(dto: CreateCategoryDto): Promise<Category> {
    return this.categories.save(
      this.categories.create({
        ...dto,
        imageUrl: dto.imageUrl ?? null,
        sortOrder: dto.sortOrder ?? 0,
        isActive: dto.isActive ?? true,
      }),
    );
  }

  async updateCategory(id: string, dto: UpdateCategoryDto): Promise<Category> {
    const category = await this.requireCategory(id);
    return this.categories.save(
      Object.assign(category, {
        ...dto,
        imageUrl: dto.imageUrl ?? category.imageUrl,
      }),
    );
  }
  async deleteCategory(id: string): Promise<void> {
    await this.categories.delete(id);
  }

  async listProducts(): Promise<AdminProductSummaryView[]> {
    const products = await this.products.find({
      relations: { category: true },
      order: { sortOrder: 'ASC', createdAt: 'DESC' },
    });
    return Promise.all(
      products.map(async (product) =>
        toAdminProductSummaryView(
          product,
          product.category,
          await this.skus.find({
            where: { productId: product.id },
            order: { createdAt: 'DESC' },
          }),
        ),
      ),
    );
  }
  async createProduct(dto: CreateProductDto): Promise<Product> {
    await this.requireCategory(dto.categoryId);
    return this.products.save(
      this.products.create({
        ...dto,
        summary: dto.summary ?? null,
        coverImageUrl: dto.coverImageUrl ?? null,
        detailHtml: this.sanitizer.sanitize(dto.detailHtml),
        sortOrder: dto.sortOrder ?? 0,
        isActive: dto.isActive ?? true,
      }),
    );
  }
  async updateProduct(id: string, dto: UpdateProductDto): Promise<Product> {
    const product = await this.requireProduct(id);
    if (dto.categoryId) await this.requireCategory(dto.categoryId);
    return this.products.save(
      Object.assign(product, {
        ...dto,
        summary: dto.summary === undefined ? product.summary : dto.summary,
        coverImageUrl:
          dto.coverImageUrl === undefined
            ? product.coverImageUrl
            : dto.coverImageUrl,
        detailHtml:
          dto.detailHtml === undefined
            ? product.detailHtml
            : this.sanitizer.sanitize(dto.detailHtml),
      }),
    );
  }
  async deleteProduct(id: string): Promise<void> {
    await this.products.delete(id);
  }

  async saveProductAggregate(
    id: string | null,
    dto: SaveProductRequest,
    adminUserId: string,
  ): Promise<AdminProductDetailView> {
    if (dto.skus.length === 0) {
      throw new BadRequestException('商品至少需要一个 SKU');
    }
    if (dto.isActive && !dto.skus.some((sku) => sku.isActive)) {
      throw new BadRequestException('上架商品至少需要一个启用 SKU');
    }
    const assets = [
      ...(dto.coverImage ? [dto.coverImage] : []),
      ...dto.images,
      ...dto.skus
        .map(({ image }) => image)
        .filter((image): image is NonNullable<typeof image> => image !== null),
    ];
    assets.forEach((asset) => this.mediaAssetPolicy.assertProductAsset(asset));
    if (!this.dataSource) {
      throw new Error('DataSource is required for aggregate product saves');
    }

    return this.dataSource.transaction(async (manager) => {
      const categoryRepository = manager.getRepository(Category);
      const productRepository = manager.getRepository(Product);
      const skuRepository = manager.getRepository(Sku);
      const imageRepository = manager.getRepository(ProductImage);
      const auditRepository = manager.getRepository(AuditLog);
      const [category, existing] = await Promise.all([
        categoryRepository.findOneBy({ id: dto.categoryId }),
        id ? productRepository.findOneBy({ id }) : Promise.resolve(null),
      ]);
      if (!category) throw new NotFoundException('Category not found');
      if (id && !existing) throw new NotFoundException('Product not found');

      const [existingSkus, existingImages] = id
        ? await Promise.all([
            skuRepository.find({ where: { productId: id } }),
            imageRepository.find({ where: { productId: id } }),
          ])
        : [[], []];
      const ownedSkuIds = new Set(
        existingSkus
          .filter(({ productId }) => productId === id)
          .map(({ id: skuId }) => skuId),
      );
      const ownedImageIds = new Set(
        existingImages
          .filter(({ productId }) => productId === id)
          .map(({ id: imageId }) => imageId),
      );
      const hasInvalidOwnership =
        dto.skus.some(
          (sku) =>
            hasInvalidSkuIdentity(sku) ||
            (hasNonEmptyId(sku) && !ownedSkuIds.has(sku.id)),
        ) ||
        dto.images.some(
          (image) =>
            (image.id !== undefined && !hasNonEmptyId(image)) ||
            (hasNonEmptyId(image) && !ownedImageIds.has(image.id)),
        ) ||
        dto.deletedSkuIds.some((skuId) => !ownedSkuIds.has(skuId));
      if (hasInvalidOwnership) {
        throw new UnprocessableEntityException({
          code: ApiErrorCode.PRODUCT_ASSET_OWNERSHIP_INVALID,
          message: 'SKU 或商品图片不属于当前商品',
        });
      }

      const product = productRepository.create({
        ...(existing ?? {}),
        ...(id ? { id } : {}),
        name: dto.name,
        summary: dto.summary ?? null,
        categoryId: dto.categoryId,
        coverImageUrl: dto.coverImage?.publicUrl ?? null,
        coverImageObjectKey: dto.coverImage?.objectKey ?? null,
        detailHtml: this.sanitizer.sanitize(dto.detailHtml),
        sortOrder: dto.sortOrder,
        isActive: dto.isActive,
      });
      const savedProduct = await productRepository.save(product);

      const submittedImageIds = new Set(
        dto.images.filter(hasNonEmptyId).map(({ id: imageId }) => imageId),
      );
      const removedImageIds = [...ownedImageIds].filter(
        (imageId) => !submittedImageIds.has(imageId),
      );
      if (removedImageIds.length) {
        await imageRepository.delete(
          removedImageIds.map((imageId) => ({
            id: imageId,
            productId: savedProduct.id,
          })),
        );
      }
      const savedImages = await imageRepository.save(
        dto.images.map((image) =>
          imageRepository.create({
            ...(hasNonEmptyId(image) ? { id: image.id } : {}),
            productId: savedProduct.id,
            url: image.publicUrl,
            objectKey: image.objectKey,
            sortOrder: image.sortOrder,
          }),
        ),
      );

      if (dto.deletedSkuIds.length) {
        await skuRepository.delete(
          dto.deletedSkuIds.map((skuId) => ({
            id: skuId,
            productId: savedProduct.id,
          })),
        );
      }
      const existingSkuInputs = dto.skus.filter(hasSkuIdentity);
      const updatedSkus = await Promise.all(
        existingSkuInputs.map(async (sku) => {
          const result = await skuRepository
            .createQueryBuilder()
            .update(Sku)
            .set({
              name: sku.name,
              attributes: { ...sku.attributes },
              priceCents: sku.priceCents,
              stock: sku.stock,
              imageUrl: sku.image?.publicUrl ?? null,
              imageObjectKey: sku.image?.objectKey ?? null,
              isActive: sku.isActive,
              // TypeORM renders this as stock_version = stock_version + 1.
              stockVersion: () => 'stock_version + 1',
            })
            .where(
              'id = :id AND product_id = :productId AND stock_version = :stockVersion',
              {
                id: sku.id,
                productId: savedProduct.id,
                stockVersion: sku.stockVersion,
              },
            )
            .execute();
          if (result.affected !== 1) {
            throw new ConflictException({
              code: ApiErrorCode.PRODUCT_STOCK_CONFLICT,
              message: '库存已发生变化，请重新加载后再保存',
              details: { skuId: sku.id },
            });
          }
          const previous = existingSkus.find(
            ({ id: skuId }) => skuId === sku.id,
          );
          return skuRepository.create({
            ...previous,
            productId: savedProduct.id,
            name: sku.name,
            attributes: { ...sku.attributes },
            priceCents: sku.priceCents,
            stock: sku.stock,
            imageUrl: sku.image?.publicUrl ?? null,
            imageObjectKey: sku.image?.objectKey ?? null,
            isActive: sku.isActive,
            stockVersion: sku.stockVersion + 1,
          });
        }),
      );
      const newSkus = dto.skus.filter((sku) => !hasSkuIdentity(sku));
      const insertedSkus = await skuRepository.save(
        newSkus.map((sku) =>
          skuRepository.create({
            productId: savedProduct.id,
            name: sku.name,
            attributes: { ...sku.attributes },
            priceCents: sku.priceCents,
            stock: sku.stock,
            imageUrl: sku.image?.publicUrl ?? null,
            imageObjectKey: sku.image?.objectKey ?? null,
            isActive: sku.isActive,
          }),
        ),
      );
      const savedSkus = [...updatedSkus, ...insertedSkus];

      await auditRepository.save(
        auditRepository.create({
          adminUserId,
          targetEntity: 'product',
          targetId: savedProduct.id,
          action: id ? 'PRODUCT_UPDATED' : 'PRODUCT_CREATED',
          changeSummary: {
            skuCount: savedSkus.length,
            imageCount: savedImages.length,
            isActive: savedProduct.isActive,
          },
        }),
      );

      return toAdminProductDetailView(
        {
          ...savedProduct,
          detailHtml: this.sanitizer.sanitize(savedProduct.detailHtml),
        },
        category,
        savedImages,
        savedSkus,
      );
    });
  }

  async getAdminProduct(id: string): Promise<AdminProductDetailView> {
    const product = await this.products.findOne({
      where: { id },
      relations: { category: true },
    });
    if (!product) throw new NotFoundException('Product not found');
    const [images, skus] = await Promise.all([
      this.images.find({
        where: { productId: id },
        order: { sortOrder: 'ASC', createdAt: 'DESC' },
      }),
      this.skus.find({
        where: { productId: id },
        order: { createdAt: 'DESC' },
      }),
    ]);
    return toAdminProductDetailView(
      { ...product, detailHtml: this.sanitizer.sanitize(product.detailHtml) },
      product.category,
      images,
      skus,
    );
  }

  async createSku(productId: string, dto: CreateSkuDto): Promise<Sku> {
    await this.validateSku(dto);
    await this.requireProduct(productId);
    return this.skus.save(
      this.skus.create({
        productId,
        name: dto.name,
        attributes: dto.attributes ?? {},
        priceCents: dto.priceCents,
        stock: dto.stock,
        imageUrl: dto.imageUrl ?? null,
        isActive: dto.isActive ?? true,
      }),
    );
  }
  listSkus(productId: string): Promise<Sku[]> {
    return this.skus.find({
      where: { productId },
      order: { createdAt: 'DESC' },
    });
  }
  async updateSku(
    productId: string,
    skuId: string,
    dto: UpdateSkuDto,
  ): Promise<Sku> {
    const sku = await this.skus.findOneBy({ id: skuId, productId });
    if (!sku) throw new NotFoundException('SKU not found');
    return this.skus.save(
      Object.assign(sku, {
        ...dto,
        attributes: dto.attributes ?? sku.attributes,
        imageUrl: dto.imageUrl === undefined ? sku.imageUrl : dto.imageUrl,
      }),
    );
  }
  async deleteSku(productId: string, skuId: string): Promise<void> {
    await this.skus.delete({ id: skuId, productId });
  }

  async listPublicProducts(
    query: PublicProductsQueryDto,
  ): Promise<PublicProductSummaryView[]> {
    const products = await this.products.find({
      relations: { category: true },
      order: { sortOrder: 'ASC', createdAt: 'DESC' },
    });
    const publicProducts = products.filter((product) => {
      const categoryIsActive = product.category?.isActive ?? false;
      const categoryMatches =
        !query.categoryId || product.categoryId === query.categoryId;
      const queryMatches = !query.q || product.name.includes(query.q);
      return (
        product.isActive && categoryIsActive && categoryMatches && queryMatches
      );
    });
    return Promise.all(
      publicProducts.map(async (product) =>
        toPublicProductSummaryView(
          product,
          product.category,
          await this.skus.find({
            where: { productId: product.id, isActive: true },
            order: { createdAt: 'DESC' },
          }),
        ),
      ),
    );
  }

  async getPublicProduct(id: string): Promise<PublicProductDetailView> {
    const product = await this.products.findOne({
      where: { id },
      relations: { category: true },
    });
    if (!product || !product.isActive || !product.category?.isActive) {
      throw new NotFoundException('Product not found');
    }
    const [skus, images] = await Promise.all([
      this.skus.find({
        where: { productId: id, isActive: true },
        order: { createdAt: 'DESC' },
      }),
      this.images.find({
        where: { productId: id },
        order: { sortOrder: 'ASC', createdAt: 'DESC' },
      }),
    ]);
    return toPublicProductDetailView(
      { ...product, detailHtml: this.sanitizer.sanitize(product.detailHtml) },
      product.category,
      images,
      skus,
    );
  }
  private async validateSku(dto: CreateSkuDto): Promise<void> {
    try {
      await validateOrReject(Object.assign(new CreateSkuDto(), dto));
    } catch {
      throw new BadRequestException('Invalid SKU');
    }
  }
  private async requireCategory(id: string): Promise<Category> {
    const category = await this.categories.findOneBy({ id });
    if (!category) throw new NotFoundException('Category not found');
    return category;
  }
  private async requireProduct(id: string): Promise<Product> {
    const product = await this.products.findOneBy({ id });
    if (!product) throw new NotFoundException('Product not found');
    return product;
  }
}
