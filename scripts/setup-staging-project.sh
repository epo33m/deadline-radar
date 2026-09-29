#!/usr/bin/env bash
#
# One-run wizard: provision the Supabase STAGING project for Deadline Radar.
#
# You drive the browser; this script tells you exactly what to click, captures
# the values you copy back, writes them to .env.staging, and registers the
# GitHub `staging` environment secret the deploy-staging.yml workflow reads.
#
# It never touches production: it writes only .env.staging (gitignored) and a
# new GitHub environment. No migration is applied here — the agent does that
# afterwards.
#
# Usage:  bash scripts/setup-staging-project.sh
# Re-run: safe. Values already in .env.staging are offered as defaults.

set -euo pipefail

# ──────────────────────────────────────────────────────────────────────────
# Wizard library: delightful, consistent UX, identical across every wizard.
# ──────────────────────────────────────────────────────────────────────────

if [[ -t 1 ]] && command -v tput >/dev/null 2>&1 && [[ "$(tput colors 2>/dev/null || echo 0)" -ge 8 ]]; then
  BOLD=$(tput bold); DIM=$(tput dim); RESET=$(tput sgr0)
  BLUE=$(tput setaf 4); GREEN=$(tput setaf 2); YELLOW=$(tput setaf 3); RED=$(tput setaf 1)
else
  BOLD=""; DIM=""; RESET=""; BLUE=""; GREEN=""; YELLOW=""; RED=""
fi

# Author sets this at the top of the stages section.
TOTAL_STAGES=0

_STAGE_INDEX=0
ENV_FILE="${ENV_FILE:-.env}"
WRITTEN_ENV=()    # KEYs written to ENV_FILE this run
WRITTEN_SECRET=() # secret NAMEs set this run
SKIPPED=()        # things we couldn't do (e.g. gh missing)

# _clear wipes the terminal so only the current step is on screen. No-op when
# output isn't a terminal, so piped logs stay readable.
_clear() {
  [[ -t 1 ]] || return 0
  if command -v tput >/dev/null 2>&1; then tput clear; else printf '\033[2J\033[3J\033[H'; fi
}

# banner "Title" shows the opening frame: what this wizard does.
banner() {
  _clear
  printf '\n%s%s  %s%s\n' "$BOLD" "$BLUE" "$1" "$RESET"
  printf '%s  %s stages%s\n\n' "$DIM" "$TOTAL_STAGES" "$RESET"
  printf '%s  You drive the browser; this wizard tells you exactly what to do and\n' "$DIM"
  printf '  captures the values you copy back. Stop any time with Ctrl-C and re-run\n'
  printf '  later, since it remembers values already saved.%s\n' "$RESET"
  pause "Ready to start?"
}

# stage "Name" clears the screen, then announces a stage and shows progress.
# Clearing keeps only the current step on screen.
stage() {
  _clear
  _STAGE_INDEX=$((_STAGE_INDEX + 1))
  printf '\n%s%s▸ Stage %s/%s · %s%s\n' \
    "$BOLD" "$BLUE" "$_STAGE_INDEX" "$TOTAL_STAGES" "$1" "$RESET"
}

# say "..." prints a plain instruction line.
say()  { printf '  %s\n' "$1"; }
# step "..." is a numbered-feeling action the human takes in the browser.
step() { printf '  %s•%s %s\n' "$BLUE" "$RESET" "$1"; }
note() { printf '  %s%s%s\n' "$DIM" "$1" "$RESET"; }
warn() { printf '  %s⚠ %s%s\n' "$YELLOW" "$1" "$RESET"; }

# open_url URL opens it in the human's browser, cross-platform incl. WSL.
open_url() {
  local url="$1"
  printf '  %s↗ opening%s %s\n' "$GREEN" "$RESET" "$url"
  { if   command -v wslview     >/dev/null 2>&1; then wslview "$url"
    elif command -v explorer.exe >/dev/null 2>&1; then explorer.exe "$url"
    elif command -v xdg-open    >/dev/null 2>&1; then xdg-open "$url"
    elif command -v open        >/dev/null 2>&1; then open "$url"
    else warn "couldn't open a browser; visit it manually: $url"; fi
  } >/dev/null 2>&1 || warn "couldn't open a browser, so visit it manually: $url"
}

# pause "msg" waits for the human to confirm they've done the manual part.
pause() {
  printf '  %s%s%s ' "$DIM" "${1:-Press Enter to continue}" "$RESET"
  read -r _ || true
}

# confirm "question" is a y/N gate; returns success on yes.
confirm() {
  local reply=""
  printf '  %s? %s [y/N] ' "$YELLOW" "$1"
  read -r reply || true
  [[ "$reply" =~ ^[Yy] ]]
}

