import { parseList } from './configuration.js';

describe('parseList', () => {
  it('splits, trims and drops empty items', () => {
    expect(parseList(' http://a.test, ,http://b.test ')).toEqual([
      'http://a.test',
      'http://b.test',
    ]);
  });

  it('returns an empty list for undefined or empty input', () => {
    expect(parseList(undefined)).toEqual([]);
    expect(parseList('')).toEqual([]);
  });
});
