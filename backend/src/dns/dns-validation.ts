/**
 * DNS record validation — pure functions, no framework or database.
 *
 * These are the rules that stop a customer breaking their own zone. Most of them
 * are not obvious, and a provider will often accept a bad record and simply fail
 * to resolve it, so validating here gives a clear error instead of a website
 * that mysteriously stops working.
 *
 * Validation runs before the provider's own validate call, not instead of it:
 * this catches the common mistakes with a useful message, and the provider
 * remains the authority on what it will accept.
 */

export type DnsRecordType = 'A' | 'AAAA' | 'CNAME' | 'MX' | 'TXT' | 'SRV' | 'NS' | 'CAA';

export type DnsRecordInput = {
  type: DnsRecordType;
  /** '@' for the zone apex, otherwise a relative label such as 'www'. */
  name: string;
  value: string;
  ttl: number;
  /** MX and SRV only. */
  priority?: number | null;
  /** SRV only. */
  weight?: number | null;
  port?: number | null;
};

export type ValidationIssue = { field: string; message: string };

export const TTL_PRESETS = [
  { label: 'Auto', value: 14400 },
  { label: '5 minutes', value: 300 },
  { label: '1 hour', value: 3600 },
  { label: '4 hours', value: 14400 },
  { label: '1 day', value: 86400 },
] as const;

const MIN_TTL = 60;
const MAX_TTL = 604800; // one week
const MAX_TXT_LENGTH = 4096;

/** A single label: 1–63 chars, alphanumeric and hyphens, not starting or ending with one. */
const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/i;

/**
 * Record names may also use underscore-prefixed labels, which hostnames may not.
 * These are not decorative: RFC 2782 requires `_service._proto` for SRV, and
 * DMARC and DKIM are published at `_dmarc` and `_domainkey`. Applying the
 * hostname rule to names would reject all three.
 */
const NAME_LABEL = /^_?(?!-)[a-z0-9-]{1,63}(?<!-)$/i;

function isValidIPv4(value: string): boolean {
  const parts = value.split('.');
  if (parts.length !== 4) return false;

  return parts.every((part) => {
    // Reject leading zeros: "01" is ambiguous and some resolvers read it as octal.
    if (!/^\d{1,3}$/.test(part)) return false;
    if (part.length > 1 && part.startsWith('0')) return false;
    const n = Number(part);
    return n >= 0 && n <= 255;
  });
}

function isValidIPv6(value: string): boolean {
  if (!/^[0-9a-f:.]+$/i.test(value)) return false;

  // Exactly one '::' may appear, as the zero-run shorthand.
  const doubleColons = value.split('::').length - 1;
  if (doubleColons > 1) return false;

  const hasEmbeddedIPv4 = value.includes('.');
  const [head = '', tail = ''] = doubleColons === 1 ? value.split('::') : [value, ''];

  const headGroups = head === '' ? [] : head.split(':');
  const tailGroups = tail === '' ? [] : tail.split(':');
  const groups = [...headGroups, ...tailGroups];

  if (hasEmbeddedIPv4) {
    const last = groups.pop();
    if (!last || !isValidIPv4(last)) return false;
    // An embedded IPv4 occupies two groups.
    groups.push('0', '0');
  }

  if (groups.some((g) => !/^[0-9a-f]{1,4}$/i.test(g))) return false;

  return doubleColons === 1 ? groups.length < 8 : groups.length === 8;
}

/** Accepts '@' for the apex, plus relative and absolute hostnames. */
function isValidHostname(value: string, { allowApex = false } = {}): boolean {
  if (allowApex && value === '@') return true;
  if (value.length === 0 || value.length > 253) return false;

  const withoutRoot = value.endsWith('.') ? value.slice(0, -1) : value;
  if (withoutRoot.length === 0) return false;

  return withoutRoot.split('.').every((label) => {
    // A wildcard is legal as the leftmost label only, but that is checked by the
    // caller; here any '*' label is accepted structurally.
    if (label === '*') return true;
    return LABEL.test(label);
  });
}

function isValidRecordName(name: string): boolean {
  if (name === '@' || name === '*') return true;

  const body = name.startsWith('*.') ? name.slice(2) : name;
  if (body.length === 0 || body.length > 253) return false;

  return body.split('.').every((label) => NAME_LABEL.test(label));
}

