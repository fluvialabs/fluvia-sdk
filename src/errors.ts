export const USER_REJECTED = 4001;
export const UNAUTHORIZED = 4100;
export const UNSUPPORTED_METHOD = 4200;
export const DISCONNECTED = 4900;
export const INVALID_PARAMS = -32602;
export const INTERNAL = -32603;

/** Branch on `code`. Fluvia's own reason, when it gives one, is `data.errorCode`. */
export class FluviaRpcError extends Error {
  readonly code: number;
  readonly data?: unknown;

  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = 'FluviaRpcError';
    this.code = code;
    if (data !== undefined) this.data = data;
  }
}

const codeOf = (error: unknown) => (error instanceof FluviaRpcError ? error.code : null);

export const isUserRejection = (error: unknown) => codeOf(error) === USER_REJECTED;
export const isUnauthorized = (error: unknown) => codeOf(error) === UNAUTHORIZED;

export function fluviaErrorCode(error: unknown): string | null {
  const data = error instanceof FluviaRpcError ? (error.data as { errorCode?: unknown } | undefined) : undefined;
  return typeof data?.errorCode === 'string' ? data.errorCode : null;
}
