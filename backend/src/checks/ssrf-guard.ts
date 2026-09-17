import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';

/**
 * Guards every outbound check WebEdge makes on a customer-supplied hostname —
 * TLS inspection, DNS propagation, uptime, webhook tests.
 *
 * Without this, those checks are a server-side request forgery primitive: a
 * customer supplies `169.254.169.254` or an internal hostname, and WebEdge
 * obligingly connects from inside the network and reports what it found.
 *
 * Two parts, and both are needed:
 *
 *  1. Classify the resolved address and refuse anything not publicly routable.
 *  2. Return that address so the caller connects to *it* rather than resolving
 *     the name a second time. Re-resolving is the DNS rebinding hole: the first
 *     lookup returns a public address and passes the check, the second returns
 *     127.0.0.1 and the connection goes somewhere else entirely.
 */

export type GuardResult =
  | { ok: true; address: string; family: 4 | 6 }
  | { ok: false; reason: string };

/**
 * IPv4 ranges that are never a legitimate target for an outbound check.
 * Each is [firstOctetMatch, predicate] over the parsed octets.
 */
function isPrivateIPv4(address: string): boolean {
  const parts = address.split('.').map(Number);
  const [a = 0, b = 0] = parts;

  if (a === 0) return true; // 0.0.0.0/8, "this network"
  if (a === 10) return true; // private
  if (a === 127) return true; // loopback
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 carrier-grade NAT
  if (a === 169 && b === 254) return true; // link-local, and the cloud metadata address
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 0) return true; // 192.0.0/24 protocol assignments, 192.0.2/24 TEST-NET-1
  if (a === 192 && b === 168) return true; // private
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a === 198 && b === 51) return true; // TEST-NET-2
  if (a === 203 && b === 0) return true; // TEST-NET-3
  if (a >= 224) return true; // multicast, reserved, broadcast

  return false;
}

function isPrivateIPv6(address: string): boolean {
  const lower = address.toLowerCase().split('%')[0] ?? '';

  if (lower === '::' || lower === '::1') return true; // unspecified, loopback
  if (lower.startsWith('fe80')) return true; // link-local
  if (/^f[cd]/.test(lower)) return true; // fc00::/7 unique local

  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible forms must be classified by
  // their embedded IPv4 address, or every IPv4 rule above is trivially bypassed.
  const embedded = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(lower);
  if (embedded?.[1]) return isPrivateIPv4(embedded[1]);

  // NAT64 well-known prefix, which can reach IPv4 private space.
  if (lower.startsWith('64:ff9b')) return true;

  return false;
}

/** True when the literal address is not publicly routable. */
export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isPrivateIPv4(address);
  if (family === 6) return isPrivateIPv6(address);
  // Not an IP address at all: refuse rather than guess.
  return true;
}

/** Hostnames that must never be resolved, regardless of what DNS says. */
function isBlockedHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase().replace(/\.$/, '');

  if (lower === 'localhost' || lower.endsWith('.localhost')) return true;
  // RFC 6761/8375 special-use names, plus the usual internal suffixes.
  if (/\.(local|internal|localdomain|home|lan|intranet|corp|private)$/.test(lower)) return true;
  // Cloud metadata services by name.
  if (lower === 'metadata.google.internal' || lower === 'metadata') return true;

  return false;
}

/**
 * Resolves a hostname and confirms it is safe to connect to.
 *
 * The returned address is what the caller must connect to. Passing the hostname
 * on to a socket instead re-resolves it and reopens the rebinding hole this
 * function exists to close.
 */
export async function resolvePublicAddress(hostname: string): Promise<GuardResult> {
  const trimmed = hostname.trim();

  if (trimmed.length === 0 || trimmed.length > 253) {
    return { ok: false, reason: 'That hostname is not valid.' };
  }
  if (isBlockedHostname(trimmed)) {
    return { ok: false, reason: 'That hostname cannot be checked.' };
  }

  // A literal IP needs no lookup, but still needs classifying.
  const literal = isIP(trimmed);
  if (literal !== 0) {
    if (isBlockedAddress(trimmed)) {
      return { ok: false, reason: 'That address cannot be checked.' };
    }
    return { ok: true, address: trimmed, family: literal === 4 ? 4 : 6 };
  }

  let resolved: Array<{ address: string; family: number }>;
  try {
    // `all` matters: a name with both a public and a private address must be
    // refused, not silently connected to whichever the resolver returned first.
    resolved = await lookup(trimmed, { all: true });
  } catch {
    return { ok: false, reason: "That hostname couldn't be resolved." };
  }

  if (resolved.length === 0) {
    return { ok: false, reason: "That hostname couldn't be resolved." };
  }

  const blocked = resolved.find((entry) => isBlockedAddress(entry.address));
  if (blocked) {
    return { ok: false, reason: 'That hostname resolves to an address that cannot be checked.' };
  }

  const first = resolved[0]!;
  return { ok: true, address: first.address, family: first.family === 4 ? 4 : 6 };
}
