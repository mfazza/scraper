<!-- GSD:project-start source:PROJECT.md -->

## Project

**Slack Conversation Archiver**

A CLI tool that automates exporting Slack conversations you don't have official export access to. It drives a real, SSO-authenticated browser session via Playwright to extract structured message data (author, timestamp, text, thread) directly from the Slack web app's DOM, then deterministically transforms that raw data into clean, threaded markdown files organized by channel/DM and day. Replaces manual copy-pasting from Slack entirely.

**Core Value:** Reliable, repeatable extraction of Slack conversations (channels, DMs, group DMs) into readable markdown archives — without relying on Slack's official export tooling (which the user doesn't have access to) or fragile manual copy/paste.

### Constraints

- **Tech Stack**: Node.js/TypeScript with Playwright for browser automation; bash for the deterministic cleaning/formatting stage.
- **Auth**: Must support SSO login flows (not just email/password), via a persisted browser context/profile.

<!-- GSD:project-end -->

<!-- GSD:stack-start source:research/STACK.md -->

## Technology Stack

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Node.js | **24.x LTS ("Krypton")**, currently 24.18.0 | Runtime | Current LTS line (verified via nodejs.org dist index). As of v24.12.0, native TypeScript **type stripping is stable** — you can run `node src/cli.ts` directly for erasable TS syntax with zero build step and zero runtime TS-transform dependency. This matters a lot for a small internal CLI: fewer moving parts between "write code" and "run it." |
| TypeScript | **6.0.x** (currently 6.0.3) — **not 7.0** | Type checking (not execution) | TypeScript 7.0 (the native Go "tsgo" port) is now `latest` on npm (7.0.2, released 2026-07-08) but `@typescript-eslint` — the linting tooling nearly every TS project depends on — still declares a peer dependency cap of `typescript: ">=4.8.4 <6.1.0"` (verified against the published package.json). Using TS 7 today means no working ESLint type-aware linting. TS 6.0.x is the newest release the ecosystem has actually caught up to. Use `tsc --noEmit` in CI for type-checking; let Node's built-in stripping execute the code. |
| Playwright | **1.61.x** (`playwright` package, not `@playwright/test`) | Browser automation | This is automation, not a test suite — you don't need the Playwright Test runner's fixture/parallelization machinery to drive one persistent, long-lived browser context. Use the plain `playwright` package and call `chromium.launchPersistentContext()` directly. Requires Node ≥18 (comfortably satisfied by Node 24). |
| Commander | **15.x** | CLI argument parsing / command definition | This tool is fundamentally **one command** (`archive`/`scrape`) with a handful of flags (`--full`, `--since`, `--channel`, `--dry-run`). Commander is the lightest-weight, most widely used library for exactly this shape of CLI — minimal ceremony, excellent TS types, no plugin system to configure. See "What NOT to Use" for why yargs/oclif are worse fits here. |
| zod | **4.x** (currently 4.4.3) | Runtime schema validation for the JSON intermediate | The whole pipeline's reliability hinges on the raw JSON (Node stage output) having a guaranteed shape before the bash/jq stage consumes it. Validate every scraped message object against a zod schema before writing to disk — a Slack DOM change that silently returns `undefined` for a field becomes a loud validation error instead of corrupted markdown three stages later. Also gives you `z.infer<>` TS types for free (single source of truth for the message shape). |
| jq | **1.8.x** (system binary, not npm — install via `brew install jq` / `apt install jq`) | JSON→Markdown transform engine, invoked from the bash cleaning script | Non-negotiable pairing with "deterministic bash script" (see dedicated section below). Bash alone cannot safely parse/transform JSON (no real JSON parser, string-splitting on quotes/braces is exactly the kind of brittle-parsing failure mode this project is trying to avoid). `jq` is POSIX-shell-friendly, has no runtime dependencies beyond itself, and is effectively the standard tool for "deterministic, scriptable JSON transformation" in a bash pipeline. |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| dayjs | 1.11.x | Date/time handling for daily-bucket file naming (`YYYY-MM-DD.md`) and incremental "since" cutoffs | Slack message timestamps are UTC epoch floats (`"1700000000.123456"`); you need reliable, immutable date math to bucket messages into the archiver's local calendar day. Prefer over `moment` (legacy/mutable, in maintenance mode only) and over pulling in `luxon`/`date-fns` unless you need their heavier feature sets — dayjs is a ~2KB drop-in with a Moment-like API and is more than sufficient for epoch→YYYY-MM-DD conversion and simple comparisons. |
| execa | 9.x | Spawning the bash cleaning script from the Node CLI after a scrape completes | `child_process.exec`/`spawn` from core Node work, but execa gives you promise-based ergonomics, better error messages (stdout/stderr attached to thrown errors), and safe argument handling without shell-injection foot-guns — important since you're passing user-configured channel/DM names as arguments into a subprocess. |
| pino | 10.x | Structured, leveled logging | This CLI runs both interactively (first login) and unattended (cron/automated incremental runs). Pino writes newline-delimited JSON logs cheaply, which you can `pino-pretty` (13.x, dev-only) for human-readable output when run interactively, and leave as raw JSON lines when run headless/logged to a file for later debugging of a failed automated run. Plain `console.log` is fine for a v0 prototype but won't hold up once you're debugging a 3am headless run that silently produced zero messages. |
| p-retry | 8.x | Wrapping flaky DOM reads (not navigation — Playwright already auto-retries locators) | Custom `page.evaluate()` extraction calls against a virtualized list can occasionally read a half-mutated DOM mid-scroll. Wrap the "drain extracted messages" step in a small retry with backoff rather than hand-rolling retry loops. Optional — only add this if you observe real flakiness; don't pre-emptively over-engineer. |
| commander (sub-parsing) built-ins | — | `--since <date>`, `--full`, `--channel <name>` flag parsing with validation | Commander's built-in `.option()` type coercion + custom validators cover this; no extra arg-parsing library needed on top. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| ESLint 10.x + `@typescript-eslint/parser`/`eslint-plugin` 8.64.x | Linting | Peer-compatible with TypeScript 6.0.x (verified) and ESLint 10.x. Do **not** upgrade the project's `typescript` devDependency past 6.0.x until `@typescript-eslint` publishes a version supporting the TS 7 (`tsgo`) peer range — check this before every TS bump. |
| Prettier 3.9.x | Formatting | Standard, uncontroversial choice; no reason to deviate. |
| Vitest 4.x | Unit testing the pure extraction/parsing logic | Not the Playwright Test runner — see Testing Strategy below. Vitest is fast, ESM-native, and needs zero config for testing pure functions (DOM-parsing helpers, jq-equivalent grouping logic if any lives in TS, zod schema validation tests). |
| `npx playwright codegen slack.app` (ad hoc, not a persistent dependency) | Selector discovery/re-discovery | Use this locally, logged into your real Slack workspace, whenever selectors need to be (re-)verified after a Slack UI change. This is a workflow habit, not a library to install. |
| `tsc --noEmit` (via `typescript` devDependency) | Type-checking in CI/pre-commit | Node's type stripping does **not** type-check — it just erases annotations. You still need `tsc --noEmit` as a separate CI/pre-commit step to catch real type errors. |

