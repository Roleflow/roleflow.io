// Reads the latest followers and likers with the workspace session.
// Cookie values and typed input are not logged.

import { decryptSessionFile } from "./session-file.mjs";
import { feedBlocked, handlesFromFollowers, handlesFromLikers, mediaIds, profileFromInfo } from "./feed.mjs";

const APP_ID = "936619743392459";

async function readJson(response) {
  const payload = await response.json().catch(() => ({}));
  return { status: response.status(), payload };
}

export async function collectActivity({ storageFile, ownHandle, profileHandles, launch }) {
  const start = launch || (async () => {
    const playwright = await import("playwright");
    const browser = await playwright.chromium.launch({ headless: true, args: ["--disable-dev-shm-usage"] });
    return browser;
  });
  const browser = await start();
  try {
    const context = await browser.newContext({ storageState: storageFile });
    const cookies = await context.cookies("https://www.instagram.com");
    const csrf = cookies.find((cookie) => cookie.name === "csrftoken");
    const user = cookies.find((cookie) => cookie.name === "ds_user_id");
    if (!csrf || !user || !user.value) return { ok: false, reason: "no_session" };
    const headers = {
      "x-ig-app-id": APP_ID,
      "x-csrftoken": csrf.value,
      referer: "https://www.instagram.com/"
    };
    const followers = await readJson(await context.request.get(
      "https://www.instagram.com/api/v1/friendships/" + encodeURIComponent(user.value) + "/followers/?count=24",
      { headers }
    ));
    if (feedBlocked(followers.status, followers.payload)) return { ok: false, reason: "paused" };
    const media = await readJson(await context.request.get(
      "https://www.instagram.com/api/v1/feed/user/" + encodeURIComponent(user.value) + "/?count=4",
      { headers }
    ));
    if (feedBlocked(media.status, media.payload)) return { ok: false, reason: "paused" };
    const likes = [];
    for (const id of mediaIds(media.payload).slice(0, 4)) {
      const likers = await readJson(await context.request.get(
        "https://www.instagram.com/api/v1/media/" + encodeURIComponent(id) + "/likers/",
        { headers }
      ));
      if (feedBlocked(likers.status, likers.payload)) return { ok: false, reason: "paused" };
      likes.push(...handlesFromLikers(likers.payload));
    }
    const profiles = {};
    for (const handle of profileHandles || []) {
      const info = await readJson(await context.request.get(
        "https://www.instagram.com/api/v1/users/web_profile_info/?username=" + encodeURIComponent(handle),
        { headers }
      ));
      if (!feedBlocked(info.status, info.payload)) profiles[handle] = profileFromInfo(info.payload);
    }
    return {
      ok: true,
      ownHandle,
      followers: handlesFromFollowers(followers.payload),
      likes,
      profiles
    };
  } finally {
    await browser.close().catch(() => {});
  }
}

export async function readInstagram({ sessionFile, sessionKey, ownHandle, profileHandles, launch }) {
  const opened = decryptSessionFile(sessionFile, sessionKey);
  if (!opened) return { ok: false, reason: "no_session" };
  try {
    return await collectActivity({ storageFile: opened.storage, ownHandle, profileHandles, launch });
  } finally {
    opened.close();
  }
}
