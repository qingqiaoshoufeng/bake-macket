import type {
  PresignUploadContentType,
  PresignUploadRequest,
  PresignUploadResponse,
  PresignUploadScope,
} from '@bake-mall/contracts';

import { apiClient } from './http.js';

/**
 * `POST /api/v1/upload/presign` — request an S3-compatible presigned POST
 * for direct browser-to-storage uploads. The backend validates the scope,
 * MIME type and size (≤ 5 MiB), then returns the destination URL, the
 * server-assigned object key and the form fields the browser should
 * include in its subsequent multipart POST.
 *
 * The endpoint is admin-only (`JwtAdminGuard`), so the merchant bearer
 * token attached to the shared `apiClient` covers both the presign call
 * and the resulting upload.
 */

export type PresignScope = PresignUploadScope;
export type PresignContentType = PresignUploadContentType;

/** Hard ceiling mirrored from the backend's `PresignUploadDto`. */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export const uploadApi = {
  /**
   * Ask the backend for a presigned upload. The browser then performs a
   * multipart POST to `uploadUrl` with the returned `fields` plus
   * the file. {@link performUpload} wraps both legs for convenience.
   */
  presign(body: PresignUploadRequest): Promise<PresignUploadResponse> {
    return apiClient.post<PresignUploadResponse>('/upload/presign', body);
  },
};

/**
 * Drive the two-step upload flow: presign, then POST the multipart form.
 *
 * The second leg is intentionally raw `fetch` against `uploadUrl` so
 * we can keep `apiClient`'s `/api/v1` prefix and auth header from leaking
 * onto the storage endpoint. Any non-2xx is surfaced as an `Error` so the
 * caller's UI can show a Chinese failure message.
 */
export async function performUpload(
  file: File,
  scope: PresignScope,
): Promise<PresignUploadResponse> {
  const presigned = await uploadApi.presign({
    scope,
    fileName: file.name,
    contentType: file.type as PresignContentType,
    sizeBytes: file.size,
  });

  const form = new FormData();
  for (const [key, value] of Object.entries(presigned.fields)) {
    form.append(key, value);
  }
  form.append('file', file);

  const response = await fetch(presigned.uploadUrl, {
    method: 'POST',
    body: form,
  });
  if (!response.ok) {
    throw new Error(`Upload failed with status ${response.status}`);
  }
  return presigned;
}
