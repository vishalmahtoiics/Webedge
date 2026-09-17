import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { randomUUID } from 'node:crypto';
import type { ErrorCode } from '../errors';

/**
 * Every error leaves the API in one envelope.
 *
 * Unexpected errors are logged in full server-side and reduced to a safe message
 * for the caller, so stack traces, SQL and upstream provider errors never reach
 * a customer (blueprint §22, §27). The request id is the thread between what the
 * customer saw and what the logs hold.
 */
@Catch()
export class AppExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(AppExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const requestId = randomUUID();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();

      // Errors we raised ourselves already carry a code and a safe message.
      if (typeof body === 'object' && body !== null && 'code' in body) {
        const { code, message, details } = body as {
          code: ErrorCode;
          message: string;
          details?: Record<string, unknown>;
        };
        res.status(status).json({ error: { code, message, requestId, ...(details ? { details } : {}) } });
        return;
      }

      // Validation failures from class-validator arrive as a message array.
      const messages =
        typeof body === 'object' && body !== null && 'message' in body
          ? (body as { message: string | string[] }).message
          : exception.message;

      res.status(status).json({
        error: {
          code: status === HttpStatus.TOO_MANY_REQUESTS ? 'RATE_LIMITED' : 'INVALID_REQUEST',
          message: Array.isArray(messages) ? messages.join(' ') : messages,
          requestId,
          ...(Array.isArray(messages) ? { details: { fields: messages } } : {}),
        },
      });
      return;
    }

    this.logger.error(
      `Unhandled exception [${requestId}]`,
      exception instanceof Error ? exception.stack : String(exception),
    );

    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      error: {
        code: 'OPERATION_FAILED',
        message: "We couldn't complete this right now. Try again in a few minutes.",
        requestId,
      },
    });
  }
}
