/**
 * Shared URL-hygiene assertion for auth journey specs (#60, #62).
 *
 * Checks the raw URL, the percent-decoded URL (a browser encodes the
 * credential), and the parameter name itself — any one of them carrying the
 * password fails. Polls because the URL under assertion may still be settling
 * after a navigation or a client-side route change.
 */
import { expect, type Page } from "./guardrails";

export async function expectNoPasswordInUrl(
  page: Page,
  password: string,
): Promise<void> {
  const combined = async () => {
    const url = page.url();
    let decoded = url;
    try {
      decoded = decodeURIComponent(url);
    } catch {
      // Malformed escape: assert on the raw URL only.
    }
    return `${url} || ${decoded}`;
  };
  await expect.poll(combined, { timeout: 8_000 }).not.toContain(password);
  expect(page.url()).not.toMatch(/[?&]password=/);
}
