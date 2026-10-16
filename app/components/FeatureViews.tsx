"use client";

import { ChangeEvent, Dispatch, SetStateAction, useEffect, useMemo, useState } from "react";
import {
  AppView, CATEGORIES, CATEGORY_EMOJI, COLORS, Category, ClockFormat, DialMode,
  ParsedTask, Task, addDaysToDate, buildIcs, dateText, makeId, normalizeCategory,
  normalizeTask, parseIcs, parseScheduleLocally, pad, timeText, todayString
} from "@/lib/dayrhythm";
import {
  CloudSession, DeletedTaskMap, getSavedSession, getSupabaseConfig,
  saveSession, signInWithPassword, signOut, signUpWithPassword, syncTasksWithCloud
} from "@/lib/supabase-rest";

type Props = {
  view: AppView;
  tasks: Task[];
  setTasks: Dispatch<SetStateAction<Task[]>>;
  selectedDate: string;
  setSelectedDate: (date: string) => void;
  clockFormat: ClockFormat;
  setClockFormat: (value: ClockFormat) => void;
  dialMode: DialMode;
  setDialMode: (value: DialMode) => void;
  theme: "light" | "dark";
  setTheme: (value: "light" | "dark") => void;
  notificationsEnabled: boolean;
  setNotificationsEnabled: (value: boolean) => void;
  deletedAt: DeletedTaskMap;
  setDeletedAt: Dispatch<SetStateAction<DeletedTaskMap>>;
  onOpenDay: (date: string) => void;
  onCreateTask: (date?: string, inbox?: boolean) => void;
  onEditTask: (task: Task) => void;
  onToggleDone: (id: string) => void;
  onDeleteTask: (id: string) => void;
  setNotice: (value: string) => void;
};

const VIEW_HEADINGS: Record<Exclude<AppView, "schedule">, { eyebrow: string; title: string; subtitle: string }> = {
  calendar: { eyebrow: "ПЛАНИРОВАНИЕ", title: "Календарь", subtitle: "Неделя и месяц в одной картине." },
  timeline: { eyebrow: "ХРОНОЛОГИЯ ДНЯ", title: "Лента времени", subtitle: "Посмотри, как события распределены по суткам." },
  ai: { eyebrow: "ИНТЕЛЛЕКТУАЛЬНОЕ ПЛАНИРОВАНИЕ", title: "AI-планировщик", subtitle: "Опиши планы словами или загрузи фото расписания." },
  insights: { eyebrow: "АНАЛИТИКА", title: "Понимание своего времени", subtitle: "Статистика, баланс и закономерности твоего расписания." },
  inbox: { eyebrow: "БЫСТРЫЕ ЗАПИСИ", title: "Входящие задачи", subtitle: "Собери идеи здесь, а время назначь позже." },
  settings: { eyebrow: "ПЕРСОНАЛИЗАЦИЯ", title: "Настройки", subtitle: "Предпочтения, уведомления, импорт и резервная копия." }
};

function tasksOnDate(tasks: Task[], date: string) {
  const day = new Date(date + "T12:00:00");
  return tasks.filter(task => {
    if (task.inbox || task.date > date) return false;
    if (task.date === date) return true;
    if (task.recurrence === "daily") return true;
    if (task.recurrence === "weekly") {
      return new Date(task.date + "T12:00:00").getDay() === day.getDay();
    }
    return false;
  }).sort((a, b) => a.start - b.start);
}

function formatDayChip(date: string) {
  return new Date(date + "T12:00:00").toLocaleDateString("ru-RU", { weekday: "short", day: "numeric" });
}
function formatMonth(date: string) {
  return new Date(date + "T12:00:00").toLocaleDateString("ru-RU", { month: "long", year: "numeric" });
}
function daysInMonth(date: string) {
  const d = new Date(date + "T12:00:00");
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}
function firstWeekOffset(date: string) {
  const d = new Date(date + "T12:00:00");
  return (new Date(d.getFullYear(), d.getMonth(), 1).getDay() + 6) % 7;
}

export default function FeatureViews(props: Props) {
  if (props.view === "calendar") return <CalendarView {...props} />;
  if (props.view === "timeline") return <TimelineView {...props} />;
  if (props.view === "ai") return <AIPlannerView {...props} />;
  if (props.view === "insights") return <InsightsView {...props} />;
  if (props.view === "inbox") return <InboxView {...props} />;
  if (props.view === "settings") return <SettingsView {...props} />;
  return null;
}

function FeatureHeader({ view }: { view: Exclude<AppView, "schedule"> }) {
  const header = VIEW_HEADINGS[view];
  return <section className="feature-intro"><div><div className="eyebrow">{header.eyebrow}</div><h1>{header.title}</h1><p className="subtitle">{header.subtitle}</p></div></section>;
}

