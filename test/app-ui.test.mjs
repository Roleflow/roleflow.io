import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { friendlyAuthError, isLoginTab, readAuthCallback } from "../auth/callback.js";
import { authReturnUrl, safeNext, siteOrigin } from "../auth/return-url.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const expired = readAuthCallback("https://www.roleflow.io/account/#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired");
assert.equal(expired.type, "");
assert.match(expired.error, /invalid or has expired/i);
assert.equal(expired.hasGrant, false);

const confirmed = readAuthCallback("https://www.roleflow.io/account/#access_token=abc&refresh_token=def&type=signup");
assert.equal(confirmed.type, "signup");
assert.equal(confirmed.hasGrant, true);
assert.equal(confirmed.error, "");

const queryError = readAuthCallback("https://www.roleflow.io/signup/?error_description=Email+link+is+invalid+or+has+expired");
assert.match(friendlyAuthError({ message: queryError.error }), /invalid or expired/i);

const pkce = readAuthCallback("https://www.roleflow.io/signup/?next=%2Fbusinesses%2F&mode=login&code=abc123");
assert.equal(pkce.code, "abc123");
assert.equal(pkce.hasGrant, false);
assert.equal(pkce.error, "");
assert.equal(siteOrigin("http://localhost:3000/signup/?mode=login"), "http://localhost:3000");
assert.equal(siteOrigin("http://127.0.0.1:3000/login/"), "http://127.0.0.1:3000");
assert.equal(siteOrigin("https://roleflow-git-preview.vercel.app/signup/"), "https://roleflow-git-preview.vercel.app");
assert.equal(siteOrigin("https://roleflow.io/signup/?next=%2Fbusinesses%2F"), "https://www.roleflow.io");
assert.equal(siteOrigin("https://www.roleflow.io/login/"), "https://www.roleflow.io");
assert.equal(siteOrigin(""), "https://www.roleflow.io");
assert.equal(
  authReturnUrl("/signup/?mode=login", "/businesses/", "http://localhost:3000/signup/?next=%2Fbusinesses%2F&mode=login"),
  "http://localhost:3000/signup/?mode=login&next=%2Fbusinesses%2F"
);
assert.equal(
  authReturnUrl("/signup/?mode=login", "/businesses/", "https://roleflow-git-preview.vercel.app/signup/"),
  "https://roleflow-git-preview.vercel.app/signup/?mode=login&next=%2Fbusinesses%2F"
);
assert.equal(
  authReturnUrl("/signup/?mode=login", "/businesses/", "https://www.roleflow.io/signup/?mode=login"),
  "https://www.roleflow.io/signup/?mode=login&next=%2Fbusinesses%2F"
);
assert.equal(
  authReturnUrl("/signup/?mode=login", "/businesses/", "https://roleflow.io/signup/?mode=login"),
  "https://www.roleflow.io/signup/?mode=login&next=%2Fbusinesses%2F"
);
assert.equal(
  authReturnUrl("/login/", "https://evil.example/phish", "https://www.roleflow.io/login/"),
  "https://www.roleflow.io/login/?next=%2Faccount%2F"
);
assert.equal(
  authReturnUrl("/reset/", "/\t/evil.example", "https://www.roleflow.io/reset/"),
  "https://www.roleflow.io/reset/?next=%2Faccount%2F"
);

