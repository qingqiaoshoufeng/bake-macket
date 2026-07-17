import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import sanitizeHtml from 'sanitize-html';

import { isAllowedProductPublicUrl } from '../catalog/media-asset-policy.service.js';
import type { AppConfig, AppEnv } from '../config/env.schema.js';

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
/** Removes executable markup while preserving the limited formatting supported by product pages. */
export function sanitizeProductHtml(input: string, env: AppEnv): string {
  return sanitizeHtml(input, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: { a: ['href'], img: ['src', 'alt'] },
    allowedSchemes: ['https'],
    allowedSchemesByTag: { a: ['https'], img: ['http', 'https'] },
    allowProtocolRelative: false,
    disallowedTagsMode: 'completelyDiscard',
    exclusiveFilter: (frame) =>
      frame.tag === 'img' &&
      !isAllowedProductPublicUrl(frame.attribs.src ?? '', env),
  });
}

@Injectable()
export class HtmlSanitizerService {
  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  sanitize(input: string): string {
    return sanitizeProductHtml(
      input,
      this.config.get('appEnv', { infer: true }),
    );
  }
}
