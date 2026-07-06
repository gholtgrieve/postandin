export function fmtTime(d) {
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
}

export function fmtDuration(start, end) {
  if (!end) return "";
  const mins = Math.round((end - start) / 60000);
  return mins >= 60
    ? `${Math.floor(mins / 60)}h${mins % 60 ? ` ${mins % 60}m` : ""}`
    : `${mins}m`;
}

export function dayKey(d) {
  // Build YYYY-MM-DD from local date components so a UTC Date like
  // new Date("2026-06-21T01:00:00Z") correctly yields "2026-06-20" in PT.
  const y  = d.getFullYear();
  const m  = String(d.getMonth() + 1).padStart(2, '0');
  const dy = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dy}`;
}

export function fmtDayLabel(dateStr) {
  const d = new Date(dateStr + "T12:00:00");
  const today = new Date(); today.setHours(12, 0, 0, 0);
  const diff = Math.round((d - today) / 86400000);
  if (diff === 0) return { name: "Today", full: d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }) };
  if (diff === 1) return { name: "Tomorrow", full: d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }) };
  return {
    name: d.toLocaleDateString("en-US", { weekday: "long" }),
    full: d.toLocaleDateString("en-US", { month: "long", day: "numeric" }),
  };
}

export function escapeHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

export function safeUrl(u) {
  try {
    const parsed = new URL(u, 'https://placeholder.invalid');
    return ['http:', 'https:'].includes(parsed.protocol) ? u : '#';
  } catch {
    return '#';
  }
}

export function safeColor(color, fallback, allowedColors) {
  return allowedColors.includes(color) ? color : fallback;
}

export function mkSessionKey(s) {
  const d = s.start;
  const date = d.toLocaleDateString('en-CA');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${s.rinkKey}|${date}|${hh}:${mm}`;
}

export function getGroupSlug(group) {
  return group.groupName.trim().toLowerCase() + '|' + group.password.trim().toLowerCase();
}
