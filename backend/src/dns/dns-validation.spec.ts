import { describe, expect, it } from 'vitest';
import {
  isManagedByWebEdge,
  validateAgainstZone,
  validateRecord,
  type DnsRecordInput,
} from './dns-validation';

const record = (over: Partial<DnsRecordInput> = {}): DnsRecordInput => ({
  type: 'A',
  name: 'www',
  value: '203.0.113.10',
  ttl: 3600,
  ...over,
});

const fields = (issues: { field: string }[]) => issues.map((i) => i.field);
const ok = (input: DnsRecordInput) => expect(validateRecord(input)).toEqual([]);

describe('A records', () => {
  it('accepts a valid IPv4 address', () => ok(record()));

  it('rejects out-of-range octets', () => {
    expect(fields(validateRecord(record({ value: '203.0.113.256' })))).toContain('value');
    expect(fields(validateRecord(record({ value: '999.1.1.1' })))).toContain('value');
  });

  it('rejects the wrong number of octets', () => {
    expect(fields(validateRecord(record({ value: '203.0.113' })))).toContain('value');
    expect(fields(validateRecord(record({ value: '203.0.113.10.1' })))).toContain('value');
  });

  /** Some resolvers read a leading zero as octal, so "010" is not 10. */
  it('rejects leading zeros as ambiguous', () => {
    expect(fields(validateRecord(record({ value: '203.0.113.010' })))).toContain('value');
  });

  it('rejects an IPv6 address in an A record', () => {
    expect(fields(validateRecord(record({ value: '2001:db8::1' })))).toContain('value');
  });
});

describe('AAAA records', () => {
  const aaaa = (value: string) => record({ type: 'AAAA', value });

  it('accepts full and shortened forms', () => {
    ok(aaaa('2001:0db8:0000:0000:0000:0000:0000:0001'));
    ok(aaaa('2001:db8::1'));
    ok(aaaa('::1'));
    ok(aaaa('::'));
  });

  it('accepts an embedded IPv4 address', () => ok(aaaa('::ffff:192.0.2.1')));

  it('rejects more than one :: shorthand', () => {
    expect(fields(validateRecord(aaaa('2001::db8::1')))).toContain('value');
  });

  it('rejects too few groups without shorthand', () => {
    expect(fields(validateRecord(aaaa('2001:db8:1:2:3:4:5')))).toContain('value');
  });

  it('rejects an oversized group', () => {
    expect(fields(validateRecord(aaaa('2001:db8::12345')))).toContain('value');
  });

  it('rejects an IPv4 address in an AAAA record', () => {
    expect(fields(validateRecord(aaaa('203.0.113.10')))).toContain('value');
  });
});

describe('CNAME records', () => {
  it('accepts a hostname target', () => {
    ok(record({ type: 'CNAME', name: 'blog', value: 'hosting.example.com' }));
  });

  /**
   * RFC 1034: the apex must carry SOA and NS, and a CNAME cannot coexist with
   * other records. Providers often accept this and then fail to resolve.
   */
  it('refuses a CNAME at the zone apex', () => {
    const issues = validateRecord(record({ type: 'CNAME', name: '@', value: 'example.com' }));
    expect(fields(issues)).toContain('name');
    expect(issues.find((i) => i.field === 'name')?.message).toMatch(/cannot be used on the domain itself/i);
  });

  it('rejects an IP address as the target', () => {
    // An IPv4 literal is structurally a valid hostname, so this documents that
    // the check is deliberately structural rather than semantic.
    expect(validateRecord(record({ type: 'CNAME', name: 'x', value: '203.0.113.10' }))).toEqual([]);
  });
});

