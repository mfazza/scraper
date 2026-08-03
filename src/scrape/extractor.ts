import type { Page } from "playwright";
import { humanPacedDelay } from "./pacing.ts";
import { type RawMessage, RAW_MESSAGE_SCHEMA_VERSION } from "../types.ts";
import { assertStillLoggedIn } from "../auth/probe.ts";

/**
 * DOM selectors verified from live workspace attributes, targeting message pane isolates to ignore sidebar elements.
 */
export const SELECTORS = {
  messageList: '.p-message_pane .c-scrollbar__hider, .p-message_pane [data-qa="slack_kit_scrollbar"]',
  beginningOfConversation: '[data-qa="beginning_of_conversation"], .c-message_list__beginning, .p-beginning_of_history',
  messageRow: '[data-qa="message_container"], .c-message',
  replyCountAffordance: '[data-qa="reply_count"], .c-message__reply_count_button, [data-qa="reply_count_button"]',
  threadPanelClose: '[data-qa="thread_flexpane_close"], .p-flexpane__close, [data-qa="flexpane_close"], [aria-label="Close"]'
};

/**
 * Parses a single message row from Slack's DOM into a plain object.
 * Runs in the browser context.
 */
function extractSingleRowFromDOM(row: HTMLElement, selectors: typeof SELECTORS) {
  const ts = row.getAttribute("data-msg-ts") || row.getAttribute("data-ts") || row.querySelector("[data-msg-ts]")?.getAttribute("data-msg-ts") || row.querySelector("[data-ts]")?.getAttribute("data-ts");
  if (!ts) return null;

  const senderEl = row.querySelector('[data-qa="message_sender"]') || row.querySelector(".c-message__sender_link");
  const author = senderEl ? senderEl.textContent?.trim() || "Unknown" : "Unknown";
  const authorHref = senderEl ? senderEl.getAttribute("href") || "" : "";
  const authorIdMatch = authorHref.match(/\/team\/(U[A-Z0-9]+)/);
  const authorId = authorIdMatch ? authorIdMatch[1] : "";

  const textEl = row.querySelector('[data-qa="message-text"]') || row.querySelector(".p-rich_text_section");
  const text = textEl ? textEl.textContent?.trim() || "" : "";

  const replyCountEl = row.querySelector(selectors.replyCountAffordance);
  const hasReplies = !!replyCountEl;

  const permalinkEl = row.querySelector('[data-qa="message-timestamp"]') || row.querySelector("a.c-link");
  const permalink = permalinkEl ? permalinkEl.getAttribute("href") || "" : "";

  const editedEl = row.querySelector('[data-qa="message-edited"]') || row.querySelector(".c-message__edited_label");
  const edited = !!editedEl || row.textContent?.includes("(edited)");

  const files: { filename: string; url: string }[] = [];
  const fileContainers = row.querySelectorAll('[data-qa="file_container"]');
  fileContainers.forEach((container) => {
    const nameEl = container.querySelector('[data-qa="file_name"]') || container.querySelector("a");
    const filename = nameEl ? nameEl.textContent?.trim() || "File" : "File";
    const url = nameEl ? nameEl.getAttribute("href") || "" : "";
    if (url) {
      files.push({ filename, url });
    }
  });

  return {
    ts,
    author,
    authorId,
    text,
    permalink,
    edited,
    hasReplies,
    files
  };
}

/**
 * Scrolls the virtualized Slack message list bottom-to-top, collecting messages via a MutationObserver
 * and immediately expanding thread replies to prevent virtualized unmounting.
 */
