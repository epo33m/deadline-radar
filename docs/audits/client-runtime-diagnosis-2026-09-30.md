# #58 — Client runtime does not attach: root cause

**Date:** 2026-09-30
**Branch:** `fix/58-client-runtime-diagnosis`
**Ticket:** [#58](https://github.com/epo33m/deadline-radar/issues/58) (diagnosis only — the fix is #59)
**Environment:** Next.js 16.3.4, React 19.2.8, macOS arm64, Chromium 1243 + WebKit 2359 (Playwright 1.63.0)

## Summary

One root cause, confirmed by a single-variable control.

`buildContentSecurityPolicy` gates `upgrade-insecure-requests` on `NODE_ENV`
(`apps/web/lib/security-headers.ts:61`). `next start` sets `NODE_ENV=production`
while serving **plain HTTP** on `127.0.0.1:3025`. The directive is therefore
emitted on a non-TLS origin, and WebKit — which, unlike Chromium, does not exempt
loopback — upgrades every subresource to `https://`. The TLS handshake fails
against the non-TLS listener, so **all 11 client chunks and the stylesheet fail to
load**. Nothing executes, so no React tree attaches.

The gate is wrong, not the directive. `upgrade-insecure-requests` is correct on a
real HTTPS deployment; what is broken is deciding to emit it from an environment
variable instead of from the origin the response is actually served on.

A second, **independent** defect was found and is *not* part of this root cause:
`style-src` blocks runtime-injected `<style>` **elements** in development (33 CSP
violations per page load). It is cosmetic and does not stop hydration. See
[Secondary finding](#secondary-finding-not-the-cause).

## The reproduction is narrower than the ticket states

The ticket reports the failure "in both engines, in dev and in a production
build". That is not what was observed. The full 2×2 matrix has exactly **one**
red cell:

| # | Server | Engine | Password toggle | Client-side nav | Verdict |
|---|--------|--------|-----------------|-----------------|---------|
| 1 | `next dev` (Turbopack) | Chromium | `password → text` | `/login → /register`, 1 main-frame nav | **green** |
| 2 | `next dev` (Turbopack) | WebKit | `password → text` | `/login → /register`, 1 main-frame nav | **green** |
| 3 | `next build && next start` | Chromium | `password → text` | `/login → /register`, 1 main-frame nav | **green** |
| 4 | `next build && next start` | WebKit | `password → password` | stuck on `/login`, 0 navs | **RED** |

Cell 4 is deterministic: two consecutive runs, identical verdict, 12 failed
requests each time. Cell 3 was re-run after the matrix and stayed green.

This corrects the prior claim recorded in `apps/e2e/servers.ts:42-49`, which
asserted the opposite: that `next dev` fails to hydrate while the production
bundle hydrates correctly. Both halves of that claim are wrong — `next dev`
hydrates in both engines, and the production build does **not** hydrate in WebKit.
That comment was introduced in `1ca1015` as a workaround for an observation that
was never verified, and it is what steered earlier investigation away from the
real cause. It has been corrected on this branch.

## Evidence

### The feedback loop

`apps/e2e/scripts/diagnose-client-runtime.ts` (added on this branch). Listeners
are attached before `goto`; the verdict is **behavioural**, never introspective:

1. Click the password-visibility toggle in `components/auth/auth-forms.tsx` and
   assert `input[name=password]`'s `type` flips `password → text`.
2. Click the "Create an account" `Link` and assert `location.pathname` becomes
   `/register` **without** a second main-frame navigation.

`__reactFiber`, `__next_f`, and `window.next` are recorded as supporting evidence
but never asserted on: their absence *is* the symptom under investigation, so
asserting on it would be circular. Exits non-zero when the runtime is dead, so it
doubles as the regression loop for #59.

### The sequence, and where it stops

`/login` in the production build emits **14 `<script>` tags**: 12 external, 2
inline. One external is the `noModule` legacy polyfill (`0cz1d0mv5g_q7.js`),
which a modern browser never requests.

| Script class | Count | What WebKit did |
|---|---|---|
| Inline, nonce-matched (`__next_f` bootstrap) | 2 | **executed** — `upgrade-insecure-requests` does not touch inline script |
| `noModule` polyfill | 1 | never requested (correct) |
| Modern external chunks | 11 | **all upgraded to `https://` → all failed** |
| `<link rel=stylesheet>` | 1 | **upgraded to `https://` → failed** |

The first failure, at **413 ms**, is the stylesheet. Every script failure follows
within 10 ms:

```
413ms  requestfailed  A TLS error caused the secure connection to fail.
                  https://127.0.0.1:3025/_next/static/chunks/0ffpgdnbite3v.css
416ms  requestfailed  … https://127.0.0.1:3025/_next/static/chunks/1_5mq6n0p3o5l.js
417ms  requestfailed  … 2a26pcmod58-f.js
417ms  requestfailed  … 33esf3lflkogz.js
418ms  requestfailed  … 3b4vlhgoy0vro.js
418ms  requestfailed  … 0vw3vpv0mcrdx.js
419ms  requestfailed  … turbopack-3vsfpiuc_wjv7.js
420ms  requestfailed  … 3bbrv4q05xj6_.js
420ms  requestfailed  … 1j4fum0vm4uhm.js
421ms  requestfailed  … 15yr0br7bl3h1.js
422ms  requestfailed  … 1y-s-xocx8hwu.js
422ms  requestfailed  … 2wfrq0tvuw7-w.js
```

`/_next` resources observed executing: **0**. The expected order, recovered from
the green Chromium run via CDP `Debugger.scriptParsed`, is 11 chunks beginning
with the main entry `1_5mq6n0p3o5l.js` (the `id="_R_"` tag) and ending with
`2wfrq0tvuw7-w.js`.

For contrast, cell 3 (production + Chromium) executed all 11 in that order with
**0 console errors and 0 page errors**.

### The first error, and what is missing rather than thrown

The first error is a **network** failure, not a JavaScript one. There is **no
uncaught exception, no `pageerror`, and no swallowed exception anywhere in the
run** — because no application JavaScript ever executed, there was nothing alive
to throw. That absence is the tell: a runtime that fails *after* loading always
leaves an exception behind. Silence plus zero executed chunks means the failure is
upstream of JavaScript entirely.

The document request itself succeeds (`200` on `http://…/login`) because
`upgrade-insecure-requests` does not apply to top-level navigations. The two
inline bootstrap scripts also succeed, which is why `window.__next_f` exists and
holds **2 unconsumed entries** — the RSC payload was pushed and never drained,
because the chunk that drains it is one of the 11 that failed. The dead
`<Link>` falls back to a native navigation, producing the 13th failed request
(`https://127.0.0.1:3025/register`), which is the "native GET submit" symptom in
the ticket.

### Ruling the three named suspects in or out

**Asset delivery — OUT.** All 13 assets referenced by the production HTML return
`200` with correct content types (`application/javascript`, `text/css`) when
requested over plain HTTP:

```
200 application/javascript  /_next/static/chunks/1_5mq6n0p3o5l.js
200 application/javascript  /_next/static/chunks/2a26pcmod58-f.js
200 text/css                /_next/static/chunks/0ffpgdnbite3v.css
200 application/javascript  /_next/static/chunks/turbopack-3vsfpiuc_wjv7.js
…  (13/13)
```

The files are present and served correctly. The browser never asks for them over
`http`. This is also why the earlier `curl`-based investigation concluded asset
delivery was fine — and it was right.

**CSP — IN, but only one directive.** `upgrade-insecure-requests` is the cause.
The ticket lists it as already found and fixed; that fix is real but **incomplete**
(`apps/web/lib/security-headers.ts:53-61` gates it on `isDev` only, so the
production-mode / plain-HTTP case was never covered). The control below is the
direct evidence. No other CSP directive is involved: the per-request nonce is
correctly attached to all 14 script tags and matches the response header, and
nonce mismatches produce a *different* signature (inline scripts refused, chunks
loaded) than the one observed.

**Proxy matcher — OUT.** The matcher (`apps/web/proxy.ts:210-224`) excludes
`/_next/static`, so it never runs on the failing requests. The document request it
*does* match returned correct HTML containing all 14 script tags. The proxy is
involved only as the **delivery mechanism for the header**, which is expected —
it is where security headers are set. Confirmed negatively by the control: the
fix lives inside the code path the proxy calls, and the proxy itself is unchanged.

### The control

Single variable: suppress `upgrade-insecure-requests` in
`buildContentSecurityPolicy` (throwaway probe, tagged, reverted, artifact
rebuilt). Response header on `next start` then no longer contains the directive,
and WebKit goes green:

```
── prod-webkit-no-uir (webkit) ──
  client runtime alive : true
  password toggle      : true (password → text)
  client nav           : true (→ /register, 1 main-frame navs)
  console errors       : 0
```

Same binary, same engine, same build inputs, same port — only the directive
differs. Root cause established.

## Single root cause, or several?

**One root cause for the client-runtime failure.** The three engine/build
variations that looked like independent defects are all the same directive
failing on a non-TLS origin:

- WebKit-only because Chromium exempts loopback from `upgrade-insecure-requests`.
- Production-only because `isDev` is the only condition on the emit, and
  `next start` sets `NODE_ENV=production`.

**Two further independent defects** were found, neither of which prevents
hydration:

### 1. HSTS has the same wrong gate (latent)

`next start` on `127.0.0.1:3025` also emits:

```
strict-transport-security: max-age=63072000; includeSubDomains; preload
```

`isProd` is the only condition (`apps/web/lib/security-headers.ts:80-82`). It does
not break the current repro — loopback is not a secure origin, so WebKit does not
pin it — but it is the same defect in the same function, and
`includeSubDomains; preload` is submitted to the browser's preload list. It
should be fixed in the same change, by the same mechanism.

### Secondary finding (not the cause)

`style-src 'self' 'nonce-…'` blocks runtime-injected `<style>` **elements**;
`style-src-attr 'unsafe-inline'` (added on the CSP branch) authorises the
`style` *attribute* only, which is a different directive. In development this
logs 33 CSP violations per page load:

> Applying inline style violates the following Content Security Policy directive
> 'style-src …'. Either the 'unsafe-inline' keyword, a hash
> **('sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=')**, or a nonce is required.

That hash is the SHA-256 of the **empty string**, so the blocked elements are
empty `<style>` tags (Turbopack dev overlay scaffolding) with **zero visual
impact**. It is why cells 1 and 2 log 33 errors each while still hydrating. It is
a genuine defect and will keep the console dirty, but it neither causes nor
contributes to the runtime failure, and fixing it will not make #59's symptom go
away.

## Proposed minimal fix

Gate the two TLS-dependent directives on the origin the response is actually
served from, not on `NODE_ENV`. In `apps/web/proxy.ts`, derive it per request and
pass it into `buildSecurityHeaders`; replace both the `isDev` condition on
`upgrade-insecure-requests` and the `isProd` condition on HSTS with it.

```
isSecure = (request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol) === "https:"
```

`isDev` stays as a parameter — `unsafe-eval` in `script-src` is genuinely an
environment concern.

**Do not** add a feature flag or env var to select this. It reintroduces "pick
the right variable" foot-guns of the same family as the original bug, and the
correct answer is always the same.

### Risk if this diagnosis is wrong

The material risk is **silently disabling `upgrade-insecure-requests` and HSTS in
real production**. Both are derived from a proxy header; if the deployment does
not send `x-forwarded-proto`, or a platform terminates TLS without forwarding the
protocol, the directive stops being emitted on HTTPS origins. The app would look
fixed and be quietly less secure, with nothing failing.

Mitigation, and it should be part of #59, not optional:

- **Fail closed.** Emit both directives unless the request *explicitly* reports
  `http:`. Absent or unparseable header ⇒ treat as secure. Never the inverse.
- **Verify against the real deployment.** After the change, confirm a production
  response still carries `upgrade-insecure-requests` and HSTS, and that
  `http://` still gets neither. Both halves, on the deployed host.

A second, smaller risk: this fix makes `next start` on loopback usable again,
which removes the reason the e2e suite was pointed at `next start` instead of
`next dev` (`apps/e2e/servers.ts:41-51`). That is desirable, but #59 should
re-check whether the dev server is now a viable e2e target rather than leaving
the comment as-is.

### A unit test asserts the bug

`apps/web/lib/security-headers.test.ts:50` is named *"emits
upgrade-insecure-requests in prod only, never in dev"*. It pins the exact
invariant that is wrong. #59 must change it, not satisfy it — a green run of
that test today is an assertion that the defect is present. The replacement
should assert the origin-based rule: emitted for an `https:` request, absent for
an `http:` one, in both environments.

## How this was produced

No production system was contacted. `/login` is server-static
(`components/auth/auth-page-shell.tsx` renders only `Link`s and `BrandLogo` — no
API, DB, or session call), so the entire matrix ran against a **web process with
no env file at all** and the API was never started. No `.env.local` (which points
at production) was loaded. Chromium and WebKit were driven against
`127.0.0.1:3025` only.

Reproduce with:

```bash
# terminal 1
cd apps/web && bunx next build && bunx next start --port 3025

# terminal 2
cd apps/e2e && bun scripts/diagnose-client-runtime.ts \
  --browser webkit --url http://127.0.0.1:3025/login --label prod-webkit
```

Exits `1` and writes an evidence bundle to `/tmp/dr58/evidence/`. Swap
`--browser chromium` for the green cell, or run `next dev` for the dev rows.

## Verdict against the ticket's acceptance criteria

- [x] Rests on observed browser and network evidence, not on `__reactFiber` /
      `__next_f` / `window.next` alone — the verdict is the password toggle and a
      client-side navigation; introspection is supporting evidence only.
- [x] Records whether each required client bundle executes, in what order, and
      where the sequence stops — 2 inline scripts execute, 0 of 11 chunks
      execute, expected order recovered from the green cell via CDP.
- [x] Identifies the first error, warning, or missing request preceding the
      failure, including any swallowed exception — first failure is the 413 ms
      TLS failure on the stylesheet; **no** exception exists, and why.
- [x] Explicitly rules asset delivery, CSP, and the proxy matcher in or out, each
      with its evidence — asset delivery OUT (13/13 at `200`), CSP IN via a
      single directive, proxy matcher OUT.
- [x] States whether this is a single root cause or several independent defects —
      one root cause; plus HSTS on the same wrong gate (latent) and a cosmetic
      dev-only CSP `style-src` element defect.
- [x] Proposes the minimal fix and names the risk if the diagnosis is wrong —
      gate on request protocol, fail closed, verify on the deployed host.
- [x] If the root cause cannot be established, says so — it was established, by
      single-variable control.
- [x] No production system is touched.