function CalendarView(props: Props) {
  const [mode, setMode] = useState<"month" | "week">("month");
  const base = new Date(props.selectedDate + "T12:00:00");
  const monthStart = `${base.getFullYear()}-${pad(base.getMonth() + 1)}-01`;
  const monthGridStart = addDaysToDate(monthStart, -firstWeekOffset(props.selectedDate));
  const mondayOffset = (base.getDay() + 6) % 7;
  const weekStart = addDaysToDate(props.selectedDate, -mondayOffset);
  const dates = mode === "month"
    ? Array.from({ length: 42 }, (_, i) => addDaysToDate(monthGridStart, i))
    : Array.from({ length: 7 }, (_, i) => addDaysToDate(weekStart, i));
  const currentTasks = tasksOnDate(props.tasks, props.selectedDate);

  return <div className="feature-page">
    <FeatureHeader view="calendar" />
    <section className="panel feature-panel calendar-panel">
      <div className="feature-toolbar">
        <div className="calendar-title-row">
          <button className="icon-button" onClick={() => props.setSelectedDate(addDaysToDate(props.selectedDate, mode === "week" ? -7 : -daysInMonth(props.selectedDate)))} aria-label="Предыдущий период">‹</button>
          <h2>{formatMonth(props.selectedDate)}</h2>
          <button className="icon-button" onClick={() => props.setSelectedDate(addDaysToDate(props.selectedDate, mode === "week" ? 7 : daysInMonth(props.selectedDate)))} aria-label="Следующий период">›</button>
        </div>
        <div className="feature-actions">
          <div className="segmented-control"><button className={mode === "month" ? "active" : ""} onClick={() => setMode("month")}>Месяц</button><button className={mode === "week" ? "active" : ""} onClick={() => setMode("week")}>Неделя</button></div>
          <button className="outline-button" onClick={() => props.setSelectedDate(todayString())}>Сегодня</button>
          <button className="primary-button" onClick={() => props.onCreateTask(props.selectedDate)}>＋ Задача</button>
        </div>
      </div>
      <div className="calendar-grid">
        {["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map(day => <div className="calendar-weekday" key={day}>{day}</div>)}
        {dates.map(date => {
          const dateTasks = tasksOnDate(props.tasks, date);
          const inMonth = date.slice(0, 7) === props.selectedDate.slice(0, 7);
          return <button key={date} className={`calendar-cell ${date === props.selectedDate ? "selected" : ""} ${!inMonth && mode === "month" ? "outside-month" : ""} ${date === todayString() ? "is-today" : ""}`} onClick={() => { props.setSelectedDate(date); if (mode === "week") props.onOpenDay(date); }}>
            <span className="calendar-number">{Number(date.slice(-2))}</span>
            <span className="calendar-dots">{dateTasks.slice(0, 4).map(task => <i key={task.id} style={{ background: task.colorHex || COLORS[task.category] }} />)}</span>
            <span className="calendar-task-count">{dateTasks.length ? `${dateTasks.length} ${dateTasks.length === 1 ? "дело" : "дела"}` : ""}</span>
            {mode === "week" && <span className="calendar-week-tasks">{dateTasks.slice(0, 3).map(task => <span key={task.id} style={{ borderLeftColor: task.colorHex || COLORS[task.category] }}>{timeText(task.start, props.clockFormat)} {task.title}</span>)}</span>}
          </button>;
        })}
      </div>
    </section>
    <section className="panel feature-panel">
      <div className="panel-heading"><div><div className="eyebrow">ВЫБРАННЫЙ ДЕНЬ</div><h2>{dateText(props.selectedDate)}</h2></div><button className="primary-button" onClick={() => props.onOpenDay(props.selectedDate)}>Открыть расписание →</button></div>
      {currentTasks.length === 0 ? <div className="feature-empty">На этот день пока ничего не запланировано.</div> : <div className="feature-task-list">{currentTasks.map(task => <TaskRow key={task.id} task={task} clockFormat={props.clockFormat} onEdit={props.onEditTask} onToggleDone={props.onToggleDone} />)}</div>}
    </section>
  </div>;
}

function TaskRow({ task, clockFormat, onEdit, onToggleDone }: { task: Task; clockFormat: ClockFormat; onEdit: (task: Task) => void; onToggleDone: (id: string) => void }) {
  return <article className={task.done ? "feature-task-row completed" : "feature-task-row"}>
    <button className={task.done ? "task-check checked" : "task-check"} onClick={() => onToggleDone(task.id)} aria-label={task.done ? "Снять отметку выполнения" : "Отметить выполненной"}>{task.done ? "✓" : ""}</button>
    <button className="feature-task-main" onClick={() => onEdit(task)}>
      <span className="feature-task-time">{timeText(task.start, clockFormat)} — {timeText(task.start + task.duration, clockFormat)}</span>
      <strong>{task.emoji || CATEGORY_EMOJI[task.category]} {task.title}</strong>
      <span className="feature-task-meta"><i style={{ background: task.colorHex || COLORS[task.category] }} />{task.category}{task.participants?.length ? ` · ${task.participants.join(", ")}` : ""}</span>
    </button>
  </article>;
}

function TimelineView(props: Props) {
  const dayTasks = tasksOnDate(props.tasks, props.selectedDate);
  const allDayTasks = dayTasks.filter(task => task.start + task.duration > 0);
  return <div className="feature-page">
    <FeatureHeader view="timeline" />
    <section className="panel feature-panel">
      <div className="feature-toolbar">
        <div className="calendar-title-row"><button className="icon-button" onClick={() => props.setSelectedDate(addDaysToDate(props.selectedDate, -1))}>‹</button><h2>{dateText(props.selectedDate)}</h2><button className="icon-button" onClick={() => props.setSelectedDate(addDaysToDate(props.selectedDate, 1))}>›</button></div>
        <div className="feature-actions"><button className="outline-button" onClick={() => props.setSelectedDate(todayString())}>Сегодня</button><button className="primary-button" onClick={() => props.onCreateTask(props.selectedDate)}>＋ Задача</button></div>
      </div>
      <div className="timeline-layout">
        <div className="timeline-hours">{Array.from({ length: 24 }, (_, hour) => <div key={hour} className="timeline-hour">{timeText(hour * 60, props.clockFormat)}</div>)}</div>
        <div className="timeline-board">
          {Array.from({ length: 24 }, (_, hour) => <div key={hour} className="timeline-hour-line" style={{ top: `${hour / 24 * 100}%` }} />)}
          {allDayTasks.map(task => <button key={task.id} className="timeline-event" style={{ top: `${task.start / 1440 * 100}%`, height: `${Math.max(1.1, task.duration / 1440 * 100)}%`, borderLeftColor: task.colorHex || COLORS[task.category], background: (task.colorHex || COLORS[task.category]) + "20" }} onClick={() => props.onEditTask(task)}>
            <strong>{task.emoji || CATEGORY_EMOJI[task.category]} {task.title}</strong>
            <span>{timeText(task.start, props.clockFormat)} · {task.duration >= 60 ? `${Math.floor(task.duration / 60)} ч${task.duration % 60 ? ` ${task.duration % 60} мин` : ""}` : `${task.duration} мин`}</span>
          </button>)}
          {props.selectedDate === todayString() && <div className="timeline-now" style={{ top: `${(new Date().getHours() * 60 + new Date().getMinutes()) / 1440 * 100}%` }}><i />Сейчас</div>}
        </div>
      </div>
      {dayTasks.length === 0 && <div className="feature-empty">Добавь первую задачу, чтобы увидеть её на временной шкале.</div>}
    </section>
  </div>;
}

async function fileToDataUrl(file: File): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Не удалось прочитать изображение."));
    reader.onerror = () => reject(new Error("Не удалось прочитать изображение."));
    reader.readAsDataURL(file);
  });
}