export function validateRecord(input: DnsRecordInput): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const value = input.value.trim();

  if (!isValidRecordName(input.name)) {
    issues.push({ field: 'name', message: 'Enter a valid record name, or @ for the domain itself.' });
  }

  if (!Number.isInteger(input.ttl) || input.ttl < MIN_TTL || input.ttl > MAX_TTL) {
    issues.push({
      field: 'ttl',
      message: `TTL must be a whole number between ${MIN_TTL} and ${MAX_TTL} seconds.`,
    });
  }

  switch (input.type) {
    case 'A':
      if (!isValidIPv4(value)) {
        issues.push({ field: 'value', message: 'Enter a valid IPv4 address, such as 203.0.113.10.' });
      }
      break;

    case 'AAAA':
      if (!isValidIPv6(value)) {
        issues.push({ field: 'value', message: 'Enter a valid IPv6 address, such as 2001:db8::1.' });
      }
      break;

    case 'CNAME':
      if (!isValidHostname(value)) {
        issues.push({ field: 'value', message: 'Enter the hostname this record should point to.' });
      }
      // A CNAME at the apex is forbidden by RFC 1034: the apex must carry SOA
      // and NS records, and a CNAME cannot coexist with any other record.
      if (input.name === '@') {
        issues.push({
          field: 'name',
          message:
            'A CNAME cannot be used on the domain itself. Use an A or AAAA record at the root instead.',
        });
      }
      break;

    case 'MX':
      // Checked before the generic hostname rule: pasting "10 mail.example.com"
      // from another panel is common, and "enter a valid hostname" does not tell
      // the customer what is actually wrong.
      if (/^\d+\s+\S/.test(value)) {
        issues.push({
          field: 'value',
          message: 'Enter only the hostname here; set the priority in its own field.',
        });
      } else if (!isValidHostname(value)) {
        issues.push({ field: 'value', message: 'Enter the mail server hostname.' });
      }
      if (input.priority === null || input.priority === undefined) {
        issues.push({ field: 'priority', message: 'Enter a priority. Lower numbers are tried first.' });
      } else if (!Number.isInteger(input.priority) || input.priority < 0 || input.priority > 65535) {
        issues.push({ field: 'priority', message: 'Priority must be between 0 and 65535.' });
      }
      break;

    case 'TXT':
      if (value.length === 0) {
        issues.push({ field: 'value', message: 'Enter the text value.' });
      } else if (value.length > MAX_TXT_LENGTH) {
        issues.push({ field: 'value', message: `TXT values must be ${MAX_TXT_LENGTH} characters or fewer.` });
      }
      break;

    case 'NS':
      if (!isValidHostname(value)) {
        issues.push({ field: 'value', message: 'Enter a valid nameserver hostname.' });
      }
      // Apex NS records define the zone's own delegation. Editing them through
      // the record UI is how a customer accidentally takes their domain offline.
      if (input.name === '@') {
        issues.push({
          field: 'name',
          message:
            'Nameservers for the domain itself are changed under Nameservers, not here. NS records here delegate a subdomain.',
        });
      }
      break;

    case 'SRV': {
      // _service._protocol.name
      if (!/^_[a-z0-9-]+\._(tcp|udp|tls)(\.|$)/i.test(input.name)) {
        issues.push({
          field: 'name',
          message: 'SRV names look like _service._tcp, for example _sip._tls.',
        });
      }
      if (!isValidHostname(value)) {
        issues.push({ field: 'value', message: 'Enter the target hostname.' });
      }
      for (const [field, n, max] of [
        ['priority', input.priority, 65535],
        ['weight', input.weight, 65535],
        ['port', input.port, 65535],
      ] as const) {
        if (n === null || n === undefined) {
          issues.push({ field, message: `Enter a ${field}.` });
        } else if (!Number.isInteger(n) || n < 0 || n > max) {
          issues.push({ field, message: `${field} must be between 0 and ${max}.` });
        }
      }
      if (input.port === 0) {
        issues.push({ field: 'port', message: 'Port 0 disables the service. Use a real port number.' });
      }
      break;
    }

    case 'CAA': {
      // flags tag "value" — controls which authorities may issue certificates.
      const match = /^(\d{1,3})\s+(issue|issuewild|iodef)\s+"?([^"]*)"?$/i.exec(value);
      if (!match) {
        issues.push({
          field: 'value',
          message: 'CAA values look like: 0 issue "letsencrypt.org".',
        });
      } else {
        const flags = Number(match[1]);
        if (flags !== 0 && flags !== 128) {
          issues.push({ field: 'value', message: 'CAA flags must be 0 or 128.' });
        }
        if ((match[3] ?? '').trim().length === 0) {
          issues.push({ field: 'value', message: 'Enter the certificate authority, or ; to allow none.' });
        }
      }
      break;
    }
  }

  return issues;
}

