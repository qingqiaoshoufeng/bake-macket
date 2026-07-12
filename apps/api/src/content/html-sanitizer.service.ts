import { Injectable } from '@nestjs/common';
import sanitizeHtml from 'sanitize-html';

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
const COS_HOSTNAME = /(^|\.)cos(?:\.[a-z0-9-]+)?\.myqcloud\.com$/i;

/** Removes executable markup while preserving the limited formatting supported by product pages. */
export function sanitizeProductHtml(input: string): string {
  return sanitizeHtml(input, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: { a: ['href'], img: ['src', 'alt'] },
    allowedSchemes: ['https'],
    allowProtocolRelative: false,
    disallowedTagsMode: 'completelyDiscard',
    exclusiveFilter: (frame) => {
      if (frame.tag !== 'img') return false;
      try {
        const url = new URL(frame.attribs.src ?? '');
        return url.protocol !== 'https:' || !COS_HOSTNAME.test(url.hostname);
      } catch {
        return true;
      }
    },
  });
}

@Injectable()
export class HtmlSanitizerService {
  sanitize(input: string): string {
    return sanitizeProductHtml(input);
  }
}
