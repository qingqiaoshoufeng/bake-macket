export const normalizeMediaBaseUrl = (baseUrl: string): string =>
  baseUrl.replace(/\/+$/, '');

export const joinMediaUrl = (baseUrl: string, objectKey: string): string =>
  `${normalizeMediaBaseUrl(baseUrl)}/${objectKey}`;
