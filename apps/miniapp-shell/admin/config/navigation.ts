import { AdminPermission } from '../../config/contracts.generated.js';

export const ADMIN_ROUTES = Object.freeze({
  home: '/pages/admin-home/index',
  password: '/pages/admin-password/index',
  printers: '/pages/admin-printers/index',
  printing: '/pages/admin-printing/index',
  users: '/pages/admin-users/index',
});

export const ADMIN_NAVIGATION = Object.freeze([
  {
    label: '订单打印',
    permission: AdminPermission.PRINT_EXECUTE,
    route: ADMIN_ROUTES.printing,
  },
  {
    label: '打印机管理',
    permission: AdminPermission.PRINT_DEVICE_MANAGE,
    route: ADMIN_ROUTES.printers,
  },
  {
    label: '用户管理',
    permission: AdminPermission.USER_READ,
    route: ADMIN_ROUTES.users,
  },
  {
    label: '修改操作密码',
    permission: AdminPermission.SELF_PASSWORD_CHANGE,
    route: ADMIN_ROUTES.password,
  },
] as const);