export async function scrapeChannelHistory(page: Page, options?: { sinceTs?: string | null }): Promise<RawMessage[]> {
  const since = options?.sinceTs ? Number(options.sinceTs) : null;

  // Wait for the message list scroll container to mount.
  await page.waitForSelector(SELECTORS.messageList, { state: "attached", timeout: 15000 }).catch(() => {
    console.warn("[Extractor] Warning: message list selector did not mount in time. Proceeding anyway...");
  });

  // Diagnostic log of initial DOM state.
  const listExists = await page.evaluate((selectors) => {
    const list = document.querySelector(selectors.messageList);
    return {
      foundList: !!list,
      foundRows: list ? list.querySelectorAll(selectors.messageRow).length : 0,
      url: window.location.href
    };
  }, SELECTORS);
  console.log(`[Extractor Debug] Status:`, listExists);

  // Inject single-row extractor helper into the browser context.
  await page.evaluate((selectors) => {
    (window as any).extractSingleRow = (row: HTMLElement) => {
      const ts = row.getAttribute("data-msg-ts") || row.getAttribute("data-ts") || row.querySelector("[data-msg-ts]")?.getAttribute("data-msg-ts") || row.querySelector("[data-ts]")?.getAttribute("data-ts");
      if (!ts) return null;

      const senderEl = row.querySelector('[data-qa="message_sender"]') || row.querySelector(".c-message__sender_link");
      const author = senderEl ? senderEl.textContent?.trim() || "Unknown" : "Unknown";
      const authorHref = senderEl ? senderEl.getAttribute("href") || "" : "";
      const authorIdMatch = authorHref.match(/\/team\/(U[A-Z0-9]+)/);
      const authorId = authorIdMatch ? authorIdMatch[1] : "";

      const textEl = row.querySelector('[data-qa="message-text"]') || row.querySelector(".p-rich_text_section");
      const text = textEl ? textEl.textContent?.trim() || "" : "";

      const replyCountEl = row.querySelector(selectors.replyCountAffordance);
      const hasReplies = !!replyCountEl;

      const permalinkEl = row.querySelector('[data-qa="message-timestamp"]') || row.querySelector("a.c-link");
      const permalink = permalinkEl ? permalinkEl.getAttribute("href") || "" : "";

      const editedEl = row.querySelector('[data-qa="message-edited"]') || row.querySelector(".c-message__edited_label");
      const edited = !!editedEl || row.textContent?.includes("(edited)");

      const files: { filename: string; url: string }[] = [];
      const fileContainers = row.querySelectorAll('[data-qa="file_container"]');
      fileContainers.forEach((container) => {
        const nameEl = container.querySelector('[data-qa="file_name"]') || container.querySelector("a");
        const filename = nameEl ? nameEl.textContent?.trim() || "File" : "File";
        const url = nameEl ? nameEl.getAttribute("href") || "" : "";
        if (url) {
          files.push({ filename, url });
        }
      });

      return {
        ts,
        author,
        authorId,
        text,
        permalink,
        edited,
        hasReplies,
        files
      };
    };
  }, SELECTORS);

  // Initialize in-page buffer and MutationObserver.
  await page.evaluate((selectors) => {
    (window as any).__scrapedMessages = [];
    
    // Extract already-visible rows.
    const list = document.querySelector(selectors.messageList);
    if (list) {
      const rows = Array.from(list.querySelectorAll(selectors.messageRow));
      rows.forEach((row) => {
        const parsed = (window as any).extractSingleRow(row, selectors);
        if (parsed) {
          (window as any).__scrapedMessages.push(parsed);
        }
      });
    }

    // Observe DOM changes to capture virtualized rows as they mount.
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            const el = node as HTMLElement;
            const rows = el.matches(selectors.messageRow)
              ? [el]
              : Array.from(el.querySelectorAll(selectors.messageRow));
            
            rows.forEach((row) => {
              const parsed = (window as any).extractSingleRow(row, selectors);
              if (parsed && !(window as any).__scrapedMessages.some((m: any) => m.ts === parsed.ts)) {
                (window as any).__scrapedMessages.push(parsed);
              }
            });
          }
        });
      }
    });

    if (list) {
      observer.observe(list, { childList: true, subtree: true });
    }
  }, SELECTORS);

  const finalMessages: Map<string, RawMessage> = new Map();
  let reachedBeginning = false;
  let scrollNoChangeCount = 0;
  let lastScrollTop = -1;

  // Scroll loop.
  console.log(`[Extractor] Starting scroll loop for ${page.url()}`);
  while (!reachedBeginning) {
    // Ensure session is still active before scrolling.
    console.log("[Extractor]   -> Asserting session liveness...");
    await assertStillLoggedIn(page);

    console.log("[Extractor]   -> Performing scrollBy(0, -400)...");
    await page.evaluate((selectors) => {
      const container = document.querySelector(selectors.messageList);
      if (container) {
        container.scrollBy(0, -400);
      }
    }, SELECTORS);

    console.log("[Extractor]   -> Awaiting human paced jitter...");
    await humanPacedDelay();

    // Drain buffered messages from page context.
    console.log("[Extractor]   -> Draining browser message buffer...");
    const drained: any[] = await page.evaluate(() => {
      const arr = (window as any).__scrapedMessages ?? [];
      (window as any).__scrapedMessages = [];
      return arr;
    });
    console.log(`[Extractor]   -> Drained ${drained.length} messages.`);

    let hitSyncPointer = false;
    for (const raw of drained) {
      if (since !== null && Number(raw.ts) <= since) {
        console.log(`[Extractor] Encountered message older than or equal to sinceTs (${raw.ts} <= ${options?.sinceTs}). Stopping scroll.`);
        hitSyncPointer = true;
        continue;
      }

      if (!finalMessages.has(raw.ts)) {
        const topLevelMsg = toRawMessage(raw);
        finalMessages.set(raw.ts, topLevelMsg);

        // Extract thread replies immediately if replies exist.
        if (raw.hasReplies) {
          console.log(`[Extractor]   -> Thread detected for msg ${raw.ts}. Attempting reply extraction...`);
          try {
            const replies = await extractThreadReplies(page, raw.ts);
            console.log(`[Extractor]      -> Scraped ${replies.length} replies.`);
            replies.forEach((rep) => {
              finalMessages.set(rep.ts, rep);
            });
          } catch (err) {
            // Warn on thread failure but do not abort top-level scroll loop.
            console.warn(`Warning: failed to extract replies for thread ${raw.ts}:`, err);
          }
        }
      }
    }

    if (hitSyncPointer) {
      reachedBeginning = true;
      break;
    }

    // Check termination criteria.
    console.log("[Extractor]   -> Checking loop termination metrics...");
    const scrollTop = await page.evaluate((selectors) => {
      const container = document.querySelector(selectors.messageList);
      return container ? container.scrollTop : 0;
    }, SELECTORS);

    if (scrollTop === lastScrollTop) {
      scrollNoChangeCount++;
    } else {
      scrollNoChangeCount = 0;
      lastScrollTop = scrollTop;
    }

    const beginningFound = await page.locator(SELECTORS.beginningOfConversation).isVisible({ timeout: 100 }).catch(() => false);
    console.log(`[Extractor]      -> scrollTop: ${scrollTop}, scrollNoChangeCount: ${scrollNoChangeCount}/5, beginningFound: ${beginningFound}`);
    reachedBeginning = beginningFound || (scrollNoChangeCount >= 5);
  }

  console.log(`[Extractor] Scroll loop finished. Collected ${finalMessages.size} unique messages.`);
  return Array.from(finalMessages.values()).sort((a, b) => Number(a.ts) - Number(b.ts));
}

