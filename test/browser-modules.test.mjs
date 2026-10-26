import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

function compileIgnore(pattern) {
  let body = pattern;
  const anchored = body.startsWith("/");
  if (anchored) body = body.slice(1);
  const anyDir = !body.includes("/");
  let out = "";
  for (let i = 0; i < body.length; i += 1) {
    const char = body[i];
    if (char === "*" && body[i + 1] === "*") {
      if (body[i + 2] === "/") {
        out += "(?:.*\\/)?";
        i += 2;
      } else {
        out += ".*";
        i += 1;
      }
      continue;
    }
    if (char === "*") {
      out += "[^/]*";
      continue;
    }
    if (char === "?") {
      out += "[^/]";
      continue;
    }
    if (".+^${}()|[]\\".includes(char)) out += "\\" + char;
    else out += char;
  }
  return anyDir && !anchored ? new RegExp(`(?:^|.*/)${out}$`) : new RegExp(`^${out}$`);
}

function parseVercelIgnore(text) {
  const rules = [];
  for (const raw of text.split(/\n/)) {
    const trimmed = raw.replace(/\r$/, "").trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const negate = trimmed.startsWith("!");
    let pattern = negate ? trimmed.slice(1) : trimmed;
    const dirOnly = pattern.endsWith("/");
    if (dirOnly) pattern = pattern.slice(0, -1);
    rules.push({ negate, dirOnly, regex: compileIgnore(pattern) });
  }
  return rules;
}

function vercelIgnored(rel, rules) {
  const parts = rel.split("/");
  const prefixes = [];
  for (let i = 1; i <= parts.length; i += 1) prefixes.push(parts.slice(0, i).join("/"));
  let ignored = false;
  for (const rule of rules) {
    for (const prefix of prefixes) {
      if (!rule.regex.test(prefix)) continue;
      if (prefix !== rel && rule.negate) continue;
      if (rule.dirOnly && prefix === rel) continue;
      ignored = !rule.negate;
    }
  }
  return ignored;
}

