import DOMPurify from 'dompurify';

const ALLOWED_TAGS = [
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'ul',
  'ol',
  'li',
  'strong',
  'b',
  'em',
  'i',
  'a',
  'img',
  'br',
];
const ALLOWED_ATTR = ['href', 'src', 'alt'];
const localImageUrlPattern = /^http:\/\/127\.0\.0\.1:\d+(?:\/|$)/;

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

export function isAllowedLinkUrl(value: string): boolean {
  return isHttpsUrl(value);
}

export function isAllowedImageUrl(value: string): boolean {
  return isHttpsUrl(value) || localImageUrlPattern.test(value);
}

function removeDisallowedUrlAttribute(node: Element): void {
  if (node instanceof HTMLAnchorElement && node.hasAttribute('href')) {
    const href = node.getAttribute('href') ?? '';
    if (!isAllowedLinkUrl(href)) node.removeAttribute('href');
  }
  if (node instanceof HTMLImageElement && node.hasAttribute('src')) {
    const src = node.getAttribute('src') ?? '';
    if (!isAllowedImageUrl(src)) node.removeAttribute('src');
  }
}

DOMPurify.addHook('afterSanitizeAttributes', removeDisallowedUrlAttribute);

export function sanitizeRichTextHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
  });
}
