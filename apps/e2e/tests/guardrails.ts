/**
 * #61 — page-health guardrails for the e2e suite.
 *
 * During the #58 investigation a completely unstyled, non-interactive page
 * passed the suite silently: every `/_next` chunk failed at the network layer,
 * so no JavaScript ever ran and there was nothing alive to throw. The suite
 * asserted on DOM that server-rendered fine and stayed green.
 *
 * This module makes that class of failure impossible to miss. Import `test`
 * (and `expect` / `type Page`) from here instead of `@playwright/test` in any
 * spec that drives a browser. The overridden `context` fixture attaches a
 * collector to every page opened in the context — including the default `page`
 * fixture — and fails the test on teardown when the report is non-empty.
 * Specs that mint their own context (currently only the JS-disabled case in
 * `login-hydration.e2e.spec.ts`) attach explicitly via `collectPageHealth`
 * and assert via `assertPageHealthy`; a bun meta-test
 * (`apps/e2e/guardrails-scope.test.ts`) enforces both import rules.
 *
 * What fails a test:
 * - any `pageerror` except two proven abort-noise patterns, both documented
 *   at the filter (WebKit surfaces superseded navigation fetches as uncaught
 *   errors while Chromium aborts them silently; a real ChunkLoadError carries
 *   chunk identity and still fires),
 * - any `console.error` except Chromium's "Failed to load resource" noise and
 *   intermittent WebKit "Refused to apply a stylesheet" phantoms, both
 *   documented at the filters (React hydration errors surface here; warns are
 *   ignored — the app intentionally logs one `console.warn` in calendar),
 * - any `/_next/static/**` response that is not 200 or 304 (304: `page.reload`
 *   issues conditional requests; a 304 carries no body so the content-type
 *   check is skipped for it),
 * - a `.js` / `.css` asset with the wrong content type,
 * - any failed request (`requestfailed`) for one of those asset URLs — this is
 *   exactly the #58 signature,
 * - a teardown DOM audit finding an unnonced stylesheet link or a stray
 *   `<style>` element (deterministic backstop: production builds nonce every
 *   stylesheet link and app code never emits style elements, so either means
 *   real styling breakage; phantoms leave no DOM trace).
 *
 * Deliberately out of scope: document responses (a missing `public/favicon.ico`
 * 404s on every load today; navigation outcomes belong to test assertions, not
 * to this guardrail) and non-asset subresources (fonts, images — covered by
 * nothing here by design, per the ticket's CSS-or-JS wording).
 */
import {
  test as baseTest,
  expect,
  type Page,
} from "@playwright/test";

export type PageHealthIssue = {
  kind:
    | "pageerror"
    | "console-error"
    | "asset-status"
    | "asset-content-type"
    | "asset-request-failed"
    | "stylesheet-integrity";
  url?: string;
  detail: string;
};

export type PageHealthReport = {
  issues: PageHealthIssue[];
};

const JAVASCRIPT_CONTENT_TYPE = "application/javascript";
const CSS_CONTENT_TYPE = "text/css";

/** Next.js client assets. Everything the client runtime needs to attach. */
function isClientAsset(url: string): boolean {
  return url.includes("/_next/static/");
}

function assetExtension(url: string): "js" | "css" | null {
  const pathname = url.split("?", 1)[0].toLowerCase();
  if (pathname.endsWith(".js")) return "js";
  if (pathname.endsWith(".css")) return "css";
  return null;
}

/** Attach all collectors. Idempotent per page: call once, read any time. */
export function collectPageHealth(page: Page): PageHealthReport {
  const report: PageHealthReport = { issues: [] };
  const push = (issue: PageHealthIssue) => {
    report.issues.push(issue);
  };

  page.on("pageerror", (error) => {
    const message = `${error.name}: ${error.message}`;
    // WebKit surfaces a superseded RSC prefetch (`?_rsc=`, aborted by the
    // next navigation) as an uncaught "…due to access control checks" error;
    // Chromium aborts the identical fetch silently. Proven abort-noise, not an
    // app defect: it appears only on rapid successive navigations, scales with
    // pacing, all functional assertions pass, and the URLs are always
    // same-origin prefetches — where a genuine access-control failure is
    // impossible. Genuine RSC breakage still surfaces: non-200 chunks via
    // asset-status, CSP refusals via console-error, and content assertions in
    // the tests themselves.
    if (/\?_rsc=\S* due to access control checks\.?$/.test(message)) return;
    // A bare "TypeError: Load failed" with no URL, chunk identity, or detail,
    // firing in the same millisecond as a cancelled navigation fetch, is the
    // same abort-noise family wearing a thinner mask (verified twice: it
    // tracks cancelled RSC/stylesheet fetches during rapid navigations, and
    // every functional assertion passes around it). Exact-match only, so a
    // real ChunkLoadError ("Loading chunk X failed") or any TypeError with a
    // message still fires.
    if (message === "TypeError: Load failed") return;
    push({
      kind: "pageerror",
      url: page.url(),
      detail: message.slice(0, 500),
    });
  });

  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    // Chromium logs every failed fetch/response as
    // "Failed to load resource: …" — including application behavior the tests
    // provoke on purpose (a wrong-password login legitimately 401s). Those
    // events are never lost: asset failures are dually covered by the
    // response/requestfailed collectors below, and non-asset outcomes belong
    // to test assertions. The console rule keeps what only it can see:
    // hydration errors, React warnings-as-errors, and anything else scripts
    // log as errors.
    if (/^Failed to load resource\b/.test(text)) return;
    // "Refused to apply a stylesheet …" fires intermittently in WebKit with
    // no functional impact, no DOM trace, and no reproducer across controlled
    // runs (post-login render, ~2/7 sessions; all flows complete; Chromium
    // never shows it). Filtering it here is calibrated, not blind: the
    // teardown DOM audit below deterministically catches REAL stylesheet
    // breakage (an unnonced stylesheet link or a stray style element), which
    // is the only thing this message could usefully signal in a production
    // build whose app code never emits style elements.
    if (/^Refused to apply a stylesheet\b/.test(text)) return;
    push({
      kind: "console-error",
      url: message.location()?.url ?? page.url(),
      detail: text.slice(0, 500),
    });
  });

  page.on("response", (response) => {
    const url = response.url();
    if (!isClientAsset(url)) return;
    const status = response.status();
    if (status !== 200 && status !== 304) {
      push({ kind: "asset-status", url, detail: `HTTP ${status}` });
      return;
    }
    if (status === 304) return;
    const contentType =
      response.headers()["content-type"]?.split(";", 1)[0].trim() ?? "";
    const extension = assetExtension(url);
    if (extension === "js" && contentType !== JAVASCRIPT_CONTENT_TYPE) {
      push({
        kind: "asset-content-type",
        url,
        detail: `expected ${JAVASCRIPT_CONTENT_TYPE}, got ${contentType || "(missing)"}`,
      });
    } else if (extension === "css" && contentType !== CSS_CONTENT_TYPE) {
      push({
        kind: "asset-content-type",
        url,
        detail: `expected ${CSS_CONTENT_TYPE}, got ${contentType || "(missing)"}`,
      });
    }
  });

  page.on("requestfailed", (request) => {
    if (!isClientAsset(request.url())) return;
    push({
      kind: "asset-request-failed",
      url: request.url(),
      detail: request.failure()?.errorText ?? "unknown",
    });
  });

  return report;
}

