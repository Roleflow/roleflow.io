import assert from "node:assert/strict";
import {
  bindRoster,
  launchPlan,
  orgAgents,
  orgCounts,
  orgLayout,
  rocketEdges,
  seatDistance,
  rosterCounts,
  clustersFromReports,
  stackModel,
  unmatchedRoster,
  zoneLabel
} from "./org.mjs";

const EXPECTED = [
  "Chief of Staff",
  "Chief Revenue Officer",
  "Chief Content Officer",
  "Chief Operating Officer",
  "Chief Financial Officer",
  "Chief Technology Officer",
  "Lead Generation Manager",
  "Outbound SDR",
  "Inbound Triage Specialist",
  "CRM Database Administrator",
  "Social Media Distribution Manager",
  "Community Engagement Specialist",
  "Paid Media & Partnerships Specialist",
  "Quality Assurance Analyst",
  "Proof & Case Study Specialist",
  "Frontend Engineer",
  "Backend & Database Engineer",
  "Integrations Engineer",
  "QA & Release Engineer",
  "Security & Access Admin"
];

const agents = orgAgents();
assert.deepEqual(agents.map((agent) => agent.name), EXPECTED);
assert.equal(new Set(agents.map((agent) => agent.key)).size, 20);
assert.equal(agents.some((agent) => /diego/i.test(agent.name)), false);

const counts = orgCounts();
assert.equal(counts.total, 20);
assert.equal(counts.cSuite, 6);
assert.equal(counts.below, 14);
assert.equal(counts.headline, "14 of 20 agents below the C-suite");
assert.equal(counts.of, "14 of 20");

const byName = new Map(agents.map((agent) => [agent.name, agent]));
assert.equal(byName.get("Chief of Staff").reportsTo, null);
assert.equal(byName.get("Chief of Staff").reportsToLabel, "Diego (CEO)");
["Chief Revenue Officer", "Chief Content Officer", "Chief Operating Officer", "Chief Financial Officer", "Chief Technology Officer"].forEach((name) => {
  assert.equal(byName.get(name).reportsTo, "cos", name);
  assert.equal(byName.get(name).level, "L1", name);
});
assert.equal(byName.get("Lead Generation Manager").reportsTo, "cro");
assert.equal(byName.get("Lead Generation Manager").level, "L2");
assert.equal(byName.get("Outbound SDR").reportsTo, "lgm");
assert.equal(byName.get("Inbound Triage Specialist").reportsTo, "cro");
assert.equal(byName.get("CRM Database Administrator").reportsTo, "cro");
assert.equal(byName.get("Social Media Distribution Manager").reportsTo, "cco");
assert.equal(byName.get("Community Engagement Specialist").reportsTo, "smdm");
assert.equal(byName.get("Paid Media & Partnerships Specialist").reportsTo, "cco");
assert.equal(byName.get("Quality Assurance Analyst").reportsTo, "coo");
assert.equal(byName.get("Proof & Case Study Specialist").reportsTo, "coo");
["Frontend Engineer", "Backend & Database Engineer", "Integrations Engineer", "QA & Release Engineer", "Security & Access Admin"].forEach((name) => {
  assert.equal(byName.get(name).reportsTo, "cto", name);
  assert.equal(byName.get(name).level, "L3", name);
});
assert.equal(agents.filter((agent) => agent.reportsTo === "cfo").length, 0);

assert.equal(zoneLabel("revenue"), "Revenue · 4");
assert.equal(zoneLabel("content"), "Content · 3");
assert.equal(zoneLabel("operations"), "Operations · 2");
assert.equal(zoneLabel("finance"), "Finance");
assert.equal(zoneLabel("technology"), "Technology · 5");

const layout = orgLayout();
assert.equal(layout.seats.length, 20);
assert.equal(layout.below, 14);
assert.equal(layout.zones.length, 5);
const finance = layout.zones.find((zone) => zone.id === "finance");
assert.equal(finance.members.length, 1);
assert.equal(finance.members[0].key, "cfo");
assert.equal(finance.label, "Finance");

layout.zones.forEach((zone) => {
  const chief = zone.members.find((seat) => seat.key === zone.chief);
  zone.members.forEach((seat) => {
    if (seat.key === chief.key) return;
    assert.ok(seatDistance(seat) > seatDistance(chief) + 0.4, zone.id + " " + seat.key);
  });
});

