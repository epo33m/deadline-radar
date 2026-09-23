export const API_ERROR_CODES = {
  VALIDATION_ERROR: "VALIDATION_ERROR",
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  RATE_LIMITED: "RATE_LIMITED",
  PAYLOAD_TOO_LARGE: "PAYLOAD_TOO_LARGE",
  DEPENDENCY_FAILURE: "DEPENDENCY_FAILURE",
  TIMEOUT: "TIMEOUT",
  INTERNAL: "INTERNAL",
  IDEMPOTENCY_CONFLICT: "IDEMPOTENCY_CONFLICT",
} as const;

export type ApiErrorCode =
  (typeof API_ERROR_CODES)[keyof typeof API_ERROR_CODES];

export type ApiErrorDetail = {
  field?: string;
  message: string;
};

export type ApiErrorBody = {
  error: {
    code: ApiErrorCode;
    message: string;
    details: ApiErrorDetail[];
  };
  requestId: string;
};

export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly details: ApiErrorDetail[];
  readonly expose: boolean;

  constructor(options: {
    status: number;
    code: ApiErrorCode;
    message: string;
    details?: ApiErrorDetail[];
    expose?: boolean;
  }) {
    super(options.message);
    this.name = "ApiError";
    this.status = options.status;
    this.code = options.code;
    this.details = options.details ?? [];
    this.expose = options.expose ?? true;
  }

  static validation(
    message = "Request validation failed",
    details: ApiErrorDetail[] = [],
  ): ApiError {
    return new ApiError({
      status: 400,
      code: API_ERROR_CODES.VALIDATION_ERROR,
      message,
      details,
    });
  }

  static unauthorized(message = "Authentication required."): ApiError {
    return new ApiError({
      status: 401,
      code: API_ERROR_CODES.UNAUTHORIZED,
      message,
    });
  }

  static forbidden(message = "Forbidden"): ApiError {
    return new ApiError({
      status: 403,
      code: API_ERROR_CODES.FORBIDDEN,
      message,
    });
  }

  static notFound(message = "Not found"): ApiError {
    return new ApiError({
      status: 404,
      code: API_ERROR_CODES.NOT_FOUND,
      message,
    });
  }

  static conflict(message: string, details: ApiErrorDetail[] = []): ApiError {
    return new ApiError({
      status: 409,
      code: API_ERROR_CODES.CONFLICT,
      message,
      details,
    });
  }

  static rateLimited(
    message = "Too many requests. Slow down and try again.",
  ): ApiError {
    return new ApiError({
      status: 429,
      code: API_ERROR_CODES.RATE_LIMITED,
      message,
    });
  }

  static payloadTooLarge(message = "Request body too large"): ApiError {
    return new ApiError({
      status: 413,
      code: API_ERROR_CODES.PAYLOAD_TOO_LARGE,
      message,
    });
  }

  static internal(message = "Internal server error"): ApiError {
    return new ApiError({
      status: 500,
      code: API_ERROR_CODES.INTERNAL,
      message,
      expose: false,
    });
  }
}

export function toErrorBody(
  err: ApiError,
  requestId: string,
): ApiErrorBody {
  return {
    error: {
      code: err.code,
      message: err.expose ? err.message : "Internal server error",
      details: err.expose ? err.details : [],
    },
    requestId,
  };
}

export function detailsFromZodFlatten(fieldErrors: {
  [key: string]: string[] | undefined;
}): ApiErrorDetail[] {
  const details: ApiErrorDetail[] = [];
  for (const [field, messages] of Object.entries(fieldErrors)) {
    for (const message of messages ?? []) {
      details.push({ field, message });
    }
  }
  return details;
}

export function validationFromZod(
  message: string,
  fieldErrors: { [key: string]: string[] | undefined },
): ApiError {
  return ApiError.validation(message, detailsFromZodFlatten(fieldErrors));
}
