import { describe, expect, it } from 'vitest';
import { enumeratePeriods, periodOrdinal, ordinalLabel, periodStart } from '../../src/core/period';

describe('UTC periods', () => {
  it('buckets the last second of a year and the first second of the next into different quarters', () => {
    const a = Date.UTC(2019, 11, 31, 23, 59, 59);
    const b = Date.UTC(2020, 0, 1, 0, 0, 0);
    expect(ordinalLabel(periodOrdinal(a, 'quarter'), 'quarter')).toBe('2019 Q4');
    expect(ordinalLabel(periodOrdinal(b, 'quarter'), 'quarter')).toBe('2020 Q1');
    expect(ordinalLabel(periodOrdinal(a, 'month'), 'month')).toBe('Dec 2019');
    expect(ordinalLabel(periodOrdinal(b, 'year'), 'year')).toBe('2020');
  });

  it('is independent of the process timezone', () => {
    // Date.UTC-based math; this would fail under local-time bucketing in e.g. America/Los_Angeles.
    expect(periodStart(Date.parse('2021-04-01T00:30:00Z'), 'quarter')).toBe(Date.UTC(2021, 3, 1));
    expect(periodStart(Date.parse('2021-03-31T23:30:00Z'), 'quarter')).toBe(Date.UTC(2021, 0, 1));
  });

  it('enumerates contiguous periods, including ones with no data', () => {
    const ps = enumeratePeriods(Date.UTC(2019, 1, 10), Date.UTC(2020, 6, 2), 'quarter');
    expect(ps.map((p) => p.label)).toEqual(['2019 Q1', '2019 Q2', '2019 Q3', '2019 Q4', '2020 Q1', '2020 Q2', '2020 Q3']);
    for (let i = 1; i < ps.length; i++) expect(ps[i].start).toBe(ps[i - 1].end);
    expect(enumeratePeriods(Date.UTC(2019, 0, 1), Date.UTC(2019, 11, 31), 'month')).toHaveLength(12);
  });
});
