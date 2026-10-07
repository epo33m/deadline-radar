"use client";

import { useEffect, useRef, useState } from "react";

import { generateIdempotencyKey } from "./idempotency";

export type FormAttemptState = {
  pending: boolean;
  error?: string;
  /**
   * Set by the server action when the next attempt must start with a fresh
   * key: the failure was a definitive 4xx (no side effect committed, claim
   * released) and nothing from this attempt is worth replaying. Retryable
   * failures (5xx, transport) leave it falsy so a retry reuses the key and
   * cannot duplicate a side effect whose response was lost.
   */
  renewKey?: boolean;
};

/**
 * #136: per-attempt idempotency key for a form.
 *
 * `renewKey` failures regenerate so the user can correct the body and
 * resubmit immediately; anything else keeps the key for replay safety.
 * `renewOnSuccess` covers forms reused after a successful submit (e.g.
 * adding another threshold).
 */
export function useFormIdempotencyKey(
  state: FormAttemptState,
  renewOnSuccess = false,
): string {
  const [key, setKey] = useState(() => generateIdempotencyKey());
  const wasPending = useRef(false);

  useEffect(() => {
    const settled = wasPending.current && !state.pending;
    wasPending.current = state.pending;
    if (!settled) return;
    if (state.error) {
      if (state.renewKey === true) setKey(generateIdempotencyKey());
      return;
    }
    if (renewOnSuccess) setKey(generateIdempotencyKey());
  }, [state, renewOnSuccess]);

  return key;
}
