"use client";

import { Eye, EyeOff } from "lucide-react";
import {
  startTransition,
  useActionState,
  useEffect,
  useState,
} from "react";
import type { z } from "zod";

import { changeEmail, type AuthActionState } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { changeEmailSchema } from "@/lib/validation/auth";

const initialState: AuthActionState = {};

const fieldClassName =
  "h-11 w-full rounded-[11px] border-hairline bg-canvas px-3 font-sans text-[17px] font-normal leading-[1.47] tracking-[-0.374px] text-ink shadow-none placeholder:text-ink-muted-48 focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20 aria-invalid:border-destructive aria-invalid:ring-destructive/20";

const errorClassName =
  "w-full text-left text-sm leading-[1.43] tracking-[-0.224px] text-destructive";

function clientFieldErrors<T extends z.ZodType>(
  schema: T,
  data: unknown,
): Partial<Record<string, string>> {
  const parsed = schema.safeParse(data);
  if (parsed.success) return {};

  const fieldErrors = parsed.error.flatten().fieldErrors;
  const result: Partial<Record<string, string>> = {};
  for (const [key, messages] of Object.entries(fieldErrors)) {
    if (Array.isArray(messages) && messages[0]) result[key] = messages[0];
  }
  return result;
}

type ChangeEmailFormProps = {
  onEmailChanged?: () => void;
};

export function ChangeEmailForm({ onEmailChanged }: ChangeEmailFormProps) {
  const [state, formAction, pending] = useActionState(
    changeEmail,
    initialState,
  );
  const [showPassword, setShowPassword] = useState(false);
  const [clientErrors, setClientErrors] = useState<
    Partial<Record<"email" | "currentPassword", string>>
  >({});

  useEffect(() => {
    if (state.success) {
      onEmailChanged?.();
    }
  }, [state.success, onEmailChanged]);

  const emailError =
    state.fieldErrors?.email?.[0] ?? clientErrors.email ?? undefined;
  const passwordError =
    state.fieldErrors?.currentPassword?.[0] ??
    clientErrors.currentPassword ??
    undefined;

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const errors = clientFieldErrors(changeEmailSchema, {
      email: formData.get("email"),
      currentPassword: formData.get("currentPassword"),
    });
    if (Object.keys(errors).length > 0) {
      setClientErrors(errors);
      return;
    }
    setClientErrors({});
    startTransition(() => {
      formAction(formData);
    });
  }

  const emailFieldId = "change-email-email";

  return (
    <form onSubmit={handleSubmit} className="w-full space-y-4" noValidate>
      <div className="w-full space-y-2.5">
        <Input
          id={emailFieldId}
          name="email"
          type="email"
          autoComplete="email"
          placeholder="New email address"
          aria-label="New email address"
          aria-invalid={Boolean(emailError)}
          aria-describedby={emailError ? `${emailFieldId}-error` : undefined}
          className={fieldClassName}
          onChange={() => {
            if (emailError) {
              setClientErrors((current) => ({ ...current, email: undefined }));
            }
          }}
        />
        {emailError ? (
          <p id={`${emailFieldId}-error`} className={errorClassName} role="alert">
            {emailError}
          </p>
        ) : null}
      </div>

      <div className="w-full space-y-2.5">
        <div className="relative">
          <Input
            id="change-email-current-password"
            name="currentPassword"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            placeholder="Current password"
            aria-label="Current password"
            aria-invalid={Boolean(passwordError)}
            aria-describedby={
              passwordError ? "change-email-password-error" : undefined
            }
            className={fieldClassName}
            onChange={() => {
              if (passwordError) {
                setClientErrors((current) => ({
                  ...current,
                  currentPassword: undefined,
                }));
              }
            }}
          />
          <button
            type="button"
            onClick={() => setShowPassword((visible) => !visible)}
            aria-label={showPassword ? "Hide password" : "Show password"}
            className="absolute top-1/2 right-3 -translate-y-1/2 rounded-md p-1 text-ink-muted-48 outline-none transition-colors hover:text-ink focus-visible:text-ink focus-visible:ring-2 focus-visible:ring-primary-focus"
          >
            {showPassword ? (
              <EyeOff className="size-4" aria-hidden="true" strokeWidth={1.75} />
            ) : (
              <Eye className="size-4" aria-hidden="true" strokeWidth={1.75} />
            )}
          </button>
        </div>
        {passwordError ? (
          <p
            id="change-email-password-error"
            className={errorClassName}
            role="alert"
          >
            {passwordError}
          </p>
        ) : null}
      </div>

      {state.error ? (
        <p className={errorClassName} role="alert">
          {state.error}
        </p>
      ) : null}
      {state.success ? (
        <p
          className="w-full text-left text-sm leading-[1.43] tracking-[-0.224px] text-success"
          role="status"
        >
          {state.success}
        </p>
      ) : null}
      <Button
        type="submit"
        disabled={pending}
        className="min-h-11 w-full rounded-full px-5 font-sans text-[17px] font-normal leading-[1.47] tracking-[-0.374px]"
      >
        {pending ? "Sending…" : "Change email"}
      </Button>
    </form>
  );
}