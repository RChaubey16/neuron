import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { BlockList, isIP, type LookupFunction } from 'node:net';

/** Thrown when a webhook URL points (or resolves) somewhere Neuron must never send a request. */
export class BlockedTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BlockedTargetError';
  }
}

// Every range a server-side request must not reach: loopback, RFC 1918
// private, CGNAT, link-local (incl. cloud metadata at 169.254.169.254),
// "this network", benchmarking, multicast and reserved space.
const blockList = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  blockList.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  // No ::ffff:0:0/96 rule: BlockList already checks an IPv4-mapped address
  // (::ffff:10.0.0.1) against the IPv4 rules above, and treats an IPv4
  // address as mapped — so that rule would block every IPv4 address.
  // NAT64 (64:ff9b::a00:1) gets no such unwrapping, so block it wholesale.
  ['64:ff9b::', 96],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  blockList.addSubnet(network, prefix, 'ipv6');
}

/** Whether an IP address falls in a private, loopback, link-local or otherwise non-public range. Anything that isn't a valid IP counts as blocked. */
export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) {
    return true;
  }
  return blockList.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

/**
 * Checks a webhook URL's scheme and host without any network access.
 * This alone can't stop a public hostname that resolves to a private
 * address — `guardedLookup` covers that at connect time — but it's the
 * only check a literal IP gets, since Node skips `lookup` for one.
 *
 * @param rawUrl - The endpoint URL to check
 * @param allowPrivateTargets - Local-dev escape hatch
 *   (`WEBHOOKS_ALLOW_PRIVATE_TARGETS`): allows `http` and private hosts
 * @returns A reason the URL is rejected, or null if it's allowed
 */
export function checkTargetUrl(
  rawUrl: string,
  allowPrivateTargets: boolean,
): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return 'URL is not valid';
  }

  const allowedProtocols = allowPrivateTargets
    ? ['https:', 'http:']
    : ['https:'];
  if (!allowedProtocols.includes(url.protocol)) {
    return 'URL must use https';
  }
  if (url.username || url.password) {
    return 'URL must not contain credentials';
  }
  if (allowPrivateTargets) {
    return null;
  }

  // WHATWG URL keeps the brackets around an IPv6 literal's hostname.
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost')) {
    return 'URL must not point to localhost';
  }
  if (isIP(host) !== 0 && isBlockedAddress(host)) {
    return 'URL must not point to a private or reserved address';
  }
  return null;
}

/**
 * A drop-in `lookup` for `http(s).request` that resolves the hostname and
 * refuses to connect if any resolved address is blocked. Validating the
 * address the socket actually connects to — rather than a separate
 * pre-flight lookup — is what closes the DNS-rebinding gap, where a
 * hostname resolves to a public IP for the check and a private one for
 * the request.
 */
export const guardedLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(
    hostname,
    { ...options, all: true },
    (error: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => {
      if (error) {
        callback(error, '', 0);
        return;
      }
      const blocked = addresses.find(({ address }) =>
        isBlockedAddress(address),
      );
      if (blocked || addresses.length === 0) {
        callback(
          new BlockedTargetError(
            `${hostname} resolves to a private or reserved address`,
          ),
          '',
          0,
        );
        return;
      }
      if (options.all) {
        callback(null, addresses);
      } else {
        callback(null, addresses[0].address, addresses[0].family);
      }
    },
  );
};
