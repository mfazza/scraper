import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execa } from "execa";
import { writeFile, rm, mkdir } from "node:fs/promises";
import path from "node:path";

describe("scripts/resolve-mentions.ts", () => {
  const cacheDir = path.join(process.cwd(), ".raw");
  const cachePath = path.join(cacheDir, "user-cache-resolve-test.json");

  beforeEach(async () => {
    await mkdir(cacheDir, { recursive: true });
    await writeFile(
      cachePath,
      JSON.stringify({
        "U12345": "Em Fazza",
        "U67890": "Em Fazza"
      }),
      "utf8"
    );
  });

  afterEach(async () => {
    await rm(cachePath, { force: true });
  });

  it("resolves user mentions inside JSON day-bucket object cleanly", async () => {
    const inputObj = {
      day: "2026-07-21",
      entries: [
        {
          parent: { text: "Hello <@U12345> and <@U67890>!" },
          replies: [
            { text: "Thanks <@U12345>." },
            { text: "No problem <@U99999>." } // Unresolvable
          ]
        }
      ]
    };

    const { stdout } = await execa("npx", [
      "tsx",
      "scripts/resolve-mentions.ts"
    ], {
      input: JSON.stringify(inputObj),
      env: { ...process.env, USER_CACHE_PATH: cachePath }
    });

    const parsed = JSON.parse(stdout);
    expect(parsed.entries[0].parent.text).toBe("Hello @Em Fazza and @Em Fazza!");
    expect(parsed.entries[0].replies[0].text).toBe("Thanks @Em Fazza.");
    expect(parsed.entries[0].replies[1].text).toBe("No problem <@U99999>.");
  });

  it("gracefully falls back to plain-text replacement if input is not JSON", async () => {
    const { stdout } = await execa("npx", [
      "tsx",
      "scripts/resolve-mentions.ts"
    ], {
      input: "Message with <@U12345> and <@U00000>.",
      env: { ...process.env, USER_CACHE_PATH: cachePath }
    });

    expect(stdout.trim()).toBe("Message with @Em Fazza and <@U00000>.");
  });
});
