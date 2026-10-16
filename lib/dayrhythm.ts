export type Category = "Работа" | "Спорт" | "Отдых" | "Быт" | "Личное";
export type Recurrence = "none" | "daily" | "weekly";

export const CATEGORIES: Category[] = ["Работа", "Спорт", "Отдых", "Быт", "Личное"];
export const COLORS: Record<Category, string> = {
  "Работа": "#6266e9",
  "Спорт": "#f36c45",
  "Отдых": "#20a68a",
  "Быт": "#d6a52d",
  "Личное": "#bc75c9"
};
export const CATEGORY_EMOJI: Record<Category, string> = {
  "Работа": "💼",
  "Спорт": "🏃",
  "Отдых": "☕",
  "Быт": "🏠",
  "Личное": "✨"
};

export interface Task {
  id: string;
  title: string;
  date: string;
  start: number;
  duration: number;
  category: Category;
  done: boolean;
  note: string;
  emoji?: string;
  colorHex?: string;
  participants?: string[];
  reminderMinutes?: number | null;
  recurrence?: Recurrence;
  inbox?: boolean;
  updatedAt?: number;
  source?: "manual" | "ai" | "calendar";
}

export type AppView = "schedule" | "calendar" | "timeline" | "ai" | "insights" | "inbox" | "settings";
export type ClockFormat = "24h" | "12h";
export type DialMode = "24h" | "day" | "night" | "auto";

export interface ParsedTask {
  title: string;
  description?: string;
  startTime: number;
  endTime: number;
  date: string;
  emoji: string;
  colorHex: string;
  category: Category;
  participants?: string[];
}

