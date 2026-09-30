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
import {
  dialogActionsClassName,
  dialogPrimaryActionClassName,
  dialogSecondaryActionClassName,
} from "@/components/ui/dialog";
import {
  DialogFormRow,
  dialogFormListClassName,
  dialogInputClassName,
} from "@/components/ui/dialog-form";
import { Input } from "@/components/ui/input";
import { changePasswordSchema } from "@/lib/validation/auth";

const initialState: AuthActionState = {};

const errorClassName =
  "pt-4 w-full text-left text-sm leading-[1.43] tracking-[-0.224px] text-destructive";

const successClassName =
  "pt-4 w-full text-left text-sm leading-[1.43] tracking-[-0.224px] text-success";

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
  id: string;
  name: string;
  label: string;
  autoComplete: "current-password" | "new-password";
  error?: string;
  showPassword: boolean;
  onTogglePassword: () => void;
  onClearError: () => void;
  onBlur?: (event: FocusEvent<HTMLInputElement>) => void;
};

function PasswordField({
  id,
  name,
  label,
  autoComplete,
  error,
  showPassword,
  onTogglePassword,
  onClearError,
  onBlur,
}: PasswordFieldProps) {
  return (
    <DialogFormRow label={label} htmlFor={id}>
      <div className="space-y-2">
        <div className="relative">
          <Input
            id={id}
            name={name}
            type={showPassword ? "text" : "password"}
            autoComplete={autoComplete}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? `${id}-error` : undefined}
            className={`${dialogInputClassName} pr-11`}
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
          <p id={`${id}-error`} className={errorClassName} role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </DialogFormRow>
  );
}

type ChangePasswordFormProps = {
  onPasswordChanged?: () => void;
  onCancel?: () => void;
};

export function ChangePasswordForm({
  onPasswordChanged,
  onCancel,
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
    <form
      onSubmit={handleSubmit}
      method="post"
      className="flex w-full flex-col"
      noValidate
    >
      <ul className={dialogFormListClassName}>
        <PasswordField
          id="change-current-password"
          name="currentPassword"
          label="Current password"
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
          id="change-password"
          name="password"
          label="New password"
          autoComplete="new-password"
          error={passwordError}
          showPassword={showPassword}
          onTogglePassword={() => setShowPassword((visible) => !visible)}
          onClearError={() =>
            setClientErrors((current) => ({ ...current, password: undefined }))
          }
        />
        <PasswordField
          id="change-confirm-password"
          name="confirmPassword"
          label="Confirm new password"
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
      </ul>

      {state.error ? (
        <p className={errorClassName} role="alert">
          {state.error}
        </p>
      ) : null}
      {state.success ? (
        <p className={successClassName} role="status">
          {state.success}
        </p>
      ) : null}

      <div className={dialogActionsClassName}>
        <Button
          type="submit"
          disabled={pending}
          className={dialogPrimaryActionClassName}
        >
          {pending ? "Updating…" : "Update password"}
        </Button>
        {onCancel ? (
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={pending}
            className={dialogSecondaryActionClassName}
          >
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  );
}