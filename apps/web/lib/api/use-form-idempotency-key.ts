"use client";

import { useState } from "react";

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
  const [prevPending, setPrevPending] = useState(state.pending);

  // Render-phase adjustment (no effect): when the action settles, decide
  // once per attempt whether the next attempt needs a fresh key. This is
  // the React-sanctioned "adjust state during render" pattern, so it never
  // triggers cascading renders the way setState-in-effect does.
  if (prevPending !== state.pending) {
    setPrevPending(state.pending);
    if (prevPending && !state.pending) {
      if (state.error) {
        if (state.renewKey === true) setKey(generateIdempotencyKey());
      } else if (renewOnSuccess) {
        setKey(generateIdempotencyKey());
      }
    }
  }

  return key;
}
