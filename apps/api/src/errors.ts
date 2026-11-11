import { ApiErrorDto } from '@reasoningapp/contracts';

const errorMessageKeys = {
  INVALID_INPUT: 'errors.invalidInput', UNAUTHENTICATED: 'errors.unauthenticated', FORBIDDEN: 'errors.forbidden',
  NOT_FOUND: 'errors.notFound', CONFLICT: 'errors.conflict', RATE_LIMITED: 'errors.rateLimited',
  AI_DISABLED: 'errors.aiDisabled', UNAVAILABLE: 'errors.unavailable', INTERNAL_ERROR: 'errors.internal',
} as const satisfies Record<ApiErrorDto['code'], string>;

export function createApiError(code: ApiErrorDto['code'], requestId: string): ApiErrorDto {
  return ApiErrorDto.parse({ code, messageKey: errorMessageKeys[code], requestId });
}

/** Only these application-owned errors may expose product 400/409/503 statuses. */
export class ProductError extends Error {
  readonly statusCode: 400 | 409 | 503;
  constructor(readonly code: 'INVALID_INPUT' | 'CONFLICT' | 'UNAVAILABLE' | 'AI_DISABLED') {
    super(code);
    this.statusCode = code === 'INVALID_INPUT' ? 400 : code === 'CONFLICT' ? 409 : 503;
  }
}

export function parseInput<T>(schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } }, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ProductError('INVALID_INPUT');
  return parsed.data;
}
