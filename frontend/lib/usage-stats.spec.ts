import { describe, expect, it } from 'vitest';
import type { ApiKey, UsageSummary } from './api';
import {
  activeKeyCounts,
  callsOnDate,
  dailyTotalsByService,
  filterByRange,
  mostUsedService,
  totalCalls,
} from './usage-stats';

function row(overrides: Partial<UsageSummary>): UsageSummary {
  return {
    service: 'url-shortener',
    date: '2026-09-01',
    apiKeyId: 'key-1',
    count: 1,
    ...overrides,
  };
}

describe('filterByRange', () => {
  it('keeps only rows within the last N days, inclusive of today', () => {
    const today = new Date('2026-09-10T00:00:00.000Z');
    const rows = [
      row({ date: '2026-09-10' }),
      row({ date: '2026-09-04' }),
      row({ date: '2026-09-03' }),
    ];

    expect(filterByRange(rows, 7, today).map((r) => r.date)).toEqual([
      '2026-09-10',
      '2026-09-04',
    ]);
  });
});

describe('totalCalls / callsOnDate', () => {
  it('sums counts across rows', () => {
    const rows = [row({ count: 3 }), row({ count: 5 })];
    expect(totalCalls(rows)).toBe(8);
  });

  it('sums only rows matching the given date', () => {
    const rows = [
      row({ date: '2026-09-01', count: 3 }),
      row({ date: '2026-09-02', count: 5 }),
    ];
    expect(callsOnDate(rows, '2026-09-01')).toBe(3);
  });
});

describe('mostUsedService', () => {
  it('returns null for no rows', () => {
    expect(mostUsedService([])).toBeNull();
  });

  it('picks the service with the highest total and its share', () => {
    const rows = [
      row({ service: 'url-shortener', count: 3 }),
      row({ service: 'notifications', count: 1 }),
    ];
    expect(mostUsedService(rows)).toEqual({
      service: 'url-shortener',
      share: 0.75,
    });
  });
});

describe('activeKeyCounts', () => {
  function key(overrides: Partial<ApiKey>): ApiKey {
    return {
      id: 'k1',
      keyPrefix: 'nrn_ab',
      name: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      lastUsedAt: null,
      revokedAt: null,
      ...overrides,
    };
  }

  it('splits keys into active and revoked counts', () => {
    const keys = [
      key({ id: 'k1' }),
      key({ id: 'k2', revokedAt: '2026-02-01T00:00:00.000Z' }),
      key({ id: 'k3' }),
    ];
    expect(activeKeyCounts(keys)).toEqual({ active: 2, revoked: 1 });
  });
});

describe('dailyTotalsByService', () => {
  it('groups by date and sums per service across keys, sorted ascending', () => {
    const rows = [
      row({ date: '2026-09-02', service: 'url-shortener', apiKeyId: 'a', count: 2 }),
      row({ date: '2026-09-01', service: 'url-shortener', apiKeyId: 'a', count: 3 }),
      row({ date: '2026-09-01', service: 'url-shortener', apiKeyId: 'b', count: 1 }),
      row({ date: '2026-09-01', service: 'notifications', apiKeyId: 'a', count: 5 }),
    ];

    expect(dailyTotalsByService(rows)).toEqual([
      { date: '2026-09-01', totals: { 'url-shortener': 4, notifications: 5 } },
      { date: '2026-09-02', totals: { 'url-shortener': 2 } },
    ]);
  });
});
