import assert from "node:assert/strict";
import fs from "node:fs";
import {
  SIDEBAR_COLLAPSED_PX,
  SIDEBAR_EXPANDED_PX,
  SIDEBAR_GROUPS_KEY,
  SIDEBAR_MOTION_MS,
  SIDEBAR_STORAGE_KEY,
  drawerRequested,
  persistCollapsedGroups,
  persistExpanded,
  readCollapsedGroups,
  readExpanded,
  toggleExpanded,
  toggleLabel
} from "../acquire/sidebar-state.js";

const memory = () => {
  const data = new Map();
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value))
  };
};

const store = memory();
assert.equal(readExpanded(store), true);
persistExpanded(store, false);
assert.equal(store.getItem(SIDEBAR_STORAGE_KEY), "collapsed");
assert.equal(readExpanded(store), false);
persistExpanded(store, true);
assert.equal(readExpanded(store), true);
assert.equal(toggleExpanded(true), false);
assert.equal(toggleExpanded(false), true);

const legacy = memory();
legacy.setItem("rf-sidebar", "closed");
assert.equal(readExpanded(legacy), false);
legacy.setItem("rf-sidebar", "open");
assert.equal(readExpanded(legacy), true);

const broken = {
  getItem() {
    throw new Error("blocked");
  },
  setItem() {
    throw new Error("blocked");
  }
};
assert.equal(readExpanded(broken), true);
persistExpanded(broken, false);
assert.deepEqual(readCollapsedGroups(broken), []);
persistCollapsedGroups(broken, ["strategy"]);

const groups = memory();
assert.deepEqual(readCollapsedGroups(groups), []);
persistCollapsedGroups(groups, ["strategy", "settings"]);
assert.equal(groups.getItem(SIDEBAR_GROUPS_KEY), '["strategy","settings"]');
assert.deepEqual(readCollapsedGroups(groups), ["strategy", "settings"]);
groups.setItem(SIDEBAR_GROUPS_KEY, "nope");
assert.deepEqual(readCollapsedGroups(groups), []);

assert.equal(SIDEBAR_COLLAPSED_PX, 72);
assert.equal(SIDEBAR_EXPANDED_PX, 264);
assert.ok(SIDEBAR_MOTION_MS >= 250 && SIDEBAR_MOTION_MS <= 300);
assert.equal(toggleLabel({ expanded: true, mobile: false, drawerOpen: false }), "Collapse sidebar");
assert.equal(toggleLabel({ expanded: false, mobile: false, drawerOpen: false }), "Expand sidebar");
assert.equal(toggleLabel({ expanded: true, mobile: true, drawerOpen: true }), "Close menu");
assert.equal(toggleLabel({ expanded: true, mobile: true, drawerOpen: false }), "Open menu");
assert.equal(drawerRequested(true, false), false);
assert.equal(drawerRequested(true, true), true);
assert.equal(drawerRequested(false, true), false);

const root = new URL("../", import.meta.url);
const read = (file) => fs.readFileSync(new URL(file, root), "utf8");
const html = read("account/acquisition/index.html");
const css = read("acquire/acquire.css");
const dock = read("acquire/dock.js");
const home = read("acquire/home.js");

assert.match(html, /id="side-toggle"/);
assert.match(html, /aria-expanded="true"/);
assert.match(html, /aria-controls="app-side"/);
assert.match(html, /Collapse sidebar/);
assert.match(html, /Expand sidebar/);
assert.match(html, /roleflow\.sidebar/);
assert.match(html, /class="ico-chevrons"/);
assert.match(html, /class="ico-menu"/);
assert.match(html, /id="nav-backdrop"/);

assert.match(css, /grid-template-columns:264px minmax\(0,1fr\)/);
assert.match(css, /grid-template-columns:72px minmax\(0,1fr\)/);
assert.match(css, /280ms ease-in-out/);
assert.match(css, /max-width:767px/);
assert.match(css, /white-space:nowrap/);
assert.match(css, /grid-template-rows:1fr/);
assert.match(css, /grid-template-rows:0fr/);
assert.match(css, /prefers-reduced-motion:reduce/);
assert.match(css, /translateX\(-105%\)/);
assert.doesNotMatch(css, /grid-template-columns:76px/);
assert.doesNotMatch(css, /grid-template-columns:280px minmax/);
assert.doesNotMatch(css, /TailorTalk|Zernio|zerochats/i);
assert.doesNotMatch(css, /outline:2px solid #FF8A3D/);

assert.doesNotMatch(dock, /pointermove|mouseenter|mouseover|armOpen|scheduleClose/);
assert.match(dock, /pointerover/);
assert.match(dock, /aria-expanded/);
assert.match(dock, /prefers-reduced-motion/);
assert.match(dock, /localStorage/);
assert.match(home, /nav-group-toggle/);
assert.match(home, /nav-chevron/);
assert.match(home, /aria-expanded/);
assert.match(home, /white-space|nav-label/);
assert.doesNotMatch(dock + home + html, /tailor\s*talk|zernio/i);

console.log("sidebar tests passed");
