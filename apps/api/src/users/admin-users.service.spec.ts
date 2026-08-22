import {
  AdminRole,
  ApiErrorCode,
  SUPER_ADMIN_PERMISSIONS,
} from '@bake-mall/contracts';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import bcrypt from 'bcrypt';
import { describe, expect, it, vi } from 'vitest';

import { User } from '../database/entities/user.entity.js';
import {
  AdminUsersService,
  maskAdminUserPhone,
} from './admin-users.service.js';

const superAdmin = () => ({
  id: '1',
  username: 'admin@example.com',
  role: AdminRole.SUPER_ADMIN,
  linkedUserId: null,
  isActive: true,
  passwordHash: 'super-hash',
  mustChangePassword: false,
  tokenVersion: 1,
});
const targetUser = (overrides: Record<string, unknown> = {}) => ({
  id: '7',
  phone: null,
  phoneVerified: false,
  orderContactPhone: null,
  wechatOpenid: 'openid-7',
  wechatUnionid: null,
  nickname: '微信用户',
  avatarUrl: 'https://cdn.example.com/avatar.webp',
  isActive: true,
  mergedIntoUserId: null,
  createdAt: new Date('2026-08-04T00:00:00.000Z'),
  updatedAt: new Date('2026-08-05T00:00:00.000Z'),
  ...overrides,
});

const build = (
  options: {
    user?: ReturnType<typeof targetUser> | null;
    existing?: Record<string, unknown> | null;
    verificationStatus?: 'VERIFIED' | 'FAILED';
  } = {},
) => {
  let savedAdmin: Record<string, unknown> | null = null;
  const user = options.user === undefined ? targetUser() : options.user;
  const existing = options.existing ?? null;
  const users = {
    findOne: vi.fn().mockResolvedValue(user),
  };
  const admins = {
    findOne: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
      where.id === '1' ? superAdmin() : existing,
    ),
    create: vi.fn((value) => value),
    save: vi.fn(async (value) => {
      savedAdmin = { ...value };
      return value;
    }),
  };
  const manager = {
    getRepository: vi.fn((entity) => (entity === User ? users : admins)),
  };
  const dataSource = {
    getRepository: vi.fn((entity) => (entity === User ? users : admins)),
    transaction: vi.fn(async (operation) => operation(manager)),
  };
  const verification = {
    verifyInTransaction: vi
      .fn()
      .mockResolvedValue(
        options.verificationStatus === 'FAILED'
          ? { status: 'FAILED', count: 1, windowStartedAt: new Date() }
          : { status: 'VERIFIED', admin: superAdmin() },
      ),
    assertVerified: vi.fn((outcome) => {
      if (outcome.status !== 'VERIFIED') throw new ForbiddenException();
      return outcome.admin;
    }),
  };
  const audit = { record: vi.fn() };
  const service = new AdminUsersService(
    dataSource as never,
    verification as never,
    audit as never,
    {
      createPhonePlaceholder: vi.fn(async (phone, manager) => {
        const repository = manager.getRepository(User);
        return repository.save(
          repository.create({
            phone,
            phoneVerified: false,
            nickname: null,
          }),
        );
      }),
    } as never,
  );
  return {
    service,
    users,
    admins,
    verification,
    audit,
    getSavedAdmin: () => savedAdmin,
  };
};

const principal = {
  id: '1',
  username: 'admin@example.com',
  role: AdminRole.SUPER_ADMIN,
  linkedUserId: null,
  mustChangePassword: false,
  permissions: SUPER_ADMIN_PERMISSIONS,
};

describe('maskAdminUserPhone', () => {
  it.each([
    ['123456', '1****6'],
    ['1234567', '1*****7'],
    ['13800000000', '138****0000'],
    ['+8613800000000', '+86*******0000'],
    ['12345678901234567890', '123*************7890'],
  ])('脱敏允许格式 %s，结果为 %s 且不泄露完整号码', (phone, masked) => {
    expect(maskAdminUserPhone(phone)).toBe(masked);
    expect(maskAdminUserPhone(phone)).not.toContain(phone);
  });

  it('保留 null，避免把缺失手机号伪装为字符串', () => {
    expect(maskAdminUserPhone(null)).toBeNull();
  });
});

