import assert from "node:assert/strict";
import { cardSpot, factoryPoints, homeStation, screenOrder, taskStation } from "./factory.mjs";

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
const order = ["research", "writers_room", "film_studio", "edit_bay", "shipping_dock"].map((id) => screenOrder(points[id]));
assert.deepEqual(order.slice().sort((a, b) => a - b), order);
assert.ok(screenOrder(points.brand_brain) < screenOrder(points.film_studio) || points.brand_brain.y > points.film_studio.y);

console.log("factory ok");