/**
 * Temporarily expands a message thread to extract reply rows, then closes the thread panel.
 */
async function extractThreadReplies(page: Page, parentTs: string): Promise<RawMessage[]> {
  const rowLocator = page.locator(`[data-ts="${parentTs}"], [data-qa="message_container"][data-ts="${parentTs}"], [data-msg-ts="${parentTs}"]`).first();
  const replyButton = rowLocator.locator(`${SELECTORS.replyCountAffordance}, .c-message__reply_count_button`).first();
  
  if (!(await replyButton.isVisible({ timeout: 1000 }).catch(() => false))) {
    return [];
  }

  await replyButton.click();
  await humanPacedDelay();

  const repliesRaw: any[] = await page.evaluate((parent) => {
    const threadPanel = document.querySelector('[data-qa="thread_flexpane"], .p-flexpane, [data-qa="thread_sidebar"]');
    if (!threadPanel) return [];

    const rows = Array.from(threadPanel.querySelectorAll('[data-qa="message_container"], .c-message'));
    return rows.map((r) => {
      const ts = r.getAttribute("data-msg-ts") || r.getAttribute("data-ts") || "";
      const senderEl = r.querySelector('[data-qa="message_sender"]') || r.querySelector(".c-message__sender_link");
      const author = senderEl ? senderEl.textContent?.trim() || "Unknown" : "Unknown";
      const authorHref = senderEl ? senderEl.getAttribute("href") || "" : "";
      const authorIdMatch = authorHref.match(/\/team\/(U[A-Z0-9]+)/);
      const authorId = authorIdMatch ? authorIdMatch[1] : "";

      const textEl = r.querySelector('[data-qa="message-text"]') || r.querySelector(".p-rich_text_section");
      const text = textEl ? textEl.textContent?.trim() || "" : "";

      const permalinkEl = r.querySelector('[data-qa="message-timestamp"]') || r.querySelector("a.c-link");
      const permalink = permalinkEl ? permalinkEl.getAttribute("href") || "" : "";

      const editedEl = r.querySelector('[data-qa="message-edited"]') || r.querySelector(".c-message__edited_label");
      const edited = !!editedEl || r.textContent?.includes("(edited)");

      const files: { filename: string; url: string }[] = [];
      const fileContainers = r.querySelectorAll('[data-qa="file_container"]');
      fileContainers.forEach((container) => {
        const nameEl = container.querySelector('[data-qa="file_name"]') || container.querySelector("a");
        const filename = nameEl ? nameEl.textContent?.trim() || "File" : "File";
        const url = nameEl ? nameEl.getAttribute("href") || "" : "";
        if (url) {
          files.push({ filename, url });
        }
      });

      return {
        ts,
        author,
        authorId,
        text,
        permalink,
        edited,
        threadId: parent,
        files
      };
    });
  }, parentTs);

  const closeButton = page.locator(`${SELECTORS.threadPanelClose}, .p-flexpane__close, [data-qa="flexpane_close"]`).first();
  if (await closeButton.isVisible().catch(() => false)) {
    await closeButton.click();
    await humanPacedDelay();
  }

  return repliesRaw
    .filter((r) => !!r.ts)
    .map((r) => toRawMessage(r));
}

/**
 * Maps a raw parsed message object to RawMessage, defaulting threadId to ts for top-level messages.
 */
function toRawMessage(raw: any): RawMessage {
  return {
    schemaVersion: RAW_MESSAGE_SCHEMA_VERSION,
    ts: raw.ts,
    threadId: raw.threadId ?? raw.ts,
    author: raw.author,
    authorId: raw.authorId ?? "",
    text: raw.text,
    permalink: raw.permalink,
    edited: !!raw.edited,
    files: raw.files ?? []
  };
}
