import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { validateOrReject } from 'class-validator';
import { DataSource, Repository } from 'typeorm';

import type {
  AdminProductDetailView,
  SaveProductRequest,
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

  listProducts(): Promise<Product[]> {
    return this.products.find({
      relations: { category: true },
      order: { sortOrder: 'ASC', createdAt: 'DESC' },
    });
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
    if (dto.isActive && !dto.skus.some((sku) => sku.isActive)) {
      throw new BadRequestException('上架商品至少需要一个启用 SKU');
    }
    if (!this.dataSource) {
      throw new Error('DataSource is required for aggregate product saves');
    }

    return this.dataSource.transaction(async (manager) => {
      const categoryRepository = manager.getRepository(Category);
      const productRepository = manager.getRepository(Product);
      const skuRepository = manager.getRepository(Sku);
      const imageRepository = manager.getRepository(ProductImage);
      const auditRepository = manager.getRepository(AuditLog);
      const category = await categoryRepository.findOneBy({
        id: dto.categoryId,
      });
      if (!category) throw new NotFoundException('Category not found');

      const existing = id ? await productRepository.findOneBy({ id }) : null;
      if (id && !existing) throw new NotFoundException('Product not found');
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

      await imageRepository.delete({ productId: savedProduct.id });
      const savedImages = await imageRepository.save(
        dto.images.map((image) =>
          imageRepository.create({
            ...(image.id ? { id: image.id } : {}),
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
      const savedSkus = await skuRepository.save(
        dto.skus.map((sku) =>
          skuRepository.create({
            ...(sku.id ? { id: sku.id } : {}),
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

      return toAdminProductDetail(savedProduct, category, savedImages, savedSkus);
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
    return toAdminProductDetail(product, product.category, images, skus);
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

  async listPublicProducts(query: PublicProductsQueryDto): Promise<Product[]> {
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
    return this.attachPublicSkus(publicProducts);
  }

  async getPublicProduct(id: string): Promise<Product> {
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
    return Object.assign(product, { skus, images });
  }

  private async attachPublicSkus(products: Product[]): Promise<Product[]> {
    const withSkus = await Promise.all(
      products.map(async (product) =>
        Object.assign(product, {
          skus: await this.skus.find({
            where: { productId: product.id, isActive: true },
            order: { createdAt: 'DESC' },
          }),
        }),
      ),
    );
    return withSkus;
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

function toAdminProductDetail(
  product: Product,
  category: Category,
  images: ProductImage[],
  skus: Sku[],
): AdminProductDetailView {
  return {
    id: product.id,
    name: product.name,
    categoryId: product.categoryId,
    categoryName: category.name,
    ...(product.summary ? { summary: product.summary } : {}),
    detailHtml: product.detailHtml,
    coverImage:
      product.coverImageUrl && product.coverImageObjectKey
        ? {
            objectKey: product.coverImageObjectKey,
            publicUrl: product.coverImageUrl,
          }
        : null,
    images: images
      .filter((image) => Boolean(image.objectKey))
      .map((image) => ({
        id: image.id,
        objectKey: image.objectKey as string,
        publicUrl: image.url,
        sortOrder: image.sortOrder,
      })),
    skus: skus.map((sku) => ({
      id: sku.id,
      name: sku.name,
      attributes: { ...sku.attributes },
      priceCents: sku.priceCents,
      stock: sku.stock,
      isActive: sku.isActive,
      image:
        sku.imageUrl && sku.imageObjectKey
          ? { objectKey: sku.imageObjectKey, publicUrl: sku.imageUrl }
          : null,
    })),
    sortOrder: product.sortOrder,
    isActive: product.isActive,
    createdAt: product.createdAt.toISOString(),
    updatedAt: product.updatedAt.toISOString(),
  };
}
