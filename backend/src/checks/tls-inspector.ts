import { Injectable, Logger } from '@nestjs/common';
import tls, { type PeerCertificate, type TLSSocket } from 'node:tls';
import { resolvePublicAddress } from './ssrf-guard';

/**
 * Reads a site's TLS certificate directly, rather than asking the provider.
 *
 * No provider here exposes an SSL endpoint, so this is how WebEdge knows whether
 * a customer's certificate is valid and when it expires. It also means the
 * answer is the same one a browser would give, which is what the customer
 * actually cares about.
 *
 * The connector that opens the socket applies the SSRF guard and pins the
 * connection to the address it resolved, because a certificate checker that
 * accepts any hostname is otherwise a way to make WebEdge connect to internal
 * services on request. The guard lives there rather than here so it sits next to
 * the socket it protects.
 */

export type CertificateStatus =
  | 'active'
  | 'expiring_soon'
  | 'expired'
  | 'name_mismatch'
  | 'self_signed'
  | 'untrusted'
  | 'unreachable';

export type TlsReport = {
  hostname: string;
  status: CertificateStatus;
  /** Plain-language summary for the customer. */
  summary: string;
  issuer: string | null;
  validFrom: string | null;
  validTo: string | null;
  daysUntilExpiry: number | null;
  coveredNames: string[];
  checkedAt: string;
};

const EXPIRING_SOON_DAYS = 14;
const CONNECT_TIMEOUT_MS = 10_000;

/** Injected so tests can reach a local server the SSRF guard would refuse. */
export type TlsConnector = (options: {
  host: string;
  port: number;
  servername: string;
}) => Promise<{ certificate: PeerCertificate; authorized: boolean; authorizationError?: string }>;

const defaultConnector: TlsConnector = async ({ port, servername }) => {
  // Guarded here rather than in inspect(): this is the connector that opens a
  // real socket, so this is where an SSRF check belongs. An injected connector
  // is reachable from code, never from a request.
  const guard = await resolvePublicAddress(servername);
  if (!guard.ok) throw new Error(guard.reason);

  // Pinned to the address the guard resolved. Passing `servername` as the host
  // would re-resolve it and reopen the rebinding hole.
  const host = guard.address;

  return new Promise((resolve, reject) => {
    const socket: TLSSocket = tls.connect(
      {
        host,
        port,
        servername,
        // The certificate is inspected and reported on, not trusted: an expired
        // or self-signed certificate is a result to show the customer, not a
        // connection to abort. Validity is reported through `authorized`.
        rejectUnauthorized: false,
        timeout: CONNECT_TIMEOUT_MS,
      },
      () => {
        const certificate = socket.getPeerCertificate(true);
        const authorized = socket.authorized;
        const authorizationError = socket.authorizationError?.message;
        socket.destroy();
        resolve({ certificate, authorized, authorizationError });
      },
    );

    socket.once('timeout', () => {
      socket.destroy();
      reject(new Error('timeout'));
    });
    socket.once('error', (error) => {
      socket.destroy();
      reject(error);
    });
  });
};

@Injectable()
export class TlsInspector {
  private readonly logger = new Logger(TlsInspector.name);

  constructor(private readonly connect: TlsConnector = defaultConnector) {}

