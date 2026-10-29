// Opens Instagram only after planDm has already allowed this one handle.
// The password is not read. The session file is decrypted in a temp file and deleted.

import { appendFileSync, chmodSync } from "node:fs";
import { planDm } from "../../acquire/auto-dm.js";
import { decryptSessionFile } from "./session-file.mjs";

const BLOCK = /challenge|checkpoint|action blocked|try again later|we limit|we restrict|confirm it.?s you/i;

export async function attachVoiceFile(page, filePath) {
  if (!page || !filePath) return { ok: false, reason: "no_file" };
  const input = page.locator('input[type="file"]');
  if (!input || typeof input.count !== "function") return { ok: false, reason: "no_file_input" };
  const count = await input.count();
  if (!count) return { ok: false, reason: "no_file_input" };
  await input.first().setInputFiles(filePath);
  return { ok: true, reason: "attached" };
}

export async function sendPlanned(input) {
  const plan = planDm(input);
  if (!plan.ok) return { ok: false, reason: plan.reason };
  if (!input.sessionKey || !input.sessionFile) return { ok: false, reason: "no_session" };
  const opened = decryptSessionFile(input.sessionFile, input.sessionKey);
  if (!opened) return { ok: false, reason: "no_session" };
  let browser;
  try {
    const playwright = await import("playwright");
    browser = await playwright.chromium.launch({ headless: true });
    const context = await browser.newContext({ storageState: opened.storage });
    const page = await context.newPage();
    await page.goto("https://www.instagram.com/direct/new/", { waitUntil: "domcontentloaded" });
    const warning = await page.locator("body").innerText();
    if (BLOCK.test(warning)) return { ok: false, reason: "paused" };
    await page.getByLabel(/search/i).fill(input.handle);
    await page.getByRole("button", { name: /^next$/i }).click();
    await page.getByRole("textbox").fill(plan.body);
    let voice = null;
    if (input.voicePath) voice = await attachVoiceFile(page, input.voicePath);
    await page.getByRole("button", { name: /^send$/i }).click();
    if (input.logFile) {
      appendFileSync(input.logFile, JSON.stringify({
        workspaceId: input.workspaceId,
        handle: input.handle,
        body: plan.body,
        at: new Date().toISOString()
      }) + "\n");
      try { chmodSync(input.logFile, 0o600); } catch (_error) { /* the directory is already private */ }
    }
    return { ok: true, reason: "sent", body: plan.body, voice: voice && voice.reason };
  } catch (error) {
    return { ok: false, reason: error && /blocked|challenge|warning/i.test(error.message || "") ? "paused" : "not_sent" };
  } finally {
    if (browser) await browser.close().catch(() => {});
    opened.close();
  }
}
