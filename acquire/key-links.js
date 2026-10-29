// Links that used to be edited on the Content page. The rows stay stored.
// The setter reads them when it builds a reply.

export function keyLinksBlock(assets, links) {
  const lines = [];
  (assets || []).forEach((item) => {
    if (!item || (item.kind !== "link" && item.kind !== "button")) return;
    const url = String(item.url || "").trim();
    if (!url) return;
    const name = String(item.title || item.label || "Link").trim();
    lines.push(name + ": " + url);
  });
  (links || []).forEach((item) => {
    if (!item) return;
    const url = String(item.url || "").trim();
    if (!url) return;
    lines.push(String(item.name || "Sales link").trim() + ": " + url);
  });
  if (!lines.length) return "";
  return "Key links stored for this business. Use only these addresses. Do not invent a link.\n" + lines.join("\n");
}
