// Pure stats for cached TailorTalk leads. Only fields the Get Leads guide returns.
// A blank source is not counted. Leads have no join date, so each day counts
// last_message_time. Days with no messages stay at zero.

export function computeStats(leads, now = new Date()) {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const series = [];
  for (let offset = 29; offset >= 0; offset -= 1) {
    const day = new Date(end);
    day.setUTCDate(end.getUTCDate() - offset);
    series.push({ day: day.toISOString().slice(0, 10), count: 0 });
  }
  const index = new Map(series.map((item, at) => [item.day, at]));
  const byStatus = {};
  const bySource = {};
  const byCategory = {};
  let converted = 0;
  let lastMs = null;

  (leads || []).forEach((lead) => {
    const status = String(lead.lead_status || "").trim().toLowerCase();
    if (status) byStatus[status] = (byStatus[status] || 0) + 1;
    const source = String(lead.source || lead.lead_source || "").trim();
    if (source) bySource[source] = (bySource[source] || 0) + 1;
    const category = String(lead.category || "").trim().toLowerCase();
    if (category) byCategory[category] = (byCategory[category] || 0) + 1;
    if (lead.is_converted === true) converted += 1;
    const activity = timeOf(lead.last_message_time);
    if (activity != null && (lastMs == null || activity > lastMs)) lastMs = activity;
    if (activity == null) return;
    const at = index.get(new Date(activity).toISOString().slice(0, 10));
    if (at != null) series[at].count += 1;
  });

  const total = (leads || []).length;
  return {
    total_leads: total,
    by_status: byStatus,
    by_source: bySource,
    by_category: byCategory,
    converted_count: converted,
    conversion_rate: total ? Math.round((converted / total) * 10000) / 10000 : null,
    last_activity_at: lastMs == null ? null : new Date(lastMs).toISOString(),
    leads_per_day: series
  };
}

function timeOf(value) {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}
