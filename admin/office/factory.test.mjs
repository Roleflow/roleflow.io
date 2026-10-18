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
assert.equal(homeStation({ name: "Lead Gen Manager" }), "research");
assert.equal(homeStation({ name: "Outbound Rep" }), "writers_room");
assert.equal(homeStation({ name: "Content Generator" }), "writers_room");
assert.equal(homeStation({ name: "Onboarding & Client Success" }), "client_floor");
assert.equal(homeStation({ name: "Ads Manager" }), "shipping_dock");
assert.equal(homeStation({ name: "Social Media Manager" }), "shipping_dock");
assert.equal(homeStation({ name: "Content Generator", station: "edit_bay" }), "edit_bay");

const writer = { name: "Content Generator" };
assert.equal(taskStation({ station: "edit_bay", status: "in_progress" }, writer), "edit_bay");
assert.equal(taskStation({ status: "queued" }, writer), "writers_room");
assert.equal(cardSpot({ status: "needs_diego", station: "writers_room" }, writer), "approval");
assert.equal(cardSpot({ status: "in_progress", station: "film_studio" }, writer), "film_studio");
assert.equal(cardSpot({ status: "done", station: "edit_bay" }, writer), "");

const points = factoryPoints();
const hq = pointsFor(hqPlan());
assert.equal(points.research.x, hq.research.x);
assert.equal(points.approval.x, hq.approval.x);
assert.equal(points.client_floor.z, hq.client_floor.z);
assert.ok(points.brand_brain.y > points.film_studio.y);
const order = ["research", "writers_room", "film_studio", "edit_bay", "shipping_dock"].map((id) => screenOrder(points[id]));
assert.deepEqual(order.slice().sort((a, b) => a - b), order);
assert.ok(screenOrder(points.writers_room) < screenOrder(points.approval));
assert.ok(screenOrder(points.approval) < screenOrder(points.film_studio));
assert.ok(screenOrder(points.shipping_dock) < screenOrder(points.mail_room));
assert.equal(hqPlan().pipeline[0].step, "STEP 1");
assert.equal(hqPlan().pipeline.at(-1).title, "Mail Room, coming soon");
assert.equal(homeStation({ name: "Mail Room", station: "mail_room" }), "");
const farOf = (point) => point.x * -0.70710678 + point.z * -0.70710678;
assert.ok(farOf(points.film_studio) < farOf(points.research) - 1);
assert.ok(screenOrder(points.research) < screenOrder(points.chief_of_staff));

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
assert.equal(hqPlan().pipeline.some((station) => station.title === "Writers' Room"), true);

console.log("factory ok");
