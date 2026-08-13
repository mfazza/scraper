# Scraper Implementation & Fix Plan

This document outlines the diagnosed issues in the Slack scraper codebase and provides ready-to-apply patches and instructions.

---

## Issue 1: Scraper Hangs Indefinitely at "Starting clean stage..."

### 1. Root Cause
* When the scraping cycle ends, `cli.ts` executes `clean.sh`.
* In `clean.sh`, each calendar day's JSON messages are piped through `npx tsx "$SCRIPT_DIR/resolve-mentions.ts"`.
* **The bug:** `tsx` (the TypeScript runtime compiler) is missing from `package.json`'s `dependencies` or `devDependencies`.
* When run in non-interactive/headless environments, `npx` blocks and hangs indefinitely waiting for confirmation to download and run the package (e.g. `Need to install the following packages: tsx. Ok to proceed? (y)`).
* Furthermore, spawning `npx tsx` inside a shell loop over hundreds of daily files (such as 590+ daily files for `#team-cider`) incurs severe process-spawning overhead.

### 2. Resolution Path
Install `tsx` locally as a `devDependency` in `/Users/em.fazza/Work/Code/scraper/package.json` to ensure it is always cached locally and runs instantly without prompts.

**Step to run inside `scraper` directory:**
```bash
npm install --save-dev tsx
```

---

## Issue 2: Quick Switcher Shortcut Failure (Timeout for User "William Chen") [RESOLVED]

### 1. Root Cause
* In `src/scrape/resolver/channel.ts`, when a user or channel is not visible in the sidebar, the script triggers the Slack Quick Switcher using `Meta+k` on macOS or `Control+k` on other platforms.
* In headless chromium environments, focus can be lost, or the user agent might report differently, causing keyboard shortcuts to get swallowed or ignored by the Slack Web interface.
* The script then times out waiting 4 seconds for the input field to display.

### 2. Resolution Path
Refactor `navigateToChannel` in `src/scrape/resolver/channel.ts` to:
1. Ensure the page body is focused before triggering shortcut keys.
2. Attempt the primary shortcut first (e.g., `Meta+k` on Darwin).
3. Fall back to the alternate shortcut (`Control+k`) if the switcher input fails to appear within 2 seconds.
4. Add a final fallback to click the sidebar or top nav search triggers if keys are completely ignored.

### 3. Proposed Code Diff for `src/scrape/resolver/channel.ts`

Replace the Quick Switcher opening block with this highly robust multi-layer fallback:

```typescript
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
```

---

## Issue 3: Noisy Visual "Stopping scroll" Warning Logs

### 1. Root Cause
* In `src/scrape/extractor.ts`, once we hit a message older than or equal to `sinceTs`, we toggle `hitSyncPointer = true` and `continue` processing the rest of the currently drained batch.
* This logs the identical "Stopping scroll" statement multiple times per scraped batch, causing log bloat.

### 2. Proposed Code Diff for `src/scrape/extractor.ts`

Refactor the `since` block under `scrapeChannelHistory` so it only logs the transition once:

```typescript
    let hitSyncPointer = false;
    for (const raw of drained) {
      if (since !== null && Number(raw.ts) <= since) {
        if (!hitSyncPointer) {
          console.log(`[Extractor] Encountered message older than or equal to sinceTs (${raw.ts} <= ${options?.sinceTs}). Stopping scroll.`);
          hitSyncPointer = true;
        }
        continue;
      }
```

---

## Implementation Command Sequence

When launching your implementation session in the scraper folder, run these commands to install dependencies and verify:

```bash
# 1. Install tsx local dependency
npm install --save-dev tsx

# 2. Compile/typecheck the code to make sure there are no TypeScript syntax or import errors
npm run typecheck

# 3. Verify all tests pass
npm test
```
