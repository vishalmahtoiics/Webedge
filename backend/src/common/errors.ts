import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * One error envelope for the whole API.
 *
 * Customer-visible messages never carry stack traces, provider names, raw
 * upstream errors, SQL, or internal identifiers (blueprint §22, §27). The
 * request id is the only handle a customer gets, and it is what support uses to
 * find the full detail in the logs.
 */
export type ErrorCode =
  | 'INVALID_REQUEST'
  | 'UNAUTHENTICATED'
  | 'PERMISSION_DENIED'
  | 'PLAN_LIMIT_REACHED'
  | 'QUOTA_EXCEEDED'
  | 'RESOURCE_NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'CAPABILITY_UNAVAILABLE'
  | 'OPERATION_FAILED'
  | 'PROVIDER_UNAVAILABLE';

const STATUS: Record<ErrorCode, HttpStatus> = {
  INVALID_REQUEST: HttpStatus.UNPROCESSABLE_ENTITY,
  UNAUTHENTICATED: HttpStatus.UNAUTHORIZED,
  PERMISSION_DENIED: HttpStatus.FORBIDDEN,
  PLAN_LIMIT_REACHED: HttpStatus.FORBIDDEN,
  QUOTA_EXCEEDED: HttpStatus.FORBIDDEN,
  RESOURCE_NOT_FOUND: HttpStatus.NOT_FOUND,
  CONFLICT: HttpStatus.CONFLICT,
  RATE_LIMITED: HttpStatus.TOO_MANY_REQUESTS,
  CAPABILITY_UNAVAILABLE: HttpStatus.NOT_IMPLEMENTED,
  OPERATION_FAILED: HttpStatus.INTERNAL_SERVER_ERROR,
  PROVIDER_UNAVAILABLE: HttpStatus.SERVICE_UNAVAILABLE,
};

export class AppError extends HttpException {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super({ code, message, details }, STATUS[code]);
  }
}

/**
 * A resource that does not exist, or exists but belongs to another customer.
 *
 * Both cases return 404 with the same body on purpose: a 403 would confirm that
 * the resource exists, which lets an attacker enumerate other customers'
 * resource ids.
 */
export const notFound = (resource = 'resource'): AppError =>
  new AppError('RESOURCE_NOT_FOUND', `The requested ${resource} was not found.`);

export const permissionDenied = (): AppError =>
  new AppError('PERMISSION_DENIED', 'You do not have permission to do this.');

export const unauthenticated = (): AppError =>
  new AppError('UNAUTHENTICATED', 'Sign in to continue.');

export const invalidRequest = (message: string, details?: Record<string, unknown>): AppError =>
  new AppError('INVALID_REQUEST', message, details);