describe('AdminUsersService', () => {
  it('返回完整微信标识、绑定状态与脱敏手机号', async () => {
    const harness = build({
      user: targetUser({
        phone: '13800000000',
        phoneVerified: true,
        wechatUnionid: 'unionid-7',
      }),
      existing: {
        id: '9',
        role: AdminRole.OPERATOR,
        linkedUserId: '7',
        loginPhone: '13700000000',
        isActive: true,
        mustChangePassword: false,
      },
    });

    const detail = await harness.service.getOne('7');

    expect(detail).toEqual({
      id: '7',
      nickname: '微信用户',
      avatarUrl: 'https://cdn.example.com/avatar.webp',
      wechat: {
        bound: true,
        openidBound: true,
        unionidBound: true,
        openid: 'openid-7',
        unionid: 'unionid-7',
      },
      identityPhone: { masked: '138****0000', verified: true },
      account: { isActive: true, mergedIntoUserId: null },
      operator: {
        isOperator: true,
        active: true,
        mustChangePassword: false,
        loginPhoneMasked: '137****0000',
      },
      createdAt: '2026-08-04T00:00:00.000Z',
      updatedAt: '2026-08-05T00:00:00.000Z',
    });
    expect(JSON.stringify(detail)).not.toMatch(
      /13800000000|13700000000|passwordHash|tokenVersion|jwt|session_key/i,
    );
  });

  it('详情保留缺失值并返回停用合并状态', async () => {
    const harness = build({
      user: targetUser({
        nickname: null,
        avatarUrl: null,
        wechatOpenid: null,
        isActive: false,
        mergedIntoUserId: '8',
      }),
    });

    await expect(harness.service.getOne('7')).resolves.toMatchObject({
      nickname: null,
      avatarUrl: null,
      wechat: {
        bound: false,
        openidBound: false,
        unionidBound: false,
        openid: null,
        unionid: null,
      },
      identityPhone: { masked: null, verified: false },
      account: { isActive: false, mergedIntoUserId: '8' },
      operator: {
        isOperator: false,
        active: false,
        mustChangePassword: false,
        loginPhoneMasked: null,
      },
    });
  });

  it('详情查询不存在用户时返回 404', async () => {
    await expect(
      build({ user: null }).service.getOne('404'),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('授权 verified canonical user，保存 null username 与临时 hash', async () => {
    const harness = build();
    vi.spyOn(bcrypt, 'hash').mockResolvedValue('temporary-hash' as never);

    const result = await harness.service.grantOperator('7', principal, {
      loginPhone: '13700000000',
      currentPassword: 'super-password',
      temporaryPassword: '123456',
      confirmTemporaryPassword: '123456',
    });

    expect(harness.users.findOne).toHaveBeenCalledWith({
      where: { id: '7' },
      lock: { mode: 'pessimistic_write' },
    });
    expect(harness.verification.verifyInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        adminId: '1',
        candidatePassword: 'super-password',
      }),
    );
    expect(harness.getSavedAdmin()).toMatchObject({
      username: null,
      loginPhone: '13700000000',
      role: AdminRole.OPERATOR,
      linkedUserId: '7',
      passwordHash: 'temporary-hash',
      isActive: true,
      mustChangePassword: true,
      tokenVersion: 1,
    });
    expect(result.operator).toMatchObject({
      role: AdminRole.OPERATOR,
      isActive: true,
      mustChangePassword: true,
    });
    expect(JSON.stringify(harness.audit.record.mock.calls)).not.toContain(
      '123456',
    );
    expect(JSON.stringify(harness.audit.record.mock.calls)).not.toContain(
      '13700000000',
    );
    expect(JSON.stringify(harness.audit.record.mock.calls)).not.toContain(
      'hash',
    );
  });

  it.each([
    ['不存在', null],
    ['inactive', targetUser({ isActive: false })],
    ['已合并', targetUser({ mergedIntoUserId: '8' })],
    [
      '未绑定微信，即使身份手机号已验证',
      targetUser({
        phone: '13800000000',
        phoneVerified: true,
        wechatOpenid: null,
        wechatUnionid: null,
      }),
    ],
  ])('拒绝%s user，且不验证、不创建或激活 admin', async (_label, user) => {
    const harness = build({ user });

    await expect(
      harness.service.grantOperator('7', principal, {
        loginPhone: '13700000000',
        currentPassword: 'super-password',
        temporaryPassword: '123456',
        confirmTemporaryPassword: '123456',
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(harness.verification.verifyInTransaction).not.toHaveBeenCalled();
    expect(harness.admins.findOne).not.toHaveBeenCalled();
    expect(harness.admins.create).not.toHaveBeenCalled();
    expect(harness.admins.save).not.toHaveBeenCalled();
  });

  it('拒绝普通管理员授权', async () => {
    await expect(
      build().service.grantOperator(
        '7',
        { ...principal, role: AdminRole.OPERATOR },
        {
          loginPhone: '13700000000',
          currentPassword: '123456',
          temporaryPassword: '654321',
          confirmTemporaryPassword: '654321',
        },
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: ApiErrorCode.ADMIN_PERMISSION_DENIED,
      }),
    });
  });

  it('已 active OPERATOR 返回明确冲突', async () => {
    await expect(
      build({
        existing: {
          id: '9',
          role: AdminRole.OPERATOR,
          linkedUserId: '7',
          isActive: true,
        },
      }).service.grantOperator('7', principal, {
        loginPhone: '13700000000',
        currentPassword: 'super-password',
        temporaryPassword: '123456',
        confirmTemporaryPassword: '123456',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('重新激活 OPERATOR 时 version++ 并重置临时密码状态', async () => {
    const harness = build({
      existing: {
        id: '9',
        username: null,
        role: AdminRole.OPERATOR,
        linkedUserId: '7',
        passwordHash: 'old',
        isActive: false,
        mustChangePassword: false,
        tokenVersion: 5,
      },
    });
    vi.spyOn(bcrypt, 'hash').mockResolvedValue('new-hash' as never);
    await harness.service.grantOperator('7', principal, {
      loginPhone: '13700000000',
      currentPassword: 'super-password',
      temporaryPassword: '654321',
      confirmTemporaryPassword: '654321',
    });
    expect(harness.getSavedAdmin()).toMatchObject({
      isActive: true,
      mustChangePassword: true,
      tokenVersion: 6,
      passwordHash: 'new-hash',
    });
  });

  it('撤权保留 OPERATOR 记录并 version++', async () => {
    const existing = {
      id: '9',
      username: null,
      role: AdminRole.OPERATOR,
      linkedUserId: '7',
      passwordHash: 'hash',
      isActive: true,
      mustChangePassword: false,
      tokenVersion: 5,
    };
    const harness = build({ existing });
    const result = await harness.service.revokeOperator('7', principal, {
      currentPassword: 'super-password',
    });
    expect(harness.getSavedAdmin()).toMatchObject({
      id: '9',
      isActive: false,
      tokenVersion: 6,
      linkedUserId: '7',
    });
    expect(result.operator).toMatchObject({ isActive: false });
  });
});

const buildUserManagement = (
  options: {
    existingPhoneOwner?: User | null;
    saveError?: unknown;
    rawRows?: Record<string, unknown>[];
    total?: number;
  } = {},
) => {
  let savedUser: User | null = null;
  const userRepository = {
    findOne: vi.fn().mockResolvedValue(options.existingPhoneOwner ?? null),
    create: vi.fn((value: Partial<User>) => value as User),
    save: vi.fn(async (value: User) => {
      if (options.saveError) throw options.saveError;
      savedUser = {
        ...value,
        id: '11',
        createdAt: new Date('2026-08-05T01:02:03.000Z'),
      } as User;
      return savedUser;
    }),
  };
  const queryBuilder = {
    leftJoin: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    andWhere: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    addOrderBy: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    take: vi.fn().mockReturnThis(),
    getCount: vi.fn().mockResolvedValue(options.total ?? 0),
    getRawMany: vi.fn().mockResolvedValue(options.rawRows ?? []),
  };
  const listRepository = {
    createQueryBuilder: vi.fn().mockReturnValue(queryBuilder),
  };
  const manager = {
    getRepository: vi.fn((entity) =>
      entity === User ? userRepository : { findOne: vi.fn() },
    ),
  };
  const dataSource = {
    getRepository: vi.fn(() => listRepository),
    transaction: vi.fn(async (operation) => operation(manager)),
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const service = new AdminUsersService(
    dataSource as never,
    { verifyInTransaction: vi.fn(), assertVerified: vi.fn() } as never,
    audit as never,
    {
      createPhonePlaceholder: vi.fn(async (phone, manager) => {
        const repository = manager.getRepository(User);
        return repository.save(
          repository.create({
            phone,
            phoneVerified: false,
            nickname: null,
          }),
        );
      }),
    } as never,
  );
  return {
    service,
    userRepository,
    queryBuilder,
    audit,
    getSavedUser: () => savedUser,
  };
};

describe('AdminUsersService 用户管理', () => {
  it('创建未验证 placeholder，复用管理员手机号规范化并只返回脱敏状态', async () => {
    const harness = buildUserManagement();

    const result = await harness.service.createPlaceholder(principal, {
      phone: ' 13800000000 ',
    });

    expect(harness.userRepository.findOne).toHaveBeenCalledWith({
      where: { phone: '13800000000' },
    });
    expect(harness.getSavedUser()).toMatchObject({
      phone: '13800000000',
      phoneVerified: false,
    });
    expect(result).toEqual({
      id: '11',
      nickname: null,
      identityPhoneMasked: '138****0000',
      identityPhoneVerified: false,
      wechatBound: false,
      wechatOpenid: null,
      wechatUnionid: null,
      loginPhoneMasked: null,
      createdAt: '2026-08-05T01:02:03.000Z',
      isOperator: false,
      operatorActive: false,
      mustChangePassword: false,
    });
    expect(result).not.toHaveProperty('phone');
    expect(result.wechatOpenid).toBeNull();
    expect(result.wechatUnionid).toBeNull();
  });

  it('创建审计只包含内部 user ID 和 phonePresent，不记录手机号', async () => {
    const harness = buildUserManagement();

    await harness.service.createPlaceholder(principal, {
      phone: '13800000000',
    });

    expect(harness.audit.record).toHaveBeenCalledWith(
      {
        actor: { type: 'ADMIN', adminUserId: '1' },
        targetEntity: 'users',
        targetId: '11',
        action: 'ADMIN_PLACEHOLDER_USER_CREATED',
        changeSummary: { userId: '11', phonePresent: true },
      },
      expect.anything(),
    );
    expect(JSON.stringify(harness.audit.record.mock.calls)).not.toContain(
      '13800000000',
    );
  });

  it.each(['+8613800000000', '1380000000', '23800000000'])(
    '拒绝非 11 位中国大陆手机号 %s',
    async (phone) => {
      const harness = buildUserManagement();

      await expect(
        harness.service.createPlaceholder(principal, { phone }),
      ).rejects.toMatchObject({ status: 400 });
      expect(harness.userRepository.save).not.toHaveBeenCalled();
    },
  );

  it('对已存在手机号返回确定性 shared conflict', async () => {
    const harness = buildUserManagement({
      existingPhoneOwner: targetUser() as User,
    });

    await expect(
      harness.service.createPlaceholder(principal, {
        phone: '13800000000',
      }),
    ).rejects.toMatchObject({
      response: {
        code: ApiErrorCode.ADMIN_USER_CONFLICT,
        message: 'User phone already exists',
      },
    });
  });

  it('将并发唯一键 race 映射为同一个确定性 shared conflict', async () => {
    const harness = buildUserManagement({
      saveError: Object.assign(new Error('duplicate'), {
        code: 'ER_DUP_ENTRY',
        errno: 1062,
      }),
    });

    await expect(
      harness.service.createPlaceholder(principal, {
        phone: '13800000000',
      }),
    ).rejects.toMatchObject({
      response: {
        code: ApiErrorCode.ADMIN_USER_CONFLICT,
        message: 'User phone already exists',
      },
    });
    expect(harness.audit.record).not.toHaveBeenCalled();
  });

  it('非数字搜索只按转义后的手机号或昵称字面量匹配，并以 createdAt/id 稳定排序', async () => {
    const harness = buildUserManagement({
      total: 21,
      rawRows: [
        {
          userId: '7',
          nickname: '张三',
          phone: '13800000000',
          phoneVerified: 1,
          wechatOpenid: 'openid-user-7',
          wechatUnionid: 'unionid-user-7',
          createdAt: new Date('2026-08-04T00:00:00.000Z'),
          operatorId: '9',
          operatorLoginPhone: '13700000000',
          operatorActive: 0,
          mustChangePassword: 1,
        },
      ],
    });

    const result = await harness.service.list({
      page: 2,
      pageSize: 10,
      q: String.raw`  张%_三\  `,
    });

    expect(harness.queryBuilder.andWhere).toHaveBeenCalledWith(
      "(user.phone LIKE :search ESCAPE '\\\\' OR user.nickname LIKE :search ESCAPE '\\\\' OR operator.loginPhone = :exactLoginPhone)",
      {
        exactLoginPhone: '张%_三\\',
        search: String.raw`%张\%\_三\\%`,
      },
    );
    expect(harness.queryBuilder.andWhere.mock.calls[0]?.[0]).not.toContain(
      'user.id = :exactUserId',
    );
    expect(harness.queryBuilder.orderBy).toHaveBeenCalledWith(
      'user.createdAt',
      'DESC',
    );
    expect(harness.queryBuilder.addOrderBy).toHaveBeenCalledWith(
      'user.id',
      'DESC',
    );
    expect(harness.queryBuilder.skip).toHaveBeenCalledWith(10);
    expect(harness.queryBuilder.take).toHaveBeenCalledWith(10);
    expect(result).toEqual({
      items: [
        {
          id: '7',
          nickname: '张三',
          identityPhoneMasked: '138****0000',
          identityPhoneVerified: true,
          wechatBound: true,
          wechatOpenid: 'openid-user-7',
          wechatUnionid: 'unionid-user-7',
          loginPhoneMasked: '137****0000',
          createdAt: '2026-08-04T00:00:00.000Z',
          isOperator: true,
          operatorActive: false,
          mustChangePassword: true,
        },
      ],
      total: 21,
      page: 2,
      pageSize: 10,
    });
  });

  it.each([
    ['7foo', false],
    ['007', false],
    ['0', false],
    ['18446744073709551616', false],
    ['7', true],
    ['18446744073709551615', true],
  ])(
    '仅对合法规范 BIGINT UNSIGNED 用户 ID %s 增加精确 ID 条件',
    async (q, expectsExactId) => {
      const harness = buildUserManagement();

      await harness.service.list({ page: 1, pageSize: 20, q });

      const [sql, parameters] = harness.queryBuilder.andWhere.mock.calls[0] as [
        string,
        Record<string, string>,
      ];
      expect(sql.includes('user.id = :exactUserId')).toBe(expectsExactId);
      expect(parameters).toEqual(
        expectsExactId
          ? { exactLoginPhone: q, exactUserId: q, search: `%${q}%` }
          : { exactLoginPhone: q, search: `%${q}%` },
      );
    },
  );

  it('列表 SQL 只投影允许的用户字段和管理员状态', async () => {
    const harness = buildUserManagement();

    await harness.service.list({ page: 1, pageSize: 20 });

    const projection = JSON.stringify(
      harness.queryBuilder.select.mock.calls[0]?.[0],
    );
    expect(projection).toContain('user.phone');
    expect(projection).toContain('user.wechatOpenid');
    expect(projection).toContain('user.wechatUnionid');
    expect(projection).toContain('operator.loginPhone');
    expect(projection).toContain('operator.isActive');
    expect(projection).toContain('operator.mustChangePassword');
    expect(projection).not.toMatch(
      /passwordHash|tokenVersion|verifyFailed|secret|jwt/i,
    );
  });
});
