"use client";

import { Eye, EyeOff } from "lucide-react";
import {
  startTransition,
  useActionState,
  useEffect,
  useState,
  type FocusEvent,
} from "react";
import type { z } from "zod";

import { changePassword, type AuthActionState } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { changePasswordSchema } from "@/lib/validation/auth";

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

type PasswordFieldProps = {
  idPrefix: string;
  name: string;
  placeholder: string;
  ariaLabel: string;
  autoComplete: "current-password" | "new-password";
  error?: string;
  showPassword: boolean;
  onTogglePassword: () => void;
  onClearError: () => void;
  onBlur?: (event: FocusEvent<HTMLInputElement>) => void;
};

function PasswordField({
  idPrefix,
  name,
  placeholder,
  ariaLabel,
  autoComplete,
  error,
  showPassword,
  onTogglePassword,
  onClearError,
  onBlur,
}: PasswordFieldProps) {
  const fieldId = `${idPrefix}-${name}`;

  return (
    <div className="w-full space-y-2.5">
      <div className="relative">
        <Input
          id={fieldId}
          name={name}
          type={showPassword ? "text" : "password"}
          autoComplete={autoComplete}
          placeholder={placeholder}
          aria-label={ariaLabel}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${fieldId}-error` : undefined}
          className={fieldClassName}
          onBlur={onBlur}
          onChange={() => {
            if (error) onClearError();
          }}
        />
        <button
          type="button"
          onClick={onTogglePassword}
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
      {error ? (
        <p id={`${fieldId}-error`} className={errorClassName} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

type ChangePasswordFormProps = {
  onPasswordChanged?: () => void;
};

export function ChangePasswordForm({
  onPasswordChanged,
}: ChangePasswordFormProps) {
  const [state, formAction, pending] = useActionState(
    changePassword,
    initialState,
  );
  const [showPassword, setShowPassword] = useState(false);
  const [clientErrors, setClientErrors] = useState<
    Partial<
      Record<"currentPassword" | "password" | "confirmPassword", string>
    >
  >({});

  useEffect(() => {
    if (state.success) {
      onPasswordChanged?.();
    }
  }, [state.success, onPasswordChanged]);

  const currentPasswordError =
    state.fieldErrors?.currentPassword?.[0] ??
    clientErrors.currentPassword ??
    undefined;
  const passwordError =
    state.fieldErrors?.password?.[0] ?? clientErrors.password ?? undefined;
  const confirmError =
    state.fieldErrors?.confirmPassword?.[0] ??
    clientErrors.confirmPassword ??
    undefined;

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const errors = clientFieldErrors(changePasswordSchema, {
      currentPassword: formData.get("currentPassword"),
      password: formData.get("password"),
      confirmPassword: formData.get("confirmPassword"),
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

  return (
    <form onSubmit={handleSubmit} className="w-full space-y-4" noValidate>
      <PasswordField
        idPrefix="change"
        name="currentPassword"
        placeholder="Current password"
        ariaLabel="Current password"
        autoComplete="current-password"
        error={currentPasswordError}
        showPassword={showPassword}
        onTogglePassword={() => setShowPassword((visible) => !visible)}
        onClearError={() =>
          setClientErrors((current) => ({
            ...current,
            currentPassword: undefined,
          }))
        }
      />
      <PasswordField
        idPrefix="change"
        name="password"
        placeholder="New password"
        ariaLabel="New password"
        autoComplete="new-password"
        error={passwordError}
        showPassword={showPassword}
        onTogglePassword={() => setShowPassword((visible) => !visible)}
        onClearError={() =>
          setClientErrors((current) => ({ ...current, password: undefined }))
        }
      />
      <PasswordField
        idPrefix="change"
        name="confirmPassword"
        placeholder="Confirm new password"
        ariaLabel="Confirm new password"
        autoComplete="new-password"
        error={confirmError}
        showPassword={showPassword}
        onTogglePassword={() => setShowPassword((visible) => !visible)}
        onClearError={() =>
          setClientErrors((current) => ({
            ...current,
            confirmPassword: undefined,
          }))
        }
      />
      {state.error ? (
        <p className={errorClassName} role="alert">
          {state.error}
        </p>
      ) : null}
      {state.success ? (
        <p className="w-full text-left text-sm leading-[1.43] tracking-[-0.224px] text-success" role="status">
          {state.success}
        </p>
      ) : null}
      <Button
        type="submit"
        disabled={pending}
        className="min-h-11 w-full rounded-full px-5 font-sans text-[17px] font-normal leading-[1.47] tracking-[-0.374px]"
      >
        {pending ? "Updating…" : "Update password"}
      </Button>
    </form>
  );
}