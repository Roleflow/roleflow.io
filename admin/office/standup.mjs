import { zonedParts } from "../hq/cron.mjs";

const ZONE = "Europe/Madrid";
const START = 8 * 60;
const WALK = 3;
const MEET_END = 12;
const END = 15;
const REPLAY = 16;

function madridMinutes(date) {
  const parts = zonedParts(date, ZONE);
  const second = new Intl.DateTimeFormat("en-US", {
    timeZone: ZONE,
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date).find((part) => part.type === "second");
  const secs = Number(second ? second.value : 0);
  return parts.hour * 60 + parts.minute + (Number.isFinite(secs) ? secs : 0) / 60;
}

export function standupPhase(date) {
  const mins = madridMinutes(date);
  const into = mins - START;
  if (into < 0 || into >= END) return { mode: "desk", t: 0, playing: false };
  if (into < WALK) return { mode: "to", t: into / WALK, playing: true };
  if (into < MEET_END) return { mode: "meet", t: (into - WALK) / (MEET_END - WALK), playing: true };
  return { mode: "back", t: (into - MEET_END) / (END - MEET_END), playing: true };
}

export function standupReplay(elapsedSeconds) {
  const u = ((Number(elapsedSeconds) % REPLAY) + REPLAY) % REPLAY / REPLAY;
  if (u < 0.34) return { mode: "to", t: u / 0.34, playing: true };
  if (u < 0.66) return { mode: "meet", t: (u - 0.34) / 0.32, playing: true };
  return { mode: "back", t: (u - 0.66) / 0.34, playing: true };
}

export function smoothstep(value) {
  const t = Math.min(1, Math.max(0, value));
  return t * t * (3 - 2 * t);
}