/**
 * Zone-level rules, which depend on the records already present.
 *
 * `existing` should exclude the record being edited, so updating a record does
 * not report a conflict with itself.
 */
export function validateAgainstZone(
  input: DnsRecordInput,
  existing: DnsRecordInput[],
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const sameName = existing.filter((r) => r.name.toLowerCase() === input.name.toLowerCase());

  // A CNAME cannot coexist with any other record of the same name (RFC 1034
  // §3.6.2). This is the single most common way a zone breaks: adding a TXT for
  // domain verification onto a name that already has a CNAME silently breaks
  // both.
  if (input.type === 'CNAME' && sameName.length > 0) {
    issues.push({
      field: 'name',
      message: `${input.name} already has other records. A CNAME cannot share a name with them.`,
    });
  }

  if (input.type !== 'CNAME' && sameName.some((r) => r.type === 'CNAME')) {
    issues.push({
      field: 'name',
      message: `${input.name} is a CNAME, which cannot share a name with other records.`,
    });
  }

  // Some TXT records must be unique even when their values differ, because the
  // consuming spec treats "more than one" as a hard failure rather than picking
  // one. Both of these fail *open* at the provider — it accepts the second
  // record happily, and the customer's mail policy silently stops working.
  if (input.type === 'TXT') {
    const value = input.value.trim().toLowerCase();

    // RFC 7489 §6.6.3: a domain publishes exactly one DMARC record. Two means
    // no usable policy at all, not the stricter of the two.
    if (input.name.toLowerCase() === '_dmarc' && value.startsWith('v=dmarc1')) {
      const existingDmarc = sameName.some(
        (r) => r.type === 'TXT' && r.value.trim().toLowerCase().startsWith('v=dmarc1'),
      );
      if (existingDmarc) {
        issues.push({
          field: 'value',
          message:
            'This domain already has a DMARC record. Edit the existing one — two DMARC records mean no policy is applied at all.',
        });
      }
    }

    // RFC 7208 §3.2: more than one SPF record is a permerror, so mail that would
    // have passed starts failing.
    if (value.startsWith('v=spf1')) {
      const existingSpf = sameName.some(
        (r) => r.type === 'TXT' && r.value.trim().toLowerCase().startsWith('v=spf1'),
      );
      if (existingSpf) {
        issues.push({
          field: 'value',
          message:
            'This name already has an SPF record. Combine the entries into one — two SPF records make every check fail.',
        });
      }
    }
  }

  // An exact duplicate is a no-op at best and confusing at worst.
  const duplicate = sameName.some(
    (r) =>
      r.type === input.type &&
      r.value.trim().toLowerCase() === input.value.trim().toLowerCase() &&
      (r.priority ?? null) === (input.priority ?? null),
  );
  if (duplicate) {
    issues.push({ field: 'value', message: 'An identical record already exists.' });
  }

  return issues;
}

/**
 * Records WebEdge created and relies on — the website's own A record, email
 * DNS. Editing them breaks the service WebEdge is providing, so the UI labels
 * them and warns before an edit.
 */
export function isManagedByWebEdge(record: Pick<DnsRecordInput, 'type' | 'name'>): boolean {
  if (record.type === 'MX') return true;
  if (record.type === 'TXT' && /^(_dmarc|_domainkey|default\._domainkey)/i.test(record.name)) return true;
  if (record.type === 'A' && (record.name === '@' || record.name === 'www')) return true;
  return false;
}
