import type {
  CustomerAvatarPresignRequest,
  CustomerAvatarPresignResponse,
  CustomerProfileView,
  PresignUploadContentType,
  UpdateCustomerProfileRequest,
} from '@bake-mall/contracts';

export type ProfileCompletionOutcome = 'PROFILE_SKIPPED' | 'PROFILE_UPDATED';

export type ProfileCompletionHandoff = Readonly<{
  outcome: ProfileCompletionOutcome;
  returnUrl: string;
}>;

export type InspectedAvatarFile = Readonly<{
  contentType: PresignUploadContentType;
  fileName: string;
  filePath: string;
  sizeBytes: number;
}>;

export type ProfileCompletionStage =
  'authenticating' | 'editing' | 'presigning' | 'saving' | 'uploading';

export type ProfileCompletionState = Readonly<{
  avatarPreviewUrl: string;
  error: string | null;
  nickname: string;
  stage: ProfileCompletionStage;
}>;

export type ProfileCompletionApi = Readonly<{
  authenticate: () => Promise<
    import('@bake-mall/contracts').CustomerAuthSessionView
  >;
  presignAvatar: (
    body: CustomerAvatarPresignRequest,
  ) => Promise<CustomerAvatarPresignResponse>;
  updateProfile: (
    body: UpdateCustomerProfileRequest,
  ) => Promise<CustomerProfileView>;
  uploadAvatar: (
    presign: CustomerAvatarPresignResponse,
    filePath: string,
  ) => Promise<void>;
}>;
