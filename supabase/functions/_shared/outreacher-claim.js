// Decision table for private.outreacher_can_send. The SQL function is the
// enforcement point. These reasons and this order are the contract the SQL follows.

export const CLAIM_REASONS = [
  "forbidden",
  "error",
  "global_kill",
  "killed",
  "disabled",
  "paused",
  "workforce",
  "ig_paused",
  "system_off",
  "subscription",
  "machine",
  "session",
  "sending_off",
  "quiet_hours",
  "daily_cap",
  "hourly_cap",
  "dnc",
  "already_contacted",
  "target"
];

export function inQuietHours(now, timeZone, start, end) {
  if (!start || !end || start === end) return false;
  const local = new Intl.DateTimeFormat("en-GB", {
    timeZone: timeZone || "Europe/Madrid",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).format(now instanceof Date ? now : new Date(now));
  const [hours, minutes, seconds] = local.split(":").map((part) => Number(part));
  const current = hours * 3600 + minutes * 60 + seconds;
  const toSeconds = (value) => {
    const [h, m, s] = String(value).split(":");
    return Number(h) * 3600 + Number(m || 0) * 60 + Number(s || 0);
  };
  const from = toSeconds(start);
  const to = toSeconds(end);
  if (from < to) return current >= from && current < to;
  return current >= from || current < to;
}

function refuse(reason) {
  return { ok: false, reason };
}

export function decideClaim(input) {
  const snapshot = input || {};
  try {
    if (snapshot.throwError) throw new Error(snapshot.throwError);
    if (snapshot.role !== "service_role") return refuse("forbidden");
    if (snapshot.globalMissing) return refuse("error");
    if (snapshot.globalKilled === true) return refuse("global_kill");
    const controls = snapshot.controls;
    if (controls && controls.killed === true) return refuse("killed");
    if (!controls || controls.enabled !== true) return refuse("disabled");
    const config = snapshot.config;
    if (!config || config.paused === true) return refuse("paused");
    const workforce = snapshot.workforce;
    if (!workforce || workforce.status !== "active") return refuse("workforce");
    const settings = snapshot.settings;
    if (!settings) return refuse("error");
    if (settings.ig_paused === true) return refuse("ig_paused");
    if (settings.system_enabled !== true) return refuse("system_off");
    const machine = snapshot.machine;
    if (!machine || !["active", "trialing"].includes(machine.subscription_status)) return refuse("subscription");
    if (machine.revoked_at || machine.status !== "ready") return refuse("machine");
    if (machine.session_state !== "connected") return refuse("session");
    if (machine.sending_mode === "off" || !machine.sending_mode) return refuse("sending_off");
    const quiet = snapshot.quiet != null
      ? snapshot.quiet === true
      : inQuietHours(snapshot.now || new Date(), settings.timezone, settings.quiet_start, settings.quiet_end);
    if (quiet) return refuse("quiet_hours");
    const dailyCap = Number(controls.daily_cap);
    const hourlyCap = Number(config.hourly_cap);
    if (!Number.isFinite(dailyCap) || !Number.isFinite(hourlyCap)) return refuse("error");
    if (Number(snapshot.dailyCount || 0) >= dailyCap) return refuse("daily_cap");
    if (Number(snapshot.hourlyCount || 0) >= hourlyCap) return refuse("hourly_cap");
    const target = String(snapshot.target || "").replace(/^@+/, "").trim().toLowerCase();
    if (!/^[a-z0-9._]{1,30}$/.test(target)) return refuse("target");
    if (snapshot.dnc === true) return refuse("dnc");
    if (snapshot.contacted === true) return refuse("already_contacted");
    const kind = String(snapshot.actionKind || "");
    if (!["dm", "warmup", "like", "follow", "view", "comment"].includes(kind)) return refuse("error");
    return {
      ok: true,
      reason: "claimed",
      mode: machine.sending_mode,
      action_kind: kind,
      target
    };
  } catch {
    return refuse("error");
  }
}
