import { type User } from '../database/entities/user.entity.js';

export type OperatorLinkedUserEligibility = Pick<
  User,
  'isActive' | 'mergedIntoUserId' | 'wechatOpenid' | 'wechatUnionid'
>;

export function isEligibleOperatorLinkedUser(
  user: OperatorLinkedUserEligibility | null,
): user is OperatorLinkedUserEligibility {
  return Boolean(
    user &&
    user.isActive &&
    user.mergedIntoUserId === null &&
    (user.wechatOpenid || user.wechatUnionid),
  );
}
