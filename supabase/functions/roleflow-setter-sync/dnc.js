// Read a setter sheet tool list into do-not-contact handles.
// The request only asks for the sheet. It never updates the sheet.

const HANDLE = /^@?([a-z0-9._]{1,30})$/i;
const HEADER = new Set(["instagram", "username", "handle", "user", "name", "ig"]);

export function sheetReadCall() {
  return {
    method: "POST",
    url: "https://api.tailortalk.ai/api/v1/get_tools",
    body: { tool_type: "sheet", mode: "read" }
  };
}

export function assertReadOnly(call) {
  const method = String(call && call.method || "").toUpperCase();
  if (method !== "GET" && method !== "POST") throw new Error("The sheet read must be a fetch.");
  const url = String(call && call.url || "");
  if (/update|append|write|delete|insert/i.test(url)) throw new Error("The sheet read must not write.");
  const body = JSON.stringify(call && call.body || {}).toLowerCase();
  if (/"mode"\s*:\s*"(update|append|write|delete|insert)"/.test(body)) throw new Error("The sheet read must not write.");
  return call;
}

export function dncSheetCount(payload) {
  return collectTools(payload).filter(isDncSheet).length;
}

export function dncHandles(payload) {
  const tools = collectTools(payload).filter(isDncSheet);
  const seen = new Set();
  const handles = [];
  tools.forEach((tool) => {
    rowsOf(tool).forEach((row) => {
      cellsOf(row).forEach((cell) => {
        const match = String(cell || "").trim().match(HANDLE);
        if (!match) return;
        const handle = match[1].toLowerCase();
        if (HEADER.has(handle) || seen.has(handle)) return;
        seen.add(handle);
        handles.push(handle);
      });
    });
  });
  return handles;
}

function collectTools(payload) {
  if (!payload || typeof payload !== "object") return [];
  const data = payload.data && typeof payload.data === "object" && !Array.isArray(payload.data) ? payload.data : payload;
  const lists = [data.tools, data.sheet_tools, data.sheets, payload.tools];
  const found = lists.find((item) => Array.isArray(item));
  return found || [];
}

function isDncSheet(tool) {
  if (!tool || typeof tool !== "object") return false;
  const type = String(tool.type || tool.tool_type || tool.kind || "").toLowerCase();
  const name = String(tool.name || tool.title || tool.id || "").toLowerCase();
  const text = [name, tool.description, tool.tab, tool.sheet, tool.purpose].filter(Boolean).join(" ").toLowerCase();
  const sheet = type === "sheet" || type === "google_sheet" || type === "sheet_tool" || name.includes("sheet") || name === "query_sheet";
  if (!sheet) return false;
  return /dnc|do[- ]not[- ]contact|exclusion|protect|blocklist|ignore|query_sheet/.test(text);
}

function rowsOf(tool) {
  const rows = tool.rows || tool.values || tool.records || tool.data;
  return Array.isArray(rows) ? rows : [];
}

function cellsOf(row) {
  if (Array.isArray(row)) return row;
  if (row && typeof row === "object") return Object.values(row);
  return [row];
}