  async inspect(hostname: string, port = 443): Promise<TlsReport> {
    const checkedAt = new Date().toISOString();

    try {
      // The connector applies the SSRF guard and pins the connection; the
      // hostname is passed as SNI so the server presents the right certificate.
      const result = await this.connect({ host: hostname, port, servername: hostname });
      return this.report(hostname, checkedAt, result);
    } catch (error) {
      this.logger.debug(
        `TLS check failed for ${hostname}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return this.unreachable(
        hostname,
        checkedAt,
        "We couldn't reach this website over HTTPS. Make sure it's online and publicly accessible.",
      );
    }
  }

  private unreachable(hostname: string, checkedAt: string, summary: string): TlsReport {
    return {
      hostname,
      status: 'unreachable',
      summary,
      issuer: null,
      validFrom: null,
      validTo: null,
      daysUntilExpiry: null,
      coveredNames: [],
      checkedAt,
    };
  }

  private report(
    hostname: string,
    checkedAt: string,
    result: { certificate: PeerCertificate; authorized: boolean; authorizationError?: string },
  ): TlsReport {
    const { certificate, authorized, authorizationError } = result;

    if (!certificate || Object.keys(certificate).length === 0) {
      return this.unreachable(hostname, checkedAt, 'This website did not present a certificate.');
    }

    const coveredNames = TlsInspector.namesFrom(certificate);
    const validTo = certificate.valid_to ? new Date(certificate.valid_to) : null;
    const validFrom = certificate.valid_from ? new Date(certificate.valid_from) : null;
    const daysUntilExpiry = validTo
      ? Math.trunc((validTo.getTime() - Date.now()) / 86_400_000)
      : null;

    const issuer = certificate.issuer?.O ?? certificate.issuer?.CN ?? null;

    const base = {
      hostname,
      issuer,
      validFrom: validFrom?.toISOString() ?? null,
      validTo: validTo?.toISOString() ?? null,
      daysUntilExpiry,
      coveredNames,
      checkedAt,
    };

    // Ordered by what the customer should act on first. Expiry beats trust,
    // because "expired" is both more urgent and more comprehensible than
    // "untrusted".
    if (daysUntilExpiry !== null && daysUntilExpiry < 0) {
      return {
        ...base,
        status: 'expired',
        summary: `This certificate expired ${Math.abs(daysUntilExpiry)} day${
          Math.abs(daysUntilExpiry) === 1 ? '' : 's'
        } ago. Visitors will see a security warning.`,
      };
    }

    if (!TlsInspector.covers(hostname, coveredNames)) {
      return {
        ...base,
        status: 'name_mismatch',
        summary: `This certificate does not cover ${hostname}. Visitors will see a security warning.`,
      };
    }

    const selfSigned =
      authorizationError === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
      authorizationError === 'SELF_SIGNED_CERT_IN_CHAIN' ||
      (!authorized && certificate.issuer?.CN === certificate.subject?.CN);

    if (selfSigned) {
      return {
        ...base,
        status: 'self_signed',
        summary: 'This certificate is self-signed, so visitors will see a security warning.',
      };
    }

    if (!authorized) {
      return {
        ...base,
        status: 'untrusted',
        summary: 'This certificate is not trusted by browsers. Visitors will see a security warning.',
      };
    }

    if (daysUntilExpiry !== null && daysUntilExpiry <= EXPIRING_SOON_DAYS) {
      return {
        ...base,
        status: 'expiring_soon',
        summary: `This certificate expires in ${daysUntilExpiry} day${
          daysUntilExpiry === 1 ? '' : 's'
        }. It should renew automatically.`,
      };
    }

    return {
      ...base,
      status: 'active',
      summary: daysUntilExpiry
        ? `Valid for another ${daysUntilExpiry} days.`
        : 'This certificate is valid.',
    };
  }

  /** Subject alternative names, falling back to the common name. */
  private static namesFrom(certificate: PeerCertificate): string[] {
    const names = new Set<string>();

    if (certificate.subjectaltname) {
      for (const entry of certificate.subjectaltname.split(',')) {
        const trimmed = entry.trim();
        if (trimmed.startsWith('DNS:')) names.add(trimmed.slice(4).toLowerCase());
      }
    }
    // Only when there are no SANs: modern browsers ignore CN when SANs exist, so
    // trusting it alongside them would report a match a browser would reject.
    if (names.size === 0 && certificate.subject?.CN) {
      names.add(certificate.subject.CN.toLowerCase());
    }

    return [...names];
  }

  /** Wildcards match exactly one label, so *.example.com covers a.example.com but not a.b.example.com. */
  private static covers(hostname: string, names: string[]): boolean {
    const host = hostname.toLowerCase().replace(/\.$/, '');

    return names.some((name) => {
      if (name === host) return true;
      if (!name.startsWith('*.')) return false;

      const suffix = name.slice(1); // ".example.com"
      if (!host.endsWith(suffix)) return false;

      const label = host.slice(0, host.length - suffix.length);
      return label.length > 0 && !label.includes('.');
    });
  }
}
