import { type AdminPermission } from '@bake-mall/contracts';
import { SetMetadata } from '@nestjs/common';

export const ADMIN_PERMISSIONS_KEY = 'adminPermissions';

export const RequireAdminPermissions = (...permissions: AdminPermission[]) =>
  SetMetadata(ADMIN_PERMISSIONS_KEY, permissions);
