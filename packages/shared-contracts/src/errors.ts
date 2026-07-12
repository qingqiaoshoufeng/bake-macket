import { ApiErrorCode } from './enums.js';

export type ApiError = {
  code: ApiErrorCode;
  message: string;
  requestId?: string;
  details?: Record<string, unknown>;
};