export const pad = (n: number) => String(n).padStart(2, "0");
export const todayString = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
export const addDaysToDate = (date: string, offset: number) => {
  const d = new Date(date + "T12:00:00");
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
export const timeText = (minutes: number, format: ClockFormat = "24h") => {
  const safe = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const hour = Math.floor(safe / 60);
  const minute = safe % 60;
  if (format === "24h") return `${pad(hour)}:${pad(minute)}`;
  const hour12 = hour % 12 || 12;
  return `${hour12}:${pad(minute)} ${hour < 12 ? "AM" : "PM"}`;
};
export const dateText = (date: string) => new Date(date + "T12:00:00").toLocaleDateString("ru-RU", {
  weekday: "long", day: "numeric", month: "long"
});
export const makeId = () => typeof crypto !== "undefined" && "randomUUID" in crypto
  ? crypto.randomUUID()
  : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

export function taskOccursOnDate(task: Task, date: string): boolean {
  if (task.inbox || task.date > date) return false;
  if (task.date === date) return true;
  if (task.recurrence === "daily") return true;
  if (task.recurrence === "weekly") {
    return new Date(task.date + "T12:00:00").getDay() === new Date(date + "T12:00:00").getDay();
  }
  return false;
}

export function taskDialSegments(task: Task, mode: Exclude<DialMode, "auto">): Array<{ start: number; duration: number }> {
  if (mode === "24h") return [{ start: task.start, duration: Math.min(task.duration, 1440 - task.start) }];
  const windowStart = mode === "day" ? 360 : 1080;
  const windowEnd = mode === "day" ? 1080 : 1800;
  let taskStart = task.start;
  if (mode === "night" && taskStart < 360) taskStart += 1440;
  const taskEnd = taskStart + task.duration;
  const clippedStart = Math.max(taskStart, windowStart);
  const clippedEnd = Math.min(taskEnd, windowEnd);
  if (clippedEnd <= clippedStart) return [];
  const scale = 1440 / (windowEnd - windowStart);
  return [{ start: (clippedStart - windowStart) * scale, duration: (clippedEnd - clippedStart) * scale }];
}

export function actualMinuteForDialMinute(value: number, mode: Exclude<DialMode, "auto">): number {
  if (mode === "day") return Math.round(360 + value / 2) % 1440;
  if (mode === "night") return Math.round(1080 + value / 2) % 1440;
  return Math.round(value) % 1440;
}

export function normalizeCategory(input: unknown): Category {
  const text = String(input ?? "").toLowerCase();
  if (/sport|gym|exercise|health|fitness|бег|спорт|зал|тренир|здоров/.test(text)) return "Спорт";
  if (/rest|break|relax|food|meal|sleep|отдых|перерыв|обед|завтрак|сон|кофе/.test(text)) return "Отдых";
  if (/home|house|chores|clean|быт|дом|уборк|покупк/.test(text)) return "Быт";
  if (/personal|social|friend|family|личн|друг|встреч|семь|общен/.test(text)) return "Личное";
  return "Работа";
}

export function normalizeTask(value: unknown, fallbackDate = todayString()): Task | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const title = String(item.title ?? "").trim();
  if (!title) return null;
  const rawStart = Number(item.start ?? item.startTime ?? 540);
  const start = Math.min(1435, Math.max(0, Number.isFinite(rawStart) ? rawStart : 540));
  const rawDuration = Number(item.duration ?? ((Number(item.endTime) || (start + 60)) - start));
  const duration = Math.max(5, Math.min(1440 - start, Number.isFinite(rawDuration) && rawDuration > 0 ? rawDuration : 60));
  const category = normalizeCategory(item.category);
  const dateCandidate = String(item.date ?? fallbackDate);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(dateCandidate) ? dateCandidate : fallbackDate;
  const reminderValue = item.reminderMinutes == null ? null : Number(item.reminderMinutes);
  return {
    id: String(item.id ?? makeId()),
    title,
    date,
    start,
    duration,
    category,
    done: Boolean(item.done ?? item.isCompleted),
    note: String(item.note ?? item.description ?? ""),
    emoji: String(item.emoji ?? CATEGORY_EMOJI[category]),
    colorHex: /^#[0-9a-f]{6}$/i.test(String(item.colorHex ?? "")) ? String(item.colorHex) : COLORS[category],
    participants: Array.isArray(item.participants) ? item.participants.map(String).filter(Boolean).slice(0, 30) : [],
    reminderMinutes: reminderValue === null || !Number.isFinite(reminderValue) ? null : Math.min(1440, Math.max(0, reminderValue)),
    recurrence: item.recurrence === "daily" || item.recurrence === "weekly" ? item.recurrence : "none",
    inbox: Boolean(item.inbox),
    updatedAt: Number(item.updatedAt) || Date.now(),
    source: item.source === "ai" || item.source === "calendar" ? item.source : "manual"
  };
}

function guessCategory(text: string): Category {
  return normalizeCategory(text);
}
function guessEmoji(text: string, category: Category): string {
  const value = text.toLowerCase();
  if (/meeting|встреч|митинг|созвон|звонок/.test(value)) return "👥";
  if (/gym|workout|трениров|зал|бег|cycling|велосипед/.test(value)) return "💪";
  if (/breakfast|lunch|dinner|обед|завтрак|ужин|готов/.test(value)) return "🍽️";
  if (/study|учеб|лекци|курс|экзамен/.test(value)) return "📚";
  if (/doctor|врач|приём|прием/.test(value)) return "🩺";
  if (/shop|покуп|магаз/.test(value)) return "🛒";
  if (/sleep|сон/.test(value)) return "🌙";
  return CATEGORY_EMOJI[category];
}

