/// Calendar helpers.
///
/// Meter timestamps are UTC; everything the household sees is cut on the local
/// calendar, so the zone has to be explicit rather than whatever the runtime
/// happens to use. Formatters are cached per zone because building an
/// Intl.DateTimeFormat is expensive relative to a Worker request.

const DAY_MS = 86_400_000;
export const HOUR_MS = 3_600_000;

const dateFormatters = new Map<string, Intl.DateTimeFormat>();
const hourFormatters = new Map<string, Intl.DateTimeFormat>();

function dateFormatter(zone: string): Intl.DateTimeFormat {
  let f = dateFormatters.get(zone);
  if (!f) {
    // "sv-SE" formats as YYYY-MM-DD, which is what the database stores.
    f = new Intl.DateTimeFormat("sv-SE", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    dateFormatters.set(zone, f);
  }
  return f;
}

function hourFormatter(zone: string): Intl.DateTimeFormat {
  let f = hourFormatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", hourCycle: "h23" });
    hourFormatters.set(zone, f);
  }
  return f;
}

/** Local calendar date of an instant, as YYYY-MM-DD. */
export function localDate(instant: Date | string | number, zone: string): string {
  const date = typeof instant === "string" ? new Date(instant) : new Date(instant);
  return dateFormatter(zone).format(date);
}

/** Local hour 0-23 of an instant. */
export function localHour(instant: Date | number, zone: string): number {
  return Number(hourFormatter(zone).format(instant));
}

/** Today's local date. */
export function today(zone: string): string {
  return localDate(new Date(), zone);
}

/** Midday anchoring keeps arithmetic clear of daylight-saving edges. */
function anchor(isoDate: string): number {
  return Date.parse(`${isoDate}T12:00:00Z`);
}

export function addDays(isoDate: string, days: number): string {
  return new Date(anchor(isoDate) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days from a to b. */
export function daysBetween(a: string, b: string): number {
  return Math.round((anchor(b) - anchor(a)) / DAY_MS);
}

/** Monday of the ISO week holding this date. */
export function weekStart(isoDate: string): string {
  const day = new Date(anchor(isoDate)).getUTCDay(); // 0 = Sunday
  return addDays(isoDate, day === 0 ? -6 : -(day - 1));
}

export function monthStart(isoDate: string): string {
  return `${isoDate.slice(0, 7)}-01`;
}

export function addMonths(isoDate: string, months: number): string {
  const [y, m] = isoDate.split("-").map(Number) as [number, number];
  const total = y * 12 + (m - 1) + months;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}-01`;
}

export function isWeekend(isoDate: string): boolean {
  const day = new Date(anchor(isoDate)).getUTCDay();
  return day === 0 || day === 6;
}
