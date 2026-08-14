import type { AdminUserView } from '@bake-mall/contracts';

type UserListData = Readonly<{
  empty: boolean;
}>;

type UserListProperties = Readonly<{
  users: WechatMiniprogram.Component.FullProperty<
    ArrayConstructor,
    AdminUserView[]
  >;
}>;

type UserListMethods = Readonly<Record<string, never>>;
type UserListBehaviors = [];

Component<UserListData, UserListProperties, UserListMethods, UserListBehaviors>(
  {
    properties: {
      users: {
        type: Array,
        value: [],
      },
    },

    data: {
      empty: true,
    },

    observers: {
      users(users: readonly AdminUserView[]): void {
        this.setData({ empty: users.length === 0 });
      },
    },
  },
);
