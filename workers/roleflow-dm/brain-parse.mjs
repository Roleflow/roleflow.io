// Reads the Instagram web UI from HTML. Fixtures cover this. No private API.

const SKIP = new Set(["explore", "accounts", "direct", "reels", "reel", "p", "stories", "about", "legal", "developer", "emails"]);

export function parseHandles(html) {
  const found = [];
  const seen = new Set();
  const pattern = /href\s*=\s*["']\/([A-Za-z0-9._]{1,30})\/?(?:\?[^"']*)?["']/g;
  let match = pattern.exec(String(html || ""));
  while (match) {
    const handle = match[1].toLowerCase();
    if (!SKIP.has(handle) && !seen.has(handle)) {
      seen.add(handle);
      found.push(handle);
    }
    match = pattern.exec(String(html || ""));
  }
  return found;
}

export function parseCount(text) {
  const match = String(text || "").match(/([\d][\d,.]*)\s*Followers/i);
  if (!match) return null;
  const parsed = Number(match[1].replace(/[.,]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function decode(text) {
  return String(text || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, "\"")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseProfile(html) {
  const source = String(html || "");
  const title = (source.match(/<title>([^<]+)<\/title>/i) || [])[1] || "";
  const handle = ((title.match(/@([A-Za-z0-9._]+)/) || [])[1] || "").toLowerCase();
  const og = (source.match(/property=["']og:description["'][^>]*content=["']([^"']*)/i) || [])[1]
    || (source.match(/content=["']([^"']*)["'][^>]*property=["']og:description["']/i) || [])[1]
    || "";
  const bio = decode((source.match(/data-testid=["']user-bio["'][^>]*>([^<]*)</i) || [])[1] || "");
  const captions = [...source.matchAll(/<article\b[^>]*>([\s\S]*?)<\/article>/gi)]
    .map((match) => decode(match[1].replace(/<[^>]+>/g, " ")))
    .filter(Boolean)
    .slice(0, 3);
  const name = decode(title.split("(")[0] || "");
  return {
    handle,
    name,
    followers: parseCount(og) ?? parseCount(source),
    bio,
    captions,
    following: /data-testid=["']following["']/i.test(source) || />\s*Following\s*</.test(source),
    category: ""
  };
}
