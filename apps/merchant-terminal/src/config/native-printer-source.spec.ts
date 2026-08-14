import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL(
    '../uni_modules/bake-escpos-printer/utssdk/app-android/index.uts',
    import.meta.url,
  ),
  'utf8',
);

describe('Android printer native source boundary', () => {
  it('dispatches connect, write, and close work to the Android IO thread', () => {
    expect(source.match(/getDispatcher\(['"]io['"]\)\.async/gu)).toHaveLength(
      3,
    );
  });

  it('uses a write deadline and counts only completed byte writes', () => {
    expect(source).not.toContain('setSoTimeout');
    expect(source).toContain('scheduleWriteTimeout');
    expect(source).toContain('cancelWriteTimeout');
    expect(source).toContain('output.write(bytes, bytesWritten, 1)');
    expect(source).not.toContain('const chunkSize = 4096');
  });

  it('validates native inputs and closes a failed connection', () => {
    expect(source).toContain("encoding != 'GB18030' && encoding != 'GBK'");
    expect(source).toMatch(/port < 1\s*\|\|\s*port > 65535/u);
    expect(source).toMatch(/connectTimeoutMs < 1\s*\|\|\s*writeTimeoutMs < 1/u);
    expect(source).toContain('socket.close()');
  });
});
