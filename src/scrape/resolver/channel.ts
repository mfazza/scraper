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

  // Fallback: Use the global Quick Switcher (Ctrl+K / Cmd+K) to search and open the conversation
  if (!clicked) {
    console.log(`[navigateToChannel] Channel/user "${channelName}" not visible in sidebar. Trying global Quick Switcher...`);
    try {
      // Focus the page body to ensure keyboard shortcuts register
      try {
        await page.focus("body");
      } catch {}

      const switcherInput = page.locator([
        '[data-qa="quick_switcher_input"]',
        'input[placeholder*="Go to"]',
        'input[aria-label*="Search or jump to"]',
        'input[placeholder*="Search by name"]',
        'input[placeholder*="Jump to"]'
      ].join(",")).first();

      let opened = false;
      const isMac = process.platform === "darwin";

      // Attempt 1: Primary shortcut
      try {
        await page.keyboard.press(isMac ? "Meta+k" : "Control+k");
        await switcherInput.waitFor({ state: "visible", timeout: 2000 });
        opened = true;
      } catch {
        // Attempt 2: Secondary shortcut fallback (mismatched OS/browser client keyboard layout)
        try {
          await page.keyboard.press(isMac ? "Control+k" : "Meta+k");
          await switcherInput.waitFor({ state: "visible", timeout: 2000 });
          opened = true;
        } catch {
          // Attempt 3: Click top nav/sidebar search buttons as a physical element click fallback
          const searchTrigger = page.locator('[data-qa="top_nav_search"], .p-ia__sidebar_header__search, [aria-label*="Search"]').first();
          if (await searchTrigger.isVisible({ timeout: 1000 })) {
            await searchTrigger.click();
            try {
              await switcherInput.waitFor({ state: "visible", timeout: 2000 });
              opened = true;
            } catch {}
          }
        }
      }

      if (!opened) {
        throw new Error("Unable to open the Slack Quick Switcher via shortcuts or click fallbacks.");
      }

      await switcherInput.click();
      await switcherInput.fill(channelName);
      
      // Allow search results to populate
      await page.waitForTimeout(2000);

      // Try clicking a matching result in the dropdown/listbox first
      const resultSelectors = [
        `[role="option"]:has-text("${channelName}")`,
        `[data-qa="quick_switcher_result"]:has-text("${channelName}")`,
        `.c-quick_switcher__result:has-text("${channelName}")`
      ];

      let resultClicked = false;
      for (const resSel of resultSelectors) {
        try {
          const resultOption = page.locator(resSel).first();
          if (await resultOption.isVisible({ timeout: 1500 })) {
            await resultOption.click();
            resultClicked = true;
            clicked = true;
            break;
          }
        } catch {
          // ignore
        }
      }

      // If no option clicked directly, press Enter on the active selection
      if (!resultClicked) {
        console.log(`[navigateToChannel] No explicit result clicked, pressing Enter for "${channelName}"...`);
        await page.keyboard.press("Enter");
        clicked = true;
      }
    } catch (err: any) {
      console.warn(`[navigateToChannel] Quick Switcher lookup failed: ${err.message}`);
      // Close the switcher if it failed and remains open
      try {
        await page.keyboard.press("Escape");
      } catch {}
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
