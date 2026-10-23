import assert from "node:assert/strict";
import fs from "node:fs";

const read = (file) => fs.readFileSync(new URL("../" + file, import.meta.url), "utf8");

const html = read("account/acquisition/index.html");
const css = read("acquire/acquire.css");
const dock = read("acquire/dock.js");
const connect = read("acquire/connect-instagram.js");
const office = read("acquire/office.js");

assert.match(html, /id="panel-collapse"/);
assert.match(html, /Collapse sidebar/);
assert.match(html, /class="desk-modal"/);
assert.match(html, /desk-modal-backdrop/);
assert.match(html, /data-close-drawer/);
assert.doesNotMatch(html, /class="agent-drawer"/);

assert.match(css, /\.desk-modal\{position:fixed;inset:0/);
assert.match(css, /place-items:center/);
assert.match(css, /\.integration-status\.on/);
assert.match(css, /grid-template-columns:280px/);

assert.match(dock, /rf-sidebar/);
assert.match(dock, /function expandSidebar/);
assert.match(dock, /function collapseSidebar/);
assert.match(dock, /localStorage/);

assert.match(connect, /Connected/);
assert.match(connect, /connect-native/);
assert.match(connect, /Connect Instagram/);
assert.match(connect, /Connecting… we'll finish this for you/);

assert.match(office, /desk-modal-title/);
assert.match(office, /data-close-drawer/);
assert.match(office, /Escape/);

assert.doesNotMatch(connect + html + dock + office, /tailor\s*talk|tailortalk\.ai/i);

console.log("panel chrome tests passed");
