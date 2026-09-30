"use client";

import { Eye, EyeOff } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  useActionState,
  useState,
  startTransition,
  type FocusEvent,
} from "react";
import type { z } from "zod";

import {
  requestPasswordReset,
  updatePassword,
  type AuthActionState,
} from "@/app/actions/auth";
import { apiBrowser } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import {
  dialogActionsClassName,
  dialogPrimaryActionClassName,
} from "@/components/ui/dialog";
import { dialogFormListClassName } from "@/components/ui/dialog-form";
import { Input } from "@/components/ui/input";
import { detectBrowserTimeZone } from "@/lib/timezone";
import {
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
} from "@/lib/validation/auth";
import { cn } from "@/lib/utils";
import { resolveSafeReturnTo } from "@deadline-radar/validation";

const initialState: AuthActionState = {};

const authInputClassName = cn(
  "h-12 w-full min-w-0 rounded-none border-0 bg-transparent px-3.5 py-0 font-sans text-[15px] font-normal leading-normal tracking-[-0.2px] text-left text-ink shadow-none outline-none placeholder:text-ink-muted-48 focus-visible:border-0 focus-visible:ring-0 focus-visible:outline-none disabled:opacity-50 disabled:bg-transparent dark:bg-transparent aria-invalid:border-0 aria-invalid:ring-0 aria-invalid:text-destructive",
);

const authErrorClassName =
  "text-sm leading-[1.43] tracking-[-0.224px] text-destructive";

const authSuccessClassName =
  "text-center text-sm leading-[1.43] tracking-[-0.224px] text-ink-muted-48";

type ClientFieldErrors = Partial<Record<"email" | "password", string>>;

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

type AuthEmailFieldProps = {
  idPrefix: string;
  error?: string;
  onClearError: () => void;
  onBlur?: (event: FocusEvent<HTMLInputElement>) => void;
};

