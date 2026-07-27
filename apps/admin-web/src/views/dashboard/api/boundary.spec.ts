import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

describe('dashboard api boundary', () => {
  it('stays a static navigation surface without remote statistics requests', () => {
    const sources = [
      'src/views/DashboardView.vue',
      'src/views/dashboard/hooks/useDashboardNavigation.ts',
    ].map((path) => readFileSync(`${process.cwd()}/${path}`, 'utf8'));

    expect(sources.join('\n')).not.toMatch(
      /apiClient|fetch\(|useAdminStatsStore/,
    );
  });
});
