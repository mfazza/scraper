import type { Page } from "playwright";

/**
 * Checks if the page URL includes '/client/' to robustly detect active authentication without fragile DOM selectors.
 */
export async function isLoggedIn(page: Page, timeoutMs = 5000): Promise<boolean> {
  if (page.url().includes("/client/")) {
    return true;
  }
  try {
    await page.waitForURL("**/client/**", { timeout: timeoutMs });
    return true;
  } catch {
    return page.url().includes("/client/");
  }
}

/**
 * Thrown when a session becomes invalid. Forces a loud CLI failure to prevent silent failures or auto-relaunch loops.
 */
export class SessionExpiredError extends Error {
  constructor() {
    super("Session expired — re-run to re-authenticate.");
    this.name = "SessionExpiredError";
  }
}

/**
 * Asserts session validity; throws SessionExpiredError if expired.
 */
export async function assertStillLoggedIn(page: Page): Promise<void> {
  if (!(await isLoggedIn(page, 5000))) {
    throw new SessionExpiredError();
  }
}
