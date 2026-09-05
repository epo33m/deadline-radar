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

/** Normalize v1 nested error envelope into UI-friendly fields. */
export function normalizeApiErrorBody<T extends Record<string, unknown>>(
  data: T,
): T & ApiErrorBody {
  const err = data.error;
  if (err && typeof err === "object" && err !== null && "message" in err) {
    const obj = err as ApiErrorObject;
    const fieldErrors =
      detailsToFieldErrors(obj.details) ??
      (data.fieldErrors as ApiErrorBody["fieldErrors"]);
    return {
      ...data,
      error: obj.message,
      errorObject: obj,
      fieldErrors,
      requestId:
        typeof data.requestId === "string" ? data.requestId : undefined,
    };
  }
  return data as T & ApiErrorBody;
}
