import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { validateOrReject } from 'class-validator';
import { Repository } from 'typeorm';

import { HtmlSanitizerService } from '../content/html-sanitizer.service.js';
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
