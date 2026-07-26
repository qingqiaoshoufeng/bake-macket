import type { MigrationInterface, QueryRunner } from 'typeorm';

type DefaultMembershipLevel = {
  code: string;
  name: string;
  subtitle: string;
  description: string;
  rank: number;
  priceCents: number;
  grantCreditCents: number;
  discountBasisPoints: number;
  validDays: number;
  benefits: ReadonlyArray<{
    title: string;
    description: string;
    sortOrder: number;
  }>;
  theme: 'PEARL' | 'CHAMPAGNE' | 'JADE' | 'OBSIDIAN';
  badgeText: string;
};

type ExistingLevelRow = {
  id: string | number;
  code: string;
  rank: string | number;
};

type CountRow = { count: string | number };

const DEFAULT_LEVELS: readonly DefaultMembershipLevel[] = [
  {
    code: 'SILVER',
    name: '银卡',
    subtitle: '日常烘焙的轻盈礼遇',
    description: '享受会员折扣、开卡消费金与生日月专属祝福。',
    rank: 10,
    priceCents: 9_900,
    grantCreditCents: 1_000,
    discountBasisPoints: 9_500,
    validDays: 365,
    benefits: [
      {
        title: '全场商品 9.5 折',
        description: '会员有效期内，参与折扣的烘焙商品享受 9.5 折。',
        sortOrder: 10,
      },
      {
        title: '开卡赠送 ¥10 消费金',
        description: '购卡成功后一次性发放，可用于商品订单抵扣。',
        sortOrder: 20,
      },
      {
        title: '生日月专属祝福卡',
        description: '生日月下单可备注领取门店手写祝福卡。',
        sortOrder: 30,
      },
    ],
    theme: 'PEARL',
    badgeText: 'SILVER',
  },
  {
    code: 'GOLD',
    name: '金卡',
    subtitle: '让每次尝鲜都更从容',
    description: '获得更高折扣、更多消费金与新品活动优先权。',
    rank: 20,
    priceCents: 19_900,
    grantCreditCents: 3_000,
    discountBasisPoints: 9_000,
    validDays: 365,
    benefits: [
      {
        title: '全场商品 9 折',
        description: '会员有效期内，参与折扣的烘焙商品享受 9 折。',
        sortOrder: 10,
      },
      {
        title: '开卡赠送 ¥30 消费金',
        description: '购卡成功后一次性发放，可用于商品订单抵扣。',
        sortOrder: 20,
      },
      {
        title: '生日月赠送指定烘焙单品',
        description: '生日月可按门店当期活动领取指定烘焙单品。',
        sortOrder: 30,
      },
      {
        title: '新品试吃活动优先参与',
        description: '新品试吃开放时可优先报名参加。',
        sortOrder: 40,
      },
    ],
    theme: 'CHAMPAGNE',
    badgeText: 'GOLD',
  },
  {
    code: 'DIAMOND',
    name: '钻石卡',
    subtitle: '珍藏每一份甜蜜时刻',
    description: '享受进阶折扣、定制升级与节日新品优先预订。',
    rank: 30,
    priceCents: 39_900,
    grantCreditCents: 8_000,
    discountBasisPoints: 8_500,
    validDays: 365,
    benefits: [
      {
        title: '全场商品 8.5 折',
        description: '会员有效期内，参与折扣的烘焙商品享受 8.5 折。',
        sortOrder: 10,
      },
      {
        title: '开卡赠送 ¥80 消费金',
        description: '购卡成功后一次性发放，可用于商品订单抵扣。',
        sortOrder: 20,
      },
      {
        title: '生日月赠送定制蛋糕升级',
        description: '生日月订购定制蛋糕时可享受指定升级礼遇。',
        sortOrder: 30,
      },
      {
        title: '节日限定商品优先预订',
        description: '节日限定商品开放后可优先预订。',
        sortOrder: 40,
      },
      {
        title: '新品尝鲜活动专属邀请',
        description: '新品尝鲜活动开放时可获得专属邀请。',
        sortOrder: 50,
      },
    ],
    theme: 'JADE',
    badgeText: 'DIAMOND',
  },
  {
    code: 'BLACK',
    name: '黑卡',
    subtitle: '为重要时刻保留专属席位',
    description: '享受旗舰折扣、定制蛋糕礼遇与专属服务。',
    rank: 40,
    priceCents: 69_900,
    grantCreditCents: 16_000,
    discountBasisPoints: 8_000,
    validDays: 365,
    benefits: [
      {
        title: '全场商品 8 折',
        description: '会员有效期内，参与折扣的烘焙商品享受 8 折。',
        sortOrder: 10,
      },
      {
        title: '开卡赠送 ¥160 消费金',
        description: '购卡成功后一次性发放，可用于商品订单抵扣。',
        sortOrder: 20,
      },
      {
        title: '生日月专属定制蛋糕礼遇',
        description: '生日月订购定制蛋糕时可享受专属礼遇。',
        sortOrder: 30,
      },
      {
        title: '节日限定商品优先锁单',
        description: '节日限定商品开放后可优先锁定订单。',
        sortOrder: 40,
      },
      {
        title: '新品尝鲜与门店活动专属邀请',
        description: '新品尝鲜和门店会员活动开放时可获得专属邀请。',
        sortOrder: 50,
      },
      {
        title: '专属客服与定制需求优先响应',
        description: '定制需求和售后咨询可获得优先响应。',
        sortOrder: 60,
      },
    ],
    theme: 'OBSIDIAN',
    badgeText: 'BLACK',
  },
];

