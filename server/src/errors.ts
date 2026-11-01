export interface ApiErrorBody {
  type: 'invalid_request_error' | 'card_error' | 'authentication_error' | 'idempotency_error' | 'api_error';
  code: string;
  message: string;
  param?: string;
  decline_code?: string;
  payment_intent?: unknown;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: ApiErrorBody,
  ) {
    super(body.message);
  }
}

export const invalid = (code: string, message: string, param?: string) =>
  new ApiError(400, { type: 'invalid_request_error', code, message, param });
