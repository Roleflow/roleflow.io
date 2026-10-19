import assert from "node:assert/strict";
import {
  cardSpot,
  factoryPoints,
  homeStation,
  hqPlan,
  pointsFor,
  screenOrder,
  setterCardSpot,
  setterHome,
  setterPlan,
  setterTaskStation,
  taskStation,
  withAssigned
} from "./factory.mjs";

assert.equal(homeStation({ name: "Roleflow Agent" }), "chief_of_staff");
assert.equal(homeStation({ name: "Chief of Staff" }), "chief_of_staff");
assert.equal(homeStation({ name: "Lead Gen Manager" }), "research");
assert.equal(homeStation({ name: "Lead Generation Manager" }), "research");
assert.equal(homeStation({ name: "Outbound Rep" }), "writers_room");
assert.equal(homeStation({ name: "Outbound SDR" }), "writers_room");
assert.equal(homeStation({ name: "Content Generator" }), "writers_room");
assert.equal(homeStation({ name: "Chief Content Officer" }), "writers_room");
assert.equal(homeStation({ name: "Onboarding & Client Success" }), "client_floor");
assert.equal(homeStation({ name: "Chief Operating Officer" }), "client_floor");
assert.equal(homeStation({ name: "Ads Manager" }), "shipping_dock");
assert.equal(homeStation({ name: "Social Media Manager" }), "shipping_dock");
assert.equal(homeStation({ name: "Social Media Distribution Manager" }), "shipping_dock");
assert.equal(homeStation({ name: "Community Engagement Specialist" }), "shipping_dock");
assert.equal(homeStation({ name: "Paid Media & Partnerships Specialist" }), "shipping_dock");
assert.equal(homeStation({ name: "Inbound Triage Specialist" }), "mail_room");
assert.equal(homeStation({ name: "CRM Database Administrator" }), "sales_desk");
assert.equal(homeStation({ name: "Chief Revenue Officer" }), "sales_desk");
assert.equal(homeStation({ name: "Chief Financial Officer" }), "back_office");
assert.equal(homeStation({ name: "Finance Manager" }), "back_office");
assert.equal(homeStation({ name: "Chief Technology Officer" }), "back_office");
assert.equal(homeStation({ name: "Frontend Engineer" }), "back_office");
assert.equal(homeStation({ name: "Backend & Database Engineer" }), "back_office");
assert.equal(homeStation({ name: "Integrations Engineer" }), "back_office");
assert.equal(homeStation({ name: "QA & Release Engineer" }), "back_office");
assert.equal(homeStation({ name: "Security & Access Admin" }), "back_office");
assert.equal(homeStation({ name: "Quality Assurance Analyst" }), "client_floor");
assert.equal(homeStation({ name: "Proof & Case Study Specialist" }), "client_floor");
assert.equal(homeStation({ name: "Content Generator", station: "edit_bay" }), "edit_bay");

const writer = { name: "Content Generator" };
assert.equal(taskStation({ station: "edit_bay", status: "in_progress" }, writer), "edit_bay");
assert.equal(taskStation({ status: "queued" }, writer), "writers_room");
assert.equal(cardSpot({ status: "needs_diego", station: "writers_room" }, writer), "approval");
assert.equal(cardSpot({ status: "in_progress", station: "film_studio" }, writer), "film_studio");
assert.equal(cardSpot({ status: "done", station: "edit_bay" }, writer), "");

const points = factoryPoints();
const hq = pointsFor(hqPlan());
assert.equal(hqPlan().kind, "org");
assert.equal(points.cos.x, hq.cos.x);
assert.equal(points.brand_brain.x, 0);
assert.ok(Math.hypot(points.cos.x, points.cos.z) < 1.5);
assert.ok(points.brand_brain.y > points.cos.y);
assert.equal(hqPlan().pipeline.length, 0);
assert.equal(hqPlan().org.below, 14);
assert.equal(hqPlan().org.headline, "14 of 20 agents below the C-suite");
assert.equal(hqPlan().groups[0].id, "chief_of_staff");
assert.ok(hqPlan().groups.some((group) => group.tab === "Revenue · 4"));
assert.ok(hqPlan().groups.some((group) => group.tab === "Finance"));
assert.equal(homeStation({ name: "Mail Room", station: "mail_room" }), "mail_room");
assert.equal(homeStation({ name: "Mail Room" }), "mail_room");
assert.equal(homeStation({ name: "Sales Desk" }), "sales_desk");
assert.equal(homeStation({ name: "Finance" }), "back_office");
assert.equal(homeStation({ name: "Proof Builder" }), "client_floor");
assert.equal(homeStation({ name: "Setter QA" }), "client_floor");
assert.ok(Math.hypot(points.cos.x, points.cos.z) < 1.5);
assert.ok(Math.hypot(points.cro.x, points.cro.z) < Math.hypot(points.sdr.x, points.sdr.z));

const vam = setterPlan("VAM");
assert.deepEqual(vam.pipeline.map((station) => station.title), ["Leads In", "Qualify", "Book Call", "Follow-up", "Report"]);
assert.equal(vam.balcony.label, "Overseer, on the balcony");
assert.equal(vam.brainSub, "VAM");
const setterPoints = pointsFor(vam);
const setterOrder = vam.pipeline.map((station) => screenOrder(setterPoints[station.id]));
assert.deepEqual(setterOrder.slice().sort((a, b) => a - b), setterOrder);
assert.ok(screenOrder(setterPoints.qualify) < screenOrder(setterPoints.approval));
assert.ok(screenOrder(setterPoints.approval) < screenOrder(setterPoints.book_call));
assert.ok(setterPoints.brand_brain.y > setterPoints.qualify.y);

const businessId = "463e2794-cb8f-462e-9325-95a7cb1da65c";
const setter = { id: businessId, name: "VAM" };
assert.equal(setterHome({ name: "Onboarding & Client Success" }, vam, businessId), "overseer");
assert.equal(setterHome(setter, vam, businessId), "qualify");
assert.equal(setterTaskStation({ title: "Book the intro call", status: "in_progress" }, setter, vam, businessId), "book_call");
assert.equal(setterTaskStation({ title: "Send the weekly report" }, setter, vam, businessId), "report");
assert.equal(setterTaskStation({ title: "Follow up tomorrow" }, setter, vam, businessId), "follow_up");
assert.equal(setterTaskStation({ title: "Qualify the reply" }, setter, vam, businessId), "qualify");
assert.equal(setterTaskStation({ title: "New DM in the inbox" }, setter, vam, businessId), "leads_in");
assert.equal(setterCardSpot({ status: "needs_diego", station: "qualify", title: "Approve the reply" }, setter, vam, businessId), "approval");
assert.equal(setterCardSpot({ status: "done", title: "Book the intro call" }, setter, vam, businessId), "");
assert.equal(setterHome({ name: "Lead Gen Manager", station: "research" }, withAssigned(vam, ["research"]), businessId), "research");

const extra = withAssigned(vam, ["client_floor", "qualify", "overseer", "nope"]);
assert.ok(extra.pipeline.some((station) => station.id === "client_floor" && station.title === "Client Floor"));
assert.equal(extra.pipeline.filter((station) => station.id === "qualify").length, 1);
assert.equal(extra.pipeline.some((station) => station.id === "overseer"), false);
assert.equal(hqPlan().org.zones.some((zone) => zone.title === "Content"), true);
assert.equal(hqPlan().pipeline.some((station) => station.title === "Writers' Room"), false);

console.log("factory ok");
