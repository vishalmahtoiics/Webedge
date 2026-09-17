import { describe, expect, it } from 'vitest';
import { isBlockedAddress, resolvePublicAddress } from './ssrf-guard';

const blocked = (address: string) =>
  expect(isBlockedAddress(address), `${address} must be blocked`).toBe(true);
const allowed = (address: string) =>
  expect(isBlockedAddress(address), `${address} must be allowed`).toBe(false);

describe('IPv4 classification', () => {
  it('allows ordinary public addresses', () => {
    allowed('1.1.1.1');
    allowed('8.8.8.8');
    allowed('142.250.196.110');
    allowed('99.99.99.99');
  });

  it('blocks loopback', () => {
    blocked('127.0.0.1');
    blocked('127.255.255.254');
  });

  it('blocks RFC 1918 private ranges', () => {
    blocked('10.0.0.1');
    blocked('172.16.0.1');
    blocked('172.31.255.255');
    blocked('192.168.1.1');
  });

  /** 172.15 and 172.32 are public; only 172.16–172.31 is private. */
  it('gets the 172.16/12 boundaries right', () => {
    allowed('172.15.255.255');
    allowed('172.32.0.1');
  });

  /**
   * The cloud metadata address. Reachable from inside most cloud instances and
   * serving credentials to anything that asks, which makes it the single most
   * valuable SSRF target.
   */
  it('blocks link-local and cloud metadata', () => {
    blocked('169.254.169.254');
    blocked('169.254.0.1');
  });

  it('blocks carrier-grade NAT', () => {
    blocked('100.64.0.1');
    blocked('100.127.255.255');
  });

  it('gets the CGNAT boundaries right', () => {
    allowed('100.63.255.255');
    allowed('100.128.0.1');
  });

  it('blocks this-network, multicast and broadcast', () => {
    blocked('0.0.0.0');
    blocked('224.0.0.1');
    blocked('239.255.255.255');
    blocked('255.255.255.255');
  });

  it('blocks documentation and benchmarking ranges', () => {
    blocked('192.0.2.1');
    blocked('198.51.100.1');
    blocked('203.0.113.1');
    blocked('198.18.0.1');
  });
});

describe('IPv6 classification', () => {
  it('allows public addresses', () => {
    allowed('2606:4700:4700::1111');
    allowed('2001:4860:4860::8888');
  });

  it('blocks loopback and unspecified', () => {
    blocked('::1');
    blocked('::');
  });

  it('blocks link-local and unique-local', () => {
    blocked('fe80::1');
    blocked('fc00::1');
    blocked('fd12:3456::1');
  });

  /**
   * Without classifying the embedded IPv4 address, ::ffff:127.0.0.1 bypasses
   * every IPv4 rule while still connecting to loopback.
   */
  it('blocks IPv4-mapped addresses by their embedded IPv4', () => {
    blocked('::ffff:127.0.0.1');
    blocked('::ffff:169.254.169.254');
    blocked('::ffff:10.0.0.1');
    blocked('::ffff:192.168.1.1');
  });

  it('allows an IPv4-mapped public address', () => {
    allowed('::ffff:8.8.8.8');
  });

  it('blocks the NAT64 well-known prefix', () => {
    blocked('64:ff9b::1');
  });

  it('ignores a zone index when classifying', () => {
    blocked('fe80::1%eth0');
  });
});

describe('non-addresses', () => {
  it('refuses anything that is not an IP rather than guessing', () => {
    blocked('not-an-ip');
    blocked('');
    blocked('1.1.1');
    blocked('999.1.1.1');
  });
});

describe('resolvePublicAddress', () => {
  it('rejects special-use hostnames without resolving them', async () => {
    for (const host of [
      'localhost',
      'app.localhost',
      'db.internal',
      'printer.local',
      'metadata.google.internal',
    ]) {
      const result = await resolvePublicAddress(host);
      expect(result.ok, `${host} must be refused`).toBe(false);
    }
  });

  it('rejects a literal private address', async () => {
    for (const address of ['127.0.0.1', '10.0.0.5', '169.254.169.254', '::1']) {
      const result = await resolvePublicAddress(address);
      expect(result.ok, `${address} must be refused`).toBe(false);
    }
  });

  it('accepts a literal public address without a lookup', async () => {
    const result = await resolvePublicAddress('1.1.1.1');
    expect(result).toEqual({ ok: true, address: '1.1.1.1', family: 4 });
  });

  it('rejects empty and overlong hostnames', async () => {
    expect((await resolvePublicAddress('')).ok).toBe(false);
    expect((await resolvePublicAddress(`${'a'.repeat(300)}.com`)).ok).toBe(false);
  });

  /**
   * The returned address is what the caller must connect to. Handing the
   * hostname to a socket instead re-resolves it, and a name that answered
   * publicly on the first lookup can answer 127.0.0.1 on the second — which is
   * exactly the rebinding attack this guard exists to stop.
   */
  it('returns an address to pin the connection to', async () => {
    const result = await resolvePublicAddress('1.1.1.1');
    expect(result.ok && result.address).toBe('1.1.1.1');
  });
});
