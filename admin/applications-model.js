export const CHANNELS = ["IG DM", "Email", "Other"];
export const STAGES = ["Not sent", "Sent", "Replied", "Call booked", "Hired", "No response", "Rejected"];
const CLOSED_STAGES = new Set(["Hired", "Rejected"]);

export const COLUMNS = [
  { key: "offer", label: "Offer", type: "text" },
  { key: "niche", label: "Niche", type: "text" },
  { key: "owner", label: "Owner/Contact", type: "text" },
  { key: "instagram", label: "Instagram handle", type: "text" },
  { key: "email", label: "Email", type: "text" },
  { key: "channel", label: "Channel", type: "select", options: CHANNELS },
  { key: "ticket", label: "Ticket", type: "text" },
  { key: "setter_ote", label: "Setter OTE", type: "text" },
  { key: "source_url", label: "Source URL", type: "url" },
  { key: "date_sent", label: "Date sent", type: "date" },
  { key: "video_url", label: "Video link", type: "url" },
  { key: "stage", label: "Stage", type: "select", options: STAGES },
  { key: "follow_up_date", label: "Follow-up date", type: "date" },
  { key: "notes", label: "Notes", type: "notes" }
];

export const APPLICATION_SELECT = [
  "id",
  "external_id",
  "sort_order",
  "updated_at",
  ...COLUMNS.map((column) => column.key)
].join(", ");

const DATE_KEYS = new Set(["date_sent", "follow_up_date"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const HEADER_TO_KEY = new Map([["id", "id"]]);
for (const column of COLUMNS) {
  HEADER_TO_KEY.set(column.label.toLowerCase(), column.key);
  HEADER_TO_KEY.set(column.key.toLowerCase(), column.key);
}
HEADER_TO_KEY.set("owner", "owner");
HEADER_TO_KEY.set("ig", "instagram");
HEADER_TO_KEY.set("instagram", "instagram");
HEADER_TO_KEY.set("video", "video_url");
HEADER_TO_KEY.set("follow-up", "follow_up_date");
HEADER_TO_KEY.set("follow up date", "follow_up_date");

export function blankApplication() {
  return {
    id: "",
    external_id: "",
    sort_order: 0,
    offer: "",
    niche: "",
    owner: "",
    instagram: "",
    email: "",
    channel: "IG DM",
    ticket: "",
    setter_ote: "",
    source_url: "",
    date_sent: "",
    video_url: "",
    stage: "Not sent",
    follow_up_date: "",
    notes: ""
  };
}

export function todayISO(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return year + "-" + month + "-" + day;
}

export function isOverdue(row, today) {
  const due = String(row?.follow_up_date || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) return false;
  if (CLOSED_STAGES.has(row?.stage)) return false;
  return due < String(today || "");
}

export function choice(value, options) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return options.find((option) => option.toLowerCase() === raw.toLowerCase()) || "";
}

export function normalizeDate(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return match[1] + "-" + match[2] + "-" + match[3];
}

export function normalizeHandle(value) {
  const handle = String(value || "").trim();
  if (!handle || handle.startsWith("@") || /[\s/]/.test(handle)) return handle;
  return "@" + handle;
}

export function safeHttpUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return url.href;
  } catch {
    return "";
  }
}

export function instagramUrl(value) {
  const name = String(value || "").trim().replace(/^@/, "");
  if (!/^[A-Za-z0-9._]{1,30}$/.test(name)) return "";
  return "https://instagram.com/" + name;
}

function emptyLast(av, bv, factor, compare) {
  const aEmpty = av === "" || av == null;
  const bEmpty = bv === "" || bv == null;
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1;
  if (bEmpty) return -1;
  return compare(av, bv) * factor;
}

export function compareApplications(a, b, key, direction) {
  const factor = direction === "desc" ? -1 : 1;
  const av = a?.[key] ?? "";
  const bv = b?.[key] ?? "";
  if (key === "sort_order") {
    return emptyLast(av, bv, factor, (left, right) => Number(left) - Number(right));
  }
  if (DATE_KEYS.has(key)) {
    return emptyLast(av, bv, factor, (left, right) => String(left).localeCompare(String(right)));
  }
  return String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: "base" }) * factor;
}

