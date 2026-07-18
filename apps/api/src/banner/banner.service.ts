import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  BannerTargetType,
  type AdminBannerView,
  type BannerView,
  type SaveBannerRequest,
} from '@bake-mall/contracts';
import { Repository } from 'typeorm';

import { AuditService } from '../audit/audit.service.js';
import { MediaAssetPolicyService } from '../catalog/media-asset-policy.service.js';
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
  ) {}

  async list(): Promise<AdminBannerView[]> {
    const banners = await this.banners.find({
      order: { sortOrder: 'ASC', createdAt: 'DESC' },
    });
    return banners.map((banner) => this.toAdminView(banner));
  }

  async create(
    request: SaveBannerRequest,
    adminUserId: string,
  ): Promise<AdminBannerView> {
    this.mediaPolicy.assertBannerAsset(request.image);
    const targetId = this.getNormalizedTargetId(request);
    await this.validateTarget(request.targetType, targetId);
    const banner = await this.banners.save(
      this.banners.create({
        imageUrl: request.image.publicUrl,
        imageObjectKey: request.image.objectKey,
        title: request.title ?? null,
        targetType: request.targetType,
        targetId,
        sortOrder: request.sortOrder,
        isActive: request.isActive,
      }),
    );
    await this.audit.record({
      adminUserId,
      targetEntity: 'banners',
      targetId: banner.id,
      action: 'BANNER_CREATED',
      changeSummary: this.toAuditSummary(banner),
    });
    return this.toAdminView(banner);
  }

  async update(
    id: string,
    request: SaveBannerRequest,
    adminUserId: string,
  ): Promise<AdminBannerView> {
    const banner = await this.requireBanner(id);
    this.mediaPolicy.assertBannerAsset(request.image);
    const targetId = this.getNormalizedTargetId(request);
    await this.validateTarget(request.targetType, targetId);
    const previous = this.toAuditSummary(banner);
    const saved = await this.banners.save({
      ...banner,
      imageUrl: request.image.publicUrl,
      imageObjectKey: request.image.objectKey,
      title: request.title ?? null,
      targetType: request.targetType,
      targetId,
      sortOrder: request.sortOrder,
      isActive: request.isActive,
    });
    await this.audit.record({
      adminUserId,
      targetEntity: 'banners',
      targetId: saved.id,
      action: 'BANNER_UPDATED',
      changeSummary: {
        before: previous,
        after: this.toAuditSummary(saved),
      },
    });
    return this.toAdminView(saved);
  }

  async remove(id: string, adminUserId: string): Promise<void> {
    const banner = await this.requireBanner(id);
    const result = await this.banners.delete(id);
    if (!result.affected) throw new NotFoundException('Banner not found');
    await this.audit.record({
      adminUserId,
      targetEntity: 'banners',
      targetId: id,
      action: 'BANNER_DELETED',
      changeSummary: this.toAuditSummary(banner),
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
  ): Promise<void> {
    if (targetType === BannerTargetType.NONE) return;
    if (!targetId) {
      throw new BadRequestException('Banner target ID is required');
    }
    const target =
      targetType === BannerTargetType.PRODUCT
        ? await this.products.findOneBy({ id: targetId })
        : await this.categories.findOneBy({ id: targetId });
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

  private async requireBanner(id: string): Promise<Banner> {
    const banner = await this.banners.findOneBy({ id });
    if (!banner) throw new NotFoundException('Banner not found');
    return banner;
  }
}