function inferDate(text: string, baseDate: string): string {
  const value = text.toLowerCase();
  if (/\b(today)\b|\bсегодня\b/.test(value)) return baseDate;
  if (/\btomorrow\b|\bзавтра\b/.test(value)) return addDaysToDate(baseDate, 1);
  if (/\bday after tomorrow\b|\bпослезавтра\b/.test(value)) return addDaysToDate(baseDate, 2);
  const weekdayMap: Record<string, number> = {
    monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, sunday: 0,
    понедельник: 1, вторник: 2, среду: 3, среда: 3, четверг: 4, пятницу: 5, пятница: 5, субботу: 6, суббота: 6, воскресенье: 0
  };
  const found = Object.entries(weekdayMap).find(([name]) => value.includes(name));
  if (found) {
    const base = new Date(baseDate + "T12:00:00");
    const currentDay = base.getDay();
    const targetDay = found[1];
    let offset = (targetDay - currentDay + 7) % 7;
    if (/next|следующ/.test(value) || offset === 0) offset = offset === 0 ? 7 : offset + (/(next|следующ)/.test(value) ? 7 : 0);
    return addDaysToDate(baseDate, offset);
  }
  return baseDate;
}

export function parseScheduleLocally(input: string, baseDate = todayString()): ParsedTask[] {
  const raw = input.trim();
  if (!raw) return [];
  const chunks = raw
    .replace(/\s+(?:and|и)\s+(?=[^,;\n]{1,70}?(?:at\s+|в\s*)\d{1,2}(?:[:.]\d{2})?)/gi, ";")
    .split(/[;\n]+/)
    .map(part => part.trim())
    .filter(Boolean);
  const result: ParsedTask[] = [];
  for (const original of chunks) {
    const timeMatch = original.match(/(?:\bat\s*|\bв\s*)?(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|утра|утром|дня|днём|днем|вечера|вечером|ночи)?/i);
    if (!timeMatch) continue;
    let hour = Number(timeMatch[1]);
    const minute = Number(timeMatch[2] ?? 0);
    const period = String(timeMatch[3] ?? "").toLowerCase();
    if (minute > 59 || hour > 24 || hour === 24 && minute > 0) continue;
    if (period === "pm" || /вечер|дня|днём|днем/.test(period)) { if (hour < 12) hour += 12; }
    else if (period === "am" || /утр/.test(period)) { if (hour === 12) hour = 0; }
    else if (/ноч/.test(period)) { if (hour === 12) hour = 0; else if (hour >= 6) hour %= 12; }
    else if (hour >= 1 && hour <= 7 && /gym|workout|run|тренир|зал|бег|велосипед/i.test(original)) hour += 12;
    hour = hour === 24 ? 0 : hour;
    const startTime = hour * 60 + minute;
    const durationMatch = original.match(/(?:for|на)\s*(\d+)\s*(minutes?|mins?|минут\w*|hours?|hrs?|час\w*)/i);
    let duration = durationMatch ? Number(durationMatch[1]) * (/hour|hr|час/i.test(durationMatch[2]) ? 60 : 1) : 60;
    duration = Math.max(5, Math.min(1440 - startTime, duration));
    const category = guessCategory(original);
    let title = original
      .replace(/\b(?:today|tomorrow|day after tomorrow|next|on)\b/gi, "")
      .replace(/\b(?:сегодня|завтра|послезавтра|следующ\w*|в понедельник|во вторник|в среду|в четверг|в пятницу|в субботу|в воскресенье)\b/gi, "")
      .replace(/\b(?:at\s*)?\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm|утра|утром|дня|днём|днем|вечера|вечером|ночи)?\b/gi, "")
      .replace(/\b(?:for|на)\s*\d+\s*(?:minutes?|mins?|минут\w*|hours?|hrs?|час\w*)\b/gi, "")
      .replace(/\b(?:at|в)\s*$/i, "")
      .replace(/\b(?:and|и)\b/gi, " ")
      .replace(/^[\s,.:—-]+|[\s,.:—-]+$/g, "")
      .trim();
    if (!title) title = category === "Работа" ? "Задача" : category;
    result.push({
      title: title.charAt(0).toLocaleUpperCase() + title.slice(1),
      description: "",
      startTime,
      endTime: startTime + duration,
      date: inferDate(original, baseDate),
      emoji: guessEmoji(original, category),
      colorHex: COLORS[category],
      category
    });
  }
  return result;
}