export function sortApplications(rows, key, direction) {
  return rows.slice().sort((a, b) => compareApplications(a, b, key, direction) || compareApplications(a, b, "sort_order", "asc"));
}

export function filterApplications(rows, { query = "", stage = "", channel = "", overdueOnly = false, today = "" } = {}) {
  const needle = String(query || "").trim().toLowerCase();
  return rows.filter((row) => {
    if (stage && row.stage !== stage) return false;
    if (channel && row.channel !== channel) return false;
    if (overdueOnly && !isOverdue(row, today)) return false;
    if (!needle) return true;
    return COLUMNS.some((column) => String(row[column.key] || "").toLowerCase().includes(needle));
  });
}

function csvCell(value) {
  const text = String(value ?? "");
  const guarded = /^[=+\-]/.test(text) ? "'" + text : text;
  if (/[",\r\n]/.test(guarded)) return '"' + guarded.replace(/"/g, '""') + '"';
  return guarded;
}

export function applicationsToCsv(rows) {
  const headers = ["Id", ...COLUMNS.map((column) => column.label)];
  const lines = [headers.map(csvCell).join(",")];
  for (const row of rows) {
    const cells = [row.id || "", ...COLUMNS.map((column) => row[column.key] ?? "")];
    lines.push(cells.map(csvCell).join(","));
  }
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}

export function parseCsv(text) {
  const src = String(text || "").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!src.trim()) return { headers: [], records: [] };
  const table = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i += 1) {
    const char = src[i];
    if (quoted) {
      if (char === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === ",") {
      row.push(cell);
      cell = "";
      continue;
    }
    if (char === "\n") {
      row.push(cell);
      table.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += char;
  }
  if (cell.length || row.length) {
    row.push(cell);
    table.push(row);
  }
  const headers = (table[0] || []).map((header) => header.trim());
  const records = table.slice(1)
    .filter((cells) => cells.some((value) => String(value).trim() !== ""))
    .map((cells) => {
      const record = {};
      headers.forEach((header, index) => {
        record[header] = cells[index] ?? "";
      });
      return record;
    });
  return { headers, records };
}

export function csvToApplications(text) {
  const parsed = parseCsv(text);
  if (!parsed.headers.length) return { rows: [], errors: ["The CSV needs a header row."] };
  const known = parsed.headers.some((header) => HEADER_TO_KEY.has(header.trim().toLowerCase()));
  if (!known) {
    return { rows: [], errors: ["Use a header row with columns such as Offer, Owner/Contact, and Stage."] };
  }
  const rows = [];
  const errors = [];
  parsed.records.forEach((record, index) => {
    const line = index + 2;
    const present = {};
    Object.entries(record).forEach(([header, value]) => {
      const key = HEADER_TO_KEY.get(String(header).trim().toLowerCase());
      if (key) present[key] = String(value ?? "").trim();
    });
    if (Object.values(present).every((value) => value === "")) return;
    if (Object.prototype.hasOwnProperty.call(present, "channel") && present.channel) {
      const channel = choice(present.channel, CHANNELS);
      if (!channel) {
        errors.push("Row " + line + ': unknown channel "' + present.channel + '".');
        return;
      }
      present.channel = channel;
    }
    if (Object.prototype.hasOwnProperty.call(present, "stage") && present.stage) {
      const stage = choice(present.stage, STAGES);
      if (!stage) {
        errors.push("Row " + line + ': unknown stage "' + present.stage + '".');
        return;
      }
      present.stage = stage;
    }
    for (const key of DATE_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(present, key) || !present[key]) continue;
      const date = normalizeDate(present[key]);
      if (date == null) {
        errors.push("Row " + line + ": " + key.replaceAll("_", " ") + " must be YYYY-MM-DD.");
        return;
      }
      present[key] = date;
    }
    if (present.instagram) present.instagram = normalizeHandle(present.instagram);
    const row = { ...blankApplication(), ...present };
    if (present.id && !UUID.test(present.id)) row.id = "";
    if (!present.channel) row.channel = "IG DM";
    if (!present.stage) row.stage = "Not sent";
    rows.push({ row, present: new Set(Object.keys(present).filter((key) => key !== "id")) });
  });
  return { rows, errors };
}
