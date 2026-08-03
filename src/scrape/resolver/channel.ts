import type { Page } from "playwright";

/**
 * Extracts channel ID from Slack's client URL: .../client/<teamId>/<channelId>
 */
export function parseChannelIdFromUrl(url: string): string | null {
  const match = url.match(/\/client\/[^/]+\/([^/?#]+)/);
  return match ? match[1] : null;
}

/**
 * Resolves a channel name to a channel ID by locating and clicking it in the sidebar (with filter fallback).
 */
export async function navigateToChannel(page: Page, channelName: string): Promise<string> {
  const selectors = [
    `[data-qa="sidebar_channel_link"]:has-text("${channelName}")`,
    `a:has-text("${channelName}")`,
    `.p-channel_sidebar__channel:has-text("${channelName}")`,
    `text="${channelName}"`
  ];

  let clicked = false;
  for (const selector of selectors) {
    try {
      const locator = page.locator(selector).first();
      if (await locator.isVisible({ timeout: 1500 })) {
        await locator.click();
        clicked = true;
        break;
      }
    } catch {
      // ignore and try next fallback
    }
  }

  // Fallback: Use the sidebar filter input to find the channel
  if (!clicked) {
    console.log(`[navigateToChannel] Channel "${channelName}" not visible in sidebar. Trying filter input...`);
    try {
      const filterInput = page.locator('[data-qa="sidebar-text-filter-input_input"], [aria-label="Channel or user name"]').first();
      if (await filterInput.isVisible({ timeout: 2000 })) {
        await filterInput.click();
        await filterInput.fill(channelName);
        await page.waitForTimeout(2000);

        for (const selector of selectors) {
          try {
            const locator = page.locator(selector).first();
            if (await locator.isVisible({ timeout: 2000 })) {
              await locator.click();
              clicked = true;
              break;
            }
          } catch {
            // ignore
          }
        }
      }
    } catch (err: any) {
      console.warn(`[navigateToChannel] Sidebar filter search failed: ${err.message}`);
    }
  }

  if (!clicked) {
    throw new Error(`Could not find channel "${channelName}" in the sidebar to click.`);
  }

  await page.waitForURL("**/client/**", { timeout: 10000 });
  
  const channelId = parseChannelIdFromUrl(page.url());
  if (!channelId) {
    throw new Error(`Failed to parse channel ID from URL: ${page.url()}`);
  }
  
  return channelId;
}
