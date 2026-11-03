// Web UI navigation. The page object is injectable so tests never open Instagram.
// Chromium itself is started by the image as a different user.

import { classifyHealth } from "./brain-health.mjs";
import { parseHandles, parseProfile } from "./brain-parse.mjs";

export async function readActivity(page) {
  const health = { url: page.url(), text: await page.innerText("body") };
  const session = classifyHealth(health);
  if (session !== "ok") return { ok: false, reason: session, health };
  await page.click("a[href$='/followers/']");
  const followers = parseHandles(await page.innerHTML("[role=dialog]"));
  await page.click("[aria-label=Close]");
  await page.click("a[href*='/liked_by/']");
  const likes = parseHandles(await page.innerHTML("[role=dialog]"));
  await page.click("[aria-label=Close]");
  return { ok: true, followers, likes, health };
}

export async function readProfile(page, handle) {
  await page.goto("https://www.instagram.com/" + encodeURIComponent(handle) + "/");
  const health = classifyHealth({ url: page.url(), text: await page.innerText("body") });
  if (health !== "ok") return { ok: false, reason: health };
  const profile = parseProfile(await page.content());
  profile.handle = profile.handle || handle;
  return { ok: true, profile };
}

export async function fillMessage(page, { handle, text, click }) {
  await page.goto("https://www.instagram.com/direct/new/");
  const health = classifyHealth({ url: page.url(), text: await page.innerText("body") });
  if (health !== "ok") return { ok: false, reason: health, clicked: false };
  await page.fill("input[placeholder*='Search']", handle);
  await page.click("div[role=button]");
  await page.click("button");
  await page.fill("textarea", text);
  const composer = await page.inputValue("textarea");
  if (composer !== text) return { ok: false, reason: "composer_mismatch", composer, clicked: false };
  if (!click) return { ok: true, composer, clicked: false, bubble: "" };
  await page.click("button[type=submit]");
  const bubble = await page.innerText("[data-message-owner=me]");
  return { ok: bubble === text, reason: bubble === text ? "sent" : "bubble_mismatch", composer, bubble, clicked: true };
}
