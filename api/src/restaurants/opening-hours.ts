import { parseJson } from "../shared/json";

export type OpeningState = "open" | "closed" | "unknown";
export type DayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
export interface OpeningHours {
  mon?: string[][];
  tue?: string[][];
  wed?: string[][];
  thu?: string[][];
  fri?: string[][];
  sat?: string[][];
  sun?: string[][];
}

const DAY_ORDER: DayKey[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function minutes(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

export function dailyHours(value: string | null): string | null {
  if (!value) return null;
  const match = /^(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})$/.exec(value.trim());
  if (!match) return null;
  const result: OpeningHours = {};
  for (const day of DAY_ORDER) result[day] = [[match[1]!, match[2]!]];
  return JSON.stringify(result);
}

export function evaluateOpeningHours(
  openingHoursJson: string | null,
  isoTime: string,
  timezone = "Asia/Ho_Chi_Minh",
): OpeningState {
  const date = new Date(isoTime);
  if (!openingHoursJson || Number.isNaN(date.getTime())) return "unknown";
  const hours = parseJson<OpeningHours | null>(openingHoursJson, null);
  if (!hours) return "unknown";

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const weekday = parts
    .find((part) => part.type === "weekday")
    ?.value.toLocaleLowerCase();
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  const currentDay = DAY_ORDER.find((day) => day === weekday);
  if (!currentDay || !Number.isInteger(hour) || !Number.isInteger(minute))
    return "unknown";
  const currentMinutes = hour * 60 + minute;
  const currentIndex = DAY_ORDER.indexOf(currentDay);
  const previousDay = DAY_ORDER[(currentIndex + 6) % 7]!;

  const inRanges = (
    ranges: string[][] | undefined,
    includeOvernightTail: boolean,
  ): boolean =>
    (ranges ?? []).some(([startText, endText]) => {
      if (!startText || !endText) return false;
      const start = minutes(startText);
      const end = minutes(endText);
      if (start === null || end === null) return false;
      if (start <= end)
        return (
          !includeOvernightTail &&
          currentMinutes >= start &&
          currentMinutes < end
        );
      return includeOvernightTail
        ? currentMinutes < end
        : currentMinutes >= start;
    });

  if (inRanges(hours[currentDay], false) || inRanges(hours[previousDay], true))
    return "open";
  return "closed";
}
