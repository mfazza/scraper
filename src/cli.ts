import { Command } from "commander";
import { loadConfig } from "./config/load.ts";
import { getAuthenticatedContext } from "./auth/session.ts";
import { navigateToChannel } from "./scrape/resolver/channel.ts";
import { scrapeChannelHistory } from "./scrape/extractor.ts";
import { writeRawMessages } from "./scrape/raw-writer.ts";
import { getLatestSyncPointer } from "./scrape/resolver/sync.ts";
import { SessionExpiredError } from "./auth/probe.ts";
import { execa } from "execa";

const program = new Command();

program
  .name("slack-archiver")
  .description("Scrapes and cleans Slack channel history into markdown")
  .option("-c, --config <path>", "path to conversations.json config file", "conversations.json")
  .option("-i, --incremental", "scrape only messages since the last run", true)
  .option("--no-incremental", "disable incremental sync and force a full scrape")
  .option("-f, --full", "force full history scrape (alias for --no-incremental)")
  .action(async (opts) => {
    const config = await loadConfig(opts.config);
    console.log(`Loaded ${config.conversations.length} conversation(s) from ${opts.config}`);

    const useIncremental = opts.incremental !== false && opts.full !== true;

    const context = await getAuthenticatedContext();
    console.log("Authenticated session ready.");

    const newRawFiles: string[] = [];

    try {
      // Find the page that is actually on the Slack client, or fall back to the first page/new page.
      let page = context.pages().find(p => p.url().includes("/client/"));
      if (!page) {
        page = context.pages()[0] ?? (await context.newPage());
      }

      // If the page is not yet in the client view, navigate to the main client URL.
      if (!page.url().includes("/client/")) {
        console.log("[CLI] Navigating to Slack client view...");
        await page.goto("https://app.slack.com/client/", { waitUntil: "domcontentloaded" });
        await page.waitForURL("**/client/**", { timeout: 15000 });
      }

      // Parse the Slack Team ID from active dashboard URL.
      const teamIdMatch = page.url().match(/\/client\/([^/]+)/);
      const teamId = teamIdMatch ? teamIdMatch[1] : "T00000000";

      for (const conversation of config.conversations) {
        if (conversation.name.toLowerCase() === "general") {
          console.log(`[CLI] Skipping "general" channel as requested.`);
          continue;
        }
        // Reuse the single authenticated page to maintain active sessionStorage/state and avoid SSO prompts.
        try {
          let channelId = conversation.id;
          let sinceTs: string | null = null;

          if (useIncremental) {
            sinceTs = await getLatestSyncPointer(conversation.slug);
            console.log(`[CLI] Incremental sync pointer for "${conversation.name}" is ${sinceTs}`);
          } else {
            console.log(`[CLI] Full history scrape for "${conversation.name}"`);
          }

          if (channelId) {
            console.log(`Using pre-configured ID ${channelId} for "${conversation.name}"`);
            await page.goto(`https://app.slack.com/client/${teamId}/${channelId}`, { waitUntil: "domcontentloaded" });
            await page.waitForURL("**/client/**", { timeout: 15000 });
          } else {
            channelId = await navigateToChannel(page, conversation.name);
          }
          
          console.log(`Resolved channel "${conversation.name}" to ID ${channelId}`);

          const messages = await scrapeChannelHistory(page, { sinceTs });

          const written = await writeRawMessages(conversation.slug, messages);
          newRawFiles.push(...written);

          console.log(`Scraped ${messages.length} messages for ${conversation.name}`);
        } catch (err: any) {
          console.error(`[CLI] Error scraping "${conversation.name}": ${err.message}. Continuing to next conversation...`);
        }
      }

      // Trigger downstream clean stage on success.
      if (newRawFiles.length > 0) {
        console.log("Starting clean stage...");
        await execa("bash", ["scripts/clean.sh", ...config.conversations.map(c => c.slug)]);
        console.log("Cleaning complete.");
      } else {
        console.log("No new raw data — skipping clean stage.");
      }
    } finally {
      await context.close();
    }

    // Diagnostic tracking.
    (globalThis as any).__newRawFiles = newRawFiles;
  });

// Exit cleanly on session expiration.
program.parseAsync().catch((err) => {
  if (err instanceof SessionExpiredError) {
    console.error(err.message);
    process.exit(1);
  }
  throw err;
});
