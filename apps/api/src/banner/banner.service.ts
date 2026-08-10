import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import {
  BannerTargetType,
  BooleanFilter,
  type AdminBannerListQuery,
  type AdminBannerListResult,
  type AdminBannerView,
  type BannerView,
  type SaveBannerRequest,
} from '@bake-mall/contracts';
import { DataSource, EntityManager, Repository } from 'typeorm';

import { AuditService } from '../audit/audit.service.js';
import { MediaAssetPolicyService } from '../catalog/media-asset-policy.service.js';
import {
  escapeLike,
  toPaginatedView,
} from '../common/query/admin-query.helpers.js';
import { Banner } from '../database/entities/banner.entity.js';
import { Category } from '../database/entities/category.entity.js';
import { Product } from '../database/entities/product.entity.js';

@Injectable()
export class BannerService {
  constructor(
    @InjectRepository(Banner) private readonly banners: Repository<Banner>,
    @InjectRepository(Product) private readonly products: Repository<Product>,
    @InjectRepository(Category)
    private readonly categories: Repository<Category>,
    private readonly mediaPolicy: MediaAssetPolicyService,
    private readonly audit: AuditService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  async list(query: AdminBannerListQuery): Promise<AdminBannerListResult> {
    const builder = this.banners.createQueryBuilder('banner');
    if (query.q?.trim()) {
      builder.andWhere("banner.title LIKE :q ESCAPE '\\\\'", {
        q: `%${escapeLike(query.q.trim())}%`,
      });
    }
    if (query.isActive) {
      builder.andWhere('banner.isActive = :isActive', {
        isActive: query.isActive === BooleanFilter.YES,
      });
    }
    if (query.targetType) {
      builder.andWhere('banner.targetType = :targetType', {
        targetType: query.targetType,
      });
    }
    if (query.targetId?.trim()) {
      builder.andWhere('banner.targetId = :targetId', {
        targetId: query.targetId.trim(),
      });
    }
    if (query.targetValid) {
      const targetIsValid = `(
        (banner.target_type = '${BannerTargetType.NONE}' AND banner.target_id IS NULL)
        OR (banner.target_type = '${BannerTargetType.CATEGORY}' AND EXISTS (
          SELECT 1 FROM categories category_target
          WHERE category_target.id = banner.target_id
            AND category_target.is_active = TRUE
        ))
        OR (banner.target_type = '${BannerTargetType.PRODUCT}' AND EXISTS (
          SELECT 1 FROM products product_target
          INNER JOIN categories product_category
            ON product_category.id = product_target.category_id
          WHERE product_target.id = banner.target_id
            AND product_target.is_active = TRUE
            AND product_category.is_active = TRUE
        ))
      )`;
      builder.andWhere(
        query.targetValid === BooleanFilter.YES
          ? targetIsValid
          : `NOT ${targetIsValid}`,
      );
    }
    if (query.createdAtFrom) {
      builder.andWhere('banner.createdAt >= :createdAtFrom', {
        createdAtFrom: new Date(query.createdAtFrom),
      });
    }
    if (query.createdAtBefore) {
      builder.andWhere('banner.createdAt < :createdAtBefore', {
        createdAtBefore: new Date(query.createdAtBefore),
      });
    }
    const [banners, total] = await builder
      .orderBy('banner.sortOrder', 'ASC')
      .addOrderBy('banner.createdAt', 'DESC')
      .addOrderBy('banner.id', 'DESC')
      .skip((query.page - 1) * query.pageSize)
      .take(query.pageSize)
      .getManyAndCount();
    return toPaginatedView(
      banners.map((banner) => this.toAdminView(banner)),
      total,
      query.page,
      query.pageSize,
    );
  }

  async create(
    request: SaveBannerRequest,
    adminUserId: string,
  ): Promise<AdminBannerView> {
    this.mediaPolicy.assertBannerAsset(request.image);
    const targetId = this.getNormalizedTargetId(request);
    return this.dataSource.transaction(async (manager) => {
      const banners = manager.getRepository(Banner);
      await this.validateTarget(request.targetType, targetId, manager);
      const banner = await banners.save(
        banners.create({
          imageUrl: request.image.publicUrl,
          imageObjectKey: request.image.objectKey,
          title: request.title ?? null,
          targetType: request.targetType,
          targetId,
          sortOrder: request.sortOrder,
          isActive: request.isActive,
        }),
      );
      await this.audit.record(
        {
          actor: { type: 'ADMIN', adminUserId },
          targetEntity: 'banners',
          targetId: banner.id,
          action: 'BANNER_CREATED',
          changeSummary: this.toAuditSummary(banner),
        },
        manager,
      );
      return this.toAdminView(banner);
    });
  }

  async update(
    id: string,
    request: SaveBannerRequest,
    adminUserId: string,
  ): Promise<AdminBannerView> {
    this.mediaPolicy.assertBannerAsset(request.image);
    const targetId = this.getNormalizedTargetId(request);
    return this.dataSource.transaction(async (manager) => {
      const banners = manager.getRepository(Banner);
      const banner = await this.requireBanner(id, banners);
      await this.validateTarget(request.targetType, targetId, manager);
      const previous = this.toAuditSummary(banner);
      const saved = await banners.save({
        ...banner,
        imageUrl: request.image.publicUrl,
        imageObjectKey: request.image.objectKey,
        title: request.title ?? null,
        targetType: request.targetType,
        targetId,
        sortOrder: request.sortOrder,
        isActive: request.isActive,
      });
      await this.audit.record(
        {
          actor: { type: 'ADMIN', adminUserId },
          targetEntity: 'banners',
          targetId: saved.id,
          action: 'BANNER_UPDATED',
          changeSummary: {
            before: previous,
            after: this.toAuditSummary(saved),
          },
        },
        manager,
      );
      return this.toAdminView(saved);
    });
  }

  async remove(id: string, adminUserId: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const banners = manager.getRepository(Banner);
      const banner = await this.requireBanner(id, banners);
      const result = await banners.delete(id);
      if (!result.affected) throw new NotFoundException('Banner not found');
      await this.audit.record(
        {
          actor: { type: 'ADMIN', adminUserId },
          targetEntity: 'banners',
          targetId: id,
          action: 'BANNER_DELETED',
          changeSummary: this.toAuditSummary(banner),
        },
        manager,
      );
    });
  }

  async listPublic(): Promise<BannerView[]> {
    const banners = await this.banners.find({
      where: { isActive: true },
      order: { sortOrder: 'ASC', createdAt: 'DESC' },
    });
    const visible = await Promise.all(
      banners.map(async (banner) =>
        (await this.isPublicTargetValid(banner)) ? this.toView(banner) : null,
      ),
    );
    return visible.filter((banner): banner is BannerView => banner !== null);
  }

  private getNormalizedTargetId(request: SaveBannerRequest): string | null {
    return request.targetType === BannerTargetType.NONE
      ? null
      : request.targetId;
  }

  private async validateTarget(
    targetType: BannerTargetType,
    targetId: string | null,
    manager?: EntityManager,
  ): Promise<void> {
    if (targetType === BannerTargetType.NONE) return;
    if (!targetId) {
      throw new BadRequestException('Banner target ID is required');
    }
    const products = manager?.getRepository(Product) ?? this.products;
    const categories = manager?.getRepository(Category) ?? this.categories;
    const target =
      targetType === BannerTargetType.PRODUCT
        ? await products.findOneBy({ id: targetId })
        : await categories.findOneBy({ id: targetId });
    if (!target) throw new NotFoundException('Banner target not found');
  }

  private async isPublicTargetValid(banner: Banner): Promise<boolean> {
    if (banner.targetType === BannerTargetType.NONE) {
      return banner.targetId === null;
    }
    if (!banner.targetId) return false;
    if (banner.targetType === BannerTargetType.CATEGORY) {
      return Boolean(
        await this.categories.findOneBy({
          id: banner.targetId,
          isActive: true,
        }),
      );
    }
    const product = await this.products.findOneBy({ id: banner.targetId });
    if (!product?.isActive) return false;
    return Boolean(
      await this.categories.findOneBy({
        id: product.categoryId,
        isActive: true,
      }),
    );
  }

  private toAdminView(banner: Banner): AdminBannerView {
    const base = {
      id: banner.id,
      image: banner.imageObjectKey
        ? {
            objectKey: banner.imageObjectKey,
            publicUrl: banner.imageUrl,
          }
        : null,
      ...(banner.title ? { title: banner.title } : {}),
      sortOrder: banner.sortOrder,
      isActive: banner.isActive,
      createdAt: banner.createdAt.toISOString(),
      updatedAt: banner.updatedAt.toISOString(),
    };
    if (banner.targetType === BannerTargetType.NONE) {
      return { ...base, targetType: BannerTargetType.NONE };
    }
    if (banner.targetType === BannerTargetType.PRODUCT) {
      return {
        ...base,
        targetType: BannerTargetType.PRODUCT,
        targetId: banner.targetId as string,
      };
    }
    return {
      ...base,
      targetType: BannerTargetType.CATEGORY,
      targetId: banner.targetId as string,
    };
  }

  private toView(banner: Banner): BannerView {
    const base = {
      id: banner.id,
      imageUrl: banner.imageUrl,
      ...(banner.title ? { title: banner.title } : {}),
    };
    if (banner.targetType === BannerTargetType.NONE) {
      return { ...base, targetType: BannerTargetType.NONE };
    }
    if (banner.targetType === BannerTargetType.PRODUCT) {
      return {
        ...base,
        targetType: BannerTargetType.PRODUCT,
        targetId: banner.targetId as string,
      };
    }
    return {
      ...base,
      targetType: BannerTargetType.CATEGORY,
      targetId: banner.targetId as string,
    };
  }

  private toAuditSummary(banner: Banner): Record<string, unknown> {
    return {
      imageObjectKey: banner.imageObjectKey,
      title: banner.title,
      targetType: banner.targetType,
      targetId: banner.targetId,
      sortOrder: banner.sortOrder,
      isActive: banner.isActive,
    };
  }

  private async requireBanner(
    id: string,
    banners: Repository<Banner> = this.banners,
  ): Promise<Banner> {
    const banner = await banners.findOneBy({ id });
    if (!banner) throw new NotFoundException('Banner not found');
    return banner;
  }
}