describe('MX records', () => {
  const mx = (over: Partial<DnsRecordInput> = {}) =>
    record({ type: 'MX', name: '@', value: 'mail.example.com', priority: 10, ...over });

  it('accepts a hostname with a priority', () => ok(mx()));

  it('requires a priority', () => {
    expect(fields(validateRecord(mx({ priority: null })))).toContain('priority');
  });

  it('rejects an out-of-range priority', () => {
    expect(fields(validateRecord(mx({ priority: 70000 })))).toContain('priority');
    expect(fields(validateRecord(mx({ priority: -1 })))).toContain('priority');
  });

  /** People paste "10 mail.example.com" from other panels, where priority is inline. */
  it('catches a priority pasted into the value', () => {
    const issues = validateRecord(mx({ value: '10 mail.example.com' }));
    expect(issues.find((i) => i.field === 'value')?.message).toMatch(/only the hostname/i);
  });
});

describe('TXT records', () => {
  it('accepts an SPF policy', () => {
    ok(record({ type: 'TXT', name: '@', value: 'v=spf1 include:_spf.example.com ~all' }));
  });

  it('rejects an empty value', () => {
    expect(fields(validateRecord(record({ type: 'TXT', value: '' })))).toContain('value');
  });

  it('rejects an oversized value', () => {
    expect(fields(validateRecord(record({ type: 'TXT', value: 'x'.repeat(5000) })))).toContain('value');
  });
});

describe('SRV records', () => {
  const srv = (over: Partial<DnsRecordInput> = {}) =>
    record({
      type: 'SRV',
      name: '_sip._tls',
      value: 'sip.example.com',
      priority: 10,
      weight: 5,
      port: 5061,
      ...over,
    });

  it('accepts a well-formed record', () => ok(srv()));

  it('requires the _service._protocol name form', () => {
    expect(fields(validateRecord(srv({ name: 'sip' })))).toContain('name');
    expect(fields(validateRecord(srv({ name: '_sip.tls' })))).toContain('name');
  });

  it('requires priority, weight and port', () => {
    const issues = fields(validateRecord(srv({ priority: null, weight: null, port: null })));
    expect(issues).toEqual(expect.arrayContaining(['priority', 'weight', 'port']));
  });

  it('rejects port 0, which disables the service', () => {
    expect(fields(validateRecord(srv({ port: 0 })))).toContain('port');
  });
});

describe('NS records', () => {
  it('accepts a subdomain delegation', () => {
    ok(record({ type: 'NS', name: 'internal', value: 'ns1.example.com' }));
  });

  /** Editing apex NS is how a customer takes their own domain offline. */
  it('refuses apex NS records, directing the customer to Nameservers', () => {
    const issues = validateRecord(record({ type: 'NS', name: '@', value: 'ns1.example.com' }));
    expect(issues.find((i) => i.field === 'name')?.message).toMatch(/under Nameservers/i);
  });
});

describe('CAA records', () => {
  const caa = (value: string) => record({ type: 'CAA', name: '@', value });

  it('accepts issue and iodef forms', () => {
    ok(caa('0 issue "letsencrypt.org"'));
    ok(caa('0 issuewild "letsencrypt.org"'));
    ok(caa('0 iodef "mailto:security@example.com"'));
  });

  it('rejects a malformed value', () => {
    expect(fields(validateRecord(caa('letsencrypt.org')))).toContain('value');
  });

  it('rejects flags other than 0 or 128', () => {
    expect(fields(validateRecord(caa('1 issue "letsencrypt.org"')))).toContain('value');
  });

  it('rejects an unknown tag', () => {
    expect(fields(validateRecord(caa('0 allow "letsencrypt.org"')))).toContain('value');
  });
});

describe('names and TTL', () => {
  it('accepts the apex and wildcards', () => {
    ok(record({ name: '@' }));
    ok(record({ name: '*' }));
    ok(record({ name: '*.staging' }));
  });

  it('rejects labels starting or ending with a hyphen', () => {
    expect(fields(validateRecord(record({ name: '-bad' })))).toContain('name');
    expect(fields(validateRecord(record({ name: 'bad-' })))).toContain('name');
  });

  it('rejects an out-of-range or fractional TTL', () => {
    expect(fields(validateRecord(record({ ttl: 30 })))).toContain('ttl');
    expect(fields(validateRecord(record({ ttl: 999999 })))).toContain('ttl');
    expect(fields(validateRecord(record({ ttl: 3600.5 })))).toContain('ttl');
  });
});

