import { getSupabase } from "../../auth/supabase.js";
import { forwardClientMessage, hashLoginToken, loginChannel } from "../../acquire/dm-login.js";

const note = document.getElementById("note");
const view = document.getElementById("view");
const ctx = view.getContext("2d");
const token = location.hash.replace(/^#/, "");
let open = true;

function paint(encoded) {
  if (!encoded) return;
  const image = new Image();
  image.onload = () => {
    view.width = image.naturalWidth || 420;
    view.height = image.naturalHeight || 800;
    ctx.drawImage(image, 0, 0);
  };
  image.src = "data:image/jpeg;base64," + encoded;
}

function point(event) {
  const rect = view.getBoundingClientRect();
  return {
    x: Math.round((event.clientX - rect.left) * view.width / (rect.width || 1)),
    y: Math.round((event.clientY - rect.top) * view.height / (rect.height || 1)),
    button: "left",
    clickCount: 1
  };
}

async function main() {
  const supabase = getSupabase();
  const session = supabase && await supabase.auth.getSession();
  if (!supabase || !session || !session.data || !session.data.session || !/^[a-f0-9]{64}$/.test(token)) {
    note.textContent = "Sign in from the business page, then connect again.";
    return;
  }
  const topic = loginChannel(await hashLoginToken(token));
  const channel = supabase.channel(topic, {
    config: { private: true, broadcast: { ack: false, self: false } }
  });
  function send(message) {
    const safe = forwardClientMessage(message);
    if (!open || !safe) return;
    channel.send({ type: "broadcast", event: "input", payload: safe });
  }
  channel.on("broadcast", { event: "frame" }, ({ payload }) => {
    if (payload && payload.j) paint(payload.j);
  });
  channel.on("broadcast", { event: "status" }, ({ payload }) => {
    if (!payload || payload.status !== "connected") return;
    open = false;
    note.textContent = "Connected as @" + (payload.handle || "");
  });
  channel.subscribe();
  view.addEventListener("mousemove", (event) => send({ method: "Input.dispatchMouseEvent", params: Object.assign({ type: "mouseMoved" }, point(event)) }));
  view.addEventListener("mousedown", (event) => send({ method: "Input.dispatchMouseEvent", params: Object.assign({ type: "mousePressed" }, point(event)) }));
  view.addEventListener("mouseup", (event) => send({ method: "Input.dispatchMouseEvent", params: Object.assign({ type: "mouseReleased" }, point(event)) }));
  document.addEventListener("keydown", (event) => {
    if (!open) return;
    event.preventDefault();
    const text = event.key && event.key.length === 1 ? event.key : "";
    send({ method: "Input.dispatchKeyEvent", params: { type: "keyDown", key: event.key, code: event.code, text, windowsVirtualKeyCode: event.keyCode, nativeVirtualKeyCode: event.keyCode } });
    if (text) send({ method: "Input.dispatchKeyEvent", params: { type: "char", key: event.key, text } });
  });
  document.addEventListener("keyup", (event) => {
    if (!open) return;
    event.preventDefault();
    send({ method: "Input.dispatchKeyEvent", params: { type: "keyUp", key: event.key, code: event.code, windowsVirtualKeyCode: event.keyCode, nativeVirtualKeyCode: event.keyCode } });
  });
  document.addEventListener("paste", (event) => {
    if (!open) return;
    event.preventDefault();
    const text = event.clipboardData && event.clipboardData.getData("text");
    if (text) send({ method: "Input.insertText", params: { text } });
  });
}

main();
