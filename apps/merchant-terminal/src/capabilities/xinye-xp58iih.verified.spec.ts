import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { parseVerifiedCapability } from './poc-capability.js';

const loadVerifiedCapability = (): unknown =>
  JSON.parse(
    readFileSync(
      new URL('./xinye-xp58iih.verified.json', import.meta.url),
      'utf8',
    ),
  );

describe('XP-58IIH verified capability fixture', () => {
  it('contains only real verified and redacted capabilities', () => {
    const parsed = parseVerifiedCapability(loadVerifiedCapability());
    const serialized = JSON.stringify(parsed);

    expect(parsed.verificationStatus).toBe('PASSED');
    expect(parsed.selfTestReference).not.toMatch(
      /\b(?:\d{1,3}\.){3}\d{1,3}\b/u,
    );
    expect(serialized).not.toMatch(/ssid|password|serialNumber/iu);
    if (parsed.supportsCut) {
      expect(parsed.cutCommandHex).toMatch(/^(?:[0-9a-f]{2})+$/iu);
    } else {
      expect(parsed.cutCommandHex).toBeNull();
    }
  });
});
