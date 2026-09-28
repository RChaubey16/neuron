import * as dns from 'node:dns';
import {
  BlockedTargetError,
  checkTargetUrl,
  guardedLookup,
  isBlockedAddress,
} from './target-guard';

jest.mock('node:dns', () => ({ lookup: jest.fn() }));

describe('webhook target guard', () => {
  describe('isBlockedAddress', () => {
    it.each([
      '127.0.0.1',
      '10.1.2.3',
      '172.20.0.5',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '::1',
      '::',
      '::ffff:127.0.0.1',
      '::ffff:7f00:1',
      'fd00::1',
      'fe80::1',
      '64:ff9b::a00:1',
      'not-an-ip',
    ])('blocks %s', (address) => {
      expect(isBlockedAddress(address)).toBe(true);
    });

    it.each(['93.184.216.34', '8.8.8.8', '2606:4700:4700::1111'])(
      'allows public address %s',
      (address) => {
        expect(isBlockedAddress(address)).toBe(false);
      },
    );
  });

  describe('checkTargetUrl', () => {
    it('allows a public https URL', () => {
      expect(checkTargetUrl('https://example.com/hooks', false)).toBeNull();
    });

    it.each([
      ['http://example.com/hooks', 'URL must use https'],
      ['ftp://example.com', 'URL must use https'],
      ['https://user:pass@example.com', 'URL must not contain credentials'],
      ['https://localhost:3000/hooks', 'URL must not point to localhost'],
      ['https://api.localhost/hooks', 'URL must not point to localhost'],
      [
        'https://127.0.0.1/hooks',
        'URL must not point to a private or reserved address',
      ],
      [
        'https://[::ffff:127.0.0.1]/hooks',
        'URL must not point to a private or reserved address',
      ],
      ['not a url', 'URL is not valid'],
    ])('rejects %s', (url, reason) => {
      expect(checkTargetUrl(url, false)).toBe(reason);
    });

    it('allows http and private hosts when private targets are allowed', () => {
      expect(checkTargetUrl('http://localhost:4000/hooks', true)).toBeNull();
      expect(checkTargetUrl('http://192.168.1.10/hooks', true)).toBeNull();
    });
  });

  describe('guardedLookup', () => {
    const lookupMock = dns.lookup as unknown as jest.Mock;

    function resolveTo(addresses: { address: string; family: number }[]) {
      lookupMock.mockImplementation(
        (_host: string, _opts: unknown, cb: (...args: unknown[]) => void) =>
          cb(null, addresses),
      );
    }

    it('passes through a public address', (done) => {
      resolveTo([{ address: '93.184.216.34', family: 4 }]);
      guardedLookup('example.com', {}, (error, address, family) => {
        expect(error).toBeNull();
        expect(address).toBe('93.184.216.34');
        expect(family).toBe(4);
        done();
      });
    });

    it('returns every address when the caller asks for all of them', (done) => {
      const addresses = [
        { address: '93.184.216.34', family: 4 },
        { address: '2606:2800:220:1::1', family: 6 },
      ];
      resolveTo(addresses);
      guardedLookup('example.com', { all: true }, (error, result) => {
        expect(error).toBeNull();
        expect(result).toEqual(addresses);
        done();
      });
    });

    it('rejects when any resolved address is private (DNS rebinding)', (done) => {
      resolveTo([
        { address: '93.184.216.34', family: 4 },
        { address: '10.0.0.5', family: 4 },
      ]);
      guardedLookup('rebind.example', {}, (error) => {
        expect(error).toBeInstanceOf(BlockedTargetError);
        done();
      });
    });
  });
});
