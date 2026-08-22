import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';

import type {
  CustomerAvatarPresignRequest,
  CustomerAvatarPresignResponse,
  CustomerProfileView,
  UpdateCustomerProfileRequest,
} from '@bake-mall/contracts';

import type { AppConfig } from '../config/env.schema.js';
import { User } from '../database/entities/user.entity.js';
import { joinMediaUrl } from '../media-url.js';
import { ObjectStorageReaderService } from '../object-storage/object-storage-reader.service.js';
import { PresignedPostService } from '../object-storage/presigned-post.service.js';
import {
  normalizeCustomerNickname,
  toCustomerProfileView,
} from './customer-profile.mapper.js';

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const AVATAR_PREFIX_BYTES = 12;
const AVATAR_UPLOAD_KEY =
  /^users\/([^/]+)\/avatar-uploads\/([0-9a-f-]{36})\.(jpg|jpeg|png|webp)$/u;
const MIME_EXTENSIONS = {
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/webp': ['webp'],
} as const;

const isControlCharacter = (value: string): boolean =>
  [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 0x20 || code === 0x7f;
  });

const validateNickname = (nickname: string): string => {
  const normalized = normalizeCustomerNickname(nickname);
  if (!normalized || normalized.length > 64 || isControlCharacter(normalized)) {
    throw new BadRequestException('Invalid nickname');
  }
  return normalized;
};

const validateAvatarKey = (userId: string, objectKey: string): string => {
  const match = objectKey.match(AVATAR_UPLOAD_KEY);
  if (!match || match[1] !== userId || objectKey.includes('..')) {
    throw new BadRequestException('Invalid avatar object key');
  }
  return objectKey;
};

const matchesMagic = (bytes: Uint8Array, contentType: string): boolean => {
  if (contentType === 'image/png') {
    return [137, 80, 78, 71, 13, 10, 26, 10].every(
      (value, index) => bytes[index] === value,
    );
  }
  if (contentType === 'image/jpeg') {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  return (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  );
};

const extensionMatchesContentType = (
  objectKey: string,
  contentType: string,
): boolean =>
  MIME_EXTENSIONS[contentType as keyof typeof MIME_EXTENSIONS]?.some(
    (extension) => objectKey.endsWith(`.${extension}`),
  ) ?? false;

@Injectable()
export class CustomerProfileService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly presignedPosts: PresignedPostService,
    private readonly objects: ObjectStorageReaderService,
  ) {}

  async presignAvatar(
    userId: string,
    request: CustomerAvatarPresignRequest,
  ): Promise<CustomerAvatarPresignResponse> {
    const extension =
      request.contentType === 'image/jpeg'
        ? 'jpg'
        : request.contentType.split('/')[1];
    const objectKey = `users/${userId}/avatar-uploads/${randomUUID()}.${extension}`;
    const signed = await this.presignedPosts.create({
      objectKey,
      contentType: request.contentType,
      maxSizeBytes: MAX_AVATAR_BYTES,
    });
    return { objectKey, ...signed };
  }

  async update(
    userId: string,
    request:
      | UpdateCustomerProfileRequest
      | { nickname?: string; avatarObjectKey?: string },
  ): Promise<CustomerProfileView> {
    const nickname =
      request.nickname === undefined
        ? undefined
        : validateNickname(request.nickname);
    const avatarObjectKey = request.avatarObjectKey;
    if (nickname === undefined && avatarObjectKey === undefined) {
      throw new BadRequestException('Profile update cannot be empty');
    }
    let finalAvatarKey: string | undefined;
    if (avatarObjectKey !== undefined) {
      validateAvatarKey(userId, avatarObjectKey);
      const contentType = await this.validateAvatarObject(avatarObjectKey);
      finalAvatarKey = avatarObjectKey.replace('/avatar-uploads/', '/avatars/');
      try {
        await this.objects.copy(avatarObjectKey, finalAvatarKey, contentType);
        await this.validateAvatarObject(finalAvatarKey);
      } catch {
        throw new BadRequestException('Avatar object is unavailable');
      }
    }

    const result = await this.dataSource.transaction(async (manager) => {
      const user = await manager
        .getRepository(User)
        .createQueryBuilder('user')
        .setLock('pessimistic_write')
        .where('user.id = :userId', { userId })
        .getOne();
      if (!user) throw new NotFoundException('User not found');
      if (!user.isActive || user.mergedIntoUserId) {
        throw new UnauthorizedException('User is inactive or merged');
      }
      if (nickname !== undefined) user.nickname = nickname;
      if (finalAvatarKey !== undefined) {
        const env = this.config.get('appEnv', { infer: true });
        user.avatarObjectKey = finalAvatarKey;
        user.avatarUrl = joinMediaUrl(
          env.OBJECT_STORAGE_PUBLIC_BASE_URL,
          finalAvatarKey,
        );
      }
      await manager.getRepository(User).save(user);
      return toCustomerProfileView(user);
    });
    if (avatarObjectKey !== undefined) {
      await this.objects.remove(avatarObjectKey).catch(() => undefined);
    }
    return result;
  }

  private async validateAvatarObject(objectKey: string): Promise<string> {
    let metadata: Awaited<ReturnType<ObjectStorageReaderService['head']>>;
    try {
      metadata = await this.objects.head(objectKey);
    } catch {
      throw new BadRequestException('Avatar object is unavailable');
    }
    if (
      !metadata.contentType ||
      !metadata.contentLength ||
      metadata.contentLength < 1 ||
      metadata.contentLength > MAX_AVATAR_BYTES ||
      !extensionMatchesContentType(objectKey, metadata.contentType)
    ) {
      throw new BadRequestException('Invalid avatar object metadata');
    }
    let bytes: Uint8Array;
    try {
      bytes = await this.objects.readPrefix(objectKey, AVATAR_PREFIX_BYTES);
    } catch {
      throw new BadRequestException('Avatar object is unavailable');
    }
    if (!matchesMagic(bytes, metadata.contentType)) {
      throw new BadRequestException('Invalid avatar object content');
    }
    return metadata.contentType;
  }
}
