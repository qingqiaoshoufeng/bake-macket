import { createHash } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import {
  ApiErrorCode,
  HomepageLinkType,
  HomepageSectionType,
  type AdminHomepageView,
  type HomepageDraftConfig,
  type HomepageLink,
  type HomepagePublishedConfig,
  type HomepageValidationIssue,
  type MediaAsset,
  type PublishHomepageRequest,
  type PublicHomepageConfig,
  type PublicHomepageView,
  type SaveHomepageDraftRequest,
} from '@bake-mall/contracts';
import { DataSource, EntityManager, In, Repository } from 'typeorm';

import { AuditService } from '../audit/audit.service.js';
import { MediaAssetPolicyService } from '../catalog/media-asset-policy.service.js';
import { Category } from '../database/entities/category.entity.js';
import { HomepageDraft } from '../database/entities/homepage-draft.entity.js';
import { HomepagePage } from '../database/entities/homepage-page.entity.js';
import { Product } from '../database/entities/product.entity.js';

const PAGE_KEY = 'HOME' as const;
const GRID_LAYOUTS = new Set([3, 4, 5, 6, 9]);
const AUTOPLAY_OPTIONS = new Set([0, 3000, 5000, 8000]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isNonEmptyText = (value: string): boolean => value.trim().length > 0;

const isMediaAsset = (value: unknown): value is MediaAsset =>
  isRecord(value) &&
  typeof value.objectKey === 'string' &&
  typeof value.publicUrl === 'string';

const hasOnlyKeys = (
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean =>
  Object.keys(value).length === keys.length &&
  Object.keys(value).every((key) => keys.includes(key));

const isHomepageLink = (value: unknown): value is HomepageLink => {
  if (!isRecord(value) || typeof value.type !== 'string') return false;
  if (value.type === HomepageLinkType.NONE) {
    return hasOnlyKeys(value, ['type']);
  }
  if (
    value.type === HomepageLinkType.PRODUCT ||
    value.type === HomepageLinkType.CATEGORY
  ) {
    return (
      hasOnlyKeys(value, ['type', 'targetId']) &&
      typeof value.targetId === 'string' &&
      isNonEmptyText(value.targetId)
    );
  }
  return (
    value.type === HomepageLinkType.PAGE &&
    hasOnlyKeys(value, ['type', 'page']) &&
    typeof value.page === 'string' &&
    ['PRODUCTS', 'CART', 'ORDERS', 'PROFILE', 'MEMBERSHIP_CARDS'].includes(
      value.page,
    )
  );
};

function assertDraftStructure(value: unknown): asserts value is HomepageDraftConfig {
  if (!isRecord(value) || value.schemaVersion !== 1) {
    throw new BadRequestException('首页草稿版本或根结构无效');
  }
  const { hero, customerService, shortcutGrid, imageBlocks } = value;
  if (
    !isRecord(hero) ||
    hero.type !== HomepageSectionType.HERO_CAROUSEL ||
    typeof hero.id !== 'string' ||
    typeof hero.enabled !== 'boolean' ||
    typeof hero.autoplayMs !== 'number' ||
    !AUTOPLAY_OPTIONS.has(hero.autoplayMs) ||
    !Array.isArray(hero.slides) ||
    hero.slides.length > 10
  ) {
    throw new BadRequestException('首页轮播配置结构无效');
  }
  const slidesValid = hero.slides.every(
    (slide) =>
      isRecord(slide) &&
      typeof slide.id === 'string' &&
      (slide.image === null || isMediaAsset(slide.image)) &&
      typeof slide.title === 'string' &&
      typeof slide.subtitle === 'string' &&
      typeof slide.altText === 'string' &&
      isHomepageLink(slide.link),
  );
  if (!slidesValid) throw new BadRequestException('首页轮播项结构无效');

  if (
    !isRecord(customerService) ||
    customerService.type !== HomepageSectionType.CUSTOMER_SERVICE ||
    typeof customerService.id !== 'string' ||
    typeof customerService.enabled !== 'boolean' ||
    typeof customerService.title !== 'string' ||
    typeof customerService.description !== 'string' ||
    typeof customerService.phone !== 'string' ||
    typeof customerService.serviceHours !== 'string' ||
    (customerService.wechatQrCode !== null &&
      !isMediaAsset(customerService.wechatQrCode))
  ) {
    throw new BadRequestException('首页客服配置结构无效');
  }

  if (
    !isRecord(shortcutGrid) ||
    shortcutGrid.type !== HomepageSectionType.SHORTCUT_GRID ||
    typeof shortcutGrid.id !== 'string' ||
    typeof shortcutGrid.enabled !== 'boolean' ||
    typeof shortcutGrid.title !== 'string' ||
    typeof shortcutGrid.layout !== 'number' ||
    !GRID_LAYOUTS.has(shortcutGrid.layout) ||
    !Array.isArray(shortcutGrid.items) ||
    shortcutGrid.items.length > 9
  ) {
    throw new BadRequestException('首页宫格配置结构无效');
  }
  const shortcutItemsValid = shortcutGrid.items.every(
    (item) =>
      isRecord(item) &&
      typeof item.id === 'string' &&
      typeof item.label === 'string' &&
      (item.image === null || isMediaAsset(item.image)) &&
      isHomepageLink(item.link),
  );
  if (!shortcutItemsValid) throw new BadRequestException('首页宫格项结构无效');

  if (!Array.isArray(imageBlocks) || imageBlocks.length > 12) {
    throw new BadRequestException('首页配图区结构无效');
  }
  const imageBlocksValid = imageBlocks.every(
    (block) =>
      isRecord(block) &&
      block.type === HomepageSectionType.IMAGE_BLOCK &&
      typeof block.id === 'string' &&
      typeof block.enabled === 'boolean' &&
      (block.image === null || isMediaAsset(block.image)) &&
      typeof block.title === 'string' &&
      typeof block.description === 'string' &&
      typeof block.altText === 'string' &&
      isHomepageLink(block.link),
  );
  if (!imageBlocksValid) throw new BadRequestException('首页配图结构无效');

  const ids = [
    hero.id,
    customerService.id,
    shortcutGrid.id,
    ...hero.slides.map(({ id }) => id),
    ...shortcutGrid.items.map(({ id }) => id),
    ...imageBlocks.map(({ id }) => id),
  ];
  if (ids.some((id) => !isNonEmptyText(id)) || new Set(ids).size !== ids.length) {
    throw new BadRequestException('首页配置 ID 不能为空或重复');
  }
}

const issue = (
  code: string,
  message: string,
  sectionId: string,
  field?: string,
  itemId?: string,
): HomepageValidationIssue => ({
  code,
  message,
  sectionId,
  ...(field ? { field } : {}),
  ...(itemId ? { itemId } : {}),
});

const collectDraftIssues = (
  config: HomepageDraftConfig,
): HomepageValidationIssue[] => [
  ...(config.hero.slides.length === 0
    ? [issue('HERO_EMPTY', '请至少配置一张首屏轮播图', config.hero.id, 'slides')]
    : []),
  ...config.hero.slides.flatMap((slide) =>
    slide.image
      ? []
      : [issue('HERO_IMAGE_REQUIRED', '请上传轮播图片', config.hero.id, 'image', slide.id)],
  ),
  ...(!config.customerService.wechatQrCode
    ? [
        issue(
          'CUSTOMER_QR_REQUIRED',
          '请上传客服微信二维码',
          config.customerService.id,
          'wechatQrCode',
        ),
      ]
    : []),
  ...(!isNonEmptyText(config.customerService.phone)
    ? [issue('CUSTOMER_PHONE_REQUIRED', '请填写客服电话', config.customerService.id, 'phone')]
    : []),
  ...(!isNonEmptyText(config.customerService.serviceHours)
    ? [
        issue(
          'CUSTOMER_HOURS_REQUIRED',
          '请填写客服服务时间',
          config.customerService.id,
          'serviceHours',
        ),
      ]
    : []),
  ...(config.shortcutGrid.items.length !== config.shortcutGrid.layout
    ? [
        issue(
          'SHORTCUT_COUNT_MISMATCH',
          `当前布局需要 ${config.shortcutGrid.layout} 个宫格入口`,
          config.shortcutGrid.id,
          'items',
        ),
      ]
    : []),
  ...config.shortcutGrid.items.flatMap((item) => [
    ...(!isNonEmptyText(item.label)
      ? [issue('SHORTCUT_LABEL_REQUIRED', '请填写宫格名称', config.shortcutGrid.id, 'label', item.id)]
      : []),
    ...(!item.image
      ? [issue('SHORTCUT_IMAGE_REQUIRED', '请上传宫格图片', config.shortcutGrid.id, 'image', item.id)]
      : []),
  ]),
  ...config.imageBlocks.flatMap((block) =>
    block.image
      ? []
      : [issue('IMAGE_BLOCK_REQUIRED', '请上传配图区图片', block.id, 'image')],
  ),
];

const collectAssets = (config: HomepageDraftConfig): MediaAsset[] => [
  ...config.hero.slides.flatMap(({ image }) => (image ? [image] : [])),
  ...(config.customerService.wechatQrCode
    ? [config.customerService.wechatQrCode]
    : []),
  ...config.shortcutGrid.items.flatMap(({ image }) => (image ? [image] : [])),
  ...config.imageBlocks.flatMap(({ image }) => (image ? [image] : [])),
];

type LocatedHomepageLink = {
  readonly link: HomepageLink;
  readonly sectionId: string;
  readonly itemId: string;
  readonly field: 'link';
};

const collectLocatedLinks = (
  config: HomepageDraftConfig,
): LocatedHomepageLink[] => [
  ...config.hero.slides.map(({ id, link }) => ({
    link,
    sectionId: config.hero.id,
    itemId: id,
    field: 'link' as const,
  })),
  ...config.shortcutGrid.items.map(({ id, link }) => ({
    link,
    sectionId: config.shortcutGrid.id,
    itemId: id,
    field: 'link' as const,
  })),
  ...config.imageBlocks.map(({ id, link }) => ({
    link,
    sectionId: id,
    itemId: id,
    field: 'link' as const,
  })),
];

const collectLinks = (config: HomepageDraftConfig): HomepageLink[] =>
  collectLocatedLinks(config).map(({ link }) => link);

const collectChangedSectionIds = (
  before: HomepageDraftConfig | null,
  after: HomepageDraftConfig,
): string[] => {
  if (!before) {
    return [
      after.hero.id,
      after.customerService.id,
      after.shortcutGrid.id,
      ...after.imageBlocks.map(({ id }) => id),
    ];
  }
  return [
    [before.hero, after.hero],
    [before.customerService, after.customerService],
    [before.shortcutGrid, after.shortcutGrid],
  ]
    .filter(([previous, next]) => JSON.stringify(previous) !== JSON.stringify(next))
    .map(([, next]) => next.id)
    .concat(
      JSON.stringify(before.imageBlocks) === JSON.stringify(after.imageBlocks)
        ? []
        : after.imageBlocks.map(({ id }) => id),
    );
};

const toIso = (date: Date | null): string | undefined => date?.toISOString();

const toPublishedConfig = (
  config: HomepageDraftConfig,
): HomepagePublishedConfig => structuredClone(config) as HomepagePublishedConfig;

const toPublicConfig = (
  config: HomepagePublishedConfig,
  validProductIds: ReadonlySet<string>,
  validCategoryIds: ReadonlySet<string>,
): PublicHomepageConfig => {
  const publicLink = (link: HomepageLink): HomepageLink => {
    if (
      link.type === HomepageLinkType.PRODUCT &&
      !validProductIds.has(link.targetId)
    ) {
      return { type: HomepageLinkType.NONE };
    }
    if (
      link.type === HomepageLinkType.CATEGORY &&
      !validCategoryIds.has(link.targetId)
    ) {
      return { type: HomepageLinkType.NONE };
    }
    return link;
  };
  const image = (asset: MediaAsset) => ({ imageUrl: asset.publicUrl });
  return {
    schemaVersion: 1,
    hero: {
      ...config.hero,
      slides: config.hero.slides.map((slide) => ({
        ...slide,
        image: image(slide.image),
        link: publicLink(slide.link),
      })),
    },
    customerService: {
      ...config.customerService,
      wechatQrCode: image(config.customerService.wechatQrCode),
    },
    shortcutGrid: {
      ...config.shortcutGrid,
      items: config.shortcutGrid.items.map((item) => ({
        ...item,
        image: image(item.image),
        link: publicLink(item.link),
      })),
    },
    imageBlocks: config.imageBlocks.map((block) => ({
      ...block,
      image: image(block.image),
      link: publicLink(block.link),
    })),
  };
};

@Injectable()
export class HomepageService {
  constructor(
    @InjectRepository(HomepagePage)
    private readonly pages: Repository<HomepagePage>,
    @InjectRepository(HomepageDraft)
    private readonly drafts: Repository<HomepageDraft>,
    @InjectRepository(Product)
    private readonly products: Repository<Product>,
    @InjectRepository(Category)
    private readonly categories: Repository<Category>,
    private readonly mediaPolicy: MediaAssetPolicyService,
    private readonly audit: AuditService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  async getAdminView(): Promise<AdminHomepageView> {
    const page = await this.requirePage(this.pages);
    const draft = await this.requireLegacyDraft(page.id, this.drafts);
    return this.toAdminView(
      page,
      draft,
      await this.collectPublishIssues(draft.draftConfig, this.dataSource.manager),
    );
  }

  async saveDraft(
    request: SaveHomepageDraftRequest,
    adminUserId: string,
  ): Promise<AdminHomepageView> {
    assertDraftStructure(request.config);
    collectAssets(request.config).forEach((asset) =>
      this.mediaPolicy.assertHomepageAsset(asset),
    );
    return this.dataSource.transaction(async (manager) => {
      const pages = manager.getRepository(HomepagePage);
      const drafts = manager.getRepository(HomepageDraft);
      const page = await this.requirePage(pages);
      const draft = await this.requireLegacyDraft(page.id, drafts);
      const previousConfig = structuredClone(draft.draftConfig);
      const nextVersion = request.version + 1;
      const result = await drafts
        .createQueryBuilder()
        .update(HomepageDraft)
        .set({
          draftConfig: structuredClone(request.config),
          version: nextVersion,
          updatedByAdminId: adminUserId,
          updatedAt: new Date(),
        })
        .where('id = :id AND version = :version', {
          id: draft.id,
          version: request.version,
        })
        .execute();
      if (result.affected !== 1) {
        const current = await this.requireLegacyDraft(page.id, drafts);
        this.throwVersionConflict(current.version);
      }
      const saved = await this.requireLegacyDraft(page.id, drafts);
      await this.audit.record(
        {
          adminUserId,
          targetEntity: 'homepage_drafts',
          targetId: saved.id,
          action: 'HOMEPAGE_DRAFT_SAVED',
          changeSummary: this.auditSummary(
            saved.draftConfig,
            request.version,
            nextVersion,
            collectChangedSectionIds(previousConfig, saved.draftConfig),
          ),
        },
        manager,
      );
      return this.toAdminView(
        page,
        saved,
        await this.collectPublishIssues(saved.draftConfig, manager),
      );
    });
  }

  async publish(
    request: PublishHomepageRequest,
    adminUserId: string,
  ): Promise<AdminHomepageView> {
    return this.dataSource.transaction(async (manager) => {
      const pages = manager.getRepository(HomepagePage);
      const drafts = manager.getRepository(HomepageDraft);
      const page = await this.requirePage(pages, manager);
      const draft = await this.requireLegacyDraft(page.id, drafts, manager);
      if (draft.version !== request.version) this.throwVersionConflict(draft.version);
      const issues = await this.collectPublishIssues(draft.draftConfig, manager);
      if (issues.length > 0) {
        throw new UnprocessableEntityException({
          code: ApiErrorCode.HOMEPAGE_PUBLISH_INVALID,
          message: '首页草稿尚未满足发布条件',
          details: { issues },
        });
      }
      collectAssets(draft.draftConfig).forEach((asset) =>
        this.mediaPolicy.assertHomepageAsset(asset),
      );
      const previousPublishedConfig = page.publishedConfig
        ? structuredClone(page.publishedConfig)
        : null;
      const previousPublishedVersion = page.publishedDraftVersion ?? 0;
      page.publishedConfig = toPublishedConfig(draft.draftConfig);
      const nextPublishedVersion = (page.publishedVersion ?? 0) + 1;
      page.publishedVersion = nextPublishedVersion;
      page.publishedDraftId = draft.id;
      page.publishedDraftVersion = draft.version;
      page.publishedByAdminId = adminUserId;
      page.publishedAt = new Date();
      const saved = await pages.save(page);
      await this.audit.record(
        {
          adminUserId,
          targetEntity: 'homepage_pages',
          targetId: saved.id,
          action: 'HOMEPAGE_PUBLISHED',
          changeSummary: this.auditSummary(
            draft.draftConfig,
            previousPublishedVersion,
            draft.version,
            collectChangedSectionIds(previousPublishedConfig, draft.draftConfig),
          ),
        },
        manager,
      );
      return this.toAdminView(saved, draft, []);
    });
  }

  async getPublicView(): Promise<PublicHomepageView | null> {
    const page = await this.requirePage(this.pages);
    if (!page.publishedConfig || !page.publishedVersion || !page.publishedAt) {
      return null;
    }
    const links = collectLinks(page.publishedConfig);
    const productIds = links.flatMap((link) =>
      link.type === HomepageLinkType.PRODUCT ? [link.targetId] : [],
    );
    const categoryIds = links.flatMap((link) =>
      link.type === HomepageLinkType.CATEGORY ? [link.targetId] : [],
    );
    const [products, categories] = await Promise.all([
      productIds.length
        ? this.products
            .createQueryBuilder('product')
            .innerJoin('product.category', 'category')
            .where('product.id IN (:...productIds)', { productIds })
            .andWhere('product.isActive = TRUE')
            .andWhere('category.isActive = TRUE')
            .getMany()
        : [],
      categoryIds.length
        ? this.categories
            .createQueryBuilder('category')
            .where('category.id IN (:...categoryIds)', { categoryIds })
            .andWhere('category.isActive = TRUE')
            .getMany()
        : [],
    ]);
    return {
      config: toPublicConfig(
        page.publishedConfig,
        new Set(products.map(({ id }) => id)),
        new Set(categories.map(({ id }) => id)),
      ),
      publishedVersion: page.publishedVersion,
      publishedAt: page.publishedAt.toISOString(),
    };
  }

  private async collectPublishIssues(
    config: HomepageDraftConfig,
    manager: EntityManager,
  ): Promise<HomepageValidationIssue[]> {
    const targetIssues = await this.collectTargetIssues(config, manager);
    return [...collectDraftIssues(config), ...targetIssues];
  }

  private async collectTargetIssues(
    config: HomepageDraftConfig,
    manager: EntityManager,
  ): Promise<HomepageValidationIssue[]> {
    const locatedLinks = collectLocatedLinks(config);
    const productIds = locatedLinks.flatMap(({ link }) =>
      link.type === HomepageLinkType.PRODUCT ? [link.targetId] : [],
    );
    const categoryIds = locatedLinks.flatMap(({ link }) =>
      link.type === HomepageLinkType.CATEGORY ? [link.targetId] : [],
    );
    const [validProducts, validCategories] = await Promise.all([
      productIds.length
        ? manager
            .getRepository(Product)
            .createQueryBuilder('product')
            .innerJoin('product.category', 'category')
            .where('product.id IN (:...productIds)', { productIds })
            .andWhere('product.isActive = TRUE')
            .andWhere('category.isActive = TRUE')
            .getMany()
        : [],
      categoryIds.length
        ? manager.getRepository(Category).findBy({
            id: In(categoryIds),
            isActive: true,
          })
        : [],
    ]);
    const validProductIds = new Set(validProducts.map(({ id }) => id));
    const validCategoryIds = new Set(validCategories.map(({ id }) => id));
    const invalidLinks = locatedLinks.filter(
      ({ link }) =>
        (link.type === HomepageLinkType.PRODUCT &&
          !validProductIds.has(link.targetId)) ||
        (link.type === HomepageLinkType.CATEGORY &&
          !validCategoryIds.has(link.targetId)),
    );
    return invalidLinks.map(({ link, sectionId, itemId, field }) =>
      issue(
        'HOMEPAGE_TARGET_INVALID',
        `跳转目标 ${link.type === HomepageLinkType.PRODUCT ? '商品' : '分类'} 已失效或未启用`,
        sectionId,
        field,
        itemId,
      ),
    );
  }

  private async requirePage(
    repository: Repository<HomepagePage>,
    manager?: EntityManager,
  ): Promise<HomepagePage> {
    const builder = repository
      .createQueryBuilder('page')
      .where('page.pageKey = :pageKey', { pageKey: PAGE_KEY });
    if (manager) builder.setLock('pessimistic_write');
    const page = await builder.getOne();
    if (!page) throw new NotFoundException('首页配置尚未初始化');
    return page;
  }

  private async requireLegacyDraft(
    homepagePageId: string,
    repository: Repository<HomepageDraft>,
    manager?: EntityManager,
  ): Promise<HomepageDraft> {
    if (!manager) {
      const drafts = await repository.find({
        where: { homepagePageId },
        order: { id: 'ASC' },
      });
      const draft = drafts.find(({ name }) => name === '当前首页') ?? drafts[0];
      if (!draft) throw new NotFoundException('首页草稿尚未初始化');
      return draft;
    }
    const currentDraft = await repository
      .createQueryBuilder('draft')
      .where('draft.homepagePageId = :homepagePageId', { homepagePageId })
      .andWhere('draft.name = :name', { name: '当前首页' })
      .setLock('pessimistic_write')
      .getOne();
    if (currentDraft) return currentDraft;
    const firstDraft = await repository
      .createQueryBuilder('draft')
      .where('draft.homepagePageId = :homepagePageId', { homepagePageId })
      .orderBy('draft.id', 'ASC')
      .setLock('pessimistic_write')
      .getOne();
    if (!firstDraft) throw new NotFoundException('首页草稿尚未初始化');
    return firstDraft;
  }

  private toAdminView(
    page: HomepagePage,
    draft: HomepageDraft,
    draftIssues: readonly HomepageValidationIssue[],
  ): AdminHomepageView {
    return {
      id: page.id,
      pageKey: PAGE_KEY,
      draftConfig: structuredClone(draft.draftConfig),
      publishedConfig: page.publishedConfig
        ? structuredClone(page.publishedConfig)
        : null,
      version: draft.version,
      ...(draft.updatedByAdminId
        ? { draftUpdatedByAdminId: draft.updatedByAdminId }
        : {}),
      ...(toIso(draft.updatedAt) ? { draftUpdatedAt: toIso(draft.updatedAt) } : {}),
      ...(page.publishedVersion
        ? { publishedVersion: page.publishedVersion }
        : {}),
      ...(page.publishedByAdminId
        ? { publishedByAdminId: page.publishedByAdminId }
        : {}),
      ...(toIso(page.publishedAt)
        ? { publishedAt: toIso(page.publishedAt) }
        : {}),
      draftIssues,
    };
  }

  private throwVersionConflict(currentVersion: number): never {
    throw new ConflictException({
      code: ApiErrorCode.HOMEPAGE_VERSION_CONFLICT,
      message: '首页配置已被其他操作更新，请重新加载后再保存',
      details: { currentVersion },
    });
  }

  private auditSummary(
    config: HomepageDraftConfig,
    previousVersion: number,
    nextVersion: number,
    changedSectionIds: readonly string[],
  ): Record<string, unknown> {
    return {
      previousVersion,
      nextVersion,
      configHash: createHash('sha256')
        .update(JSON.stringify(config))
        .digest('hex'),
      heroSlideCount: config.hero.slides.length,
      shortcutCount: config.shortcutGrid.items.length,
      imageBlockCount: config.imageBlocks.length,
      changedSectionIds: [...changedSectionIds],
    };
  }
}
