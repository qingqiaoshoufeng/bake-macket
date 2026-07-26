import {
  ApiErrorCode,
  MembershipLevelStatus,
  MembershipTheme,
  type AdminMembershipLevelDetailView,
} from '@bake-mall/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiClientError } from '../../../api/http.js';
import { membershipCardsApi } from '../api/index.js';
import {
  mapMembershipDetailToForm,
  mapMembershipFormToRequest,
  useMembershipCardEditor,
  validateMembershipForm,
} from './useMembershipCardEditor.js';

vi.mock('../api/index.js', () => ({
  membershipCardsApi: {
    getOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
}));

const api = vi.mocked(membershipCardsApi);
const detail: AdminMembershipLevelDetailView = {
  id: 'level-1',
  code: 'CHAMPAGNE_365',
  name: '香槟年卡',
  subtitle: '把日常烤得更香',
  description: '全年会员权益',
  rank: 20,
  priceCents: 19900,
  grantCreditCents: 30000,
  discountBasisPoints: 9550,
  validDays: 365,
  benefits: [{ title: '全场会员价', description: '每日可享', sortOrder: 10 }],
  cardTheme: { theme: MembershipTheme.CHAMPAGNE, badgeText: 'BAKER CLUB' },
  sortOrder: 8,
  status: MembershipLevelStatus.INACTIVE,
  version: 3,
  purchaseCount: 0,
  createdAt: '2026-07-21T08:00:00.000Z',
  updatedAt: '2026-07-21T09:00:00.000Z',
};

describe('会员卡表单映射与校验', () => {
  it('在元字符串、分和折扣基点之间精确映射并保留 rank 与 sortOrder', () => {
    const form = mapMembershipDetailToForm(detail);

    expect(form).toMatchObject({
      priceYuan: '199.00',
      grantCreditYuan: '300.00',
      discountText: '9.55',
      rank: 20,
      sortOrder: 8,
      version: 3,
    });
    expect(mapMembershipFormToRequest(form)).toEqual({
      code: 'CHAMPAGNE_365',
      name: '香槟年卡',
      subtitle: '把日常烤得更香',
      description: '全年会员权益',
      rank: 20,
      priceCents: 19900,
      grantCreditCents: 30000,
      discountBasisPoints: 9550,
      validDays: 365,
      benefits: [
        { title: '全场会员价', description: '每日可享', sortOrder: 10 },
      ],
      cardTheme: {
        theme: MembershipTheme.CHAMPAGNE,
        badgeText: 'BAKER CLUB',
      },
      sortOrder: 8,
      status: MembershipLevelStatus.INACTIVE,
      version: 3,
    });
  });

  it('区分业务 rank 与展示 sortOrder，并校验上架权益和边界', () => {
    const form = mapMembershipDetailToForm(detail);

    expect(
      validateMembershipForm({
        ...form,
        code: 'bad-code',
        rank: 0,
        validDays: 3651,
        discountText: '0.9',
        status: MembershipLevelStatus.ACTIVE,
        benefits: [],
      }),
    ).toEqual(
      expect.arrayContaining([
        '等级编码只能包含大写字母、数字和下划线',
        '业务等级必须是正整数',
        '有效天数必须为 1–3650 天',
        '上架前至少添加一条权益',
        '折扣必须为 1.0–10.0 折，最多保留三位小数',
      ]),
    );
  });
});

describe('useMembershipCardEditor', () => {
  afterEach(() => vi.resetAllMocks());

  it('在 version 409 时保留草稿和结构化冲突，明确重新加载后才覆盖', async () => {
    api.getOne.mockResolvedValue(detail);
    const editor = useMembershipCardEditor({
      mode: 'edit',
      levelId: detail.id,
    });
    await editor.load();
    editor.replaceForm({ ...editor.form.value, name: '未保存的配方草稿' });
    api.update.mockRejectedValueOnce(
      new ApiClientError(409, '会员等级已被其他操作更新', {
        code: ApiErrorCode.MEMBERSHIP_LEVEL_VERSION_CONFLICT,
        details: { currentVersion: 4 },
      }),
    );

    await expect(editor.save()).rejects.toThrow();

    expect(editor.form.value.name).toBe('未保存的配方草稿');
    expect(editor.conflict.value).toEqual({
      code: ApiErrorCode.MEMBERSHIP_LEVEL_VERSION_CONFLICT,
      message: '会员等级已被其他操作更新',
      details: { currentVersion: 4 },
    });
    expect(api.getOne).toHaveBeenCalledTimes(1);

    api.getOne.mockResolvedValue({
      ...detail,
      name: '服务端最新配方',
      version: 4,
    });
    await editor.reload();
    expect(editor.form.value.name).toBe('服务端最新配方');
    expect(editor.conflict.value).toBeNull();
  });

  it('创建成功后携带服务端 version 继续更新而不重复创建', async () => {
    const editor = useMembershipCardEditor({ mode: 'new' });
    const form = mapMembershipDetailToForm(detail);
    editor.replaceForm({ ...form, version: undefined });
    api.create.mockResolvedValueOnce(detail);
    api.update.mockResolvedValueOnce({ ...detail, name: '第二版', version: 4 });

    await editor.save();
    editor.replaceForm({ ...editor.form.value, name: '第二版' });
    await editor.save();

    expect(api.create).toHaveBeenCalledOnce();
    expect(api.update).toHaveBeenCalledWith(
      detail.id,
      expect.objectContaining({ name: '第二版', version: 3 }),
    );
  });
});
