import { afterAll, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act, renderHook } from "@testing-library/react";

import { useFormIdempotencyKey } from "./use-form-idempotency-key";

GlobalRegistrator.register();

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Attempt = {
  pending: boolean;
  error?: string;
  renewKey?: boolean;
};

function settle(
  rerender: (props: { state: Attempt }) => void,
  state: Attempt,
): void {
  act(() => rerender({ state: { pending: true } }));
  act(() => rerender({ state }));
}

describe("#136: useFormIdempotencyKey regenerates on definitive failure", () => {
  afterAll(() => {
    GlobalRegistrator.unregister();
  });

  test("regenerates after a definitive client failure (renewKey)", () => {
    const { result, rerender } = renderHook(
      ({ state }: { state: Attempt }) => useFormIdempotencyKey(state),
      { initialProps: { state: { pending: false } as Attempt } },
    );
    const initial = result.current;
    expect(initial).toMatch(UUID_RE);

    settle(rerender, { pending: false, error: "Invalid body", renewKey: true });

    expect(result.current).not.toBe(initial);
    expect(result.current).toMatch(UUID_RE);
  });

  test("keeps the key after a retryable failure (5xx / network)", () => {
    const { result, rerender } = renderHook(
      ({ state }: { state: Attempt }) => useFormIdempotencyKey(state),
      { initialProps: { state: { pending: false } as Attempt } },
    );
    const initial = result.current;

    settle(rerender, { pending: false, error: "boom", renewKey: false });
    expect(result.current).toBe(initial);

    settle(rerender, { pending: false, error: "transport" });
    expect(result.current).toBe(initial);
  });

  test("keeps the key while the submit is still pending", () => {
    const { result, rerender } = renderHook(
      ({ state }: { state: Attempt }) => useFormIdempotencyKey(state),
      { initialProps: { state: { pending: false } as Attempt } },
    );
    const initial = result.current;

    act(() => rerender({ state: { pending: true, error: "early" } }));
    expect(result.current).toBe(initial);
  });

  test("renewOnSuccess regenerates for a form reused after success", () => {
    const { result, rerender } = renderHook(
      ({ state }: { state: Attempt }) => useFormIdempotencyKey(state, true),
      { initialProps: { state: { pending: false } as Attempt } },
    );
    const initial = result.current;

    settle(rerender, { pending: false });

    expect(result.current).not.toBe(initial);
    expect(result.current).toMatch(UUID_RE);
  });

  test("without renewOnSuccess the key survives a successful submit", () => {
    const { result, rerender } = renderHook(
      ({ state }: { state: Attempt }) => useFormIdempotencyKey(state),
      { initialProps: { state: { pending: false } as Attempt } },
    );
    const initial = result.current;

    settle(rerender, { pending: false });

    expect(result.current).toBe(initial);
  });
});
