import { describe, it, expect, vi, beforeEach } from "vitest";
import { navigateToChannel, parseChannelIdFromUrl } from "../src/scrape/resolver/channel.ts";
import type { Page, Locator } from "playwright";

describe("channel resolver utils", () => {
  describe("parseChannelIdFromUrl", () => {
    it("extracts channel ID from slack client URL", () => {
      const url = "https://app.slack.com/client/T01234567/C01234567?someQuery=true";
      expect(parseChannelIdFromUrl(url)).toBe("C01234567");
    });

    it("returns null if URL is not a valid Slack client URL", () => {
      const url = "https://app.slack.com/home";
      expect(parseChannelIdFromUrl(url)).toBeNull();
    });
  });

  describe("navigateToChannel", () => {
    let pressedKeys: string[];
    let clickedSelectors: string[];
    let filledTexts: { locatorId: string; val: string }[];
    let mockUrl: string;

    beforeEach(() => {
      pressedKeys = [];
      clickedSelectors = [];
      filledTexts = [];
      mockUrl = "https://app.slack.com/client/T01234567/C01234567";
    });

    function createMockPage(options: {
      sidebarVisibleSelectors: string[];
      switcherInputVisible: boolean;
      switcherOptionVisible: boolean;
    }) {
      const { sidebarVisibleSelectors, switcherInputVisible, switcherOptionVisible } = options;

      const mockLocator = (selector: string): any => {
        const first = () => {
          return {
            isVisible: async (opts?: { timeout?: number }) => {
              // Sidebar selector check
              if (sidebarVisibleSelectors.some(s => selector.includes(s) || selector === s)) {
                return true;
              }
              // Switcher input check
              if (selector.includes("quick_switcher_input") || selector.includes("placeholder*=")) {
                return switcherInputVisible;
              }
              // Switcher option check
              if (selector.includes("[role=\"option\"]") || selector.includes("quick_switcher_result")) {
                return switcherOptionVisible;
              }
              return false;
            },
            click: async () => {
              clickedSelectors.push(selector);
            },
            fill: async (text: string) => {
              filledTexts.push({ locatorId: selector, val: text });
            },
            waitFor: async (opts?: any) => {
              // Wait succeeds
            },
            first,
          };
        };

        return {
          first,
          isVisible: async () => {
            return sidebarVisibleSelectors.includes(selector);
          },
          click: async () => {
            clickedSelectors.push(selector);
          },
          fill: async (text: string) => {
            filledTexts.push({ locatorId: selector, val: text });
          },
          waitFor: async (opts?: any) => {},
        };
      };

      const page = {
        locator: vi.fn().mockImplementation(mockLocator),
        keyboard: {
          press: vi.fn().mockImplementation(async (key: string) => {
            pressedKeys.push(key);
          }),
        },
        waitForTimeout: vi.fn().mockResolvedValue(undefined),
        waitForURL: vi.fn().mockResolvedValue(undefined),
        url: vi.fn().mockImplementation(() => mockUrl),
      } as unknown as Page;

      return page;
    }

    it("resolves channel directly if immediately visible in the sidebar", async () => {
      const mockPage = createMockPage({
        sidebarVisibleSelectors: ['[data-qa="sidebar_channel_link"]:has-text("general")'],
        switcherInputVisible: false,
        switcherOptionVisible: false,
      });

      const channelId = await navigateToChannel(mockPage, "general");

      expect(channelId).toBe("C01234567");
      expect(clickedSelectors).toContain('[data-qa="sidebar_channel_link"]:has-text("general")');
      expect(pressedKeys.length).toBe(0); // No keyboard events triggered
    });

    it("falls back to Quick Switcher if not visible in sidebar, and clicks matching option", async () => {
      const mockPage = createMockPage({
        sidebarVisibleSelectors: [],
        switcherInputVisible: true,
        switcherOptionVisible: true,
      });

      const channelId = await navigateToChannel(mockPage, "random-user");

      expect(channelId).toBe("C01234567");
      // Check that it opened Quick Switcher (Cmd+K/Ctrl+K depending on platform)
      expect(pressedKeys.some(k => k === "Meta+k" || k === "Control+k")).toBe(true);
      // Fills the user name
      expect(filledTexts.some(f => f.val === "random-user")).toBe(true);
      // Clicks the matching listbox option
      expect(clickedSelectors.some(s => s.includes('[role="option"]'))).toBe(true);
    });

    it("falls back to pressing Enter in Quick Switcher if no explicit option is visible", async () => {
      const mockPage = createMockPage({
        sidebarVisibleSelectors: [],
        switcherInputVisible: true,
        switcherOptionVisible: false,
      });

      const channelId = await navigateToChannel(mockPage, "unlisted-user");

      expect(channelId).toBe("C01234567");
      // Checked that it fell back to Enter
      expect(pressedKeys).toContain("Enter");
    });
  });
});
