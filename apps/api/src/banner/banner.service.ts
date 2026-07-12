import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { BannerTargetType, type BannerView } from '@bake-mall/contracts';
import { Repository } from 'typeorm';

import { Banner } from '../database/entities/banner.entity.js';
import { Category } from '../database/entities/category.entity.js';
import { Product } from '../database/entities/product.entity.js';
import { CreateBannerDto, UpdateBannerDto } from './dto.js';

@Injectable()
export class BannerService {
  constructor(
    @InjectRepository(Banner) private readonly banners: Repository<Banner>,
    @InjectRepository(Product) private readonly products: Repository<Product>,
    @InjectRepository(Category)
    private readonly categories: Repository<Category>,
  ) {}

  list(): Promise<Banner[]> {
    return this.banners.find({
      order: { sortOrder: 'ASC', createdAt: 'DESC' },
    });
  }

  async create(dto: CreateBannerDto): Promise<Banner> {
    await this.validateTarget(dto.targetType, dto.targetId ?? null);
    return this.banners.save(
      this.banners.create({
        imageUrl: dto.imageUrl,
        title: dto.title ?? null,
        targetType: dto.targetType,
        targetId: dto.targetId ?? null,
        sortOrder: dto.sortOrder ?? 0,
        isActive: dto.isActive ?? true,
      }),
    );
  }

  async update(id: string, dto: UpdateBannerDto): Promise<Banner> {
    const banner = await this.requireBanner(id);
    const targetType = dto.targetType ?? banner.targetType;
    const targetId =
      dto.targetId === undefined ? banner.targetId : (dto.targetId ?? null);
    await this.validateTarget(targetType, targetId);
    return this.banners.save(
      Object.assign(banner, {
        imageUrl: dto.imageUrl ?? banner.imageUrl,
        title: dto.title === undefined ? banner.title : (dto.title ?? null),
        targetType,
        targetId,
        sortOrder: dto.sortOrder ?? banner.sortOrder,
        isActive: dto.isActive ?? banner.isActive,
      }),
    );
  }

  async remove(id: string): Promise<void> {
    const result = await this.banners.delete(id);
    if (!result.affected) throw new NotFoundException('Banner not found');
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

  private async validateTarget(
    targetType: BannerTargetType,
    targetId: string | null,
  ): Promise<void> {
    if (targetType === BannerTargetType.NONE) {
      if (targetId !== null) {
        throw new BadRequestException('NONE banners must not have a target ID');
      }
      return;
    }
    if (!targetId)
      throw new BadRequestException('Banner target ID is required');
    const target =
      targetType === BannerTargetType.PRODUCT
        ? await this.products.findOneBy({ id: targetId })
        : await this.categories.findOneBy({ id: targetId });
    if (!target) throw new NotFoundException('Banner target not found');
  }

  private async isPublicTargetValid(banner: Banner): Promise<boolean> {
    if (banner.targetType === BannerTargetType.NONE)
      return banner.targetId === null;
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

  private async requireBanner(id: string): Promise<Banner> {
    const banner = await this.banners.findOneBy({ id });
    if (!banner) throw new NotFoundException('Banner not found');
    return banner;
  }
}