const DEFAULT_CODES = DEFAULT_LEVELS.map(({ code }) => code);
const DEFAULT_RANKS = DEFAULT_LEVELS.map(({ rank }) => rank);

function rowsOf<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function countOf(value: unknown): number {
  const [row] = rowsOf<CountRow>(value);
  return Number(row?.count ?? 0);
}

function matchingExistingLevel(
  existing: readonly ExistingLevelRow[],
  level: DefaultMembershipLevel,
): ExistingLevelRow | undefined {
  const codeMatch = existing.find(({ code }) => code === level.code);
  const rankMatch = existing.find(({ rank }) => Number(rank) === level.rank);
  if (!codeMatch && !rankMatch) return undefined;
  if (
    codeMatch &&
    rankMatch &&
    String(codeMatch.id) === String(rankMatch.id) &&
    Number(codeMatch.rank) === level.rank &&
    rankMatch.code === level.code
  ) {
    return codeMatch;
  }
  throw new Error(
    `Default membership level conflict for code ${level.code} and rank ${level.rank}`,
  );
}

async function inOwnedTransaction(
  queryRunner: QueryRunner,
  operation: () => Promise<void>,
): Promise<void> {
  const ownsTransaction = !queryRunner.isTransactionActive;
  if (ownsTransaction) await queryRunner.startTransaction();
  try {
    await operation();
    if (ownsTransaction) await queryRunner.commitTransaction();
  } catch (error) {
    if (ownsTransaction) await queryRunner.rollbackTransaction();
    throw error;
  }
}

/** Installs the four default purchasable membership levels without overwriting merchant data. */
export class DefaultMembershipLevels1718000000006 implements MigrationInterface {
  name = 'DefaultMembershipLevels1718000000006';

  async up(queryRunner: QueryRunner): Promise<void> {
    await inOwnedTransaction(queryRunner, async () => {
      const existing = rowsOf<ExistingLevelRow>(
        await queryRunner.query(
          `SELECT \`id\`, \`code\`, \`rank\` FROM \`membership_levels\`
           WHERE \`code\` IN (?, ?, ?, ?)
              OR \`rank\` IN (?, ?, ?, ?)
           FOR UPDATE`,
          [...DEFAULT_CODES, ...DEFAULT_RANKS],
        ),
      );

      const missing = DEFAULT_LEVELS.filter(
        (level) => !matchingExistingLevel(existing, level),
      );
      await missing.reduce<Promise<void>>(
        (previous, level) =>
          previous.then(async () => {
            await queryRunner.query(
              `INSERT INTO \`membership_levels\`
                (\`code\`, \`name\`, \`subtitle\`, \`description\`, \`rank\`,
                 \`price_cents\`, \`grant_credit_cents\`, \`discount_basis_points\`,
                 \`valid_days\`, \`benefits\`, \`theme\`, \`badge_text\`,
                 \`sort_order\`, \`is_active\`, \`version\`)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), ?, ?, ?, ?, ?)`,
              [
                level.code,
                level.name,
                level.subtitle,
                level.description,
                level.rank,
                level.priceCents,
                level.grantCreditCents,
                level.discountBasisPoints,
                level.validDays,
                JSON.stringify(level.benefits),
                level.theme,
                level.badgeText,
                level.rank,
                1,
                1,
              ],
            );
          }),
        Promise.resolve(),
      );
    });
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await inOwnedTransaction(queryRunner, async () => {
      const purchaseReferences = countOf(
        await queryRunner.query(
          `SELECT COUNT(*) AS \`count\`
           FROM \`membership_purchase_orders\` purchase
           INNER JOIN \`membership_levels\` level
             ON level.\`id\` = purchase.\`membership_level_id\`
           WHERE level.\`code\` IN (?, ?, ?, ?)`,
          DEFAULT_CODES,
        ),
      );
      if (purchaseReferences > 0) {
        throw new Error(
          `Cannot remove default membership levels: membership_purchase_orders has ${purchaseReferences} reference(s)`,
        );
      }

      const membershipReferences = countOf(
        await queryRunner.query(
          `SELECT COUNT(*) AS \`count\`
           FROM \`user_memberships\` membership
           INNER JOIN \`membership_levels\` level
             ON level.\`id\` = membership.\`membership_level_id\`
           WHERE level.\`code\` IN (?, ?, ?, ?)`,
          DEFAULT_CODES,
        ),
      );
      if (membershipReferences > 0) {
        throw new Error(
          `Cannot remove default membership levels: user_memberships has ${membershipReferences} reference(s)`,
        );
      }

      await queryRunner.query(
        `DELETE FROM \`membership_levels\`
         WHERE \`code\` IN (?, ?, ?, ?)`,
        DEFAULT_CODES,
      );
    });
  }
}
