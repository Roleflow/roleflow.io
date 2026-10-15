import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { friendlyAuthError, isLoginTab, readAuthCallback } from "../auth/callback.js";

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

assert.equal(isLoginTab("?mode=login", "#access_token=abc&type=signup"), true);
assert.equal(isLoginTab("", "#login"), true);
assert.equal(isLoginTab("", "#access_token=abc&type=signup"), false);
assert.equal(isLoginTab("", "#error=access_denied&error_description=Email+link+is+invalid"), false);

assert.match(friendlyAuthError({ message: "Invalid login credentials" }), /don't match/);
assert.match(friendlyAuthError({ message: "Email not confirmed" }), /Confirm your email/);
assert.equal(friendlyAuthError({ message: "Database error saving new user" }), "Invalid access code.");

assert.match(read("signup/signup.js"), /get\("mode"\) === "login"/);
assert.match(read("signup/signup.js"), /isLoginTab/);
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
assert.match(read("admin/admin.js"), /location\.replace\("\/businesses\/"\)/);
assert.match(read("admin/crm.js"), /id: "crm-action-agent"|id="crm-action-agent"/);
assert.match(read("admin/crm.js"), /id: "crm-sync"/);
assert.match(read("onboarding/app.js"), /class: "stepper"/);
assert.match(read("auth/site.css"), /\.toast-stack/);
assert.match(read("auth/site.css"), /\.app-nav a\[aria-current=page\]/);

const homepage = read("index.html");
assert.match(homepage, /id="menu-toggle" href="\/signup\/">Access/);
assert.match(homepage, /class="vsl"/);
assert.match(homepage, /data-src="https:\/\/share\.descript\.com\/embed\/XJIQMjM0Q1N"/);
assert.match(homepage, /loading="lazy"/);
assert.match(read("vercel.json"), /frame-src 'self' https:\/\/share\.descript\.com/);
assert.doesNotMatch(homepage, />Menu</);
assert.match(homepage, /<footer><a href="\/resources\/"/);
assert.match(read("auth/sidebar.js"), /tagName === "A"/);

for (const file of ["account/index.html", "account/account.js", "account/setter.js", "account/setter-model.js"]) {
  assert.doesNotMatch(read(file), /tailortalk/i, file);
}

console.log("app ui ok");
