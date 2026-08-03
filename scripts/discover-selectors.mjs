#!/usr/bin/env node
/**
 * Developer utility to discover Slack DOM selectors and landmarks using non-guessy heuristics.
 * Reuses the authenticated browser profile from src/auth/session.ts.
 */
import { getAuthenticatedContext } from "../src/auth/session.ts";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const FINDINGS_PATH = path.join(
  process.cwd(),
  ".planning/phases/01-login-first-end-to-end-archive/01-SPIKE-FINDINGS.md",
);

function section(title, lines) {
  console.log(`\n=== ${title} ===`);
  for (const line of lines) console.log(line);
}

async function main() {
  console.log("Launching browser (reusing your existing session if available)...\n");
  const context = await getAuthenticatedContext();
  const page = context.pages()[0] ?? (await context.newPage());

  const findings = {};

  // --- 1. Entry URL & login landmark ---
  await page.waitForTimeout(1500);
  const entryUrl = page.url();
  const loginLandmarks = await page.evaluate(() => {
    const candidates = Array.from(
      document.querySelectorAll("[data-qa], [aria-label]"),
    ).slice(0, 400);
    return candidates
      .filter((el) => {
        const qa = el.getAttribute("data-qa") || "";
        const label = el.getAttribute("aria-label") || "";
        return /workspace|team|home|sidebar/i.test(qa + " " + label);
      })
      .slice(0, 15)
      .map((el) => ({
        tag: el.tagName.toLowerCase(),
        dataQa: el.getAttribute("data-qa"),
        ariaLabel: el.getAttribute("aria-label"),
      }));
  });
  findings.entryUrl = entryUrl;
  findings.loginLandmarkCandidates = loginLandmarks;
  section("1. Entry URL & Login Landmark", [
    `Confirmed entry URL (post-load): ${entryUrl}`,
    `Candidate landmark elements (data-qa/aria-label containing workspace/team/home/sidebar):`,
    JSON.stringify(loginLandmarks, null, 2),
  ]);

  // --- 2. Quick-switcher mechanics ---
  const isMac = process.platform === "darwin";
  await page.keyboard.press(isMac ? "Meta+k" : "Control+k");
  await page.waitForTimeout(800);
  const quickSwitcherInputs = await page.evaluate(() => {
    return Array.from(document.querySelectorAll("input"))
      .filter((el) => el.offsetParent !== null)
      .map((el) => ({
        placeholder: el.placeholder,
        ariaLabel: el.getAttribute("aria-label"),
        dataQa: el.getAttribute("data-qa"),
        id: el.id,
      }));
  });
  await page.screenshot({ path: "/tmp/slack-quickswitcher.png" }).catch(() => {});
  await page.keyboard.press("Escape").catch(() => {});
  findings.quickSwitcherShortcut = isMac ? "Meta+k (Cmd+K)" : "Control+k (Ctrl+K)";
  findings.quickSwitcherInputs = quickSwitcherInputs;
  section("2. Quick-Switcher Mechanics", [
    `Shortcut tried: ${findings.quickSwitcherShortcut}`,
    `Visible <input> elements after pressing shortcut (empty = shortcut likely didn't open it):`,
    JSON.stringify(quickSwitcherInputs, null, 2),
    `Screenshot saved: /tmp/slack-quickswitcher.png (open this to visually confirm)`,
  ]);

  // --- 3. Channel URL / ID shape ---
  const channelLinkInfo = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a[href*="/client/"]')).slice(0, 30);
    return links.slice(0, 5).map((el) => ({
      href: el.getAttribute("href"),
      text: el.textContent?.trim().slice(0, 40),
    }));
  });
  findings.channelLinkSamples = channelLinkInfo;
  section("4. Channel URL / Channel ID Shape", [
    `Sample sidebar links matching /client/ (href pattern reveals channel ID shape):`,
    JSON.stringify(channelLinkInfo, null, 2),
  ]);
  if (channelLinkInfo[0]?.href) {
    await page.click(`a[href="${channelLinkInfo[0].href}"]`).catch(() => {});
    await page.waitForTimeout(1500);
    findings.firstChannelClickedUrl = page.url();
    console.log(`After clicking first channel link, URL is: ${findings.firstChannelClickedUrl}`);
  }

  // --- 4. Thread-panel independence from scroll ---
  const threadAffordances = await page.evaluate(() => {
    const candidates = Array.from(document.querySelectorAll("button, a, span"))
      .filter((el) => /repl(y|ies)|thread/i.test(el.textContent || ""))
      .slice(0, 10);
    return candidates.map((el) => ({
      tag: el.tagName.toLowerCase(),
      text: el.textContent?.trim().slice(0, 60),
      dataQa: el.getAttribute("data-qa"),
    }));
  });
  findings.threadAffordanceCandidates = threadAffordances;
  section("3. Thread-Panel Independence from Scroll", [
    `Candidate thread-open affordances found on current view (text matching repl/thread):`,
    JSON.stringify(threadAffordances, null, 2),
    `NOTE: Automated click-testing of scroll-independence was skipped (risk of accidentally`,
    `posting/reading unintended content). Please manually click one of the above from the TOP`,
    `of a channel and one from further down after scrolling, and confirm both open the thread panel.`,
  ]);

  // --- Auto-fill findings file ---
  let doc = await readFile(FINDINGS_PATH, "utf-8");
  const autoNote = "\n\n---\n## AUTO-DETECTED (script output — please verify against screenshot/manual check)\n\n```json\n" +
    JSON.stringify(findings, null, 2) +
    "\n```\n";
  doc += autoNote;
  await writeFile(FINDINGS_PATH, doc, "utf-8");

  console.log(`\n✅ Auto-detected data appended to 01-SPIKE-FINDINGS.md.`);
  console.log(`Review it, fill in the four "Confirmed value" lines using this data + the`);
  console.log(`screenshot at /tmp/slack-quickswitcher.png, then reply "approved".`);

  await context.close();
}

main().catch((err) => {
  console.error("Discovery script failed:", err);
  process.exit(1);
});
