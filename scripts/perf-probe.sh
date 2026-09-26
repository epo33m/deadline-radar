#!/bin/sh
# perf-probe.sh — repeatable production latency baseline (Phase A, perf plan).
#
# Hits only public, read-only endpoints (/health, /openapi, unauthenticated
# 401s, /login). No secrets, no writes. Output is a small table plus a
# timestamped raw log under scripts/perf-logs/ for before/after comparison.
#
# Usage:
#   sh scripts/perf-probe.sh
#   API_ORIGIN=https://… WEB_ORIGIN=https://… sh scripts/perf-probe.sh
#
# Requirements: curl, awk.

set -eu

API_ORIGIN="${API_ORIGIN:-https://deadline-radar-api-production.up.railway.app}"
WEB_ORIGIN="${WEB_ORIGIN:-https://deadline-radar-web.vercel.app}"

LOGDIR="scripts/perf-logs"
mkdir -p "$LOGDIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
LOG="$LOGDIR/probe-$STAMP.log"

log() { printf '%s\n' "$*" | tee -a "$LOG"; }

probe() {
  # $1 = label, $2 = url, $3 = repeats
  label="$1"; url="$2"; n="$3"
  i=1
  while [ "$i" -le "$n" ]; do
    out="$(curl -sS -o /dev/null \
      -w 'ttfb=%{time_starttransfer} total=%{time_total} code=%{http_code} size=%{size_download}' \
      --max-time 30 "$url" 2>&1 || echo 'FAILED')"
    log "  $label run$i: $out"
    i=$((i + 1))
  done
}

log "== perf probe $STAMP =="
log "API: $API_ORIGIN"
log "WEB: $WEB_ORIGIN"
log ""
log "-- API /health (static JSON, no DB, rate-limit exempt) --"
probe "api-health" "$API_ORIGIN/health" 3
log ""
log "-- API /openapi (static, larger payload, rate-limit exempt) --"
probe "api-openapi" "$API_ORIGIN/openapi" 1
log ""
log "-- API /health/cron (touches Supabase) --"
probe "api-health-cron" "$API_ORIGIN/health/cron" 3
log ""
log "-- API unauth calls (401 expected; still pay Redis rate-limit + auth chain) --"
probe "api-summary-401" "$API_ORIGIN/api/v1/summary" 2
probe "api-tasks-401" "$API_ORIGIN/api/v1/tasks" 2
probe "api-session-401" "$API_ORIGIN/api/v1/auth/session" 1
log ""
log "-- WEB /login (documented static; watch x-vercel-cache) --"
probe "web-login" "$WEB_ORIGIN/login" 3
log ""
log "-- WEB /login deploy/proxy headers --"
curl -sS -D - -o /dev/null --max-time 30 "$WEB_ORIGIN/login" 2>/dev/null \
  | grep -iE '^(x-vercel-id|x-vercel-cache|cache-control|age):' \
  | tee -a "$LOG" || log "  (header fetch failed)"
log ""
log "-- API edge headers --"
curl -sS -D - -o /dev/null --max-time 30 "$API_ORIGIN/health" 2>/dev/null \
  | grep -iE '^(x-railway-edge|x-railway-request-id|x-hikari-trace):' \
  | tee -a "$LOG" || log "  (header fetch failed)"
log ""
log "raw log: $LOG"
