import { Command } from "commander";
import { loadConfig } from "./config/load.ts";
import { getAuthenticatedContext } from "./auth/session.ts";
import { navigateToChannel } from "./scrape/resolver/channel.ts";
import { scrapeChannelHistory } from "./scrape/extractor.ts";
import { writeRawMessages } from "./scrape/raw-writer.ts";
import { getLatestSyncPointer } from "./scrape/resolver/sync.ts";
import { SessionExpiredError } from "./auth/probe.ts";
import { withRetry } from "./scrape/retry.ts";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";

const program = new Command();

async function mapConcurrent<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const currentIndex = index++;
      results[currentIndex] = await fn(items[currentIndex]);
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

program
  .name("slack-archiver")
  .description("Scrapes and cleans Slack channel history into markdown")
  .option("-c, --config <path>", "path to conversations.json config file", "conversations.json")
  .option("-i, --incremental", "scrape only messages since the last run", true)
  .option("--no-incremental", "disable incremental sync and force a full scrape")
  .option("-f, --full", "force full history scrape (alias for --no-incremental)")
  .action(async (opts) => {
    const startTime = new Date().toISOString();
    const config = await loadConfig(opts.config);
    console.log(`Loaded ${config.conversations.length} conversation(s) from ${opts.config}`);

    const useIncremental = opts.incremental !== false && opts.full !== true;

    const context = await getAuthenticatedContext();
    console.log("Authenticated session ready.");

    const newRawFiles: string[] = [];
    const runResults: { name: string; slug: string; messagesCount: number; status: 'success' | 'skipped' | 'failed'; error?: string }[] = [];

    try {
      let page = context.pages().find(p => p.url().includes("/client/"));
      if (!page) {
        page = context.pages()[0] ?? (await context.newPage());
      }

      if (!page.url().includes("/client/")) {
        console.log("[CLI] Navigating to Slack client view...");
        await withRetry(async () => {
          await page!.goto("https://app.slack.com/client/", { waitUntil: "domcontentloaded" });
          await page!.waitForURL("**/client/**", { timeout: 15000 });
        });
      }

      const teamIdMatch = page.url().match(/\/client\/([^/]+)/);
      const teamId = teamIdMatch ? teamIdMatch[1] : "T00000000";

      // Process conversations concurrently with a max concurrency limit of 3
      await mapConcurrent(config.conversations, 3, async (conversation) => {
        if (conversation.name.toLowerCase() === "general") {
          console.log(`[CLI] Skipping "general" channel as requested.`);
          runResults.push({ name: conversation.name, slug: conversation.slug, messagesCount: 0, status: 'skipped' });
          return;
        }

        const workerPage = await context.newPage();
        try {
          let channelId = conversation.id;
          let sinceTs: string | null = null;

          if (useIncremental) {
            sinceTs = await getLatestSyncPointer(conversation.slug);
            console.log(`[CLI] Incremental sync pointer for "${conversation.name}" is ${sinceTs}`);
          } else {
            console.log(`[CLI] Full history scrape for "${conversation.name}"`);
          }

          await withRetry(async () => {
            if (channelId) {
              console.log(`Using pre-configured ID ${channelId} for "${conversation.name}"`);
              await workerPage.goto(`https://app.slack.com/client/${teamId}/${channelId}`, { waitUntil: "domcontentloaded" });
              await workerPage.waitForURL("**/client/**", { timeout: 15000 });
            } else {
              channelId = await navigateToChannel(workerPage, conversation.name);
            }
          });

          console.log(`Resolved channel "${conversation.name}" to ID ${channelId}`);

          const messages = await withRetry(async () => {
            return await scrapeChannelHistory(workerPage, { sinceTs });
          });

          const written = await writeRawMessages(conversation.slug, messages);
          newRawFiles.push(...written);

          console.log(`Scraped ${messages.length} messages for ${conversation.name}`);
          runResults.push({ name: conversation.name, slug: conversation.slug, messagesCount: messages.length, status: 'success' });
        } catch (err: any) {
          console.error(`[CLI] Error scraping "${conversation.name}": ${err.message}. Continuing...`);
          runResults.push({ name: conversation.name, slug: conversation.slug, messagesCount: 0, status: 'failed', error: err.message });
        } finally {
          await workerPage.close().catch(() => {});
        }
      });

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

    // Generate structured run summary telemetry report
    const endTime = new Date().toISOString();
    const summary = {
      startTime,
      endTime,
      totalConversations: config.conversations.length,
      successCount: runResults.filter(r => r.status === 'success').length,
      failureCount: runResults.filter(r => r.status === 'failed').length,
      conversations: runResults
    };

    await mkdir(path.join(process.cwd(), ".planning"), { recursive: true });
    await writeFile(path.join(process.cwd(), ".planning", "run-summary.json"), JSON.stringify(summary, null, 2), "utf-8");
    console.log("[CLI] Run summary telemetry report generated at .planning/run-summary.json");

    (globalThis as any).__newRawFiles = newRawFiles;
  });

program.parseAsync().catch((err) => {
  if (err instanceof SessionExpiredError) {
    console.error(err.message);
    process.exit(1);
  }
  throw err;
});
