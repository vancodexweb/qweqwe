import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

interface NormalizedErrorBody {
  code?: string;
  message: string | string[];
  retryAfterSeconds?: number;
}

/**
 * Единый формат ошибок для всего API:
 * { statusCode, code, message, timestamp, path }.
 *
 * `code` — машиночитаемый идентификатор (TELEGRAM_LINK_REQUIRED, RATE_LIMITED,
 * NICKNAME_NOT_REGISTERED и т.д.), по которому фронтенд может принимать решения
 * без парсинга текста сообщения. Все сервисы бросают HttpException с телом
 * `{ code, message }` — этот фильтр их не выдумывает, а нормализует.
 *
 * Для непредвиденных ошибок (не HttpException) наружу уходит только
 * generic-сообщение — stack trace и детали остаются в серверных логах,
 * чтобы не утекали внутренности реализации.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionsFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    const body = this.normalizeBody(exception, status);

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `${request.method} ${request.url} -> ${status}: ${this.stringifyMessage(body.message)}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    if (body.retryAfterSeconds) {
      response.setHeader('Retry-After', body.retryAfterSeconds.toString());
    }

    response.status(status).json({
      statusCode: status,
      code: body.code ?? `HTTP_${status}`,
      message: body.message,
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }

  private normalizeBody(exception: unknown, status: number): NormalizedErrorBody {
    if (exception instanceof HttpException) {
      const response = exception.getResponse();

      if (typeof response === 'string') {
        return { message: response };
      }

      if (typeof response === 'object' && response !== null) {
        const responseObj = response as Record<string, unknown>;
        return {
          code: typeof responseObj.code === 'string' ? responseObj.code : undefined,
          message: (responseObj.message as string | string[]) ?? exception.message,
          retryAfterSeconds:
            typeof responseObj.retryAfterSeconds === 'number' ? responseObj.retryAfterSeconds : undefined,
        };
      }

      return { message: exception.message };
    }

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      return { message: 'Внутренняя ошибка сервера. Попробуйте повторить запрос позже.' };
    }

    return { message: 'Некорректный запрос.' };
  }

  private stringifyMessage(message: string | string[]): string {
    return Array.isArray(message) ? message.join('; ') : message;
  }
}