const ignoreText = fs.readFileSync(path.join(root, ".vercelignore"), "utf8");
const ignoreRules = parseVercelIgnore(ignoreText);
assert.match(ignoreText, /^supabase\/functions$/m);
assert.equal(vercelIgnored("supabase/functions/_shared/setter-gate.js", ignoreRules), true);
assert.equal(vercelIgnored("supabase/migrations/20261023140000_setter_gate.sql", ignoreRules), true);
assert.equal(vercelIgnored("supabase/config.js", ignoreRules), false);
assert.equal(vercelIgnored("acquire/setter-delay.js", ignoreRules), false);
assert.equal(vercelIgnored("acquire/app.js", ignoreRules), false);
assert.equal(vercelIgnored("docs/other.md", ignoreRules), true);
assert.equal(vercelIgnored("docs/brand-brain.md", ignoreRules), false);
assert.equal(vercelIgnored("test/qualify.test.mjs", ignoreRules), true);
assert.equal(vercelIgnored("admin/admin.js", ignoreRules), false);
assert.equal(vercelIgnored("admin/hq/cron.test.mjs", ignoreRules), true);
assert.equal(vercelIgnored("supabase/seed.sql", ignoreRules), true);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function moduleSources(html) {
  const tags = html.match(/<script\b[^>]*>/gi) || [];
  const sources = [];
  for (const tag of tags) {
    if (!/\btype\s*=\s*["']module["']/i.test(tag)) continue;
    const src = tag.match(/\bsrc\s*=\s*["']([^"']+)["']/i);
    if (src) sources.push(src[1]);
  }
  return sources;
}

function readString(source, index) {
  const quote = source[index];
  let i = index + 1;
  let value = "";
  while (i < source.length) {
    if (source[i] === "\\") {
      value += source[i + 1] || "";
      i += 2;
      continue;
    }
    if (quote === "`" && source[i] === "$" && source[i + 1] === "{") {
      i += 2;
      let depth = 1;
      while (i < source.length && depth) {
        if (source[i] === "{") depth += 1;
        else if (source[i] === "}") depth -= 1;
        i += 1;
      }
      continue;
    }
    if (source[i] === quote) return { end: i + 1, value };
    value += source[i];
    i += 1;
  }
  return { end: i, value };
}

function skipTrivia(source, index) {
  let i = index;
  while (i < source.length) {
    if (source[i] === "/" && source[i + 1] === "/") {
      while (i < source.length && source[i] !== "\n") i += 1;
      continue;
    }
    if (source[i] === "/" && source[i + 1] === "*") {
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) i += 1;
      i += 2;
      continue;
    }
    break;
  }
  return i;
}

function keywordBefore(source, index) {
  let i = index;
  while (i > 0 && /\s/.test(source[i - 1])) i -= 1;
  if (source[i - 1] === "(") {
    i -= 1;
    while (i > 0 && /\s/.test(source[i - 1])) i -= 1;
  }
  if (source.slice(i - 6, i) === "import" && !/[A-Za-z0-9_$.]/.test(source[i - 7] || "")) return "import";
  if (source.slice(i - 4, i) === "from" && !/[A-Za-z0-9_$.]/.test(source[i - 5] || "")) return "from";
  return "";
}

function specifiers(source) {
  const found = [];
  let i = 0;
  while (i < source.length) {
    i = skipTrivia(source, i);
    if (i >= source.length) break;
    if (source[i] === "'" || source[i] === '"' || source[i] === "`") {
      i = readString(source, i).end;
      continue;
    }
    const kind = source.startsWith("import", i) ? "import" : source.startsWith("export", i) ? "export" : "";
    const before = i === 0 ? "" : source[i - 1];
    const after = source[i + kind.length];
    if (!kind || /[A-Za-z0-9_$]/.test(before) || /[A-Za-z0-9_$]/.test(after || "")) {
      i += 1;
      continue;
    }
    i += kind.length;
    let depth = 0;
    let spec = "";
    while (i < source.length) {
      i = skipTrivia(source, i);
      if (i >= source.length) break;
      const char = source[i];
      if (char === "'" || char === '"' || char === "`") {
        const word = keywordBefore(source, i);
        const text = readString(source, i);
        if ((word === "from" || word === "import") && !spec) spec = text.value;
        i = text.end;
        continue;
      }
      if (char === "(" || char === "{" || char === "[") depth += 1;
      else if (char === ")" || char === "}" || char === "]") depth = Math.max(0, depth - 1);
      else if ((char === ";" || char === "\n") && depth === 0 && spec) {
        i += 1;
        break;
      } else if (char === ";" && depth === 0) {
        i += 1;
        break;
      }
      i += 1;
    }
    if (spec) found.push(spec);
  }
  return found;
}

function resolveSpecifier(fromFile, spec) {
  if (/^(https?:)?\/\//.test(spec) || spec.startsWith("http:") || spec.startsWith("https:") || spec.startsWith("data:")) {
    return { external: spec };
  }
  const clean = spec.split("?")[0].split("#")[0];
  if (!clean.startsWith(".") && !clean.startsWith("/")) return { bare: spec };
  const abs = clean.startsWith("/")
    ? path.join(root, decodeURIComponent(clean.slice(1)))
    : path.resolve(path.dirname(fromFile), clean);
  return { abs };
}

function rel(abs) {
  return path.relative(root, abs).split(path.sep).join("/");
}

const problems = [];
const seen = new Set();
const reached = new Set();

function visit(abs, via) {
  const key = rel(abs);
  if (seen.has(key)) return;
  seen.add(key);
  reached.add(key);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    problems.push(`${via} -> missing ${key}`);
    return;
  }
  if (vercelIgnored(key, ignoreRules)) {
    problems.push(`${via} -> vercelignored ${key}`);
    return;
  }
  const text = fs.readFileSync(abs, "utf8");
  for (const spec of specifiers(text)) {
    const next = resolveSpecifier(abs, spec);
    if (next.external) continue;
    if (next.bare) {
      problems.push(`${key} imports bare specifier ${next.bare}`);
      continue;
    }
    visit(next.abs, `${via} -> ${key}`);
  }
}

const htmlFiles = walk(root).filter((file) => file.endsWith(".html"));
assert.ok(htmlFiles.length > 10);
let entries = 0;
for (const html of htmlFiles) {
  for (const src of moduleSources(fs.readFileSync(html, "utf8"))) {
    entries += 1;
    const next = resolveSpecifier(html, src.startsWith("/") || src.startsWith(".") ? src : `./${src}`);
    if (next.bare || next.external) {
      problems.push(`${rel(html)} module src ${src} is not a local file`);
      continue;
    }
    visit(next.abs, rel(html));
  }
}
assert.ok(entries > 10, "expected module script entries");
assert.ok(reached.has("acquire/app.js"));
assert.ok(reached.has("acquire/setter-delay.js"));
assert.equal(problems.length, 0, problems.join("\n"));

console.log("browser module tests passed");