function AuthEmailField({
  idPrefix,
  error,
  onClearError,
  onBlur,
}: AuthEmailFieldProps) {
  const fieldId = `${idPrefix}-email`;

  return (
    <li className="py-0.5">
      <div className="space-y-1">
        <Input
          id={fieldId}
          name="email"
          type="email"
          placeholder="Email"
          aria-label="Email"
          autoComplete="email"
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${fieldId}-error` : undefined}
          className={authInputClassName}
          onBlur={onBlur}
          onChange={() => {
            if (error) onClearError();
          }}
        />
        {error ? (
          <p id={`${fieldId}-error`} className={`${authErrorClassName} px-3.5 pb-2 text-left`} role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </li>
  );
}

type AuthPasswordFieldProps = {
  idPrefix: string;
  name?: string;
  ariaLabel?: string;
  autoComplete: "current-password" | "new-password";
  error?: string;
  showPassword: boolean;
  onTogglePassword: () => void;
  onClearError: () => void;
  onBlur?: (event: FocusEvent<HTMLInputElement>) => void;
};

function AuthPasswordField({
  idPrefix,
  name = "password",
  ariaLabel = "Password",
  autoComplete,
  error,
  showPassword,
  onTogglePassword,
  onClearError,
  onBlur,
}: AuthPasswordFieldProps) {
  const fieldId = `${idPrefix}-${name}`;

  return (
    <li className="py-0.5">
      <div className="space-y-1">
        <div className="relative">
          <Input
            id={fieldId}
            name={name}
            type={showPassword ? "text" : "password"}
            placeholder={ariaLabel}
            aria-label={ariaLabel}
            autoComplete={autoComplete}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? `${fieldId}-error` : undefined}
            className={`${authInputClassName} pr-11`}
            onBlur={onBlur}
            onChange={() => {
              if (error) onClearError();
            }}
          />
          <button
            type="button"
            onClick={onTogglePassword}
            aria-label={showPassword ? "Hide password" : "Show password"}
            aria-pressed={showPassword}
            className="absolute top-1/2 right-3.5 -translate-y-1/2 rounded-sm text-ink-muted-48 transition-colors hover:text-ink focus-visible:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-focus"
          >
            {showPassword ? (
              <EyeOff className="size-4" aria-hidden="true" />
            ) : (
              <Eye className="size-4" aria-hidden="true" />
            )}
          </button>
        </div>
        {error ? (
          <p id={`${fieldId}-error`} className={`${authErrorClassName} px-3.5 pb-2 text-left`} role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </li>
  );
}

function AuthFormActions({
  pending,
  pendingLabel,
  submitLabel,
}: {
  pending: boolean;
  pendingLabel: string;
  submitLabel: string;
}) {
  return (
    <div className={dialogActionsClassName}>
      <Button
        type="submit"
        disabled={pending}
        className={cn(dialogPrimaryActionClassName, "font-medium")}
      >
        {pending ? pendingLabel : submitLabel}
      </Button>
    </div>
  );
}

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<string, string[]>>
  >({});
  const [showPassword, setShowPassword] = useState(false);
  const [clientErrors, setClientErrors] = useState<ClientFieldErrors>({});

  const confirmError = searchParams.get("error") === "confirm";

  const emailError =
    fieldErrors.email?.[0] ?? clientErrors.email ?? undefined;
  const passwordError =
    fieldErrors.password?.[0] ?? clientErrors.password ?? undefined;

  function readFormValues(form: HTMLFormElement) {
    const formData = new FormData(form);
    return {
      email: formData.get("email"),
      password: formData.get("password"),
    };
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = readFormValues(form);
    const errors = clientFieldErrors(loginSchema, values);
    if (Object.keys(errors).length > 0) {
      setClientErrors(errors);
      return;
    }

    setClientErrors({});
    setError(undefined);
    setFieldErrors({});
    setPending(true);

    // Same-origin /api rewrite → Elysia so the browser stores httpOnly cookies.
    const result = await apiBrowser<{
      redirectTo?: string;
      error?: string;
      fieldErrors?: Partial<Record<string, string[]>>;
    }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: values.email,
        password: values.password,
      }),
    });

    setPending(false);

    if (result.error) {
      setError(result.error);
      setFieldErrors(result.fieldErrors ?? {});
      return;
    }

    // SEC-005: never trust redirectTo blindly — validate, fall back internal.
    router.replace(resolveSafeReturnTo(result.redirectTo, "/summary"));
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="flex w-full flex-col" noValidate>
      {confirmError ? (
        <p
          className="mb-4 rounded-[11px] border border-hairline bg-canvas px-4 py-3 text-sm leading-[1.43] tracking-[-0.224px] text-ink-muted-80"
          role="status"
        >
          This link is invalid or has expired.{" "}
          <Link
            href="/forgot-password"
            className="font-medium text-primary hover:underline focus-visible:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-focus"
          >
            Request a new link
          </Link>
          .
        </p>
      ) : null}
      <ul className={dialogFormListClassName}>
        <AuthEmailField
          idPrefix="login"
          error={emailError}
          onClearError={() =>
            setClientErrors((current) => ({ ...current, email: undefined }))
          }
        />
        <AuthPasswordField
          idPrefix="login"
          autoComplete="current-password"
          error={passwordError}
          showPassword={showPassword}
          onTogglePassword={() => setShowPassword((visible) => !visible)}
          onClearError={() =>
            setClientErrors((current) => ({ ...current, password: undefined }))
          }
        />
      </ul>
      {error ? (
        <p className={`${authErrorClassName} mt-4`} role="alert">
          {error}
        </p>
      ) : null}
      <AuthFormActions
        pending={pending}
        pendingLabel="Signing in…"
        submitLabel="Sign in"
      />
    </form>
  );
}

export function RegisterForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<string, string[]>>
  >({});
  const [showPassword, setShowPassword] = useState(false);
  const [clientErrors, setClientErrors] = useState<ClientFieldErrors>({});

  const emailError =
    fieldErrors.email?.[0] ?? clientErrors.email ?? undefined;
  const passwordError =
    fieldErrors.password?.[0] ?? clientErrors.password ?? undefined;

  function readFormValues(form: HTMLFormElement) {
    const formData = new FormData(form);
    return {
      email: formData.get("email"),
      password: formData.get("password"),
    };
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = readFormValues(form);
    const errors = clientFieldErrors(registerSchema, values);
    if (Object.keys(errors).length > 0) {
      setClientErrors(errors);
      return;
    }

    setClientErrors({});
    setError(undefined);
    setFieldErrors({});
    setPending(true);

    const result = await apiBrowser<{
      redirectTo?: string;
      message?: string;
      error?: string;
      fieldErrors?: Partial<Record<string, string[]>>;
    }>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({
        email: values.email,
        password: values.password,
        timezone: detectBrowserTimeZone(),
      }),
    });

    setPending(false);

    if (result.error) {
      setError(result.error);
      setFieldErrors(result.fieldErrors ?? {});
      return;
    }

    if (result.redirectTo) {
      // SEC-005: validate; on invalid values stay on the page (show the
      // confirmation message below) instead of navigating.
      const safe = resolveSafeReturnTo(result.redirectTo, "");
      if (safe !== "") {
        router.replace(safe);
        router.refresh();
        return;
      }
    }

    setError(
      result.message ??
        "Check your email to confirm your account before signing in.",
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex w-full flex-col" noValidate>
      <ul className={dialogFormListClassName}>
        <AuthEmailField
          idPrefix="register"
          error={emailError}
          onClearError={() =>
            setClientErrors((current) => ({ ...current, email: undefined }))
          }
        />
        <AuthPasswordField
          idPrefix="register"
          autoComplete="new-password"
          error={passwordError}
          showPassword={showPassword}
          onTogglePassword={() => setShowPassword((visible) => !visible)}
          onClearError={() =>
            setClientErrors((current) => ({ ...current, password: undefined }))
          }
        />
      </ul>
      {error ? (
        <p className={`${authErrorClassName} mt-4`} role="alert">
          {error}
        </p>
      ) : null}
      <AuthFormActions
        pending={pending}
        pendingLabel="Creating account…"
        submitLabel="Create account"
      />
    </form>
  );
}

export function ForgotPasswordForm() {
  const [state, formAction, pending] = useActionState(
    requestPasswordReset,
    initialState,
  );
  const [clientErrors, setClientErrors] = useState<ClientFieldErrors>({});

  const emailError =
    state.fieldErrors?.email?.[0] ?? clientErrors.email ?? undefined;

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const errors = clientFieldErrors(forgotPasswordSchema, {
      email: formData.get("email"),
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
    <form onSubmit={handleSubmit} className="flex w-full flex-col" noValidate>
      <ul className={dialogFormListClassName}>
        <AuthEmailField
          idPrefix="forgot"
          error={emailError}
          onClearError={() =>
            setClientErrors((current) => ({ ...current, email: undefined }))
          }
        />
      </ul>
      {state.error ? (
        <p className={`${authErrorClassName} mt-4`} role="alert">
          {state.error}
        </p>
      ) : null}
      {state.success ? (
        <p className={`${authSuccessClassName} mt-4`} role="status">
          {state.success}
        </p>
      ) : null}
      <AuthFormActions
        pending={pending}
        pendingLabel="Sending…"
        submitLabel="Continue"
      />
    </form>
  );
}

export function ResetPasswordForm() {
  const [state, formAction, pending] = useActionState(
    updatePassword,
    initialState,
  );
  const [showPassword, setShowPassword] = useState(false);
  const [clientErrors, setClientErrors] = useState<
    Partial<Record<"password" | "confirmPassword", string>>
  >({});

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
    const errors = clientFieldErrors(resetPasswordSchema, {
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
    <form onSubmit={handleSubmit} className="flex w-full flex-col" noValidate>
      <ul className={dialogFormListClassName}>
        <AuthPasswordField
          idPrefix="reset"
          autoComplete="new-password"
          error={passwordError}
          showPassword={showPassword}
          onTogglePassword={() => setShowPassword((visible) => !visible)}
          onClearError={() =>
            setClientErrors((current) => ({ ...current, password: undefined }))
          }
        />
        <AuthPasswordField
          idPrefix="reset-confirm"
          name="confirmPassword"
          ariaLabel="Confirm password"
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
        <p className={`${authErrorClassName} mt-4`} role="alert">
          {state.error}
        </p>
      ) : null}
      <AuthFormActions
        pending={pending}
        pendingLabel="Updating…"
        submitLabel="Update password"
      />
    </form>
  );
}
