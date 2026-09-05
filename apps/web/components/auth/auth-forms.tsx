"use client";

import { Eye, EyeOff } from "lucide-react";
import { useRouter } from "next/navigation";
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
import { Input } from "@/components/ui/input";
import { detectBrowserTimeZone } from "@/lib/timezone";
import {
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
} from "@/lib/validation/auth";

const initialState: AuthActionState = {};

const authInputClassName =
  "h-11 rounded-[11px] border-hairline bg-canvas px-3 font-sans text-[17px] font-normal leading-[1.47] tracking-[-0.374px] text-ink shadow-none placeholder:text-ink-muted-48 focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20 aria-invalid:border-destructive aria-invalid:ring-destructive/20";

const authSubmitBaseClassName =
  "h-auto w-full rounded-full px-[22px] py-[11px] font-sans text-[17px] font-normal leading-[1.47] tracking-[-0.374px] transition-transform active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:pointer-events-none disabled:opacity-50 disabled:active:scale-100";

const authSubmitVariants = {
  primary: `${authSubmitBaseClassName} bg-primary text-on-primary hover:bg-primary/90 focus-visible:outline-primary-focus`,
  ink: `${authSubmitBaseClassName} bg-ink text-on-dark hover:bg-ink-muted-80 focus-visible:outline-ink-muted-80`,
} as const;

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
    <div className="space-y-2.5">
      <Input
        id={fieldId}
        name="email"
        type="email"
        autoComplete="email"
        placeholder="Enter email"
        aria-label="Email"
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${fieldId}-error` : undefined}
        className={authInputClassName}
        onBlur={onBlur}
        onChange={() => {
          if (error) onClearError();
        }}
      />
      {error ? (
        <p id={`${fieldId}-error`} className={authErrorClassName} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

type AuthPasswordFieldProps = {
  idPrefix: string;
  name?: string;
  placeholder?: string;
  ariaLabel?: string;
  autoComplete: "current-password" | "new-password";
  error?: string;
  showPassword: boolean;
  onTogglePassword: () => void;
  onClearError: () => void;
  withTopMargin?: boolean;
  onBlur?: (event: FocusEvent<HTMLInputElement>) => void;
};

function AuthPasswordField({
  idPrefix,
  name = "password",
  placeholder = "Enter password",
  ariaLabel = "Password",
  autoComplete,
  error,
  showPassword,
  onTogglePassword,
  onClearError,
  withTopMargin = true,
  onBlur,
}: AuthPasswordFieldProps) {
  const fieldId = `${idPrefix}-password`;

  return (
    <div className={withTopMargin ? "mt-6 space-y-2.5" : "space-y-2.5"}>
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
          className="absolute top-1/2 right-3 -translate-y-1/2 rounded-sm text-ink-muted-48 transition-colors hover:text-ink focus-visible:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-focus"
        >
          {showPassword ? (
            <EyeOff className="size-4" aria-hidden="true" />
          ) : (
            <Eye className="size-4" aria-hidden="true" />
          )}
        </button>
      </div>
      {error ? (
        <p id={`${fieldId}-error`} className={authErrorClassName} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function AuthFormActions({
  pending,
  pendingLabel,
  submitLabel,
  variant = "primary",
}: {
  pending: boolean;
  pendingLabel: string;
  submitLabel: string;
  variant?: keyof typeof authSubmitVariants;
}) {
  return (
    <Button
      type="submit"
      disabled={pending}
      className={`${authSubmitVariants[variant]} mt-8`}
    >
      {pending ? pendingLabel : submitLabel}
    </Button>
  );
}

export function LoginForm() {
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

    router.replace(result.redirectTo ?? "/dashboard");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="flex w-full flex-col" noValidate>
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
      router.replace(result.redirectTo);
      router.refresh();
      return;
    }

    setError(
      result.message ??
        "Check your email to confirm your account before signing in.",
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex w-full flex-col" noValidate>
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
      {error ? (
        <p className={`${authErrorClassName} mt-4`} role="alert">
          {error}
        </p>
      ) : null}
      <AuthFormActions
        pending={pending}
        pendingLabel="Creating account…"
        submitLabel="Create account"
        variant="ink"
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
      <AuthEmailField
        idPrefix="forgot"
        error={emailError}
        onClearError={() =>
          setClientErrors((current) => ({ ...current, email: undefined }))
        }
      />
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
        submitLabel="Send reset link"
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
      <AuthPasswordField
        idPrefix="reset"
        autoComplete="new-password"
        error={passwordError}
        showPassword={showPassword}
        onTogglePassword={() => setShowPassword((visible) => !visible)}
        onClearError={() =>
          setClientErrors((current) => ({ ...current, password: undefined }))
        }
        withTopMargin={false}
      />
      <AuthPasswordField
        idPrefix="reset-confirm"
        name="confirmPassword"
        placeholder="Confirm password"
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
