// Attaches to the Chromium process started by the image. Imported only at runtime.

import { readActivity, readProfile } from "./brain-browser.mjs";

export function adaptPage(page) {
  return {
    health: async () => ({ url: page.url(), text: await page.innerText("body") }),
    listActivity: () => readActivity(page),
    readProfile: (handle) => readProfile(page, handle),
    openDm: async (handle) => {
      await page.goto("https://www.instagram.com/direct/new/");
      await page.fill("input[placeholder*='Search']", handle);
      await page.click("div[role=button]");
      return {
        typeAll: (text) => page.fill("textarea", text),
        readComposer: () => page.inputValue("textarea"),
        readLastBubble: () => page.innerText("[data-message-owner=me]"),
        clickSend: () => page.click("button[type=submit]")
      };
    }
  };
}

export async function attachBrowser(env) {
  const playwright = await import("playwright-core");
  const browser = await playwright.chromium.connectOverCDP(env.ROLEFLOW_CDP || "http://127.0.0.1:9222");
  const context = browser.contexts()[0] || await browser.newContext();
  const page = context.pages()[0] || await context.newPage();
  return adaptPage(page);
}
