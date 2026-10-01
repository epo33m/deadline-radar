import {
  ERROR_COPY,
  resolveErrorCopy,
  type CtaAction,
  type ErrorCopyItem,
} from "@deadline-radar/validation";

export type ApiErrorDetail = {
  field?: string;
  message: string;
};

export type ApiErrorObject = {
  code: string;
  message: string;
  details?: ApiErrorDetail[];
};

export type ApiErrorBody = {
  /** Normalized string message for UI (derived from nested error when present). */
  error?: string;
  /** UI title corresponding to the error */
  errorTitle?: string;
  /** Suggested primary call to action */
  errorCta?: CtaAction | CtaAction[];
  /** Whether the error condition is considered transient/retryable */
  isRetryable?: boolean;
  /** Raw nested API error envelope when present. */
  errorObject?: ApiErrorObject;
  fieldErrors?: Partial<Record<string, string[]>>;
  message?: string;
  success?: string;
  requestId?: string;
};

function detailsToFieldErrors(
  details: ApiErrorDetail[] | undefined,
): Partial<Record<string, string[]>> | undefined {
  if (!details?.length) return undefined;
  const out: Partial<Record<string, string[]>> = {};
  for (const d of details) {
    if (!d.field) continue;
    const list = out[d.field] ?? [];
    list.push(d.message);
    out[d.field] = list;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Determine if an HTTP status is transient / retryable.
 */
export function isStatusRetryable(status?: number): boolean {
  if (!status) return true;
  if (status === 429 || status === 502 || status === 503 || status === 504) return true;
  if (status >= 400 && status < 500) return false;
  return true;
}

/**
 * Map an HTTP status code to canonical Apple-ish Error Copy.
 */
export function copyForHttpStatus(status?: number): ErrorCopyItem {
  switch (status) {
    case 400:
      return {
        title: "Something went wrong",
        message:
          "We couldn't complete this request. Please check your information and try again.",
        cta: "Try Again",
      };
    case 401:
      return ERROR_COPY.auth.sessionExpired;
    case 403:
      return ERROR_COPY.authorization.accessDenied;
    case 404:
      return ERROR_COPY.resource.notFound;
    case 409:
      return ERROR_COPY.conflict.thisHasChanged;
    case 413:
      return ERROR_COPY.upload.fileTooLarge;
    case 422:
      return ERROR_COPY.validation.checkYourInformation;
    case 429:
      return ERROR_COPY.rateLimit.tooManyRequests;
    case 502:
    case 503:
    case 504:
      return ERROR_COPY.server.serviceUnavailable;
    case 500:
    default:
      return ERROR_COPY.general.somethingWentWrong;
  }
}

/** Normalize v1 nested error envelope into UI-friendly fields. */
export function normalizeApiErrorBody<T extends Record<string, unknown>>(
  data: T,
  status?: number,
): Omit<T, "error"> & ApiErrorBody {
  const err = data.error;
  if (err && typeof err === "object" && err !== null && "message" in err) {
    const obj = err as ApiErrorObject;
    const fieldErrors =
      detailsToFieldErrors(obj.details) ??
      (data.fieldErrors as ApiErrorBody["fieldErrors"]);
    const resolved = resolveErrorCopy(obj.code, {
      title: "Something went wrong",
      message: obj.message,
      cta: isStatusRetryable(status) ? "Try Again" : "Go Back",
    });

    const rest = { ...data };
    delete rest.error;

    return {
      ...rest,
      error: obj.message,
      errorTitle: resolved.title,
      errorCta: resolved.cta,
      isRetryable: isStatusRetryable(status),
      errorObject: obj,
      fieldErrors,
      requestId:
        typeof data.requestId === "string" ? data.requestId : undefined,
    };
  }

  if (typeof err === "string" && err.length > 0) {
    const resolved = copyForHttpStatus(status);
    const rest = { ...data };
    delete rest.error;
    return {
      ...rest,
      error: err,
      errorTitle: resolved.title,
      errorCta: resolved.cta,
      isRetryable: isStatusRetryable(status),
      requestId:
        typeof data.requestId === "string" ? data.requestId : undefined,
    };
  }

  const rest = { ...data };
  delete rest.error;

  if (status && status >= 400) {
    const copy = copyForHttpStatus(status);
    return {
      ...rest,
      error: copy.message,
      errorTitle: copy.title,
      errorCta: copy.cta,
      isRetryable: isStatusRetryable(status),
      requestId:
        typeof data.requestId === "string" ? data.requestId : undefined,
    };
  }

  return {
    ...rest,
    ...(data.error ? { error: String(data.error) } : {}),
  } as Omit<T, "error"> & ApiErrorBody;
}

