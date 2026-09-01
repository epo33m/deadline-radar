"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import {
  updateTimezone,
  type AuthActionState,
} from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { detectBrowserTimeZone } from "@/lib/timezone";

const initialState: AuthActionState = {};

type TimezoneFormProps = {
  initialTimezone: string;
};

export function TimezoneForm({ initialTimezone }: TimezoneFormProps) {
  const [state, formAction, pending] = useActionState(
    updateTimezone,
    initialState,
  );
  const [timezone, setTimezone] = useState(initialTimezone);
  const [showSaved, setShowSaved] = useState(false);
  const wasPending = useRef(false);

  useEffect(() => {
    if (wasPending.current && !pending && !state.error) {
      setShowSaved(true);
    }
    wasPending.current = pending;
  }, [pending, state.error]);

  return (
    <form action={formAction} className="flex max-w-md flex-col gap-4">
      <div className="space-y-2">
        <Label htmlFor="timezone">Timezone</Label>
        <Input
          id="timezone"
          name="timezone"
          value={timezone}
          onChange={(event) => {
            setTimezone(event.target.value);
            setShowSaved(false);
          }}
          placeholder="Asia/Makassar"
          required
          aria-invalid={Boolean(state.error)}
        />
        <p className="text-xs text-ink-muted-48">
          IANA timezone used for reminder timing (e.g. Asia/Makassar).
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save timezone"}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setTimezone(detectBrowserTimeZone());
            setShowSaved(false);
          }}
        >
          Use browser default
        </Button>
      </div>
      {state.error ? (
        <p className="text-sm text-destructive" role="alert">
          {state.error}
        </p>
      ) : null}
      {showSaved && !state.error ? (
        <p className="text-sm text-ink-muted-48" role="status">
          Timezone saved.
        </p>
      ) : null}
    </form>
  );
}