function AIPlannerView(props: Props) {
  const [prompt, setPrompt] = useState("");
  const [provider, setProvider] = useState<"groq" | "gemini">("groq");
  const [images, setImages] = useState<string[]>([]);
  const [imageNames, setImageNames] = useState<string[]>([]);
  const [parsed, setParsed] = useState<ParsedTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [configured, setConfigured] = useState({ groqConfigured: false, geminiConfigured: false });

  useEffect(() => { fetch("/api/ai").then(r => r.ok ? r.json() : null).then(v => v && setConfigured(v)).catch(() => undefined); }, []);

  const handleImages = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length) return;
    if (files.some(file => !file.type.startsWith("image/"))) { setError("Можно загружать только изображения."); return; }
    if (files.some(file => file.size > 4 * 1024 * 1024)) { setError("Каждое изображение должно быть меньше 4 МБ."); return; }
    const remaining = Math.max(0, 3 - images.length);
    const accepted = files.slice(0, remaining);
    try {
      const data = await Promise.all(accepted.map(fileToDataUrl));
      setImages(old => [...old, ...data].slice(0, 3));
      setImageNames(old => [...old, ...accepted.map(file => file.name)].slice(0, 3));
      setError("");
    } catch (err) { setError(err instanceof Error ? err.message : "Ошибка загрузки изображения."); }
  };

  const parse = async () => {
    setLoading(true); setError(""); setStatus(""); setParsed([]);
    try {
      const response = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: images.length ? "parse-schedule-images" : "parse-schedule",
          prompt: prompt || "Распознай расписание из изображения, используй дату выбранного дня, если дата не указана.",
          date: props.selectedDate,
          model: images.length ? "gemini" : provider,
          images
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "AI-сервис не ответил.");
      const values = Array.isArray(data.tasks) ? data.tasks : [];
      const normalized = values.map((item: Record<string, unknown>) => {
        const category = normalizeCategory(item.category);
        const rawStart = Number(item.startTime ?? 540);
        const rawEnd = Number(item.endTime ?? rawStart + 60);
        return {
          title: String(item.title ?? "Задача"),
          description: String(item.description ?? ""),
          startTime: Math.max(0, Math.min(1439, rawStart)),
          endTime: Math.max(Math.min(1440, rawStart + 5), Math.min(1440, rawEnd)),
          date: /^\d{4}-\d{2}-\d{2}$/.test(String(item.date ?? "")) ? String(item.date) : props.selectedDate,
          emoji: String(item.emoji ?? CATEGORY_EMOJI[category]),
          colorHex: /^#[0-9a-f]{6}$/i.test(String(item.colorHex ?? "")) ? String(item.colorHex) : COLORS[category],
          category
        } satisfies ParsedTask;
      }).filter((task: ParsedTask) => task.title.trim() && task.endTime > task.startTime);
      if (!normalized.length) throw new Error("Не удалось найти задачи. Уточни текст или загрузи более чёткое фото.");
      setParsed(normalized);
      setStatus(images.length ? "Изображения обработаны Gemini." : `Разобрано через ${provider === "groq" ? "Groq" : "Gemini"}.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Не удалось разобрать расписание.";
      if (!images.length) {
        const fallback = parseScheduleLocally(prompt, props.selectedDate);
        if (fallback.length) {
          setParsed(fallback);
          setStatus("Использован локальный разбор фраз и времени. Для полноценного AI добавь API-ключ в .env.local.");
          setError("");
        } else {
          setError(message + " Локальный разбор не нашёл времени в тексте.");
        }
      } else {
        setError(message);
      }
    } finally { setLoading(false); }
  };

  const addParsedTasks = () => {
    const added = parsed.map(item => normalizeTask({
      id: makeId(), title: item.title, date: item.date, start: item.startTime,
      duration: item.endTime - item.startTime, category: item.category, done: false,
      note: item.description ?? "", emoji: item.emoji, colorHex: item.colorHex,
      participants: item.participants ?? [], recurrence: "none", inbox: false,
      updatedAt: Date.now(), source: "ai"
    }, props.selectedDate)).filter((task): task is Task => Boolean(task));
    props.setTasks(old => [...old, ...added]);
    props.setSelectedDate(added[0]?.date ?? props.selectedDate);
    props.setNotice(`Добавлено задач: ${added.length}.`);
    setParsed([]); setPrompt(""); setImages([]); setImageNames([]); setStatus("");
  };

  return <div className="feature-page">
    <FeatureHeader view="ai" />
    <div className="ai-layout">
      <section className="panel feature-panel ai-input-panel">
        <div className="panel-heading"><div><div className="eyebrow">ОПИШИ СВОИ ПЛАНЫ</div><h2>Из текста — в расписание</h2></div><span className="ai-star">✦</span></div>
        <textarea className="ai-prompt" value={prompt} onChange={event => setPrompt(event.target.value)} placeholder={"Например: завтра встреча в 10:00 на час, обед в 13:00 на 45 минут и тренировка в 18:30 на полтора часа."} rows={6} />
        <div className="ai-prompt-examples"><span>Или попробуй:</span><button onClick={() => setPrompt("Завтра работа с 9:00 на 3 часа, обед в 13:00 на 45 минут, тренировка в 18:30 на 90 минут")}>Рабочий день</button><button onClick={() => setPrompt("В понедельник созвон в 10 утра на 30 минут и зал в 19:00 на час")}>Два события</button></div>
        <div className="ai-provider-row">
          <label className="field-label">AI-модель<select value={provider} onChange={event => setProvider(event.target.value as "groq" | "gemini")}><option value="groq">Groq · быстрый разбор текста</option><option value="gemini">Gemini · расширенный разбор</option></select></label>
          <div className="provider-status"><span className={configured[provider === "groq" ? "groqConfigured" : "geminiConfigured"] ? "status-dot" : "status-dot status-dot-muted"} />{configured[provider === "groq" ? "groqConfigured" : "geminiConfigured"] ? "Ключ настроен" : "API-ключ не настроен"}</div>
        </div>
        <div className="ai-image-upload">
          <div><strong>Фото расписания или заметок</strong><p>До 3 изображений, до 4 МБ каждое. Для фото используется Gemini.</p></div>
          <label className="outline-button">＋ Добавить фото<input type="file" accept="image/png,image/jpeg,image/webp,image/heic,image/heif" multiple onChange={handleImages} hidden disabled={images.length >= 3} /></label>
        </div>
        {images.length > 0 && <div className="ai-image-list">{images.map((image, index) => <div className="ai-image-thumb" key={image}><img src={image} alt={imageNames[index] ?? `Изображение ${index + 1}`} /><span>{imageNames[index]}</span><button onClick={() => { setImages(old => old.filter((_, i) => i !== index)); setImageNames(old => old.filter((_, i) => i !== index)); }} aria-label="Удалить изображение">×</button></div>)}</div>}
        {error && <div className="feature-error" role="alert">{error}</div>}
        {status && <div className="feature-status">{status}</div>}
        <button className="primary-button ai-parse-button" onClick={parse} disabled={loading || (!prompt.trim() && !images.length)}>{loading ? "Разбираю расписание…" : "✦ Разобрать расписание"}</button>
        <p className="subtle-note">Текст без ключа AI обрабатывается локальным правиловым разбором. Фото требуют настроенного GEMINI_API_KEY. API-ключи остаются на сервере и не передаются браузеру.</p>
      </section>
      <section className="panel feature-panel ai-preview-panel">
        <div className="panel-heading"><div><div className="eyebrow">ПЕРЕД ДОБАВЛЕНИЕМ</div><h2>Предпросмотр <span className="count-badge">{parsed.length}</span></h2></div></div>
        {!parsed.length ? <div className="feature-empty ai-empty"><div className="empty-art">✦</div><h3>Здесь появятся твои задачи</h3><p>Проверь дату, время и название, затем добавь всё в календарь.</p></div> : <div className="ai-parsed-list">{parsed.map((task, index) => <article key={index} className="ai-parsed-task"><i style={{ background: task.colorHex }} /><div className="ai-parsed-main"><strong>{task.emoji} {task.title}</strong><span>{formatDayChip(task.date)} · {timeText(task.startTime, props.clockFormat)}–{timeText(task.endTime, props.clockFormat)}</span>{task.description && <p>{task.description}</p>}</div><button className="icon-button" onClick={() => setParsed(old => old.filter((_, i) => i !== index))} aria-label="Убрать из списка">×</button></article>)}
          <button className="primary-button add-parsed-button" onClick={addParsedTasks}>＋ Добавить {parsed.length} {parsed.length === 1 ? "задачу" : "задач"} в расписание</button></div>}
      </section>
    </div>
  </div>;
}

function InsightsView(props: Props) {
  const [range, setRange] = useState<"day" | "week" | "month">("week");
  const [aiInsights, setAiInsights] = useState<string[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");
  const [aiReady, setAiReady] = useState(false);
  useEffect(() => { fetch("/api/ai").then(r => r.ok ? r.json() : null).then(value => setAiReady(Boolean(value?.groqConfigured || value?.geminiConfigured))).catch(() => undefined); }, []);

  const startDate = range === "day" ? props.selectedDate : range === "week" ? addDaysToDate(props.selectedDate, -((new Date(props.selectedDate + "T12:00:00").getDay() + 6) % 7)) : props.selectedDate.slice(0, 7) + "-01";
  const endDate = range === "day" ? props.selectedDate : range === "week" ? addDaysToDate(startDate, 6) : `${props.selectedDate.slice(0, 7)}-${daysInMonth(props.selectedDate)}`;
  const events = props.tasks.filter(task => !task.inbox && task.date >= startDate && task.date <= endDate);
  const dailyEvents = tasksOnDate(props.tasks, props.selectedDate);
  const totalMinutes = events.reduce((sum, task) => sum + task.duration, 0);
  const completed = events.filter(task => task.done).length;
  const categoryMinutes = CATEGORIES.map(category => ({ category, minutes: events.filter(task => task.category === category).reduce((sum, task) => sum + task.duration, 0), color: COLORS[category] }));
  const totalCategoryMinutes = categoryMinutes.reduce((sum, item) => sum + item.minutes, 0);
  let percentage = 0;
  const conicStops = categoryMinutes.map(item => {
    const start = percentage;
    percentage += totalCategoryMinutes ? item.minutes / totalCategoryMinutes * 100 : 0;
    return `${item.color} ${start}% ${percentage}%`;
  }).join(", ");
  const hourIntensity = Array.from({ length: 24 }, (_, hour) => events.filter(task => {
    const start = Math.max(hour * 60, task.start);
    const end = Math.min((hour + 1) * 60, task.start + task.duration);
    return start < end;
  }).reduce((sum, task) => sum + Math.max(0, Math.min((hour + 1) * 60, task.start + task.duration) - Math.max(hour * 60, task.start)), 0));
  const workMinutes = categoryMinutes.find(item => item.category === "Работа")?.minutes ?? 0;
  const personalMinutes = totalMinutes - workMinutes;
  const focusBlocks = dailyEvents.filter(task => task.category === "Работа").sort((a, b) => a.start - b.start).reduce((count, task, index, work) => {
    if (index === 0 || task.start - (work[index - 1].start + work[index - 1].duration) > 10) return count + 1;
    return count;
  }, 0);
  const localInsights = useMemo(() => {
    const result: string[] = [];
    if (!events.length) return ["Добавь несколько задач — тогда появятся закономерности в использовании времени.", "Попробуй отметить длительность и категорию у каждой записи.", "Оставляй в календаре свободные интервалы для отдыха.", "Проверяй план в конце дня и корректируй длительность задач.", "Используй входящие для идей, которым ещё не назначено время."];
    const work = events.filter(task => task.category === "Работа").reduce((sum, task) => sum + task.duration, 0);
    const rest = events.filter(task => task.category === "Отдых").reduce((sum, task) => sum + task.duration, 0);
    const busiest = [...events].sort((a, b) => b.duration - a.duration)[0];
    result.push(work > totalMinutes * 0.7 ? "Большая часть запланированного времени приходится на работу. Оставь буфер для перерывов." : "Рабочие и личные дела распределены без явного перекоса по длительности.");
    result.push(rest < 30 ? "В выбранном периоде почти нет времени на отдых. Добавь короткие паузы в план." : `В расписании заложено ${Math.round(rest / 60 * 10) / 10} ч на отдых.`);
    result.push(`${completed} из ${events.length} задач отмечены выполненными в выбранном периоде.`);
    if (busiest) result.push(`Самый длинный блок — «${busiest.title}» (${Math.round(busiest.duration / 6) / 10} ч). Проверь, нужен ли перерыв внутри него.`);
    result.push(focusBlocks > 2 ? `Сегодня запланировано ${focusBlocks} отдельных рабочих блока. Между ними можно группировать похожие дела.` : "Объединяй похожие рабочие задачи в непрерывные блоки, чтобы меньше переключаться.");
    return result.slice(0, 5);
  }, [events, totalMinutes, completed, focusBlocks]);
  const insights = aiInsights.length ? aiInsights : localInsights;

  const askAI = async () => {
    setAiLoading(true); setAiError("");
    try {
      const response = await fetch("/api/ai", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "insights", model: "groq", date: props.selectedDate, tasks: events })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "AI-анализ недоступен.");
      setAiInsights(Array.isArray(payload.insights) ? payload.insights.slice(0, 5).map(String) : []);
      if (!Array.isArray(payload.insights) || !payload.insights.length) throw new Error("AI не вернул список инсайтов.");
    } catch (err) { setAiError(err instanceof Error ? err.message : "Не удалось получить AI-инсайты."); }
    finally { setAiLoading(false); }
  };

  return <div className="feature-page">
    <FeatureHeader view="insights" />
    <div className="insights-range-row"><div className="segmented-control"><button className={range === "day" ? "active" : ""} onClick={() => setRange("day")}>День</button><button className={range === "week" ? "active" : ""} onClick={() => setRange("week")}>Неделя</button><button className={range === "month" ? "active" : ""} onClick={() => setRange("month")}>Месяц</button></div><span className="muted-text">{formatDayChip(startDate)} — {formatDayChip(endDate)}</span><button className="outline-button" onClick={askAI} disabled={aiLoading || !aiReady}>{aiLoading ? "Анализирую…" : "✦ AI-инсайты"}</button></div>
    {aiError && <div className="feature-error">{aiError} Ниже показан локальный анализ по статистике задач.</div>}
    <div className="stats-grid">
      <StatCard label="Задачи" value={String(events.length)} detail={`${completed} выполнено`} />
      <StatCard label="Запланировано" value={`${Math.floor(totalMinutes / 60)}ч ${totalMinutes % 60}м`} detail="суммарная длительность" />
      <StatCard label="Доля выполнения" value={events.length ? `${Math.round(completed / events.length * 100)}%` : "—"} detail="по отметкам выполнения" />
      <StatCard label="Свободное время" value={`${Math.floor(Math.max(0, (range === "day" ? 1440 : range === "week" ? 10080 : daysInMonth(props.selectedDate) * 1440) - totalMinutes) / 60)}ч`} detail="оценка по календарному времени" />
    </div>
    <div className="insights-grid">
      <section className="panel feature-panel chart-panel"><div className="panel-heading"><div><div className="eyebrow">СТРУКТУРА ВРЕМЕНИ</div><h2>По категориям</h2></div></div>
        <div className="donut-layout"><div className="category-donut" style={{ background: totalCategoryMinutes ? `conic-gradient(${conicStops})` : "var(--line)" }}><div><strong>{Math.round(totalMinutes / 60 * 10) / 10}</strong><span>часов</span></div></div><div className="chart-legend">{categoryMinutes.map(item => <div key={item.category}><i style={{ background: item.color }} /><span>{item.category}</span><strong>{Math.round(item.minutes / 60 * 10) / 10} ч</strong></div>)}</div></div>
      </section>
      <section className="panel feature-panel chart-panel"><div className="panel-heading"><div><div className="eyebrow">БАЛАНС</div><h2>Работа и остальное</h2></div></div>
        <div className="balance-insight"><div className="balance-gauge" style={{ background: `conic-gradient(#6266e9 0 ${totalMinutes ? workMinutes / totalMinutes * 100 : 0}%, #20a68a ${totalMinutes ? workMinutes / totalMinutes * 100 : 0}% 100%)` }}><div><strong>{totalMinutes ? Math.round(workMinutes / totalMinutes * 100) : 0}%</strong><span>работа</span></div></div><div className="balance-stats"><div><i style={{ background: COLORS["Работа"] }} /><span>Работа</span><strong>{Math.round(workMinutes / 60 * 10) / 10} ч</strong></div><div><i style={{ background: COLORS["Личное"] }} /><span>Остальное</span><strong>{Math.round(personalMinutes / 60 * 10) / 10} ч</strong></div><p>Баланс отражает только записи, которые ты внёс в расписание.</p></div></div>
      </section>
      <section className="panel feature-panel chart-panel"><div className="panel-heading"><div><div className="eyebrow">РИТМ СУТОК</div><h2>Занятость по часам</h2></div></div>
        <div className="energy-heatmap">{hourIntensity.map((minutes, hour) => <div key={hour} className="energy-hour"><div className="energy-cell" title={`${pad(hour)}:00 — ${minutes} мин занято`} style={{ opacity: minutes ? 0.18 + Math.min(1, minutes / 60) * 0.82 : 0.12, background: minutes ? "#6266e9" : "var(--line)" }} /><span>{hour % 3 === 0 ? pad(hour) : ""}</span></div>)}</div><p className="chart-footnote">Цвет ярче там, где суммарно запланировано больше времени.</p>
      </section>
      <section className="panel feature-panel chart-panel"><div className="panel-heading"><div><div className="eyebrow">ФОКУС</div><h2>Рабочие блоки дня</h2></div><span className="count-badge">{focusBlocks}</span></div>
        {dailyEvents.filter(task => task.category === "Работа").length ? <div className="focus-list">{dailyEvents.filter(task => task.category === "Работа").sort((a, b) => a.start - b.start).map(task => <div className="focus-row" key={task.id}><i style={{ background: task.colorHex || COLORS[task.category] }} /><div><strong>{task.title}</strong><span>{timeText(task.start, props.clockFormat)} · {Math.round(task.duration / 6) / 10} ч</span></div></div>)}</div> : <div className="feature-empty compact">На выбранный день нет рабочих блоков.</div>}
      </section>
    </div>
    <section className="panel feature-panel insight-list-panel"><div className="panel-heading"><div><div className="eyebrow">{aiInsights.length ? "AI-АНАЛИЗ" : "ПО ДАННЫМ РАСПИСАНИЯ"}</div><h2>Что можно заметить</h2></div><span className={aiReady ? "mini-status" : "mini-status muted"}>{aiReady ? "AI доступен" : "локально"}</span></div><div className="insight-cards">{insights.map((insight, index) => <div className="insight-item" key={index}><span>{pad(index + 1)}</span><p>{insight}</p></div>)}</div></section>
  </div>;
}

function StatCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="panel stat-card"><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>;
}

function InboxView(props: Props) {
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const inbox = props.tasks.filter(task => task.inbox).sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  const addInbox = () => {
    if (!title.trim()) return;
    const category: Category = "Личное";
    const normalized = normalizeTask({
      id: makeId(), title: title.trim(), note: note.trim(), date: props.selectedDate,
      start: 540, duration: 60, category, done: false, inbox: true,
      emoji: CATEGORY_EMOJI[category], colorHex: COLORS[category], updatedAt: Date.now()
    });
    if (normalized) props.setTasks(old => [...old, normalized]);
    setTitle(""); setNote("");
    props.setNotice("Задача сохранена во входящих.");
  };
  return <div className="feature-page"><FeatureHeader view="inbox" />
    <div className="inbox-layout">
      <section className="panel feature-panel inbox-create"><div className="eyebrow">БЫСТРАЯ ЗАПИСЬ</div><h2>Поймай идею, не отвлекаясь</h2><label className="field-label">Что нужно сделать?<input value={title} onChange={event => setTitle(event.target.value)} onKeyDown={event => { if (event.key === "Enter") addInbox(); }} placeholder="Позвонить, купить, не забыть…" maxLength={100} /></label><label className="field-label">Заметка<textarea value={note} onChange={event => setNote(event.target.value)} rows={3} placeholder="Детали — по желанию" maxLength={300} /></label><button className="primary-button" onClick={addInbox} disabled={!title.trim()}>＋ Входящая задача</button><p className="subtle-note">У входящей задачи нет закреплённого времени. Она не занимает место на циферблате, пока ты не добавишь её в расписание.</p></section>
      <section className="panel feature-panel inbox-list-panel"><div className="panel-heading"><div><div className="eyebrow">ЕЩЁ НЕ РАСПЛАНИРОВАНО</div><h2>Входящие <span className="count-badge">{inbox.length}</span></h2></div></div>
        {!inbox.length ? <div className="feature-empty"><div className="empty-art">＋</div><h3>Пока всё разобрано</h3><p>Новые дела можно записывать сюда, а разбирать позже.</p></div> : <div className="inbox-task-list">{inbox.map(task => <article className="inbox-task" key={task.id}><span className="inbox-task-icon">{task.emoji || "✎"}</span><div className="inbox-task-main"><strong>{task.title}</strong>{task.note && <p>{task.note}</p>}<small>Добавлено {task.date}</small></div><div className="inbox-task-actions"><button className="outline-button" onClick={() => props.onEditTask(task)}>Запланировать</button><button className="icon-button" onClick={() => props.onDeleteTask(task.id)} aria-label="Удалить">×</button></div></article>)}</div>}
      </section>
    </div>
  </div>;
}

function SettingsView(props: Props) {
  const [notificationsSupported, setNotificationsSupported] = useState(false);
  const [session, setSession] = useState<CloudSession | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [authLoading, setAuthLoading] = useState(false);
  const [authMessage, setAuthMessage] = useState("");
  const [authError, setAuthError] = useState("");
  const [clearConfirm, setClearConfirm] = useState(false);
  const [syncLoading, setSyncLoading] = useState(false);
  const [supabaseConfigured, setSupabaseConfigured] = useState(false);
  const storageSize = useMemo(() => {
    if (typeof window === "undefined") return "—";
    let total = 0;
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (key) total += key.length + (localStorage.getItem(key)?.length ?? 0);
    }
    return total > 1024 * 1024 ? `${(total / 1024 / 1024).toFixed(2)} МБ` : `${(total / 1024).toFixed(1)} КБ`;
  }, [props.tasks.length]);
  useEffect(() => {
    setNotificationsSupported(typeof window !== "undefined" && "Notification" in window);
    setSession(getSavedSession());
    setSupabaseConfigured(Boolean(getSupabaseConfig()));
  }, []);

  const enableNotifications = async () => {
    if (!("Notification" in window)) {
      props.setNotice("Этот браузер не поддерживает уведомления.");
      return;
    }
    const permission = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
    const enabled = permission === "granted";
    props.setNotificationsEnabled(enabled);
    props.setNotice(enabled ? "Уведомления разрешены. Напоминания работают, пока приложение открыто." : "Разрешение на уведомления не получено.");
  };

  const handleAuth = async () => {
    setAuthLoading(true); setAuthError(""); setAuthMessage("");
    try {
      if (authMode === "login") {
        const value = await signInWithPassword(email.trim(), password);
        setSession(value); setAuthMessage("Вход выполнен. Теперь можно синхронизировать расписание.");
      } else {
        const value = await signUpWithPassword(email.trim(), password);
        if (value.session) setSession(value.session);
        setAuthMessage(value.message);
      }
    } catch (error) { setAuthError(error instanceof Error ? error.message : "Не удалось выполнить запрос авторизации."); }
    finally { setAuthLoading(false); }
  };

  const syncNow = async () => {
    if (!session) return;
    setSyncLoading(true); setAuthError(""); setAuthMessage("");
    try {
      const result = await syncTasksWithCloud(session, props.tasks, props.deletedAt);
      setSession(result.session); saveSession(result.session);
      props.setTasks(result.tasks);
      props.setDeletedAt(result.deletedAt);
      setAuthMessage(`Синхронизация завершена: ${result.tasks.length} задач в объединённом расписании.`);
      props.setNotice("Облачная синхронизация завершена.");
    } catch (error) { setAuthError(error instanceof Error ? error.message : "Ошибка облачной синхронизации."); }
    finally { setSyncLoading(false); }
  };

  const exportIcs = () => {
    const blob = new Blob([buildIcs(props.tasks)], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a"); link.href = url; link.download = `dayrhythm-${todayString()}.ics`; link.click();
    URL.revokeObjectURL(url);
    props.setNotice("Календарь экспортирован в .ics.");
  };

  const importIcs = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const imported = parseIcs(await file.text()).map(task => ({ ...task, id: makeId(), updatedAt: Date.now() }));
      if (!imported.length) throw new Error("В файле не найдено событий формата VEVENT.");
      props.setTasks(old => [...old, ...imported]);
      props.setNotice(`Импортировано событий из календаря: ${imported.length}.`);
    } catch (error) { props.setNotice(error instanceof Error ? `Не удалось импортировать .ics: ${error.message}` : "Не удалось импортировать календарь."); }
  };

  const clearLocalData = () => {
    if (!clearConfirm) { setClearConfirm(true); return; }
    props.setTasks([]);
    props.setDeletedAt({});
    if (typeof window !== "undefined") {
      localStorage.removeItem("dayrhythm.tasks.v1");
      localStorage.removeItem("dayrhythm.deleted.v1");
    }
    setClearConfirm(false);
    props.setNotice("Локальный список задач очищен.");
  };

  return <div className="feature-page"><FeatureHeader view="settings" />
    <div className="settings-grid">
      <section className="panel feature-panel settings-section"><div className="panel-heading"><div><div className="eyebrow">ВИД И ВРЕМЯ</div><h2>Предпочтения</h2></div></div>
        <label className="setting-row"><span><strong>Тема оформления</strong><small>Светлая или тёмная палитра приложения.</small></span><select value={props.theme} onChange={event => props.setTheme(event.target.value as "light" | "dark")}><option value="light">Светлая</option><option value="dark">Тёмная</option></select></label>
        <label className="setting-row"><span><strong>Формат времени</strong><small>Время в карточках, календаре и ленте.</small></span><select value={props.clockFormat} onChange={event => props.setClockFormat(event.target.value as ClockFormat)}><option value="24h">24 часа · 18:30</option><option value="12h">12 часов · 6:30 PM</option></select></label>
        <label className="setting-row"><span><strong>Режим циферблата</strong><small>Влияет на отображение кругового плана.</small></span><select value={props.dialMode} onChange={event => props.setDialMode(event.target.value as DialMode)}><option value="24h">Полные сутки</option><option value="day">День · 06–18</option><option value="night">Ночь · 18–06</option><option value="auto">Авто по текущему времени</option></select></label>
      </section>
      <section className="panel feature-panel settings-section"><div className="panel-heading"><div><div className="eyebrow">НАПОМИНАНИЯ</div><h2>Уведомления</h2></div><span className={props.notificationsEnabled ? "mini-status" : "mini-status muted"}>{props.notificationsEnabled ? "Включены" : "Выключены"}</span></div>
        <p className="settings-description">Разреши браузеру показывать напоминания, заданные у задач. Чтобы напоминание сработало, приложение должно оставаться открытым; браузерные уведомления не равны системным iOS-напоминаниям.</p>
        {!notificationsSupported && <div className="feature-error">Текущий браузер не поддерживает Notification API.</div>}
        <button className={props.notificationsEnabled ? "outline-button" : "primary-button"} onClick={enableNotifications} disabled={!notificationsSupported}>{props.notificationsEnabled ? "Проверить разрешение" : "Разрешить уведомления"}</button>
      </section>
      <section className="panel feature-panel settings-section"><div className="panel-heading"><div><div className="eyebrow">КАЛЕНДАРЬ</div><h2>Импорт и экспорт</h2></div></div>
        <p className="settings-description">Используй формат .ics для обмена событиями с Apple Calendar, Google Calendar и другими календарями. Веб-версия не получает прямого доступа к календарям устройства.</p>
        <div className="settings-actions"><button className="outline-button" onClick={exportIcs}>Экспорт .ics</button><label className="outline-button">Импорт .ics<input type="file" accept=".ics,text/calendar" hidden onChange={importIcs} /></label></div>
      </section>
      <section className="panel feature-panel settings-section"><div className="panel-heading"><div><div className="eyebrow">ХРАНЕНИЕ</div><h2>Локальные данные</h2></div></div>
        <div className="storage-stats"><div><span>Задачи в браузере</span><strong>{props.tasks.length}</strong></div><div><span>Оценка размера</span><strong>{storageSize}</strong></div></div>
        <p className="settings-description">Данные автоматически сохраняются в localStorage на этом устройстве. Для переноса на другое устройство используй экспорт JSON в верхней панели или облачную синхронизацию ниже.</p>
        <button className="delete-button" onClick={clearLocalData}>{clearConfirm ? "Подтвердить очистку" : "Очистить локальные задачи"}</button>{clearConfirm && <button className="outline-button" onClick={() => setClearConfirm(false)}>Отмена</button>}
      </section>
      <section className="panel feature-panel settings-section cloud-section"><div className="panel-heading"><div><div className="eyebrow">ОБЛАКО · НЕОБЯЗАТЕЛЬНО</div><h2>Аккаунт и синхронизация</h2></div><span className={session ? "mini-status" : "mini-status muted"}>{session ? "Вход выполнен" : "Не подключено"}</span></div>
        {!supabaseConfigured ? <><p className="settings-description">Чтобы включить аккаунт и синхронизацию между устройствами, создай проект Supabase, добавь URL и anon/publishable key в .env.local, затем выполни SQL из <code>supabase/schema.sql</code>. Service Role Key не нужен и не должен попадать в браузер.</p><div className="feature-status">Облачные функции отключены: Supabase не настроен.</div></> :
          session ? <><p className="settings-description">Аккаунт: {session.user.email ?? session.user.id}. Ручная синхронизация объединяет записи по ID и времени последнего изменения.</p><div className="settings-actions"><button className="primary-button" onClick={syncNow} disabled={syncLoading}>{syncLoading ? "Синхронизирую…" : "Синхронизировать сейчас"}</button><button className="outline-button" onClick={async () => { await signOut(); setSession(null); setAuthMessage("Ты вышел из аккаунта."); }}>Выйти</button></div></> :
          <><div className="segmented-control"><button className={authMode === "login" ? "active" : ""} onClick={() => { setAuthMode("login"); setAuthError(""); setAuthMessage(""); }}>Вход</button><button className={authMode === "signup" ? "active" : ""} onClick={() => { setAuthMode("signup"); setAuthError(""); setAuthMessage(""); }}>Регистрация</button></div><label className="field-label">Email<input type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} /></label><label className="field-label">Пароль<input type="password" autoComplete={authMode === "login" ? "current-password" : "new-password"} value={password} onChange={event => setPassword(event.target.value)} minLength={6} /></label><button className="primary-button" onClick={handleAuth} disabled={authLoading || !email.includes("@") || password.length < 6}>{authLoading ? "Отправляю…" : authMode === "login" ? "Войти в аккаунт" : "Создать аккаунт"}</button></>}
        {authError && <div className="feature-error" role="alert">{authError}</div>}{authMessage && <div className="feature-status">{authMessage}</div>}
      </section>
    </div>
  </div>;
}