function seat(key) {
  return layout.seats.find((item) => item.key === key);
}
[["lgm", "sdr"], ["smdm", "ces"]].forEach(([manager, report]) => {
  const chief = seat(seat(manager).reportsTo);
  assert.ok(seatDistance(chief) < seatDistance(seat(manager)), manager);
  assert.ok(Math.hypot(seat(manager).x - seat(report).x, seat(manager).z - seat(report).z) < 2.2, manager + " beside " + report);
});

let nearest = 99;
for (let i = 0; i < layout.seats.length; i += 1) {
  for (let j = i + 1; j < layout.seats.length; j += 1) {
    const a = layout.seats[i];
    const b = layout.seats[j];
    nearest = Math.min(nearest, Math.hypot(a.x - b.x, a.z - b.z));
  }
}
assert.ok(nearest > 1.6, "seats overlapped: " + nearest);

const cos = seat("cos");
assert.ok(seatDistance(cos) < 1.2, "Chief of Staff sits on the center platform");
assert.ok(seatDistance(seat("cro")) > 4);
assert.ok(seatDistance(seat("cto")) > seatDistance(cos));

const edges = rocketEdges();
assert.deepEqual(edges.filter((edge) => edge.from === "cos").map((edge) => edge.to).sort(), ["cco", "cfo", "coo", "cro", "cto"]);
assert.equal(edges.some((edge) => edge.from === "brain"), false);
assert.equal(edges.some((edge) => edge.from === "cfo" && edge.hop !== "handoff"), false);
assert.ok(edges.some((edge) => edge.from === "cro" && edge.to === "lgm"));
assert.ok(edges.some((edge) => edge.from === "lgm" && edge.to === "sdr"));
assert.ok(edges.some((edge) => edge.from === "sdr" && edge.to === "crm"));
assert.ok(edges.some((edge) => edge.from === "its" && edge.to === "crm"));
assert.ok(edges.some((edge) => edge.from === "cco" && edge.to === "pmp"));
assert.ok(edges.some((edge) => edge.from === "smdm" && edge.to === "ces"));
assert.ok(edges.some((edge) => edge.from === "qr" && edge.to === "fe"));
assert.ok(edges.some((edge) => edge.from === "qr" && edge.to === "be"));
assert.ok(edges.some((edge) => edge.from === "qr" && edge.to === "ie"));

const idle = launchPlan([], false);
assert.equal(idle.every((edge) => edge.mode === "idle"), true);
const aimed = launchPlan(["sdr"], false);
const mode = (from, to) => aimed.find((edge) => edge.from === from && edge.to === to).mode;
assert.equal(mode("cos", "cro"), "active");
assert.equal(mode("cro", "lgm"), "active");
assert.equal(mode("lgm", "sdr"), "active");
assert.equal(mode("cos", "cfo"), "idle");
assert.equal(mode("cos", "cto"), "idle");
assert.equal(mode("cco", "smdm"), "idle");
const still = launchPlan(["sdr"], true);
assert.equal(still.every((edge) => edge.mode === "rest"), true);

const bound = bindRoster([
  { id: "live-cos", name: "Roleflow Agent", title: "Chief of Staff", status: "active", department: "Executive" },
  { id: "live-ads", name: "Ads Manager", title: "Ads Manager", status: "active", department: "Marketing" },
  { id: "live-out", name: "New Bot", status: "active", outside_org: true, department: "Outside" },
  { id: "live-sales", name: "Sales Operations Manager", title: "Sales Operations Manager", status: "active", department: "Sales" }
]);
assert.equal(bound.length, 20);
assert.equal(bound.find((seat) => seat.key === "cos").id, "live-cos");
assert.equal(bound.find((seat) => seat.key === "smdm").id, "live-ads");
assert.equal(bound.find((seat) => seat.key === "cro").id, "org:cro");
const parenthetical = bindRoster([
  { id: "live-cto", name: "Chief Technology Officer (CTO)", title: "CTO", status: "active", department: "Technology", sort_order: 60 },
  { id: "live-cro", name: "Chief Revenue Officer (CRO)", title: "Chief Revenue Officer", status: "active", department: "Revenue", sort_order: 20 },
  { id: "retired-sales", name: "Sales Operations Manager", status: "retired", department: "Sales" },
  { id: "retired-fin", name: "Finance Manager", status: "retired", department: "Finance", reports_to: "live-cro" },
  { id: "retired-bot", name: "New Bot", status: "retired", outside_org: true, department: "Outside" }
]);
assert.equal(parenthetical.find((seat) => seat.key === "cto").id, "live-cto");
assert.equal(parenthetical.find((seat) => seat.key === "cro").id, "live-cro");
assert.equal(parenthetical.some((seat) => String(seat.id).startsWith("retired")), false);
const extra = unmatchedRoster([
  { id: "live-cos", name: "Roleflow Agent", status: "active", department: "Executive" },
  { id: "live-ads", name: "Ads Manager", status: "active", department: "Marketing" },
  { id: "live-out", name: "New Bot", status: "active", outside_org: true, department: "Outside" },
  { id: "live-sales", name: "Sales Operations Manager", status: "active", department: "Sales" }
]);
assert.deepEqual(extra.map((agent) => agent.id).sort(), ["live-out", "live-sales"]);