/** One line per issue, most informative first. Empty array means healthy. */
export function pageHealthErrors(report: PageHealthReport): string[] {
  return report.issues.map((issue) => {
    const where = issue.url ? ` ${issue.url}` : "";
    return `[${issue.kind}]${where} :: ${issue.detail}`;
  });
}

/** Fail the test when the report is non-empty. */
export function assertPageHealthy(
  report: PageHealthReport,
  ignore?: (line: string) => boolean,
): void {
  const errors = pageHealthErrors(report).filter(
    (line) => !(ignore?.(line) ?? false),
  );
  expect(
    errors,
    "page-health guardrails (#61): the page below shipped broken assets or errors",
  ).toEqual([]);
}

/**
 * Drop-in `test` with guardrails on every page in every context it creates.
 * The `context.on("page")` hook catches pages opened after setup too, so
 * `page.goto`, `page.reload`, and popup-driven flows are all covered.
 *
 * Escape hatch for tests that intentionally visit an unhealthy page (E2E-06
 * asserts a 404, and Next's default 404 injects CSP-blocked inline styles):
 * push `{ type: INTENTIONAL_ERROR_PAGE, description: "<why>" }` onto
 * `test.info().annotations` before that navigation. The description is
 * mandatory — an exemption without one fails the test — so every hole in the
 * guardrail explains itself in the report.
 */
export const INTENTIONAL_ERROR_PAGE = "guardrails:intentional-error-page";

export const test = baseTest.extend({
  context: async ({ context }, use, testInfo) => {
    const reports: PageHealthReport[] = [];
    const pages: Page[] = [];
    context.on("page", (page) => {
      reports.push(collectPageHealth(page));
      pages.push(page);
    });
    await use(context);
    const exemption = testInfo.annotations.find(
      (annotation) => annotation.type === INTENTIONAL_ERROR_PAGE,
    );
    if (exemption) {
      expect(
        exemption.description,
        `page-health guardrails (#61): ${INTENTIONAL_ERROR_PAGE} requires a description naming the intentional error page`,
      ).toBeTruthy();
      return;
    }
    // Stylesheet integrity audit: in production builds every stylesheet link
    // carries the per-request nonce and app code never emits <style>
    // elements, so either finding means real styling breakage. This is the
    // deterministic backstop for the filtered console noise above — a phantom
    // refusal leaves no DOM trace, a real one always does. Scoped to pages
    // still open at teardown (normally one); earlier navigations are covered
    // by their own functional assertions.
    for (const page of pages) {
      if (page.isClosed()) continue;
      const audit = await page
        .evaluate(() => ({
          unnoncedLinks: document.querySelectorAll(
            'link[rel="stylesheet"]:not([nonce])',
          ).length,
          styleElements: document.querySelectorAll("style").length,
        }))
        .catch(() => null);
      if (!audit) continue;
      if (audit.unnoncedLinks > 0 || audit.styleElements > 0) {
        reports.push({
          issues: [
            {
              kind: "stylesheet-integrity",
              url: page.url(),
              detail:
                `unnonced stylesheet links: ${audit.unnoncedLinks}, ` +
                `style elements: ${audit.styleElements}`,
            },
          ],
        });
      }
    }
    const errors = reports.flatMap((report) => pageHealthErrors(report));
    expect(
      errors,
      `page-health guardrails (#61) in ${testInfo.title}: ` +
        "the pages this test visited shipped broken assets or errors",
    ).toEqual([]);
  },
});

export { expect };
export type { Page };
