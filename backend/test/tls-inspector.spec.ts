import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import tls, { type PeerCertificate } from 'node:tls';
import { createServer, type Server } from 'node:tls';
import { TlsInspector, type TlsConnector } from '../src/checks/tls-inspector';

/**
 * The TLS inspector against a real certificate.
 *
 * The fixture at /tmp/tlsfix is a genuine self-signed certificate for
 * northwind.test, valid 20 days — so expiry maths, SAN parsing and the
 * self-signed path are all exercised against real X.509 rather than a
 * hand-written object that happens to match the parser.
 *
 * The connector is injected because the SSRF guard refuses loopback, which is
 * exactly what it should do. That refusal is tested separately, through the
 * default path.
 */
const PORT = 8443;

const localConnector: TlsConnector = ({ port, servername }) =>
  new Promise((resolve, reject) => {
    const socket = tls.connect(
      { host: '127.0.0.1', port, servername, rejectUnauthorized: false, timeout: 5000 },
      () => {
        const certificate = socket.getPeerCertificate(true);
        const authorized = socket.authorized;
        const authorizationError = socket.authorizationError?.message;
        socket.destroy();
        resolve({ certificate, authorized, authorizationError });
      },
    );
    socket.once('error', (e) => { socket.destroy(); reject(e); });
    socket.once('timeout', () => { socket.destroy(); reject(new Error('timeout')); });
  });

describe('TLS inspector', () => {
  let server: Server;
  const inspector = new TlsInspector(localConnector);

  beforeAll(async () => {
    server = createServer(
      {
        key: readFileSync('/tmp/tlsfix/key.pem'),
        cert: readFileSync('/tmp/tlsfix/cert.pem'),
      },
      (socket) => socket.end(),
    );
    await new Promise<void>((resolve) => server.listen(PORT, '127.0.0.1', resolve));
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('reads the certificate and its covered names', async () => {
    const report = await inspector.inspect('northwind.test', PORT);

    expect(report.coveredNames).toContain('northwind.test');
    expect(report.coveredNames).toContain('www.northwind.test');
    expect(report.validTo).toBeTruthy();
    expect(report.issuer).toBe('Northwind Traders');
  });

  /** The fixture is issued for 20 days, so this is real arithmetic on a real notAfter. */
  it('computes days until expiry from the real certificate', async () => {
    const report = await inspector.inspect('northwind.test', PORT);

    expect(report.daysUntilExpiry).toBeGreaterThan(15);
    expect(report.daysUntilExpiry).toBeLessThanOrEqual(20);
  });

  it('reports a self-signed certificate as such, in plain language', async () => {
    const report = await inspector.inspect('northwind.test', PORT);

    expect(report.status).toBe('self_signed');
    expect(report.summary).toMatch(/security warning/i);
  });

  /**
   * Name mismatch outranks the trust problem: a certificate that does not cover
   * the hostname fails for every visitor regardless of who signed it.
   */
  it('reports a name mismatch when the certificate does not cover the host', async () => {
    const report = await inspector.inspect('other-domain.test', PORT);

    expect(report.status).toBe('name_mismatch');
    expect(report.summary).toContain('other-domain.test');
  });

  it('reports a closed port as unreachable, without inventing a status', async () => {
    const report = await inspector.inspect('northwind.test', 9999);

    expect(report.status).toBe('unreachable');
    expect(report.daysUntilExpiry).toBeNull();
    expect(report.coveredNames).toEqual([]);
  });

  describe('the SSRF guard on the default path', () => {
    // No injected connector: this exercises the guard the production code uses.
    const guarded = new TlsInspector();

    it('refuses loopback, private and metadata addresses', async () => {
      for (const host of ['127.0.0.1', 'localhost', '169.254.169.254', '10.0.0.1', '[::1]']) {
        const report = await guarded.inspect(host, PORT);
        expect(report.status, `${host} must be refused`).toBe('unreachable');
      }
    });

    it('refuses internal hostname suffixes', async () => {
      for (const host of ['db.internal', 'printer.local', 'metadata.google.internal']) {
        const report = await guarded.inspect(host);
        expect(report.status, `${host} must be refused`).toBe('unreachable');
      }
    });
  });
});

describe('name matching', () => {
  // Exercised through inspect() against certificates whose SANs are fixed, so
  // the wildcard rules are checked as the inspector actually applies them.
  const withNames = (names: string[]): TlsConnector => async () => ({
    certificate: {
      subject: { CN: names[0] },
      issuer: { O: 'Test CA', CN: 'Test CA' },
      subjectaltname: names.map((n) => `DNS:${n}`).join(', '),
      valid_from: new Date(Date.now() - 86_400_000).toUTCString(),
      valid_to: new Date(Date.now() + 90 * 86_400_000).toUTCString(),
    } as unknown as PeerCertificate,
    authorized: true,
  });

  const statusFor = async (hostname: string, names: string[]) =>
    (await new TlsInspector(withNames(names)).inspect(hostname, 443)).status;

  it('matches an exact name', async () => {
    expect(await statusFor('example.com', ['example.com'])).toBe('active');
  });

  it('matches a wildcard one label deep', async () => {
    expect(await statusFor('www.example.com', ['*.example.com'])).toBe('active');
  });

  /** A wildcard covers one label only — this is where naive suffix matching fails. */
  it('does not let a wildcard match two labels', async () => {
    expect(await statusFor('a.b.example.com', ['*.example.com'])).toBe('name_mismatch');
  });

  it('does not let a wildcard match the bare domain', async () => {
    expect(await statusFor('example.com', ['*.example.com'])).toBe('name_mismatch');
  });

  it('does not match a domain that merely ends with the same text', async () => {
    expect(await statusFor('notexample.com', ['example.com'])).toBe('name_mismatch');
  });

  it('matches case-insensitively and ignores a trailing dot', async () => {
    expect(await statusFor('EXAMPLE.com.', ['example.com'])).toBe('active');
  });

  it('flags a certificate expiring inside the warning window', async () => {
    const soon: TlsConnector = async () => ({
      certificate: {
        subject: { CN: 'example.com' },
        issuer: { O: 'Test CA', CN: 'Test CA' },
        subjectaltname: 'DNS:example.com',
        valid_from: new Date(Date.now() - 86_400_000).toUTCString(),
        valid_to: new Date(Date.now() + 5 * 86_400_000).toUTCString(),
      } as unknown as PeerCertificate,
      authorized: true,
    });

    const report = await new TlsInspector(soon).inspect('example.com', 443);
    expect(report.status).toBe('expiring_soon');
    expect(report.summary).toMatch(/expires in 4 days|expires in 5 days/);
  });

  it('flags an expired certificate ahead of every other problem', async () => {
    const expired: TlsConnector = async () => ({
      certificate: {
        subject: { CN: 'example.com' },
        issuer: { O: 'Test CA', CN: 'Test CA' },
        subjectaltname: 'DNS:example.com',
        valid_from: new Date(Date.now() - 400 * 86_400_000).toUTCString(),
        valid_to: new Date(Date.now() - 3 * 86_400_000).toUTCString(),
      } as unknown as PeerCertificate,
      authorized: false,
    });

    const report = await new TlsInspector(expired).inspect('example.com', 443);
    expect(report.status).toBe('expired');
    expect(report.summary).toMatch(/expired 3 days ago/);
  });
});