const empty = bindRoster([]);
assert.equal(empty.length, 20);
assert.equal(empty.every((seat) => String(seat.id).startsWith("org:")), true);

const stack = stackModel([
  { id: "live-cfo", name: "Chief Financial Officer", status: "active", department: "Finance" }
]);
assert.equal(stack.headline, "0 of 1 agents below the C-suite");
assert.equal(stack.cos.name, "Chief of Staff");
assert.equal(stack.zones.map((zone) => zone.label).join("|"), "Revenue · 4|Content · 3|Operations · 2|Finance|Technology · 5");
const financeStack = stack.zones.find((zone) => zone.id === "finance");
assert.equal(financeStack.people.length, 0);
assert.equal(financeStack.chief.id, "live-cfo");
const revenue = stack.zones.find((zone) => zone.id === "revenue");
const lead = revenue.people.find((person) => person.seat.key === "lgm");
assert.equal(lead.reports.length, 1);
assert.equal(lead.reports[0].seat.name, "Outbound SDR");
assert.equal(revenue.people.some((person) => person.seat.key === "sdr"), false);

const counted = [{ id: "cos", name: "Chief of Staff", status: "active", reports_to: null }];
["cro", "cco", "coo", "cfo", "cto"].forEach((id) => counted.push({ id, name: id, status: "active", reports_to: "cos" }));
for (let i = 0; i < 14; i += 1) counted.push({ id: "s" + i, name: "Specialist " + i, status: "active", reports_to: "cro" });
counted.push({ id: "ret-sales", name: "Sales Operations Manager", status: "retired", reports_to: "cos" });
counted.push({ id: "ret-fin", name: "Finance Manager", status: "retired", reports_to: "cos" });
counted.push({ id: "ret-bot", name: "New Bot", status: "retired", outside_org: true, department: "Outside" });
const liveCounts = rosterCounts(counted);
assert.equal(liveCounts.total, 20);
assert.equal(liveCounts.cSuite, 6);
assert.equal(liveCounts.below, 14);
assert.equal(liveCounts.headline, "14 of 20 agents below the C-suite");

const clusterRows = [
  { id: "c", name: "Chief of Staff", reports_to: null, department: "Executive", status: "active" },
  { id: "r", name: "Someone in revenue", reports_to: "c", department: "Revenue", status: "active" },
  { id: "m", name: "Manager", reports_to: "r", department: "Revenue", status: "active" },
  { id: "s", name: "Rep", reports_to: "m", department: "Revenue", status: "active" },
  { id: "f", name: "Someone in finance", reports_to: "c", department: "Finance", status: "active" },
  { id: "old", name: "Finance Manager", reports_to: "c", department: "Finance", status: "retired" }
];
const clusters = clustersFromReports(clusterRows);
assert.equal(clusters.cos.id, "c");
assert.deepEqual(clusters.zones.find((zone) => zone.zone === "revenue").members.map((row) => row.id), ["m", "s"]);
assert.equal(clusters.zones.find((zone) => zone.zone === "finance").members.length, 0);
assert.equal(clusters.zones.some((zone) => zone.chief && zone.chief.id === "old"), false);

console.log("org ok");