## Playwright Persistent Session Pattern (verified against current Playwright docs)

- `storageState()`/`storageState: <path>` (the pattern Playwright's own docs default to) only captures **cookies + `localStorage`**. Slack's web client is a heavy SPA that also relies on **IndexedDB** and service-worker state for session bootstrapping in some auth flows — `storageState` alone is not guaranteed to reproduce a fully logged-in session on the next run. `launchPersistentContext` persists the **entire browser profile directory** (cookies, localStorage, IndexedDB, service workers, cache) exactly like a real Chrome profile, which is the safer bet for reproducing an SSO-authenticated session across runs.
- Flow: **first run** — launch `launchPersistentContext(userDataDir, { headless: false })` pointed at a fresh, empty directory (e.g. `./.auth/slack-profile/`), let the user complete the SSO login manually in the visible window, then simply close the context (the profile directory is written to disk automatically — no explicit "save" step needed, unlike `storageState`). **Subsequent runs** — launch the same `launchPersistentContext(userDataDir, { headless: true })` pointed at the same directory; the session should already be authenticated.
- **Verified pitfall (from current Playwright docs):** do not point `userDataDir` at a real Chrome "User Data" profile directory — recent Chrome policy changes actively block automating the default profile. Always use a dedicated, empty directory created solely for this tool.
- Add the profile directory to `.gitignore` — it will contain live session cookies capable of impersonating the user's Slack session.
- Detect an expired/invalid session defensively at the start of every automated run (e.g. check for a known "logged out" DOM marker or a redirect to Slack's SSO/login URL) and fail loudly with an actionable message ("re-run with `--login` to re-authenticate") rather than silently scraping a login page.

## Extracting Structured Data From Slack's Virtualized DOM

## JSON→Markdown Cleaning Stage: bash + jq (confirmed reasonable, with one caveat)

- `jq` handles: reading the raw JSON, `group_by(.ts | todate | strftime("%Y-%m-%d"))` for daily bucketing, `group_by(.thread_ts // .ts)` + `sort_by(.ts)` for nesting thread replies under parents, and emitting markdown-shaped strings via `jq -r` (raw output, no JSON quoting) using string interpolation (`"### \(.author) — \(.time)\n\n\(.text)\n"`).
- Bash handles: orchestration — looping over conversations, creating the `channel/YYYY-MM-DD.md` directory structure, and piping `jq` output into files with `>>`/`>`.
- This combination is genuinely deterministic (no LLM, no fuzzy parsing) and matches the "spirit" of the constraint well: `jq` transforms are pure functions of the input JSON, testable in isolation from the command line (`echo '{...}' | jq -f transform.jq`), and versionable as `.jq` filter files rather than inline one-liners once the transform grows past a few lines.
- **Caveat to flag for the roadmap:** nested thread indentation with multi-line message bodies (a message containing embedded newlines/code blocks needs each line indented consistently under its thread parent) is the one place `jq`+bash cleaning logic gets genuinely fiddly — multi-line string indentation is not jq's strongest feature. If the indentation logic grows beyond ~100–150 lines of `jq`/bash, it is worth revisiting whether a small dedicated Node/TS transform script (same runtime as the scraper, same zod schema, still fully deterministic and LLM-free) would be more maintainable — that still satisfies "deterministic, no LLM," just not literally "bash." Surface this explicitly as a decision point in the phase that implements `CLEAN-01`/`CLEAN-02`, rather than deciding it up front.

## Testing Strategy for Scraping a UI You Don't Control

## Installation

# Core

# Supporting

# Dev dependencies

# System dependency (not npm) — install once, verify with `jq --version`

# apt-get install jq   # Debian/Ubuntu

# Playwright's bundled browser binaries (required once)

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|--------------------------|
| Commander 15 | yargs 18 | If the CLI grows into many subcommands each with complex, interdependent flag validation and built-in usage-string generation matters a lot — yargs' validation/coercion pipeline is more powerful than Commander's. Not warranted for this project's single-command shape. |
| Commander 15 | oclif 4.x | If this tool is ever distributed as a public/plugin-based multi-command CLI package with auto-update and a plugin ecosystem. Pure overkill (extra scaffolding, class-based command structure, plugin manifest) for a single-purpose internal archiver. |
| `launchPersistentContext` + profile dir | `storageState()` cookie/localStorage export | If Slack's session truly only depended on cookies (some simpler SSO setups do) — but IndexedDB-dependent SPA session state is common enough in modern web apps that persistent-context is the safer default assumption until proven otherwise for this specific workspace's SSO flow. |
| bash + jq | Small Node/TS transform script (same schema, same "no LLM" guarantee) | If the threading/indentation logic in the cleaning stage grows complex enough that `jq`'s string-templating becomes harder to maintain than equivalent TypeScript — see caveat above. Still fully deterministic; just not literally bash. |
| dayjs | date-fns 4.x / luxon 3.x | If you need more sophisticated timezone-conversion or i18n formatting than "epoch → YYYY-MM-DD in a fixed timezone." Both are excellent, more full-featured libraries; dayjs is chosen here purely for footprint/simplicity given the narrow date-bucketing need. |
| pino | Plain `console.log` + `picocolors` | Fine for a first prototype/spike where you're just trying to see scraped output. Revisit once the tool runs unattended/headless and you need to debug failures after the fact without re-running. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|--------------|
| TypeScript 7.0 (`tsgo`, currently npm `latest`) | Released 2026-07-08 (one week old at research time); `@typescript-eslint` peer range caps at `<6.1.0`, so type-aware linting breaks. Bleeding-edge, ecosystem hasn't caught up. | TypeScript 6.0.x until `@typescript-eslint` publishes TS7 support — re-check this before any future TS bump. |
| `storageState()` as the *only* auth-persistence mechanism | Doesn't capture IndexedDB/service-worker state that SPA session bootstrapping (Slack's client included) commonly depends on; risks a session that "looks" saved but doesn't actually resume logged-in. | `launchPersistentContext(userDataDir, ...)`, which persists the full browser profile. |
| Automating Chrome's default/real user profile as `userDataDir` | Chrome's own policy changes (documented in current Playwright docs) actively block or destabilize automation against the default profile. | A dedicated, empty, gitignored profile directory created solely for this tool. |
| Parsing JSON in the bash stage with `grep`/`sed`/`awk` | Exactly the brittle-parsing failure mode `CLEAN-01` is trying to avoid by having a structured JSON intermediate in the first place — string-splitting JSON breaks on any message containing quotes, newlines, or nested braces (which Slack messages routinely do: code blocks, quotes, emoji shortcodes). | `jq` for all JSON reads/transforms inside the bash script. |
| `moment.js` for date handling | Officially in maintenance mode/legacy status; mutable API is a common source of subtle date bugs. | `dayjs` (or `date-fns`/`luxon` if richer needs arise). |
| Parallelizing scraping across multiple browser tabs/contexts to "go faster" | Slack's client and any bot-detection heuristics are more likely to flag multiple concurrent sessions/tabs hammering the workspace than one sequential session paging through conversations one at a time; also multiplies scroll-state bookkeeping complexity for little real benefit at this tool's scale (a predefined, bounded list of channels/DMs). | Sequential processing: one persistent context, one page, navigate/scroll through each configured conversation in turn. |
| oclif for a single-command internal tool | Its plugin architecture, class-based command definitions, and auto-update/manifest tooling solve problems (multi-command public CLI distribution) this project doesn't have — pure added complexity. | Commander. |

## Stack Patterns by Variant

- Keep `headless: false` for the first-run login exactly as planned — no change needed. `launchPersistentContext` doesn't care how the login happened, only that it results in a valid persisted profile.
- The zod schema validation step (see Supporting Libraries) should already surface this as a hard failure. Treat any schema validation failure in production as a signal to re-run `npx playwright codegen` against the live workspace and refresh selectors/fixtures — don't try to make the schema "loose" to tolerate it.
- Migrate just that stage to a small Node/TS script using the same zod-validated JSON input — still deterministic and LLM-free, satisfies the spirit of `CLEAN-01` even if not the literal letter of "bash." Flag this explicitly as a decision to make during the phase that implements the cleaning stage, not before.

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|------------------|-------|
| `typescript@6.0.3` | `@typescript-eslint/parser@8.64.0`, `@typescript-eslint/eslint-plugin@8.64.0` | Peer range verified as `>=4.8.4 <6.1.0` — do not bump `typescript` past 6.0.x without first checking `@typescript-eslint`'s current peer range. |
| `eslint@10.7.0` | `@typescript-eslint/*@8.64.0` | Peer range `^8.57.0 \|\| ^9.0.0 \|\| ^10.0.0` — satisfied. |
| `playwright@1.61.1` | Node `>=18` (per published `engines` field) | Node 24 LTS comfortably exceeds this; no compatibility concern. |
| Node `>=24.12.0` | Native TS type stripping (stable) | Only "erasable" TS syntax runs directly (no `enum` with runtime values relying on legacy emit, no experimental decorators requiring transform, etc.) — keep the CLI's TS surface simple enough to stay erasable, or add `tsx` as a dev dependency if you need full transform support. |

## Sources

- npm registry (`registry.npmjs.org`), queried live on 2026-07-15 for: `playwright`, `@playwright/test`, `playwright-core`, `commander`, `yargs`, `oclif`, `typescript`, `zod`, `tsx`, `pino`, `pino-pretty`, `execa`, `@types/node`, `chokidar`, `dotenv`, `dayjs`, `zx`, `fast-glob`, `p-limit`, `p-retry`, `cli-progress`, `ora`, `chalk`, `picocolors`, `inquirer`, `@inquirer/prompts`, `conf`, `@typescript-eslint/parser`, `@typescript-eslint/eslint-plugin`, `eslint`, `prettier`, `vitest` — HIGH confidence (live, current data).
- `nodejs.org/dist/index.json`, queried live — Node LTS line confirmed as v24.x "Krypton." HIGH confidence.
- `raw.githubusercontent.com/nodejs/node/main/doc/api/typescript.md`, fetched live — confirmed type-stripping stability timeline (stable as of v24.12.0/v25.2.0). HIGH confidence.
- `raw.githubusercontent.com/microsoft/playwright/main/docs/src/api/class-browsertype.md` and `browser-contexts.md`, fetched live from Playwright's main branch — confirmed `launchPersistentContext` API shape and the Chrome default-profile automation warning. HIGH confidence.
- `github.com/jqlang/jq` releases API, queried live — confirmed current jq release (1.8.2). HIGH confidence.
- General knowledge of Slack web client architecture (virtualized message list, `data-qa` attribute conventions, `ts`-as-message-identity, thread_ts linkage) — MEDIUM confidence; this is well-established community/engineering knowledge but **could not be verified against a live, authenticated Slack DOM** in this research pass. Flagged explicitly above as requiring a phase-specific spike/verification step before extraction code is written.

<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->

## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->

## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->

## Project Skills

No project skills found. Add skills to any of: `.github/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->

## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:

- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->

## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
