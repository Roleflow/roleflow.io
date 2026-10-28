// Client onboarding link. verify_jwt is false.
// The token is scoped to one business, expires, and can be revoked.
// The raw token is never stored. This function does not turn a setter on.

import { adminClient, json } from "../_shared/gateway-http.js";
import { advanceStatus, hashToken, publicIntakeView, scopeToken, textFromDocxXml, textFromUpload } from "../_shared/onboarding-build.js";
import { parseTranscript, stripPii } from "../_shared/winning-conversations.js";

const MAX_BYTES = 1500000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" } });
  if (req.method !== "POST") return json(405, { ok: false, error: "Use POST." });
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch (_error) { body = {}; }
  const token = String(body.token || "").trim();
  if (token.length < 20) return json(200, { ok: false, error: "This link is not valid." });
  const admin = adminClient();
  const tokenHash = await hashToken(token);
  const link = await admin.from("acq_onboarding_links").select("id, business_id, expires_at, revoked_at").eq("token_hash", tokenHash).maybeSingle();
  const scope = scopeToken(link.data, Date.now());
  if (!scope.ok) {
    const reason = scope.reason === "revoked" ? "This link was revoked." : scope.reason === "expired" ? "This link has expired." : "This link is not valid.";
    return json(200, { ok: false, error: reason });
  }
  const businessId = scope.business_id;
  const action = String(body.action || "load");
  if (action === "load") return json(200, await loadIntake(admin, businessId));
  if (action === "save") return saveIntake(admin, businessId, body);
  if (action === "upload") return uploadIntake(admin, businessId, body);
  return json(200, { ok: false, error: "Unknown action." });
});

async function loadIntake(admin, businessId) {
  const [form, materials] = await Promise.all([
    admin.from("acq_onboarding").select("offer, price, ideal, booking_link, criteria, disqualifiers, status").eq("business_id", businessId).maybeSingle(),
    admin.from("acq_onboarding_materials").select("id, name, kind").eq("business_id", businessId).order("created_at", { ascending: false }).limit(20)
  ]);
  if (form.error) return { ok: false, error: "Onboarding is not ready yet." };
  return publicIntakeView(form.data || {}, materials.error ? [] : materials.data || []);
}

async function saveIntake(admin, businessId, body) {
  const offer = clip(body.offer, 4000);
  const price = clip(body.price, 200);
  const ideal = clip(body.ideal, 4000);
  const booking = clip(body.booking_link, 500);
  const criteria = clip(body.criteria, 4000);
  const disqualifiers = clip(body.disqualifiers, 4000);
  const current = await admin.from("acq_onboarding").select("status").eq("business_id", businessId).maybeSingle();
  const status = advanceStatus(current.data && current.data.status, "materials");
  const saved = await admin.from("acq_onboarding").upsert({
    business_id: businessId,
    offer, price, ideal, booking_link: booking, criteria, disqualifiers,
    status,
    updated_at: new Date().toISOString()
  });
  if (saved.error) return json(200, { ok: false, error: "The form was not saved." });
  const transcript = String(body.transcript || "").trim();
  if (transcript) {
    const parsed = parseTranscript(transcript);
    const names = parsed.messages.map((item) => item.label);
    const messages = parsed.messages.map((item) => ({
      side: item.side === "me" ? "me" : "them",
      label: /^(me|them|yo|ellos)$/i.test(item.label) ? item.label : "[name]",
      text: stripPii(item.text, names).slice(0, 4000)
    }));
    const raw = messages.map((item) => (item.side === "me" ? "Setter" : "Lead") + ": " + item.text).join("\n").slice(0, 20000);
    await admin.from("acq_winning_conversations").insert({
      business_id: businessId,
      title: raw.split("\n")[0].slice(0, 80),
      raw_text: raw,
      messages,
      outcome: body.outcome === "booked" || body.outcome === "closed" ? body.outcome : "",
      notes: stripPii(body.notes, names).slice(0, 1000)
    });
  }
  const pasted = String(body.material || "").trim();
  if (pasted) {
    await admin.from("acq_onboarding_materials").insert({
      business_id: businessId,
      kind: "text",
      name: clip(body.material_name, 180) || "Pasted notes",
      body: pasted.slice(0, 80000)
    });
  }
  return json(200, await loadIntake(admin, businessId));
}

async function uploadIntake(admin, businessId, body) {
  const name = clip(body.name, 180) || "upload.txt";
  if (/\.(png|jpe?g|webp|gif)$/i.test(name)) {
    return json(200, { ok: false, error: "Paste the conversation. Screenshots are not read." });
  }
  const encoded = String(body.data || "");
  let bytes: Uint8Array;
  try { bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0)); }
  catch (_error) { return json(200, { ok: false, error: "That file could not be read." }); }
  if (!bytes.length || bytes.length > MAX_BYTES) return json(200, { ok: false, error: "Use a file under 1.5 MB, or paste the text." });
  const text = await fileText(name, bytes);
  if (!text) return json(200, { ok: false, error: "No text could be read from that file. Paste it instead." });
  const path = businessId + "/" + crypto.randomUUID() + "/" + name.replace(/[^\w.\- ]+/g, "").slice(0, 80);
  await admin.storage.from("onboarding-materials").upload(path, bytes, { contentType: "application/octet-stream", upsert: false });
  const inserted = await admin.from("acq_onboarding_materials").insert({
    business_id: businessId,
    kind: "file",
    name,
    body: text.slice(0, 80000),
    storage_path: path
  }).select("id, name, kind").single();
  if (inserted.error) return json(200, { ok: false, error: "The file was not saved." });
  const current = await admin.from("acq_onboarding").select("status").eq("business_id", businessId).maybeSingle();
  await admin.from("acq_onboarding").upsert({
    business_id: businessId,
    status: advanceStatus(current.data && current.data.status, "materials"),
    updated_at: new Date().toISOString()
  });
  return json(200, { ok: true, material: { id: inserted.data.id, name: inserted.data.name, kind: inserted.data.kind } });
}

async function fileText(name: string, bytes: Uint8Array) {
  if (name.toLowerCase().endsWith(".docx")) {
    try {
      const { unzipSync, strFromU8 } = await import("npm:fflate@0.8.2");
      const files = unzipSync(bytes);
      const xml = files["word/document.xml"];
      return xml ? textFromDocxXml(strFromU8(xml)) : "";
    } catch (_error) {
      return "";
    }
  }
  const found = textFromUpload(name, bytes);
  return found.note === "screenshot" ? "" : found.text;
}

function clip(value: unknown, max: number) {
  return String(value || "").trim().slice(0, max);
}
