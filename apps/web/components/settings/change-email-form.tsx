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
import { LoadingDialog } from "@/components/ui/loading-dialog";
import { changeEmailSchema } from "@/lib/validation/auth";

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

type ChangeEmailFormProps = {
  onEmailChanged?: () => void;
  onCancel?: () => void;
};

export function ChangeEmailForm({
  onEmailChanged,
  onCancel,
}: ChangeEmailFormProps) {
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
  const passwordFieldId = "change-email-current-password";

  return (
    <>
      <LoadingDialog
        open={pending}
        title="Sending confirmation…"
        description="Please wait a moment"
      />
      <form onSubmit={handleSubmit} className="flex w-full flex-col" noValidate>
        <ul className={dialogFormListClassName}>
          <DialogFormRow label="New email" htmlFor={emailFieldId}>
            <div className="space-y-2">
              <Input
                id={emailFieldId}
                name="email"
                type="email"
                autoComplete="email"
                aria-invalid={Boolean(emailError)}
                aria-describedby={
                  emailError ? `${emailFieldId}-error` : undefined
                }
                className={dialogInputClassName}
                onChange={() => {
                  if (emailError) {
                    setClientErrors((current) => ({
                      ...current,
                      email: undefined,
                    }));
                  }
                }}
              />
              {emailError ? (
                <p
                  id={`${emailFieldId}-error`}
                  className={errorClassName}
                  role="alert"
                >
                  {emailError}
                </p>
              ) : null}
            </div>
          </DialogFormRow>

          <DialogFormRow
            label="Current password"
            htmlFor={passwordFieldId}
          >
            <div className="space-y-2">
              <div className="relative">
                <Input
                  id={passwordFieldId}
                  name="currentPassword"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  aria-invalid={Boolean(passwordError)}
                  aria-describedby={
                    passwordError ? `${passwordFieldId}-error` : undefined
                  }
                  className={`${dialogInputClassName} pr-11`}
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
                    <EyeOff
                      className="size-4"
                      aria-hidden="true"
                      strokeWidth={1.75}
                    />
                  ) : (
                    <Eye
                      className="size-4"
                      aria-hidden="true"
                      strokeWidth={1.75}
                    />
                  )}
                </button>
              </div>
              {passwordError ? (
                <p
                  id={`${passwordFieldId}-error`}
                  className={errorClassName}
                  role="alert"
                >
                  {passwordError}
                </p>
              ) : null}
            </div>
          </DialogFormRow>
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
            {pending ? "Sending…" : "Change email"}
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
    </>
  );
}