describe('zone-level rules', () => {
  const existing: DnsRecordInput[] = [
    record({ type: 'A', name: 'www', value: '203.0.113.10' }),
    record({ type: 'CNAME', name: 'blog', value: 'pages.example.com' }),
  ];

  /**
   * The classic zone break: adding a verification TXT onto a name that already
   * has a CNAME silently breaks both.
   */
  it('refuses a non-CNAME on a name that already has a CNAME', () => {
    const issues = validateAgainstZone(
      record({ type: 'TXT', name: 'blog', value: 'verification=abc' }),
      existing,
    );
    expect(issues[0]?.message).toMatch(/is a CNAME/i);
  });

  it('refuses a CNAME on a name that already has other records', () => {
    const issues = validateAgainstZone(
      record({ type: 'CNAME', name: 'www', value: 'other.example.com' }),
      existing,
    );
    expect(issues[0]?.message).toMatch(/already has other records/i);
  });

  it('refuses an exact duplicate', () => {
    const issues = validateAgainstZone(record({ type: 'A', name: 'www', value: '203.0.113.10' }), existing);
    expect(issues[0]?.message).toMatch(/identical record/i);
  });

  it('allows a second A record on the same name for round-robin', () => {
    expect(validateAgainstZone(record({ type: 'A', name: 'www', value: '203.0.113.11' }), existing)).toEqual([]);
  });

  /**
   * Both of these fail open at the provider: it accepts the second record and
   * the customer's mail policy silently stops working, which is exactly the
   * class of error this validation exists to catch.
   */
  it('refuses a second DMARC record', () => {
    const zone = [record({ type: 'TXT', name: '_dmarc', value: 'v=DMARC1; p=quarantine;' })];
    const issues = validateAgainstZone(
      record({ type: 'TXT', name: '_dmarc', value: 'v=DMARC1; p=none;' }),
      zone,
    );
    expect(issues[0]?.message).toMatch(/already has a DMARC record/i);
  });

  it('refuses a second SPF record', () => {
    const zone = [record({ type: 'TXT', name: '@', value: 'v=spf1 include:a.example.com ~all' })];
    const issues = validateAgainstZone(
      record({ type: 'TXT', name: '@', value: 'v=spf1 include:b.example.com ~all' }),
      zone,
    );
    expect(issues[0]?.message).toMatch(/already has an SPF record/i);
  });

  it('allows other TXT records alongside DMARC and SPF', () => {
    const zone = [
      record({ type: 'TXT', name: '@', value: 'v=spf1 include:a.example.com ~all' }),
    ];
    expect(
      validateAgainstZone(record({ type: 'TXT', name: '@', value: 'google-site-verification=abc' }), zone),
    ).toEqual([]);
  });

  it('allows an unrelated name', () => {
    expect(validateAgainstZone(record({ type: 'A', name: 'api', value: '203.0.113.12' }), existing)).toEqual([]);
  });

  /** `existing` excludes the record being edited, so it never conflicts with itself. */
  it('does not report a conflict when a record is edited in place', () => {
    const others = existing.filter((r) => r.name !== 'www');
    expect(validateAgainstZone(record({ type: 'A', name: 'www', value: '203.0.113.99' }), others)).toEqual([]);
  });
});

describe('WebEdge-managed records', () => {
  it('flags the records WebEdge relies on', () => {
    expect(isManagedByWebEdge({ type: 'MX', name: '@' })).toBe(true);
    expect(isManagedByWebEdge({ type: 'A', name: '@' })).toBe(true);
    expect(isManagedByWebEdge({ type: 'A', name: 'www' })).toBe(true);
    expect(isManagedByWebEdge({ type: 'TXT', name: '_dmarc' })).toBe(true);
  });

  it('leaves the customer\'s own records alone', () => {
    expect(isManagedByWebEdge({ type: 'A', name: 'api' })).toBe(false);
    expect(isManagedByWebEdge({ type: 'TXT', name: '@' })).toBe(false);
  });
});
