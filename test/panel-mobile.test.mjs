import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const css = fs.readFileSync(new URL("../acquire/panel-mobile.css", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../account/acquisition/index.html", import.meta.url), "utf8");

// Strip comments, then walk the top level of the stylesheet.
function topLevelBlocks(source) {
  const text = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const blocks = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "{") {
      if (depth === 0) blocks.push({ prelude: text.slice(start, i).trim(), open: i });
      depth++;
    } else if (text[i] === "}") {
      depth--;
      if (depth === 0) {
        blocks[blocks.length - 1].body = text.slice(blocks[blocks.length - 1].open + 1, i);
        start = i + 1;
      }
    }
  }
  assert.equal(depth, 0, "panel-mobile.css has unbalanced braces");
  assert.equal(text.slice(start).trim(), "", "panel-mobile.css has text after the last block");
  return blocks;
}

// Split a selector list on top-level commas only (not the ones inside :has() or :not()).
function splitSelectors(list) {
  const out = [];
  let depth = 0;
  let current = "";
  for (const ch of list) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { out.push(current); current = ""; } else current += ch;
  }
  out.push(current);
  return out;
}

test("panel-mobile.css loads after the shared panel styles", () => {
  const shell = html.indexOf('href="/acquire/panel-shell.css"');
  const mobile = html.indexOf('href="/acquire/panel-mobile.css"');
  assert.ok(shell > 0, "panel-shell.css link is missing");
  assert.ok(mobile > shell, "panel-mobile.css must come after panel-shell.css");
});

test("every rule is phone only, so the desktop layout cannot change", () => {
  const blocks = topLevelBlocks(css);
  assert.ok(blocks.length >= 1);
  for (const block of blocks) {
    const match = /^@media\s*\(\s*max-width:\s*(\d+)px\s*\)$/.exec(block.prelude);
    assert.ok(match, "top-level block is not a max-width media query: " + block.prelude);
    assert.ok(Number(match[1]) <= 767, "media query reaches desktop widths: " + block.prelude);
  }
});

test("rules are scoped to the client panel", () => {
  for (const block of topLevelBlocks(css)) {
    const selectors = block.body.replace(/\{[^}]*\}/g, "\n").split("\n").flatMap(splitSelectors).map((s) => s.trim()).filter(Boolean);
    for (const selector of selectors) assert.match(selector, /^body\.platform/, "selector is not scoped to body.platform: " + selector);
  }
});

test("no vendor names in panel styles", () => {
  assert.doesNotMatch(css, /zernio/i);
});
