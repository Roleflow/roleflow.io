// Phone layout check for the client panel (/account/acquisition/).
// Runs the local preview with demo data and every outside request blocked
// (fonts and the supabase-js bundle are allowed so the page renders as it does live).
//
//   python3 -m http.server 8811 --bind 127.0.0.1        # from the repo root
//   npm i --no-save playwright-core
//   CHROME=/usr/bin/google-chrome node scripts/panel-mobile-check.mjs
//
// Fails when, at 360, 375, 390 or 430 px wide, a screen scrolls sideways, an element
// sticks out of the screen, a button or field sits under another element, two
// pieces of text overlap, or a single word is squeezed onto several lines. Also checks that 768, 1024 and 1440 px are unchanged by
// panel-mobile.css (same boxes and styles with the file on and off).
import { chromium } from "playwright-core";

const BASE = process.env.BASE || "http://127.0.0.1:8811";
const CHROME = process.env.CHROME || "/usr/bin/google-chrome";
const ALLOW = new Set(["127.0.0.1", "localhost", "fonts.googleapis.com", "fonts.gstatic.com", "cdn.jsdelivr.net"]);
const P = "/account/acquisition/?preview=1&edit=1";
const PHONES = [[360, 780], [375, 812], [390, 844], [430, 932]];
const DESKTOPS = [768, 1024, 1440];
const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY) : null; // e.g. ONLY=chats to check one screen

