import { readFile } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";

async function main() {
  const cachePath = process.env.USER_CACHE_PATH || path.join(process.cwd(), ".raw", "user-cache.json");
  let cache: Record<string, string> = {};
  try {
    const content = await readFile(cachePath, "utf8");
    cache = JSON.parse(content);
  } catch (err) {
    // Graceful fallback if cache doesn't exist
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false
  });

  const resolveText = (text: string): string => {
    if (!text) return "";
    return text.replace(/<@(U[A-Z0-9]+)>/g, (match, userId) => {
      return cache[userId] ? `@${cache[userId]}` : match;
    });
  };

  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const dayObj = JSON.parse(line);
      if (dayObj.entries) {
        for (const entry of dayObj.entries) {
          if (entry.parent) {
            entry.parent.text = resolveText(entry.parent.text);
          }
          if (entry.replies) {
            for (const r of entry.replies) {
              r.text = resolveText(r.text);
            }
          }
        }
      } else if (Array.isArray(dayObj)) {
        // Handle array of entries directly if needed
        for (const entry of dayObj) {
          if (entry.parent) {
            entry.parent.text = resolveText(entry.parent.text);
          }
          if (entry.replies) {
            for (const r of entry.replies) {
              r.text = resolveText(r.text);
            }
          }
        }
      }
      console.log(JSON.stringify(dayObj));
    } catch (err) {
      console.log(resolveText(line));
    }
  }
}

main().catch(console.error);