const rejectedNext = [
  ["tab", "/\t/evil.example"],
  ["tab from query", new URLSearchParams("next=%2F%09%2Fevil.example").get("next")],
  ["cr", "/\r/evil.example"],
  ["cr from query", new URLSearchParams("next=%2F%0D%2Fevil.example").get("next")],
  ["lf", "/\n/evil.example"],
  ["lf from query", new URLSearchParams("next=%2F%0A%2Fevil.example").get("next")],
  ["backslash", "/\\evil.example"],
  ["backslash doubled", "/\\\\evil.example"],
  ["protocol-relative", "//evil.example"],
  ["protocol-relative slash", "///evil.example"],
  ["absolute external", "https://evil.example/phish"],
  ["absolute external http", "http://evil.example/phish"],
  ["javascript", "javascript:alert(1)"],
  ["path that normalizes to protocol-relative", "/login/..//evil.example"]
];
for (const [name, value] of rejectedNext) {
  assert.equal(safeNext(value), "/account/", name);
  assert.equal(safeNext(value, "http://localhost:3000/login/"), "/account/", name + " on localhost");
}
assert.equal(safeNext("/account/"), "/account/");
assert.equal(safeNext("/businesses/"), "/businesses/");
assert.equal(safeNext("/businesses/?tab=1#leads"), "/businesses/?tab=1#leads");
assert.equal(safeNext("/admin/hq/"), "/admin/hq/");
assert.equal(safeNext("https://www.roleflow.io/account/"), "/account/");
assert.equal(safeNext("//www.roleflow.io/businesses/"), "/businesses/");
assert.equal(safeNext("/businesses/", "http://localhost:3000/login/"), "/businesses/");
assert.equal(safeNext("http://localhost:3000/businesses/", "http://localhost:3000/login/"), "/businesses/");
assert.equal(safeNext("https://www.roleflow.io/businesses/", "http://localhost:3000/login/"), "/account/");
assert.equal(safeNext(""), "/account/");
assert.equal(safeNext(null), "/account/");
assert.match(read("signup/signup.js"), /authReturnUrl\(/);
assert.match(read("signup/signup.js"), /\/signup\/\?mode=login/);
assert.match(read("login/login.js"), /authReturnUrl\("\/login\/", next, window\.location\.href\)/);
assert.match(read("reset/reset.js"), /authReturnUrl\("\/reset\/", next, window\.location\.href\)/);
assert.match(read("auth/callback.js"), /exchangeCodeForSession/);
assert.match(read("supabase/config.toml"), /site_url = "https:\/\/www\.roleflow\.io"/);
assert.match(read("supabase/config.toml"), /https:\/\/www\.roleflow\.io\/\*\*/);
assert.match(read("supabase/config.toml"), /https:\/\/roleflow\.io\/\*\*/);
assert.doesNotMatch(read("signup/signup.js") + read("login/login.js") + read("reset/reset.js") + read("auth/sidebar.js"), /localhost:3000/);

assert.equal(isLoginTab("?mode=login", "#access_token=abc&type=signup"), true);
assert.equal(isLoginTab("", "#login"), true);
assert.equal(isLoginTab("", "#access_token=abc&type=signup"), false);
assert.equal(isLoginTab("", "#error=access_denied&error_description=Email+link+is+invalid"), false);

assert.match(friendlyAuthError({ message: "Invalid login credentials" }), /don't match/);
assert.match(friendlyAuthError({ message: "Email not confirmed" }), /Confirm your email/);
assert.equal(friendlyAuthError({ message: "Database error saving new user" }), "Invalid access code.");

assert.match(read("signup/signup.js"), /get\("mode"\) === "login"/);
assert.match(read("signup/signup.js"), /isLoginTab/);
for (const file of ["signup/signup.js", "login/login.js", "reset/reset.js", "auth/sidebar.js", "businesses/app.js", "admin/hq/app.js", "admin/office/scene.js", "admin/office/factory.mjs"]) {
  const tmp = path.join(os.tmpdir(), "roleflow-syntax-" + file.replaceAll("/", "-") + ".mjs");
  fs.writeFileSync(tmp, read(file));
  const checked = spawnSync(process.execPath, ["--check", tmp], { encoding: "utf8" });
  assert.equal(checked.status, 0, file + "\n" + checked.stderr);
}
assert.match(read("signup/index.html"), /id="login-form"/);
assert.match(read("signup/index.html"), /id="access-code"/);
assert.match(read("login/login.js"), /shouldCreateUser:\s*false/);
assert.doesNotMatch(read("login/login.js"), /hash\.includes\("access_token"\)/);
assert.match(read("login/login.js"), /resolveSession/);
assert.match(read("reset/reset.js"), /type === "recovery"/);
assert.match(read("account/account.js"), /type === "recovery"/);
assert.match(read("account/index.html"), /id="setter" hidden/);
assert.match(read("account/index.html"), /Your <span class="g">AI Setter<\/span>/);
assert.match(read("account/index.html"), /id="app-side"/);
assert.match(read("admin/index.html"), /href="\/businesses\/">Businesses/);
assert.match(read("admin/index.html"), /href="\/account\/#profile">Your account/);
assert.doesNotMatch(read("admin/index.html"), /#clients|#publish|CRM\/Insights/);
assert.match(read("admin/admin.js"), /renderAcquisitionRoster/);
assert.match(read("admin/admin.js"), /Go to your businesses/);
assert.match(read("admin/acquisition-admin.js"), /Instagram: not connected/);
assert.match(read("admin/acquisition-admin.js"), /#dashboard/);
assert.match(read("admin/acquisition-admin.js"), /\["Open"\]/);
assert.match(read("admin/acquisition-admin.js"), /Pending activation/);
assert.doesNotMatch(read("admin/acquisition-admin.js"), /tailortalk/i);
assert.match(read("admin/crm.js"), /id: "crm-action-agent"|id="crm-action-agent"/);
assert.match(read("admin/crm.js"), /id: "crm-sync"/);
assert.match(read("onboarding/app.js"), /class: "stepper"/);
assert.match(read("auth/site.css"), /\.toast-stack/);
assert.match(read("auth/site.css"), /\.app-nav a\[aria-current=page\]/);
const scene = read("admin/office/scene.js");
assert.match(scene, /visibilitychange/);
assert.match(scene, /TOUCH\.PAN/);
assert.match(scene, /TOUCH\.DOLLY_PAN/);
assert.match(scene, /narrow \? 1\.25 : 1\.5/);
assert.match(scene, /layout === "factory"/);
assert.match(scene, /brand-brain/);
assert.match(scene, /PerspectiveCamera/);
assert.match(scene, /YOUR APPROVAL/);
assert.match(scene, /Next step: Your approval/);
assert.match(read("admin/office/factory.mjs"), /kind: "org"/);
assert.match(read("admin/office/org.mjs"), /agents below the C-suite/);
assert.match(read("admin/office/desk.mjs"), /in_progress/);
assert.match(read("admin/hq/app.js"), /currentDesk/);
assert.match(read("admin/hq/app.js"), /rosterCounts/);
assert.match(read("admin/office/scene.js"), /buildOrg/);
assert.match(read("admin/office/factory.mjs"), /Back Office/);
assert.doesNotMatch(read("admin/office/factory.mjs"), /coming soon/);
assert.match(scene, /addTether/);
assert.match(read("admin/hq/app.js"), /plan\.groups/);
assert.match(scene, /Setty AI/);
assert.match(scene, /Zerochats/);
assert.match(scene, /1 in - 10 out/);
assert.match(scene, /YOUR POSTS/);
assert.match(scene, /ON THE BALCONY/);
assert.match(scene, /syncCards/);
const hq = read("admin/hq/app.js");
assert.match(hq, /layout: "factory"/);
assert.match(hq, /\/docs\/brand-brain\.md/);
assert.match(hq, /factoryCards/);
assert.match(read("docs/brand-brain.md"), /Brand Brain/);
assert.match(read(".vercelignore"), /!docs\/brand-brain\.md/);
const workforce = read("businesses/workforce.js");
assert.match(workforce, /layout: "factory"/);
assert.match(workforce, /setterPlan/);
assert.match(workforce, /Brand Brain/);
assert.match(workforce, /DM setter/);
assert.match(read("admin/office/factory.mjs"), /Leads In/);
assert.match(read("admin/office/factory.mjs"), /Overseer, on the balcony/);
assert.match(hq, /hqPlan\(activeAgents\(\)\)/);
assert.match(hq, /data-action": "cam"/);
assert.match(hq, /statusBubble/);
assert.match(workforce, /data-cam/);
assert.match(workforce, /statusBubble/);
const hqCss = read("admin/hq/hq.css");
assert.match(hqCss, /\.cam-tabs/);
assert.match(hqCss, /scroll-snap-type:x mandatory/);
assert.match(hqCss, /body\.hq #hq-nav\.app-nav\{position:fixed/);
assert.match(hqCss, /#hq-panel\{top:auto/);
assert.match(hqCss, /\.hq-need \.btn\{min-height:52px/);

assert.match(read("index.html"), /id="drawer-applications" href="\/admin\/#applications" hidden>Applications Tracker/);
assert.match(read("index.html"), /id="drawer-admin" href="\/admin\/" hidden>Client tracking/);
assert.match(read("index.html"), /id="drawer-crm" href="\/admin\/#crm" hidden>CRM/);
assert.match(read("auth/sidebar.js"), /applicationsLink\.hidden = !isAdmin/);
assert.match(read("auth/sidebar.js"), /crmLink\.hidden = !isAdmin/);
const homepage = read("index.html");
assert.match(homepage, /id="menu-toggle" href="\/signup\/">Access/);
assert.match(homepage, /AI Client Acquisition Engine/);
assert.match(homepage, /AI Client Acquisition Engine\./);
assert.match(homepage, /class="vsl"/);
assert.match(homepage, /https:\/\/share\.descript\.com\/embed\/XJIQMjM0Q1N/);
assert.match(homepage, /https:\/\/share\.descript\.com\/view\/XJIQMjM0Q1N/);
assert.match(homepage, /loading="lazy"/);
assert.match(homepage, /aspect-ratio:16\/9|class="vsl-frame"/);
assert.doesNotMatch(homepage, /calendar\.app\.google/);
assert.match(homepage, /href="#qualify" data-qualify>Apply To Work Together →/);
const heroHtml = homepage.slice(homepage.indexOf('<section class="hero">'), homepage.indexOf("</section>", homepage.indexOf('<section class="hero">')));
assert.match(heroHtml, /<em class="serif">Per Close<\/em>/);
assert.match(heroHtml, /class="trust"/);
assert.match(heroHtml, /AI Client Acquisition Engine/);
assert.doesNotMatch(heroHtml, /avatar/i);
assert.match(heroHtml, /class="promise"/);
assert.match(heroHtml, /class="vsl-shell"/);
assert.doesNotMatch(heroHtml, /Value Add Marketing/);
assert.doesNotMatch(heroHtml, /vam-logo/);
assert.doesNotMatch(homepage, /Value Add Marketing/);
assert.doesNotMatch(homepage, /vam-logo/);
assert.doesNotMatch(homepage, /id="results"/);
assert.doesNotMatch(homepage, /\$50k a month/);
const ticker = homepage.slice(homepage.indexOf('class="marquee"'), homepage.indexOf("</div>", homepage.indexOf("marquee-track")) + 6);
assert.match(ticker, /Instagram DM replies/);
assert.doesNotMatch(ticker, /AI DM setter/);
assert.match(ticker, /Recorded voice notes/);
assert.match(ticker, /Practice chat/);
assert.doesNotMatch(ticker, /Lead warmer|Comment voice/);
assert.match(homepage, /<h2>[^<]*<em class="serif">/);
const offerHtml = homepage.slice(homepage.indexOf('id="offer"'), homepage.indexOf('id="skool"'));
assert.match(offerHtml, /Value stack/);
assert.match(offerHtml, /What's included/);
assert.match(offerHtml, /The risk sits with/);
assert.match(offerHtml, /Per closed deal/);
assert.match(offerHtml, /10%/);
assert.match(offerHtml, /\$0 upfront \+ 10% of revenue generated, no retainer/);
assert.doesNotMatch(offerHtml, /No setup fee/);
assert.match(offerHtml, /href="\/terms\/"/);
assert.match(offerHtml, /Results vary; not a guarantee/);
assert.match(homepage, /id="edge"/);
assert.match(homepage, /\$0 upfront \+ 10% of revenue generated, no retainer/);
assert.doesNotMatch(homepage, /100% revenue share/);
assert.doesNotMatch(homepage, /No setup fee/);
assert.doesNotMatch(homepage, /10% of the business growth you record on deals Roleflow sourced/);
assert.doesNotMatch(homepage, /AI DM setter/);
assert.match(homepage, /built to convert because we only earn when you do/);
assert.match(homepage, /Results vary; not a guarantee/);
assert.match(homepage, /A hired setter/);
assert.match(homepage, /other AI setter/);
assert.doesNotMatch(homepage, /ManyChat|Zernio|RipDrip|Mochi|guaranteed/i);
assert.equal(fs.existsSync(path.join(root, "es/index.html")), false);
assert.doesNotMatch(homepage, /href="\/es/);
assert.doesNotMatch(homepage, /hreflang="es"/);
assert.match(read("account/acquisition/index.html"), /class="profile-lang"[\s\S]*id="lang-es" data-lang="es"[\s\S]*id="lang-en"/);
const accessPage = read("signup/index.html");
assert.match(accessPage, /AI Client Acquisition Engine/);
assert.match(accessPage, /Value Add Marketing/);
assert.match(accessPage, /Results vary; not a guarantee/);
assert.match(accessPage, /\/assets\/vam-logo\.svg/);
assert.match(accessPage, /\$50k a month/);
assert.doesNotMatch(accessPage, /\[TESTIMONIAL/);
assert.match(homepage, /id="drawer-dashboard" href="\/account\/acquisition\/"/);
assert.match(homepage, /id="drawer-login"/);
const primaryNav = homepage.match(/<nav class="nav-links"[\s\S]*?<\/nav>/)[0];
assert.match(primaryNav, />Services</);
assert.match(primaryNav, />Offer</);
assert.match(primaryNav, /Skool Crew/);
assert.doesNotMatch(primaryNav, /Results|Podcast|Español|English/);
assert.doesNotMatch(primaryNav, /Log in/);
assert.doesNotMatch(primaryNav, /signup\/\?mode=login/);
const navActions = homepage.match(/<div class="nav-actions"[\s\S]*?<\/div>/)[0];
assert.match(navActions, /class="nav-access" href="\/login\/\?next=\/account\/acquisition\/">Access/);
assert.match(navActions, /class="nav-cta" href="#qualify" data-qualify>Apply/);
assert.ok(navActions.indexOf(">Access<") < navActions.indexOf(">Apply<"));
assert.match(primaryNav, /class="nav-access-link" href="\/login\/\?next=\/account\/acquisition\/">Access/);
assert.doesNotMatch(homepage, /slow replies/);
assert.match(read("vercel.json"), /frame-src 'self' https:\/\/share\.descript\.com/);
assert.doesNotMatch(homepage, />Menu</);
assert.match(homepage, /href="\/resources\/"/);
assert.match(homepage, /class="foot-social"/);
assert.match(homepage, /href="https:\/\/www\.instagram\.com\/roleflow\.io" target="_blank" rel="noopener"/);
assert.match(homepage, /href="https:\/\/www\.tiktok\.com\/@roleflow\.io" target="_blank" rel="noopener"/);
assert.match(homepage, /href="https:\/\/www\.youtube\.com\/@roleflow" target="_blank" rel="noopener"/);
assert.match(read("booked/index.html"), /While you wait for your call, see how the system works:/);
assert.match(read("booked/index.html"), /rel="noopener"/);
assert.match(read("auth/sidebar.js"), /tagName === "A"/);

for (const file of ["account/index.html", "account/account.js", "account/setter.js", "account/setter-model.js"]) {
  assert.doesNotMatch(read(file), /tailortalk/i, file);
}

console.log("app ui ok");