# _existing KEY: current value of KEY in ENV_FILE, if any.
_existing() {
  [[ -f "$ENV_FILE" ]] || return 1
  local line; line=$(grep -E "^${1}=" "$ENV_FILE" | tail -n1) || return 1
  printf '%s' "${line#*=}"
}

# ask KEY "Prompt" reads a value into $KEY. Offers the existing .env value as
# a default on re-runs (Enter keeps it). Visible input (non-secret).
ask() {
  local key="$1" prompt="$2" current input
  current=$(_existing "$key" || true)
  if [[ -n "$current" ]]; then
    printf '  %s%s%s %s[Enter keeps current]%s ' "$BOLD" "$prompt" "$RESET" "$DIM" "$RESET"
  else
    printf '  %s%s%s ' "$BOLD" "$prompt" "$RESET"
  fi
  read -r input || true
  [[ -z "$input" && -n "$current" ]] && input="$current"
  printf -v "$key" '%s' "$input"
}

# ask_secret KEY "Prompt" is like ask, but input is hidden.
ask_secret() {
  local key="$1" prompt="$2" current input
  current=$(_existing "$key" || true)
  if [[ -n "$current" ]]; then
    printf '  %s%s%s %s[Enter keeps current]%s ' "$BOLD" "$prompt" "$RESET" "$DIM" "$RESET"
  else
    printf '  %s%s%s ' "$BOLD" "$prompt" "$RESET"
  fi
  read -rs input || true
  printf '\n'
  [[ -z "$input" && -n "$current" ]] && input="$current"
  printf -v "$key" '%s' "$input"
}

# write_env KEY VALUE upserts KEY=VALUE into ENV_FILE (creates it; replaces
# any existing line). Idempotent.
write_env() {
  local key="$1" value="$2" tmp
  touch "$ENV_FILE"
  tmp=$(mktemp)
  grep -vE "^${key}=" "$ENV_FILE" > "$tmp" || true
  printf '%s=%s\n' "$key" "$value" >> "$tmp"
  mv "$tmp" "$ENV_FILE"
  WRITTEN_ENV+=("$key")
  printf '  %s✓ wrote%s %s → %s\n' "$GREEN" "$RESET" "$key" "$ENV_FILE"
}

# set_secret NAME VALUE sets a GitHub Actions repo secret via gh. Falls back
# to a warning (and records it) if gh is unavailable or unauthenticated.
set_secret() {
  local name="$1" value="$2"
  if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
    if printf '%s' "$value" | gh secret set "$name" >/dev/null 2>&1; then
      WRITTEN_SECRET+=("$name")
      printf '  %s✓ set%s GitHub secret %s\n' "$GREEN" "$RESET" "$name"
      return
    fi
  fi
  SKIPPED+=("GitHub secret $name (set it manually: gh secret set $name)")
  warn "skipped GitHub secret $name: gh not ready; set it later"
}

# set_var NAME VALUE sets a GitHub Actions repo variable (non-secret).
set_var() {
  local name="$1" value="$2"
  if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
    if gh variable set "$name" --body "$value" >/dev/null 2>&1; then
      printf '  %s✓ set%s GitHub variable %s\n' "$GREEN" "$RESET" "$name"
      return
    fi
  fi
  SKIPPED+=("GitHub variable $name")
  warn "skipped GitHub variable $name, gh not ready; set it later"
}

