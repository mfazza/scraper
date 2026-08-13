import { chromium, type BrowserContext } from "playwright";
import { mkdir, chmod } from "node:fs/promises";
import path from "node:path";
import { isLoggedIn } from "./probe.ts";

/**
 * Project-local directory for persisting browser profiles and session states.
 */
export const PROFILE_DIR = path.join(process.cwd(), ".auth", "browser-profile");

/**
 * Slack sign-in entry URL.
 */
export const SLACK_ENTRY_URL = "https://slack.com/signin";

/**
 * Initializes or restores an authenticated browser context.
 * First attempts a headless probe of existing session cookies.
 * If expired, falls back to a headed browser for manual SSO/MFA, waiting until the client view loads.
 */
export async function getAuthenticatedContext(): Promise<BrowserContext> {
  await mkdir(PROFILE_DIR, { recursive: true });
  // Restrict profile directory access to owner read/write/execute.
  await chmod(PROFILE_DIR, 0o700);

  // Probe existing session in headless mode
  let context = await chromium.launchPersistentContext(PROFILE_DIR, { headless: true });
  let page = context.pages()[0] ?? (await context.newPage());
  
  let loggedIn = false;
  try {
    await page.goto("https://app.slack.com/client/", { waitUntil: "domcontentloaded", timeout: 15000 });
    loggedIn = await isLoggedIn(page, 5000);
  } catch {
    loggedIn = false;
  }

  if (loggedIn) {
    return context;
  }

  // Fallback to headed browser for manual SSO/MFA if session is invalid
  await context.close();

  context = await chromium.launchPersistentContext(PROFILE_DIR, { headless: false });
  page = context.pages()[0] ?? (await context.newPage());
  await page.goto("https://slack.com/signin");
  console.log("Please complete SSO login in the opened browser window...");
  console.log("Note: If you land on a 'Choose a workspace' list, click on your specific workspace to open it and enter the client.");

  // Wait for client URL in any page to signal successful auth.
  await Promise.race([
    page.waitForURL("**/client/**", { timeout: 0 }),
    new Promise<void>((resolve) => {
      context.on("page", async (newPage) => {
        try {
          await newPage.waitForURL("**/client/**", { timeout: 0 });
          resolve();
        } catch {
          // ignore page close/navigation errors during SSO phase
        }
      });
    })
  ]);

  return context;
}
