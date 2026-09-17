import { Injectable, Logger } from '@nestjs/common';
import { LogVisibility, Prisma, Realm } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { Principal } from '../common/principal';

/** Keys whose values are never written to the audit trail in plaintext. */
const SECRET_KEYS = /^(password|passwordHash|token|apiKey|api_key|secret|ciphertext|totpSecret|authTag|iv)$/i;

export type ActivityInput = {
  action: string;
  customerId?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  visibility?: LogVisibility;
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
};

@Injectable()
export class ActivityService {
  private readonly logger = new Logger(ActivityService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Replaces secret-looking values with a marker before anything is persisted.
   *
   * The audit trail records that a password changed, never what it changed to.
   * Applied recursively, because secrets arrive nested inside credential and
   * settings payloads.
   */
  static redact(value: unknown, depth = 0): Prisma.InputJsonValue | undefined {
    const redacted = ActivityService.redactValue(value, depth);
    // A top-level null means "nothing to record", which is an absent column
    // rather than a stored JSON null.
    return redacted === null ? undefined : redacted;
  }

  /**
   * Nested nulls are legitimate JSON and must be preserved — a field that
   * changed from a value to null is exactly what an audit trail should show.
   * Prisma's InputJsonValue excludes null, so the recursion carries it and the
   * public entry point strips it only at the top level.
   */
  private static redactValue(value: unknown, depth: number): Prisma.InputJsonValue | null {
    if (value === undefined || value === null) return null;
    if (depth > 8) return '<max depth>';

    if (Array.isArray(value)) {
      return value.map((v) => ActivityService.redactValue(v, depth + 1));
    }

    if (typeof value === 'object') {
      const out: Record<string, Prisma.InputJsonValue | null> = {};
      for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
        out[key] = SECRET_KEYS.test(key) ? '<redacted>' : ActivityService.redactValue(v, depth + 1);
      }
      return out;
    }

    if (typeof value === 'bigint') return value.toString();
    return value as Prisma.InputJsonValue;
  }

  /**
   * Writing the trail must never break the action it is recording, so failures
   * are logged rather than thrown. A missing audit row is a monitoring problem;
   * a failed customer operation because logging hiccuped is a product problem.
   */
  async record(principal: Principal | undefined, input: ActivityInput): Promise<void> {
    try {
      const isAdmin = principal?.realm === Realm.ADMIN;
      const impersonatedCustomerId =
        principal && isAdmin ? principal.impersonating?.customerId : undefined;

      await this.prisma.activityLog.create({
        data: {
          action: input.action,
          adminUserId: isAdmin ? principal.userId : null,
          customerUserId: principal && !isAdmin ? principal.userId : null,
          impersonatorAdminId: impersonatedCustomerId && isAdmin ? principal.userId : null,
          customerId:
            input.customerId ??
            impersonatedCustomerId ??
            (principal && principal.realm === Realm.CUSTOMER ? principal.customerId : null),
          resourceType: input.resourceType ?? null,
          resourceId: input.resourceId ?? null,
          oldValue: ActivityService.redact(input.oldValue),
          newValue: ActivityService.redact(input.newValue),
          visibility: input.visibility ?? LogVisibility.INTERNAL,
          ipAddress: input.ipAddress ?? null,
          userAgent: input.userAgent ?? null,
          requestId: input.requestId ?? null,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to write activity log for "${input.action}"`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