const click = (selector, nth = 0) => async (page) => { await page.locator(selector).nth(nth).click({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(300); };
const SCREENS = [
  ["dashboard", P + "&switches=live#dashboard"],
  ["dashboard blocked", P + "&switches=live&aikey=bad&igstatus=error&admin=1#dashboard"],
  ["dashboard es", P + "&switches=live&lang=es#dashboard"],
  ["performance", P + "#performance"],
  ["assistant", P + "#assistant"],
  ["chats", P + "#chats"],
  ["chats empty", P + "&chats=empty#chats"],
  ["opportunities", P + "#opportunities"],
  ["opportunities filters", P + "#opportunities", click(".filters-menu summary")],
  ["opportunities lead sheet", P + "&sheet=1#opportunities"],
  ["calendar", P + "#calendar"],
  ["calendar week", P + "#calendar", click(".gcal-views button", 1)],
  ["calendar month", P + "#calendar", click(".gcal-views button", 2)],
  ["calendar schedule", P + "#calendar", click(".gcal-views button", 3)],
  ["calendar event", P + "#calendar", click(".gcal-event")],
  ["sops", P + "#sops"],
  ["sops built", P + "&built=1#sops"],
  ["ctas", P + "#ctas"],
  ["ctas add keyword", P + "&cta=add#ctas"],
  ["voice", P + "#voice"],
  ["lead warmer", P + "#warmer"],
  ["outreacher", P + "#outreacher"],
  ["setter", P + "#setter"],
  ["follow-ups", P + "#followup"],
  ["follow-ups add step", P + "#followup", click("#follow-add-step")],
  ["follow-ups manual", P + "#followup/manual"],
  ["follow-ups welcome", P + "#followup/welcome"],
  ["follow-ups reminders", P + "#followup/reminders"],
  ["settings", P + "#settings"],
  ["settings team", P + "&team=1#settings"],
  ["setter tester", "/account/acquisition/?preview=1&role=tester#setter"],
  ["setter prompt editor", "/account/acquisition/?preview=1&role=prompt_editor#setter"],
  ["settings instagram", P + "&connect=1#settings/connect"],
  ["settings instagram long handle", P + "&igstatus=connected&handle=averyveryverylonginstagramhandle_forthetest#settings/connect"],
  ["settings ai key", P + "&claude=bad#settings/model"],
  ["menu open", P + "#dashboard", click("#nav-toggle")],
  ["profile menu", P + "#dashboard", click("#profile-open")],
  ["assistant panel", P + "#dashboard", click("#assistant-open")],
  ["many businesses", P + "&many=1#dashboard", click("#nav-toggle")],
  ["login", "/login/"],
  ["signup", "/signup/"],
  ["onboarding", "/account/onboarding/?preview=1"]
];

function inspect() {
  const W = document.documentElement.clientWidth, H = innerHeight;
  const style = (e) => getComputedStyle(e);
  const visible = (e) => {
    const r = e.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || r.right <= 0 || r.left >= W) return false;
    if (e.closest("[hidden],.sr,.skip,[aria-hidden=true]") || e.closest("details:not([open]) > :not(summary)")) return false;
    for (let p = e; p && p !== document.body; p = p.parentElement) {
      const s = style(p);
      if (s.display === "none" || s.visibility === "hidden" || +s.opacity === 0) return false;
      if (p !== e && s.overflow !== "visible") { const q = p.getBoundingClientRect(); if (r.bottom <= q.top + 1 || r.top >= q.bottom - 1 || r.right <= q.left + 1 || r.left >= q.right - 1) return false; }
    }
    return true;
  };
  const clipped = (e) => { for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) if (/(auto|scroll|hidden|clip)/.test(style(p).overflowX)) return true; return false; };
  // A "layer" is an overlay the element lives in (fixed, sticky, popovers). Things in different layers may overlap by design.
  const LAYER = ".modal,.desk-modal,[role=dialog],.nav-backdrop,.platform-side,.assistant-panel,.profile-panel,.cta-dialog,.lead-drawer,.gcal-pop,.toast-stack";
  const layer = (e) => { for (let p = e; p && p !== document.body; p = p.parentElement) { const s = style(p).position; if (s === "fixed" || s === "sticky" || p.matches(LAYER)) return p; } return null; };
  const name = (e) => { let s = e.tagName.toLowerCase() + (e.id ? "#" + e.id : "") + (typeof e.className === "string" && e.className.trim() ? "." + e.className.trim().split(/\s+/).slice(0, 2).join(".") : ""); const t = (e.innerText || e.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ").slice(0, 30); return t ? s + ' "' + t + '"' : s; };
  const problems = [];
  if (document.documentElement.scrollWidth > W + 1) problems.push("page scrolls sideways by " + (document.documentElement.scrollWidth - W) + "px");
  const all = [...document.querySelectorAll("body *")].filter((e) => !["SCRIPT", "STYLE", "BR", "OPTION"].includes(e.tagName) && visible(e));
  const wide = new Set(all.filter((e) => { const r = e.getBoundingClientRect(); return (r.right > W + 1 || r.left < -1) && !clipped(e) && style(e).position !== "fixed"; }));
  for (const e of wide) if (!wide.has(e.parentElement)) problems.push("sticks out of the screen: " + name(e));
  // Controls hidden under something else when scrolled to the middle of the screen.
  const controls = all.filter((e) => e.matches("button, a[href], input:not([type=hidden]), select, textarea, summary") && !(e.matches("input[type=file]") && style(e).opacity < 0.1));
  const y0 = scrollY;
  for (const e of controls) {
    const own = layer(e);
    if (!own) { const r = e.getBoundingClientRect(); window.scrollTo(0, Math.max(0, r.top + scrollY - H / 2)); }
    const r = e.getBoundingClientRect();
    const x = Math.min(W - 1, Math.max(0, r.left + r.width / 2)), y = r.top + r.height / 2;
    if (y < 0 || y > H) continue;
    const top = document.elementFromPoint(x, y);
    if (!top || top === e || e.contains(top) || top.contains(e) || (e.labels && [...e.labels].some((l) => l.contains(top))) || (top.closest("label") && top.closest("label").contains(e))) continue;
    const other = layer(top);
    if (other && other !== own && !other.contains(e)) continue; // an overlay or sticky bar on top is expected
    if (top.matches(".assistant-fab, .assistant-fab *")) {
      // The floating button may pass over content while scrolling; only the very end of the page counts.
      if (document.documentElement.scrollHeight - (scrollY + H) > 4) continue;
    }
    problems.push("under another element: " + name(e) + " is covered by " + name(top));
  }
  window.scrollTo(0, y0);
  // Overlapping text, measured on the glyph boxes themselves.
  const runs = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.textContent.trim() || !n.parentElement || !visible(n.parentElement) || n.parentElement.closest("svg,select,option,textarea")) continue;
    const range = document.createRange(); range.selectNodeContents(n);
    const rects = [...range.getClientRects()].filter((r) => r.width > 2 && r.height > 2);
    for (const r of rects) runs.push([n.parentElement, r, layer(n.parentElement)]);
    // A single word wrapped onto several lines ("Key / wo / rd") means its box is far too narrow.
    const word = n.textContent.trim();
    if (!/\s/.test(word) && word.length >= 4 && !/^https?:|@|\//.test(word) && new Set(rects.map((r) => Math.round(r.top))).size > 1) problems.push("word split across lines: " + name(n.parentElement) + ' "' + word.slice(0, 20) + '"');
  }
  for (let i = 0; i < runs.length; i++) for (let j = i + 1; j < runs.length; j++) {
    const [a, ra, la] = runs[i], [b, rb, lb] = runs[j];
    if (a === b || la !== lb) continue;
    const ix = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left), iy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
    if (ix > 2 && iy > Math.min(ra.height, rb.height) * 0.4) problems.push("text overlaps: " + name(a) + " and " + name(b));
  }
  return [...new Set(problems)];
}

let browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
// A long run can crash a renderer on a small machine; start a fresh browser and try once more.
async function retry(fn) {
  try { return await fn(); }
  catch (error) {
    if (!/crash|closed/i.test(String(error))) throw error;
    await browser.close().catch(() => {});
    browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
    return fn();
  }
}
async function open(viewport, mobile) {
  const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1 });
  await context.route("**/*", (route) => (ALLOW.has(new URL(route.request().url()).hostname) ? route.continue() : route.abort()));
  return context;
}
let failures = 0;
for (const [width, height] of PHONES) {
  for (const [label, url, act] of SCREENS) {
    if (ONLY && !ONLY.test(label)) continue;
    const problems = await retry(async () => {
      const context = await open({ width, height }, true);
      try {
        const page = await context.newPage();
        await page.goto(BASE + url, { waitUntil: "load" });
        await page.waitForTimeout(900);
        if (act) await act(page);
        return await page.evaluate(inspect);
      } finally { await context.close().catch(() => {}); }
    });
    if (problems.length) { failures++; console.log("FAIL " + width + "px " + label); problems.slice(0, 12).forEach((p) => console.log("     " + p)); }
    else console.log("ok   " + width + "px " + label);
  }
}
const snapshot = (page) => page.evaluate(() => [...document.querySelectorAll("body *")].map((e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return [r.x, r.y, r.width, r.height, s.display, s.position, s.color, s.backgroundColor, s.fontSize, s.padding, s.margin, s.gridTemplateColumns, s.flexDirection].map((v) => (typeof v === "number" ? Math.round(v) : v)).join("|"); }).join("\n"));
for (const width of DESKTOPS) {
  for (const tab of ["dashboard", "performance", "chats", "opportunities", "calendar", "ctas", "voice", "setter", "followup", "settings"]) {
    if (ONLY && !ONLY.test(tab)) continue;
    const context = await open({ width, height: 900 }, false);
    const page = await context.newPage();
    await page.goto(BASE + P + "&switches=live#" + tab, { waitUntil: "load" });
    await page.waitForTimeout(900);
    const withFile = await snapshot(page);
    await page.evaluate(() => { const link = document.querySelector('link[href$="panel-mobile.css"]'); if (link) link.disabled = true; });
    await page.waitForTimeout(100);
    const without = await snapshot(page);
    if (withFile !== without) { failures++; console.log("FAIL " + width + "px " + tab + ": panel-mobile.css changes the desktop layout"); }
    else console.log("ok   " + width + "px " + tab + " (desktop unchanged)");
    await context.close();
  }
}
await browser.close();
console.log(failures ? failures + " failing checks" : "all checks pass");
process.exit(failures ? 1 : 0);
