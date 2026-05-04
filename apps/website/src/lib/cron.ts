/**
 * Tiny cron-to-next-fire utility.
 *
 * Just enough to render "Next fire: in 14h" for the routine goal card.
 * Supports the literal patterns the capture classifier emits (`0 9 * * 1`,
 * `0 9 1 * *`, `0 9 * * *`) plus comma lists (`0,30`), ranges (`9-17`),
 * and step values (`*\/15`). Anything more exotic returns null and the
 * caller falls back to "scheduled".
 */

export type CronFire = {
  next: Date;
  /** Human label, e.g. "in 14h" or "tomorrow at 9:00". */
  label: string;
};

function parseField(spec: string, min: number, max: number): Set<number> | null {
  if (spec === "*") return null;
  const out = new Set<number>();
  for (const part of spec.split(",")) {
    const stepMatch = part.match(/^(\*|\d+(-\d+)?)\/(\d+)$/);
    if (stepMatch) {
      const range = stepMatch[1]!;
      const step = Number(stepMatch[3]);
      if (!Number.isFinite(step) || step <= 0) return null;
      let lo = min;
      let hi = max;
      if (range !== "*") {
        const [a, b] = range.split("-").map(Number);
        if (!Number.isFinite(a)) return null;
        lo = a as number;
        hi = (b ?? max) as number;
      }
      for (let v = lo; v <= hi; v += step) out.add(v);
      continue;
    }
    const rangeMatch = part.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) {
      const a = Number(rangeMatch[1]);
      const b = Number(rangeMatch[2]);
      if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
      for (let v = a; v <= b; v++) out.add(v);
      continue;
    }
    const n = Number(part);
    if (!Number.isFinite(n)) return null;
    out.add(n);
  }
  // Validate range
  for (const v of out) {
    if (v < min || v > max) return null;
  }
  return out;
}

export function nextCronFire(expr: string, from: Date = new Date()): CronFire | null {
  if (!expr) return null;
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const minute = parseField(parts[0]!, 0, 59);
  const hour = parseField(parts[1]!, 0, 23);
  const dom = parseField(parts[2]!, 1, 31);
  const mon = parseField(parts[3]!, 1, 12);
  const dow = parseField(parts[4]!, 0, 6);
  if (
    minute === null && hour === null && dom === null && mon === null && dow === null &&
    parts.some((p) => p !== "*")
  ) {
    // All `*` is "every minute" — almost certainly wrong intent.
    return null;
  }

  const cursor = new Date(from);
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);

  // 60-day search window. Worst case ~86,400 iterations; JS handles it in <10ms.
  for (let i = 0; i < 60 * 24 * 60; i++) {
    const okM = minute === null || minute.has(cursor.getMinutes());
    const okH = hour === null || hour.has(cursor.getHours());
    const okDom = dom === null || dom.has(cursor.getDate());
    const okMon = mon === null || mon.has(cursor.getMonth() + 1);
    const okDow = dow === null || dow.has(cursor.getDay());
    if (okM && okH && okDom && okMon && okDow) {
      return { next: new Date(cursor), label: friendlyFireLabel(cursor, from) };
    }
    cursor.setMinutes(cursor.getMinutes() + 1);
  }
  return null;
}

function friendlyFireLabel(when: Date, now: Date): string {
  const diffMs = when.getTime() - now.getTime();
  const mins = Math.round(diffMs / 60_000);
  if (mins < 60) return `in ${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `in ${hours}h`;
  const days = Math.round(hours / 24);
  if (days === 1) {
    return `tomorrow at ${when.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
  }
  if (days < 7) {
    return when.toLocaleDateString("en-US", { weekday: "short" }) +
      " " +
      when.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }
  return when.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function describeCron(expr: string): string {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return expr;
  const [min, hr, dom, _mon, dow] = parts;
  const time = hr === "*" ? "every hour" : `${hr}:${(min ?? "0").padStart(2, "0")}`;
  if (dom === "*" && dow === "*") return `every day at ${time}`;
  if (dom === "*" && dow !== "*") {
    const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const days = dow!.split(",").map((d) => names[Number(d) % 7] ?? d).join(", ");
    return `every ${days} at ${time}`;
  }
  if (dow === "*" && dom !== "*") return `on the ${dom}${suffix(Number(dom))} at ${time}`;
  return expr;
}

function suffix(n: number): string {
  if (n >= 11 && n <= 13) return "th";
  switch (n % 10) {
    case 1: return "st";
    case 2: return "nd";
    case 3: return "rd";
    default: return "th";
  }
}
