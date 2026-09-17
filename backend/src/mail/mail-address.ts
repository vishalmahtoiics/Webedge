/**
 * Email address rules for a maildir-backed mail server.
 *
 * Deliberately narrower than RFC 5321 allows. The RFC permits quoted local
 * parts (`"a b"@example.com`), escapes, and characters like `/` and `..`, and
 * every one of those is a problem when the local part becomes part of a path on
 * disk: `"../../etc"@example.com` is a legal address and a directory traversal.
 * Dovecot and Postfix can be configured to handle them, but the safe move is to
 * refuse to create such an address in the first place — nobody has ever needed
 * one, and accepting it means every downstream component has to be right.
 *
 * What is accepted is the set every mail provider accepts: letters, digits, and
 * `. _ + -`, not leading or trailing a dot, with no consecutive dots.
 */

/** RFC 5321 §4.5.3.1 — the limits that actually bind. */
export const MAX_LOCAL_PART = 64;
export const MAX_DOMAIN = 255;
export const MAX_ADDRESS = 254;

/**
 * `+` is allowed because sub-addressing is genuinely useful, and Postfix strips
 * it at delivery. It is rejected in *stored* local parts (see `isValidLocalPart`
 * with `forStorage`), because `sales+tag@` as a mailbox name would shadow every
 * tagged address delivered to `sales@`.
 */
const LOCAL_PART = /^[a-z0-9]([a-z0-9._+-]*[a-z0-9])?$/;
const LOCAL_PART_STORED = /^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$/;

/** A domain label: no leading or trailing hyphen, 63 characters at most. */
const DOMAIN_LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

export type AddressParts = { localPart: string; domain: string };

/**
 * Normalises for storage and comparison.
 *
 * The domain is lowercased unconditionally — domains are case-insensitive. The
 * local part is lowercased too, which the RFC does not require: it says case
 * *may* be significant. In practice no mail system treats it as significant, and
 * preserving case here would let `Asha@` and `asha@` exist as two mailboxes,
 * which either splits one person's mail across two places or delivers it to the
 * wrong one. Two people receiving each other's mail is worse than a pedantic
 * reading of the RFC.
 */
export function normaliseAddress(address: string): string {
  return address.trim().toLowerCase();
}

export function isValidDomain(domain: string): boolean {
  const value = domain.trim().toLowerCase();
  if (value.length === 0 || value.length > MAX_DOMAIN) return false;
  // A trailing dot is valid in DNS but not in an address, and an address with
  // one would not match the domain it was stored against.
  if (value.endsWith('.') || value.startsWith('.')) return false;

  const labels = value.split('.');
  // A mail domain needs at least two labels: `localhost` is not deliverable
  // from outside, and accepting it invites a misconfiguration nobody notices.
  if (labels.length < 2) return false;

  return labels.every((label) => DOMAIN_LABEL.test(label));
}

export function isValidLocalPart(localPart: string, options: { forStorage?: boolean } = {}): boolean {
  const value = localPart.trim().toLowerCase();
  if (value.length === 0 || value.length > MAX_LOCAL_PART) return false;

  // Consecutive dots are invalid unquoted, and `..` is the traversal sequence
  // this whole module exists to keep off the disk.
  if (value.includes('..')) return false;

  return (options.forStorage ? LOCAL_PART_STORED : LOCAL_PART).test(value);
}

/**
 * Splits an address, or returns null if it is not one WebEdge will accept.
 *
 * Splits on the *last* `@`, because that is the one separating local part from
 * domain — an unquoted local part cannot contain `@`, so more than one means the
 * address is malformed and is rejected below by the local-part rule.
 */
export function parseAddress(
  address: string,
  options: { forStorage?: boolean } = {},
): AddressParts | null {
  const value = normaliseAddress(address);
  if (value.length === 0 || value.length > MAX_ADDRESS) return null;

  const at = value.lastIndexOf('@');
  if (at <= 0 || at === value.length - 1) return null;

  const localPart = value.slice(0, at);
  const domain = value.slice(at + 1);

  if (!isValidLocalPart(localPart, options)) return null;
  if (!isValidDomain(domain)) return null;

  return { localPart, domain };
}

export function isValidAddress(address: string, options: { forStorage?: boolean } = {}): boolean {
  return parseAddress(address, options) !== null;
}

/**
 * Local parts that must not be handed to a customer.
 *
 * `postmaster` and `abuse` are required to reach a human who can act on reports
 * (RFC 5321 §4.5.1, RFC 2142), and the addresses used to prove domain control to
 * a certificate authority must not be claimable by whoever gets there first —
 * otherwise a customer on a shared domain can issue certificates for it.
 */
const RESERVED_LOCAL_PARTS = new Set([
  'postmaster',
  'abuse',
  'hostmaster',
  'webmaster',
  'admin',
  'administrator',
  'ssl-admin',
  'ssladmin',
  'ssladministrator',
  'ssladministrator',
  'root',
  'mailer-daemon',
  'noreply',
  'no-reply',
]);

export function isReservedLocalPart(localPart: string): boolean {
  return RESERVED_LOCAL_PARTS.has(localPart.trim().toLowerCase());
}

/** The catch-all marker: valid as an alias name, never as an address. */
export const CATCH_ALL = '*';