const icsEscape = (value: string) => value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
const icsUnescape = (value: string) => value.replace(/\\n/gi, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\");
const icsDate = (date: string, minutes: number) => date.replace(/-/g, "") + "T" + pad(Math.floor(minutes / 60)) + pad(minutes % 60) + "00";

export function buildIcs(tasks: Task[]): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//DayRhythm Web//Schedule//RU", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
  for (const task of tasks) {
    if (task.inbox) continue;
    lines.push("BEGIN:VEVENT");
    lines.push("UID:" + task.id.replace(/[^a-zA-Z0-9@._-]/g, "-") + "@dayrhythm.local");
    lines.push("DTSTAMP:" + new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z"));
    lines.push("DTSTART:" + icsDate(task.date, task.start));
    lines.push("DTEND:" + icsDate(task.date, Math.min(1439, task.start + task.duration)));
    lines.push("SUMMARY:" + icsEscape((task.emoji ? task.emoji + " " : "") + task.title));
    if (task.note) lines.push("DESCRIPTION:" + icsEscape(task.note));
    lines.push("CATEGORIES:" + task.category);
    if (task.recurrence === "daily") lines.push("RRULE:FREQ=DAILY");
    if (task.recurrence === "weekly") lines.push("RRULE:FREQ=WEEKLY");
    lines.push("STATUS:" + (task.done ? "COMPLETED" : "CONFIRMED"));
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

export function parseIcs(input: string): Task[] {
  const unfolded = input.replace(/\r?\n[ \t]/g, "");
  const blocks = unfolded.split(/BEGIN:VEVENT/i).slice(1);
  const output: Task[] = [];
  for (const block of blocks) {
    const body = block.split(/END:VEVENT/i)[0] ?? "";
    const valueFor = (key: string) => {
      const line = body.split(/\r?\n/).find(line => new RegExp("^" + key + "(?:;[^:]*)?:", "i").test(line));
      return line ? line.slice(line.indexOf(":") + 1).trim() : "";
    };
    const dateFor = (key: string): { date: string; minutes: number } | null => {
      const line = body.split(/\r?\n/).find(item => new RegExp("^" + key + "(?:;[^:]*)?:", "i").test(item));
      if (!line) return null;
      const raw = line.slice(line.indexOf(":") + 1).trim();
      const match = raw.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
      if (!match) return null;
      const date = `${match[1]}-${match[2]}-${match[3]}`;
      if (!match[4]) return { date, minutes: 540 };
      if (match[7]) {
        const utc = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6] ?? 0)));
        return { date: `${utc.getFullYear()}-${pad(utc.getMonth()+1)}-${pad(utc.getDate())}`, minutes: utc.getHours() * 60 + utc.getMinutes() };
      }
      return { date, minutes: Math.min(1435, Number(match[4]) * 60 + Number(match[5])) };
    };
    const start = dateFor("DTSTART"), end = dateFor("DTEND");
    if (!start) continue;
    const rawTitle = icsUnescape(valueFor("SUMMARY")) || "Событие календаря";
    const emojiMatch = rawTitle.match(/^(\p{Extended_Pictographic}\uFE0F?)/u);
    const title = emojiMatch ? rawTitle.slice(emojiMatch[0].length).trim() : rawTitle;
    const category = normalizeCategory(valueFor("CATEGORIES"));
    const normalized = normalizeTask({
      id: valueFor("UID") || makeId(),
      title,
      date: start.date,
      start: start.minutes,
      duration: Math.max(5, Math.min(1440 - start.minutes, (end?.date === start.date ? (end.minutes ?? start.minutes + 60) : start.minutes + 60) - start.minutes)),
      category,
      done: /^COMPLETED$/i.test(valueFor("STATUS")),
      note: icsUnescape(valueFor("DESCRIPTION")),
      emoji: emojiMatch?.[0] ?? guessEmoji(title, category),
      source: "calendar"
    }, start.date);
    if (normalized) output.push(normalized);
  }
  return output;
}
