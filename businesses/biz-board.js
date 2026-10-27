// Shared business cards for the signed-in roster and /businesses/.
// The card face is the name, status, age, and the last-7-days chart.

function el(tag, attrs, children) {
  const node = document.createElement(tag);
  Object.entries(attrs || {}).forEach(([key, value]) => {
    if (value == null || value === false) return;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else node.setAttribute(key, value === true ? "" : String(value));
  });
  (children || []).forEach((child) => {
    if (child == null || child === false) return;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  });
  return node;
}

function dayNumber(day) {
  if (day && day.label) return String(day.label);
  const raw = String((day && (day.day || day.key)) || "");
  const num = Number(raw.slice(8, 10));
  return Number.isFinite(num) && num > 0 ? String(num) : "";
}

export function leadChart(days, label) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 268 78");
  svg.setAttribute("class", "lead-chart");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", label || "Leads over the last 7 days");
  const series = (days && days.length) ? days : [{ count: 0, label: "" }];
  const max = Math.max(1, ...series.map((day) => Number(day.count) || 0));
  const left = 8;
  const right = 260;
  const top = 8;
  const base = 50;
  const points = series.map((day, index) => {
    const x = series.length === 1 ? (left + right) / 2 : left + (index / (series.length - 1)) * (right - left);
    const y = base - ((Number(day.count) || 0) / max) * (base - top);
    return [x, y];
  });
  const line = points.map((point) => point[0].toFixed(1) + "," + point[1].toFixed(1)).join(" ");
  const area = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
  area.setAttribute("points", points[0][0].toFixed(1) + "," + base + " " + line + " " + points[points.length - 1][0].toFixed(1) + "," + base);
  area.setAttribute("fill", "rgba(123,77,255,.22)");
  const stroke = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
  stroke.setAttribute("points", line);
  stroke.setAttribute("fill", "none");
  stroke.setAttribute("stroke", "#7B4DFF");
  stroke.setAttribute("stroke-width", "2");
  stroke.setAttribute("stroke-linejoin", "round");
  stroke.setAttribute("stroke-linecap", "round");
  svg.append(area, stroke);
  points.forEach((point, index) => {
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", point[0].toFixed(1));
    text.setAttribute("y", "70");
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("fill", "#7E8AAE");
    text.setAttribute("font-size", "10");
    text.setAttribute("font-family", "Instrument Sans, sans-serif");
    text.textContent = dayNumber(series[index]);
    svg.append(text);
  });
  return svg;
}

export function businessCard(spec) {
  const article = el("article", { class: "biz-tile biz-card biz-face" });
  const link = el("a", {
    class: "biz-hit",
    href: spec.href || "#",
    "aria-label": spec.name || "Business"
  });
  if (spec.onOpen) {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      spec.onOpen();
    });
  }
  const status = el("p", { class: spec.active ? "biz-status is-on" : "biz-status is-off" }, [
    el("i", { class: spec.active ? "ai-dot on" : "ai-dot" }),
    spec.activeText || "AI active"
  ]);
  if (spec.shared) status.append(el("span", { class: "shared-chip", text: spec.sharedText || "Shared" }));
  const name = el("h2", { text: spec.name || "Untitled business" });
  const created = el("p", { class: "biz-created", text: spec.created || "" });
  const foot = el("div", { class: "lead-row" }, [
    el("span", { text: spec.leadLabel || "Leads · last 7 days" }),
    el("strong", { text: spec.total == null ? "—" : String(spec.total) })
  ]);
  article.append(link, status, name, created, foot, leadChart(spec.days, spec.chartLabel));
  if (spec.menu) article.append(spec.menu);
  return article;
}

export function addBusinessCard(spec) {
  const card = el("button", {
    type: "button",
    class: "biz-tile biz-card add-business",
    id: spec.id || "add-business"
  });
  card.append(el("span", { class: "add-orb", "aria-hidden": "true", text: "+" }));
  card.append(el("span", { class: "add-label", text: spec.text || "Add business" }));
  card.addEventListener("click", () => spec.onClick && spec.onClick());
  return card;
}
