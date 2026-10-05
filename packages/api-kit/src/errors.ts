/** One field-level problem reported by the API (zod issues are mapped to this shape). */
export type ApiFieldError = {
  path: Array<string | number>
  message: string
}

/**
 * Error thrown by the HTTP client for every non-2xx response and for network
 * failures (status 0). It is the single class the query client and the apps'
 * `instanceof` checks rely on, so never define a second one.
 */
export class ApiError extends Error {
  readonly success = false as const
  readonly status: number
  readonly code?: string
  readonly errors?: ApiFieldError[]
  readonly requestId?: string
  readonly data?: unknown

  constructor(
    status: number,
    message: string,
    options: { code?: string; errors?: ApiFieldError[]; requestId?: string; data?: unknown; cause?: unknown } = {}
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined)
    this.name = 'ApiError'
    this.status = status
    this.code = options.code
    this.errors = options.errors
    this.requestId = options.requestId
    this.data = options.data
  }

  /** True for failures the caller caused (4xx), false for server and network failures. */
  get isClientError(): boolean {
    return this.status >= 400 && this.status < 500
  }

  /** The message for one field, when the API reported field-level errors. */
  fieldError(field: string): string | undefined {
    return this.errors?.find(e => e.path.map(String).join('.') === field)?.message
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError
}
