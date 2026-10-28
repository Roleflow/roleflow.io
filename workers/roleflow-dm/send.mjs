// Opens Instagram only after planDm has already allowed this one handle.
// The password is not read. The session file is decrypted in a temp file and deleted.

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planDm } from "../../acquire/auto-dm.js";

const BLOCK = /challenge|checkpoint|action blocked|try again later|we limit|we restrict|confirm it.?s you/i;

export async function sendPlanned(input) {
  const plan = planDm(input);
  if (!plan.ok) return { ok: false, reason: plan.reason };
  if (!input.sessionKey || !input.sessionFile) return { ok: false, reason: "no_session" };
  const dir = mkdtempSync(join(tmpdir(), "rf-dm-"));
  const storage = join(dir, "state.json");
  const decrypted = spawnSync("openssl", [
    "enc", "-d", "-aes-256-cbc", "-pbkdf2",
    "-in", input.sessionFile,
    "-out", storage,
    "-pass", "env:ROLEFLOW_DM_SESSION_KEY"
  ], { env: { ...process.env, ROLEFLOW_DM_SESSION_KEY: input.sessionKey } });
  if (decrypted.status !== 0) {
    rmSync(dir, { recursive: true, force: true });
    return { ok: false, reason: "no_session" };
  }
  let browser;
  try {
    const playwright = await import("playwright");
    browser = await playwright.chromium.launch({ headless: true });
    const context = await browser.newContext({ storageState: storage });
    const page = await context.newPage();
    await page.goto("https://www.instagram.com/direct/new/", { waitUntil: "domcontentloaded" });
    const warning = await page.locator("body").innerText();
    if (BLOCK.test(warning)) return { ok: false, reason: "paused" };
    await page.getByLabel(/search/i).fill(input.handle);
    await page.getByRole("button", { name: /^next$/i }).click();
    await page.getByRole("textbox").fill(plan.body);
    await page.getByRole("button", { name: /^send$/i }).click();
    return { ok: true, reason: "sent" };
  } catch (error) {
    return { ok: false, reason: error && /blocked|challenge|warning/i.test(error.message || "") ? "paused" : "not_sent" };
  } finally {
    if (browser) await browser.close().catch(() => {});
    rmSync(dir, { recursive: true, force: true });
  }
}
