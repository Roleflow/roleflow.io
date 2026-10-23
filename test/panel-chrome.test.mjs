import assert from "node:assert/strict";
import fs from "node:fs";

const read = (file) => fs.readFileSync(new URL("../" + file, import.meta.url), "utf8");

const html = read("account/acquisition/index.html");
const css = read("acquire/acquire.css");
const dock = read("acquire/dock.js");
const connect = read("acquire/connect-instagram.js");
const office = read("acquire/office.js");

assert.match(html, /id="side-toggle"/);
assert.match(html, /Collapse sidebar/);
assert.match(html, /aria-expanded/);
assert.match(html, /class="desk-modal"/);
assert.match(html, /desk-modal-backdrop/);
assert.match(html, /data-close-drawer/);
assert.doesNotMatch(html, /class="agent-drawer"/);

assert.match(css, /\.desk-modal\{position:fixed;inset:0/);
assert.match(css, /place-items:center/);
assert.match(css, /\.integration-status\.on/);
assert.match(css, /grid-template-columns:264px/);

assert.doesNotMatch(dock, /pointermove/);
assert.match(dock, /localStorage/);
assert.match(dock, /aria-expanded/);

assert.match(connect, /Connected/);
assert.match(connect, /connect-native/);
assert.match(connect, /Connect Instagram/);
assert.match(connect, /Connecting… we'll finish this for you/);

assert.match(office, /desk-modal-title/);
assert.match(office, /data-close-drawer/);
assert.match(office, /Escape/);

assert.doesNotMatch(connect + html + dock + office, /tailor\s*talk|tailortalk\.ai|\btailor\b/i);
assert.doesNotMatch(css, /outline:2px solid #FF8A3D/);
assert.doesNotMatch(css, /border-radius:0 0 12px 12px/);
assert.match(css, /body\.platform \.agent input:not\(\[type="checkbox"\]/);
assert.match(css, /box-shadow:0 0 0 3px rgba\(123,77,255,\.28\)/);
assert.match(css, /\.setter-section textarea\{min-height:160px;margin:0 12px 12px;width:calc\(100% - 24px\)\}/);

console.log("panel chrome tests passed");