# finish clears, then shows a closing summary of everything configured.
finish() {
  _clear
  printf '\n%s%s  ✓ Setup complete%s\n' "$BOLD" "$GREEN" "$RESET"
  (( ${#WRITTEN_ENV[@]} ))    && note "wrote ${#WRITTEN_ENV[@]} value(s) to $ENV_FILE: ${WRITTEN_ENV[*]}"
  (( ${#WRITTEN_SECRET[@]} )) && note "set ${#WRITTEN_SECRET[@]} GitHub secret(s): ${WRITTEN_SECRET[*]}"
  if (( ${#SKIPPED[@]} )); then
    printf '\n'; warn "still to do by hand:"
    for s in "${SKIPPED[@]}"; do note "  - $s"; done
  fi
  printf '\n'
}

# ──────────────────────────────────────────────────────────────────────────
# STAGES: author this section. One stage() per step the human takes.
# Replace the example below. Set TOTAL_STAGES to match the stages you write.
# ──────────────────────────────────────────────────────────────────────────

TOTAL_STAGES=4

# Write to .env.staging, never .env / .env.local (those point at production).
ENV_FILE=".env.staging"

PROJECT_NAME="deadline-radar-staging"
DB_USER_PREFIX="postgres"
POOLER_PORT="6543"
WEB_ORIGIN_VAL="http://127.0.0.1:3025"
API_ORIGIN_VAL="http://127.0.0.1:4025"

banner "Supabase staging project"

# ── Stage 1: create the project, capture ref / region / DB password ───────
stage "Create the staging project"
say "We create a brand-new Supabase project. Production is never touched."
note "Target parity with production: PostgreSQL 17 (new projects default to it)"
note "and region us-east-1, so migrations and the pooler behave identically."
open_url "https://supabase.com/dashboard/org"
step "Click 'New project'."
step "Name: $PROJECT_NAME   ·   Organization: pick your existing org."
step "Database Password: pick a strong one — LETTERS AND DIGITS ONLY (no @ : / # %),"
note "because it goes into a postgres:// URL unencoded. Later stages need it verbatim."
step "Region: 'US East (N. Virginia)'  → pooler host aws-0-us-east-1."
step "Leave the remaining plan/compute options at their defaults, then 'Create new project'."
step "Wait for provisioning (~2 min) until the dashboard says the project is ready."
pause "Project created and ready?"

step "Copy the project ref from the address bar:"
note "https://supabase.com/dashboard/project/<ref>   — 20 lowercase letters"
ask STAGING_REF "Project ref:"

step "Confirm the region code you're using for the pooler (default us-east-1 ="
note "US East (N. Virginia), which is what production runs on):"
ask STAGING_REGION "Region code:"

ask_secret STAGING_DB_PASSWORD "Database password (letters/digits only):"

if [[ ! "$STAGING_REF" =~ ^[a-z]{20}$ ]]; then
  warn "that ref doesn't look right (expected 20 lowercase letters) — copy it from the URL again"
  ask STAGING_REF "Project ref (retry):"
fi
if [[ -z "$STAGING_REF" ]]; then warn "no ref captured; later stages will be wrong"; fi
note "ref=$STAGING_REF  region=$STAGING_REGION"
pause "Values look right?"

# ── Stage 2: API keys ─────────────────────────────────────────────────────
stage "API keys"
say "New projects ship 'publishable' + 'secret' keys. Legacy anon/service_role keys"
note "still work if your project shows them instead — either pair is fine here,"
note "because the app passes keys straight to createClient() and never parses them."
open_url "https://supabase.com/dashboard/project/$STAGING_REF/settings/api-keys"
step "Open the 'Publishable and secret API keys' tab."
step "Copy the publishable key (sb_publishable_…). Legacy naming: anon key (eyJ…)."
ask_secret STAGING_ANON_KEY "Publishable / anon key:"

step "Reveal and copy the secret key (sb_secret_…). Legacy naming: service_role (eyJ…)."
ask_secret STAGING_SERVICE_KEY "Secret / service_role key:"

if [[ -n "$STAGING_ANON_KEY" && ! "$STAGING_ANON_KEY" =~ ^(sb_publishable_|eyJ) ]]; then
  warn "that key has an unexpected format — re-copy the PUBLISHABLE key, not the secret one"
  ask_secret STAGING_ANON_KEY "Publishable / anon key (retry):"
fi
if [[ -n "$STAGING_SERVICE_KEY" && ! "$STAGING_SERVICE_KEY" =~ ^(sb_secret_|eyJ) ]]; then
  warn "that key has an unexpected format — re-copy the SECRET key"
  ask_secret STAGING_SERVICE_KEY "Secret / service_role key (retry):"
fi
note "the two keys must differ (publishable ≠ secret)"
pause "Keys copied?"

# ── Stage 3: auth settings ───────────────────────────────────────────────
stage "Authentication settings"
say "Two toggles so local sign-in works without a mailbox."
open_url "https://supabase.com/dashboard/project/$STAGING_REF/settings/auth"
step "In 'User Signups', turn OFF 'Confirm email' (MAILER_AUTOCONFIRM)."
note "Production has this off for the same reason."
open_url "https://supabase.com/dashboard/project/$STAGING_REF/settings/auth"
step "URL Configuration → Site URL: set it to $WEB_ORIGIN_VAL"
step "Add these additional redirect URLs:"
note "  $WEB_ORIGIN_VAL/**"
note "  http://localhost:3025/**"
note "Save, then reload and confirm both fields stuck."
confirm "Confirm email OFF, Site URL and both redirect URLs saved?" \
  || warn "not confirmed — sign-in will fail later; fix it before running the dev server"

# ── Stage 4: write .env.staging + GitHub staging secret ──────────────────
stage "Write config and register staging secret"

if git check-ignore -q "$ENV_FILE" 2>/dev/null; then
  note "git ignores $ENV_FILE — staging secrets stay out of the repo"
else
  warn "$ENV_FILE is NOT gitignored; verify before committing anything"
fi

STAGING_SUPABASE_URL="https://$STAGING_REF.supabase.co"
STAGING_DATABASE_URL="postgresql://$DB_USER_PREFIX.$STAGING_REF:$STAGING_DB_PASSWORD@aws-0-$STAGING_REGION.pooler.supabase.com:$POOLER_PORT/postgres"
BRIDGE_SECRET_VAL="$(openssl rand -hex 32)"
CRON_SECRET_VAL="$(openssl rand -hex 32)"
CUTOFF_ISO="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

say "API-only secrets (never handed to the Next.js process):"
write_env SUPABASE_URL            "$STAGING_SUPABASE_URL"
write_env SUPABASE_ANON_KEY       "$STAGING_ANON_KEY"
write_env SUPABASE_SERVICE_ROLE_KEY "$STAGING_SERVICE_KEY"
write_env DATABASE_URL            "$STAGING_DATABASE_URL"
write_env AUTH_BRIDGE_SECRET      "$BRIDGE_SECRET_VAL"
write_env CRON_SECRET             "$CRON_SECRET_VAL"
write_env REMINDER_CUTOFF_ISO     "$CUTOFF_ISO"

say "Shared origin / port config:"
write_env WEB_ORIGIN "$WEB_ORIGIN_VAL"
write_env API_ORIGIN "$API_ORIGIN_VAL"
write_env API_PORT   "4025"

say "Web process (public by design, but kept out of the repo anyway):"
write_env NEXT_PUBLIC_SUPABASE_URL     "$STAGING_SUPABASE_URL"
write_env NEXT_PUBLIC_SUPABASE_ANON_KEY "$STAGING_ANON_KEY"

note "omitted on purpose: SUPABASE_JWT_SECRET (new projects sign ES256; the API"
note "verifies via JWKS), RESEND_* (UI work sends no mail), REDIS_URL (dev uses"
note "the in-memory rate limiter) — all optional outside production."

# Read-only connectivity probe: catches a mistyped password or wrong region
# now, instead of after 42 migrations.
say ""
if command -v psql >/dev/null 2>&1; then
  if psql "$STAGING_DATABASE_URL" -Atc "select version();" >/dev/null 2>&1; then
    printf '  %s✓%s reachable — credentials and pooler host are correct\n' "$GREEN" "$RESET"
  else
    warn "psql could not connect. Check: password verbatim (letters/digits only),"
    warn "region code, and that provisioning finished. Nothing was applied."
  fi
else
  warn "psql not installed; skipping the connectivity probe"
fi

say ""
say "GitHub 'staging' environment (deploy-staging.yml reads STAGING_DATABASE_URL):"
if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  REPO_FULL="$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || echo "")"
  if [[ -n "$REPO_FULL" ]]; then
    if gh api -X PUT "repos/$REPO_FULL/environments/staging" >/dev/null 2>&1; then
      printf '  %s✓%s environment staging ready on %s\n' "$GREEN" "$RESET" "$REPO_FULL"
    else
      SKIPPED+=("GitHub environment staging (create it in Settings → Environments)")
      warn "could not create the staging environment; set it in the GitHub UI"
    fi
    if printf '%s' "$STAGING_DATABASE_URL" | gh secret set STAGING_DATABASE_URL --env staging >/dev/null 2>&1; then
      WRITTEN_SECRET+=("STAGING_DATABASE_URL (env staging)")
      printf '  %s✓ set%s STAGING_DATABASE_URL on environment staging\n' "$GREEN" "$RESET"
    else
      SKIPPED+=("STAGING_DATABASE_URL (gh secret set STAGING_DATABASE_URL --env staging)")
      warn "could not set STAGING_DATABASE_URL"
    fi
  else
    SKIPPED+=("GitHub staging environment (could not resolve the repo)")
    warn "could not resolve the GitHub repo from this directory"
  fi
else
  SKIPPED+=("GitHub staging environment + STAGING_DATABASE_URL (gh not ready)")
  warn "gh not ready; register the staging secret later"
fi

say ""
say "Next, hand back to the agent — it applies the 42 migrations, verifies"
note "parity, seeds a user + courses + tasks, and wires dev:staging."
note "  bun --env-file=.env.staging run scripts/migrate.ts up"
note "  bun --env-file=.env.staging run scripts/migrate.ts verify"
pause "Done?"

finish
