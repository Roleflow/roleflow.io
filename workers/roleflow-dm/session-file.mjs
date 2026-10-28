// Decrypts one workspace session into a temp file and deletes it afterwards.
// The Instagram password is not read here.

import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function readSessionKey(keyFile) {
  try {
    return readFileSync(keyFile, "utf8").trim();
  } catch (_error) {
    return "";
  }
}

export function decryptSessionFile(file, key) {
  if (!file || !key) return null;
  const dir = mkdtempSync(join(tmpdir(), "rf-dm-"));
  const storage = join(dir, "state.json");
  const result = spawnSync("openssl", [
    "enc", "-d", "-aes-256-cbc", "-pbkdf2",
    "-in", file,
    "-out", storage,
    "-pass", "env:ROLEFLOW_DM_SESSION_KEY"
  ], { env: { ...process.env, ROLEFLOW_DM_SESSION_KEY: key } });
  if (result.status !== 0) {
    rmSync(dir, { recursive: true, force: true });
    return null;
  }
  try { chmodSync(storage, 0o600); } catch (_error) { /* the temp dir is already private */ }
  return {
    storage,
    close() { rmSync(dir, { recursive: true, force: true }); }
  };
}
