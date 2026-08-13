# Slack Archiver

A robust, lightweight tool that scrapes Slack channel and direct message (DM) histories directly from the Slack web client. It resolves thread structures, maps user mentions, partition-buckets messages chronologically by day, and renders them into beautiful, static Markdown documents ideal for offline reading, archiving, or personal wikis.

---

## Features

- **DOM-Based Extraction**: Uses Playwright to extract history directly from the Slack interface. By using client-side elements and URL verification, it avoids fragile selectors and bypasses Slack API restrictions/rate limits.
- **Interleaved Thread Resolving**: Automatically detects thread reply affordances, expands them inline during top-to-bottom scroll extraction, and closes the panels to handle Slack's virtualized DOM recycle behavior gracefully.
- **Smart Incremental Sync**: Remembers the latest timestamp (`ts`) scraped for each channel and resumes scraping from that point forward on subsequent runs, minimizing bandwidth and runtimes.
- **Deduplication & Transactional Writes**: Reads existing daily raw logs, merges new scrapes, deduplicates on timestamp key, and sorts chronologically before rewriting files to ensure deterministic local state.
- **Mentions & User Caching**: Resolves Slack user IDs (e.g. `<@U123456>`) to real human names using an offline-first `.raw/user-cache.json` directory compiled from active session interactions.
- **Decoupled Markdown Renders**: Translates daily JSON data arrays into clean, daily `.md` pages partitioned in the local timezone.

---

## Directory Structure

```
scraper/
├── src/                # Scraper source code (TypeScript)
│   ├── auth/           # Headless/headed session bootstrap and liveness probes
│   ├── config/         # Zod configuration parsers and safe schema verification
│   ├── scrape/         # Scroll loops, MutationObservers, and raw writers
│   └── types.ts        # Shared types and Zod schemas
├── scripts/            # Downstream pipelines and shell commands
│   ├── clean.sh        # Orchestrates raw data JSON translation -> nested Markdown
│   └── resolve-mentions.ts # Offline mention resolver mapping user IDs to display names
├── lib/                # Utility scripts (nesting threads, timezone groupings, formatting)
├── .auth/              # Local browser profile directory (GITIGNORED)
├── .raw/               # Raw hourly/daily scraped JSON logs (GITIGNORED)
└── raw/                # Fully resolved, day-sorted Markdown digests (GITIGNORED)
```

---

## Prerequisites

- **Node.js**: Version 24.0.0 or higher.
- **npm**: Package manager.
- **jq**: Command-line JSON processor (required by downstream bash rendering utilities). Install via:
  - macOS: `brew install jq`
  - Linux: `sudo apt-get install jq`

---

## Setup

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Install Playwright Browser**:
   ```bash
   npx playwright install chromium
   ```

3. **Configure Your Conversations**:
   Create a local, gitignored `conversations.json` file. You can bootstrap this by copying the example template:
   ```bash
   cp conversations.json.example conversations.json
   ```

---

## Configuration (`conversations.json`)

The config file defines which channels and DMs the tool should scrape. 

### Schema Definition

- **`type`** (`"channel"` | `"dm"`): The type of Slack conversation.
- **`name`**: The exact display name of the channel (without `#`) or person as seen in your Slack sidebar.
- **`id`** *(optional)*: The unique Slack ID (e.g. `C09KSUKAUBV`).
  - **Highly Recommended**: Supplying the ID skips the sidebar resolution step and navigates directly to the conversation client URL, maximizing performance and robustness.
  - If omitted, the tool automatically uses the sidebar filter to search for the conversation and resolve its ID.

### Example

```json
{
  "conversations": [
    {
      "type": "channel",
      "name": "general",
      "id": "C0123456789"
    },
    {
      "type": "channel",
      "name": "random"
    },
    {
      "type": "dm",
      "name": "Jane Doe",
      "id": "D0123456789"
    }
  ]
}
```

---

## Authentication & Liveness

The tool employs a **headless-first, headed-fallback** authentication strategy:

1. **Headless Probe**: On startup, it launches Chromium headlessly and attempts to navigate to the Slack client using cookies stored in `.auth/browser-profile/`.
2. **Headed Fallback**: If no valid session is found (first-time launch or expired cookies), it closes the headless browser and launches a **headed** browser pointing to `slack.com/signin`.
3. **Manual Action**: Log in manually via your standard SSO/MFA process. Once you are successfully inside the Slack client workspace (indicated by the URL matching `**/client/**`), the script automatically captures your active session, closes the headed UI, and resumes the scraper task headlessly.
4. **Liveness Gating**: Before each page scroll batch, the scraper asserts active session cookies. If expired, it aborts loudly rather than scraping login pages or risking silent loop errors.

---

## Usage

### Run Scraper & Downstream Clean

Executes the sync pipeline sequentially for all entries in your `conversations.json`:

```bash
npm start
```

By default, the archiver runs in **incremental mode**, only pulling messages newer than the latest timestamp found in your `.raw/` files.

### Options & Arguments

All standard arguments are supported:

- **Force Full Scrape**: Disable incremental checking and scrape entire channel histories:
  ```bash
  npm start -- --full
  ```
- **Custom Config Path**: Point to an alternative config file:
  ```bash
  npm start -- --config /path/to/my-config.json
  ```
- **Explicit Incremental Flag**:
  ```bash
  npm start -- --incremental
  ```

---

## Development & Quality Assurance

- **Type Checking**:
  ```bash
  npm run typecheck
  ```
- **Tests**: Runs the unit and integration suite verifying schemas, raw-state writing, timezone bucketing, and thread-nesting logic:
  ```bash
  npm test
  ```
