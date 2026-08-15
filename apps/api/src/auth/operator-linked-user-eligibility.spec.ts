import { describe, expect, it } from 'vitest';

import { isEligibleOperatorLinkedUser } from './operator-linked-user-eligibility.js';

const linkedUser = (overrides: Record<string, unknown> = {}) => ({
  id: '7',
  isActive: true,
  mergedIntoUserId: null,
  wechatOpenid: 'openid-7',
  wechatUnionid: null,
  phone: null,
  phoneVerified: false,
  orderContactPhone: null,
  ...overrides,
});

describe('isEligibleOperatorLinkedUser', () => {
  it.each([
    ['仅 OpenID', linkedUser()],
    [
      '仅 UnionID',
      linkedUser({ wechatOpenid: null, wechatUnionid: 'unionid-7' }),
    ],
    [
      '身份手机号和订单联系手机号均变化',
      linkedUser({
        phone: '13900000000',
        phoneVerified: true,
        orderContactPhone: '13600000000',
      }),
    ],
  ])('%s 时允许已显式关联的 OPERATOR', (_label, user) => {
    expect(isEligibleOperatorLinkedUser(user)).toBe(true);
  });

  it.each([
    ['User 不存在', null],
    [
      '没有微信 identity，即使身份手机号已验证',
      linkedUser({
        wechatOpenid: null,
        wechatUnionid: null,
        phone: '13800000000',
        phoneVerified: true,
      }),
    ],
    ['User inactive', linkedUser({ isActive: false })],
    ['User 已合并', linkedUser({ mergedIntoUserId: '8' })],
  ])('%s 时拒绝', (_label, user) => {
    expect(isEligibleOperatorLinkedUser(user)).toBe(false);
  });
});
