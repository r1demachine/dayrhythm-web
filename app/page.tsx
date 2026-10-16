"use client";

import { FormEvent, PointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import FeatureViews from "./components/FeatureViews";
import { CATEGORIES, CATEGORY_EMOJI, COLORS, actualMinuteForDialMinute, addDaysToDate, dateText, makeId, normalizeTask, pad, taskDialSegments, taskOccursOnDate, timeText, todayString } from "@/lib/dayrhythm";
import type { AppView, Category, ClockFormat, DialMode, Recurrence, Task } from "@/lib/dayrhythm";
import { getSavedSession, saveSession, syncTasksWithCloud } from "@/lib/supabase-rest";
import type { DeletedTaskMap } from "@/lib/supabase-rest";

const STORAGE_KEY = "dayrhythm.tasks.v1";
const THEME_KEY = "dayrhythm.theme.v1";
const CLOCK_FORMAT_KEY = "dayrhythm.clock-format.v1";
const DIAL_MODE_KEY = "dayrhythm.dial-mode.v1";
const NOTIFICATIONS_KEY = "dayrhythm.notifications.v1";
const DELETED_KEY = "dayrhythm.deleted.v1";
const polar = (minutes: number, radius: number, cx = 200, cy = 200) => {
  const angle = (minutes / 1440) * Math.PI * 2 - Math.PI / 2;
  // Стабилизируем SVG-атрибуты: сервер и браузер могут чуть различаться в последних знаках Math.sin/cos.
  return {
    x: Number((cx + Math.cos(angle) * radius).toFixed(3)),
    y: Number((cy + Math.sin(angle) * radius).toFixed(3))
  };
};
const sectorPath = (start: number, duration: number, inner: number, outer: number) => {
  const a = polar(start, outer), b = polar(start + duration, outer);
  const c = polar(start + duration, inner), d = polar(start, inner);
  const large = duration > 720 ? 1 : 0;
  return `M ${a.x} ${a.y} A ${outer} ${outer} 0 ${large} 1 ${b.x} ${b.y} L ${c.x} ${c.y} A ${inner} ${inner} 0 ${large} 0 ${d.x} ${d.y} Z`;
};

export default function Home() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedDate, setSelectedDate] = useState(todayString);
  const [ready, setReady] = useState(false);
  const [activeView, setActiveView] = useState<AppView>("schedule");
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [clockFormat, setClockFormat] = useState<ClockFormat>("24h");
  const [dialMode, setDialMode] = useState<DialMode>("24h");
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [deletedAt, setDeletedAt] = useState<DeletedTaskMap>({});
  const [cloudAuthRevision, setCloudAuthRevision] = useState(0);
  const [editing, setEditing] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [start, setStart] = useState("09:00");
  const [duration, setDuration] = useState("60");
  const [category, setCategory] = useState<Category>("Работа");
  const [note, setNote] = useState("");
  const [emoji, setEmoji] = useState("💼");
  const [colorHex, setColorHex] = useState(COLORS["Работа"]);
  const [participants, setParticipants] = useState("");
  const [reminderMinutes, setReminderMinutes] = useState("none");
  const [recurrence, setRecurrence] = useState<Recurrence>("none");
  const [isInboxTask, setIsInboxTask] = useState(false);
  const [filter, setFilter] = useState<"Все" | Category>("Все");
  const [now, setNow] = useState(0);
  const [notice, setNotice] = useState("");
  const dialRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<string | null>(null);
  const dragOriginRef = useRef<{ x: number; y: number } | null>(null);
  const suppressSectorClickRef = useRef(false);
  const autoSyncInFlightRef = useRef(false);
  const lastSyncedSignatureRef = useRef("");

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed: unknown = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          setTasks(parsed.map(value => normalizeTask(value)).filter((value): value is Task => Boolean(value)));
        }
      }
      const savedTheme = localStorage.getItem(THEME_KEY);
      if (savedTheme === "dark" || savedTheme === "light") setTheme(savedTheme);
      const savedClock = localStorage.getItem(CLOCK_FORMAT_KEY);
      if (savedClock === "12h" || savedClock === "24h") setClockFormat(savedClock);
      const savedDial = localStorage.getItem(DIAL_MODE_KEY);
      if (savedDial === "24h" || savedDial === "day" || savedDial === "night" || savedDial === "auto") setDialMode(savedDial);
      setNotificationsEnabled(localStorage.getItem(NOTIFICATIONS_KEY) === "true");
      const savedDeleted = localStorage.getItem(DELETED_KEY);
      if (savedDeleted) {
        const value: unknown = JSON.parse(savedDeleted);
        if (value && typeof value === "object" && !Array.isArray(value)) setDeletedAt(value as DeletedTaskMap);
      }
    } catch { setNotice("Не удалось прочитать сохранённые данные браузера."); }
    setReady(true);
  }, []);
  useEffect(() => {
    if (ready) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
      localStorage.setItem(DELETED_KEY, JSON.stringify(deletedAt));
      localStorage.setItem(THEME_KEY, theme);
      localStorage.setItem(CLOCK_FORMAT_KEY, clockFormat);
      localStorage.setItem(DIAL_MODE_KEY, dialMode);
      localStorage.setItem(NOTIFICATIONS_KEY, String(notificationsEnabled));
    }
  }, [tasks, deletedAt, theme, clockFormat, dialMode, notificationsEnabled, ready]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  useEffect(() => {
    if (!ready) return;
    const signature = JSON.stringify({ tasks, deletedAt });
    if (signature === lastSyncedSignatureRef.current || autoSyncInFlightRef.current) return;
    const session = getSavedSession();
    if (!session) return;
    const timer = window.setTimeout(async () => {
      if (autoSyncInFlightRef.current) return;
      autoSyncInFlightRef.current = true;
      try {
        const result = await syncTasksWithCloud(session, tasks, deletedAt);
        saveSession(result.session);
        lastSyncedSignatureRef.current = JSON.stringify({ tasks: result.tasks, deletedAt: result.deletedAt });
        if (JSON.stringify(tasks) !== JSON.stringify(result.tasks)) setTasks(result.tasks);
        if (JSON.stringify(deletedAt) !== JSON.stringify(result.deletedAt)) setDeletedAt(result.deletedAt);
      } catch {
        // Keep local edits; retry on the next data/auth change or from Settings.
        lastSyncedSignatureRef.current = signature;
        setNotice("Не удалось синхронизировать данные с облаком. Проверь подключение в настройках.");
      } finally {
        autoSyncInFlightRef.current = false;
      }
    }, 900);
    return () => window.clearTimeout(timer);
  }, [tasks, deletedAt, ready, cloudAuthRevision]);
  useEffect(() => {
    const update = () => {
      const d = new Date();
      setNow(d.getHours() * 60 + d.getMinutes());
    };
    update();
    const timer = window.setInterval(update, 30000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!ready || !notificationsEnabled || typeof window === "undefined" || !("Notification" in window) || Notification.permission !== "granted") return;
    const currentDate = todayString();
    const firedKey = "dayrhythm.fired-reminders.v1";
    let fired: Record<string, number> = {};
    try { fired = JSON.parse(localStorage.getItem(firedKey) || "{}") as Record<string, number>; } catch { fired = {}; }
    for (const task of tasks) {
      if (task.inbox || task.reminderMinutes == null || !taskOccursOnDate(task, currentDate)) continue;
      const reminderAt = task.start - task.reminderMinutes;
      if (reminderAt < 0 || now < reminderAt || now >= reminderAt + 1) continue;
      const id = `${currentDate}:${task.id}:${task.reminderMinutes}`;
      if (fired[id]) continue;
      try {
        new Notification(`${task.emoji || CATEGORY_EMOJI[task.category]} ${task.title}`, {
          body: task.reminderMinutes === 0 ? `Начинается сейчас · ${timeText(task.start, clockFormat)}` : `Начнётся через ${task.reminderMinutes} мин · ${timeText(task.start, clockFormat)}`
        });
        fired[id] = Date.now();
      } catch { /* Notification permission can change while the app is open. */ }
    }
    localStorage.setItem(firedKey, JSON.stringify(fired));
  }, [tasks, now, notificationsEnabled, ready, clockFormat]);

  const dayTasks = useMemo(() => tasks.filter(t => taskOccursOnDate(t, selectedDate)).sort((a, b) => a.start - b.start), [tasks, selectedDate]);
  const shownTasks = dayTasks.filter(t => filter === "Все" || t.category === filter);
  const doneCount = dayTasks.filter(t => t.done).length;
  const plannedMinutes = dayTasks.reduce((sum, t) => sum + t.duration, 0);
  const freeMinutes = Math.max(0, 1440 - plannedMinutes);
  const activeTask = dayTasks.find(t => !t.inbox && now >= t.start && now < t.start + t.duration);
  const effectiveDialMode: Exclude<DialMode, "auto"> = dialMode === "auto" ? (now >= 360 && now < 1080 ? "day" : "night") : dialMode;
  const dialHours = effectiveDialMode === "24h"
    ? Array.from({ length: 24 }, (_, hour) => hour)
    : effectiveDialMode === "day"
      ? Array.from({ length: 13 }, (_, index) => 6 + index)
      : [18, 19, 20, 21, 22, 23, 0, 1, 2, 3, 4, 5, 6];
  const nowDialMinute = effectiveDialMode === "24h"
    ? now
    : effectiveDialMode === "day"
      ? (now >= 360 && now <= 1080 ? (now - 360) * 2 : null)
      : (now >= 1080 || now < 360 ? (now >= 1080 ? now - 1080 : now + 360) * 2 : null);
  const changeDate = (delta: number) => {
    const d = new Date(selectedDate + "T12:00:00");
    d.setDate(d.getDate() + delta);
    setSelectedDate(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
  };
  const resetForm = () => {
    setEditing(null); setTitle(""); setStart("09:00"); setDuration("60"); setCategory("Работа"); setNote("");
    setEmoji(CATEGORY_EMOJI["Работа"]); setColorHex(COLORS["Работа"]); setParticipants(""); setReminderMinutes("none");
    setRecurrence("none"); setIsInboxTask(false); setShowForm(false);
  };
  const openNew = (minute?: number, inbox = false) => {
    setEditing(null); setTitle(""); setStart(timeText(minute ?? 540)); setDuration("60"); setCategory("Работа"); setNote("");
    setEmoji(CATEGORY_EMOJI["Работа"]); setColorHex(COLORS["Работа"]); setParticipants(""); setReminderMinutes("none");
    setRecurrence("none"); setIsInboxTask(inbox); setShowForm(true);
  };
  const openEdit = (task: Task) => {
    setEditing(task.id); setTitle(task.title); setStart(timeText(task.start)); setDuration(String(task.duration));
    setCategory(task.category); setNote(task.note); setEmoji(task.emoji || CATEGORY_EMOJI[task.category]);
    setColorHex(task.colorHex || COLORS[task.category]); setParticipants((task.participants || []).join(", "));
    setReminderMinutes(task.reminderMinutes == null ? "none" : String(task.reminderMinutes));
    setRecurrence(task.recurrence || "none"); setIsInboxTask(Boolean(task.inbox)); setShowForm(true);
  };
  const saveTask = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const [h, m] = start.split(":").map(Number);
    const startMinutes = h * 60 + m;
    const length = Math.min(1440 - startMinutes, Math.max(5, Number(duration) || 60));
    if (!title.trim()) return;
    const updatedAt = Date.now();
    const taskFields = {
      title: title.trim(), date: selectedDate, start: startMinutes, duration: length, category,
      note: note.trim(), emoji: emoji.trim() || CATEGORY_EMOJI[category], colorHex,
      participants: participants.split(",").map(value => value.trim()).filter(Boolean).slice(0, 30),
      reminderMinutes: reminderMinutes === "none" ? null : Number(reminderMinutes),
      recurrence, inbox: isInboxTask, updatedAt
    };
    if (editing) {
      setTasks(old => old.map(t => t.id === editing ? { ...t, ...taskFields } : t));
      setDeletedAt(old => { const next = { ...old }; delete next[editing]; return next; });
    } else {
      setTasks(old => [...old, { id: makeId(), ...taskFields, done: false, source: "manual" }]);
    }
    resetForm();
  };
  const toggleDone = (id: string) => setTasks(old => old.map(t => t.id === id ? { ...t, done: !t.done, updatedAt: Date.now() } : t));
  const deleteTask = (id: string) => {
    setDeletedAt(old => ({ ...old, [id]: Date.now() }));
    setTasks(old => old.filter(t => t.id !== id));
  };
  const moveTask = useCallback((id: string, minute: number) => {
    setTasks(old => old.map(t => {
      if (t.id !== id) return t;
      const startMinute = Math.min(1435, Math.max(0, Math.round(minute / 15) * 15));
      return { ...t, start: startMinute, duration: Math.min(t.duration, 1440 - startMinute), updatedAt: Date.now() };
    }));
  }, []);
  const onDialPointerUp = (event: PointerEvent<SVGSVGElement>) => {
    if (!dragRef.current || !dialRef.current) return;
    const origin = dragOriginRef.current;
    const moved = origin ? Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 8 : false;
    const taskId = dragRef.current;
    dragRef.current = null;
    dragOriginRef.current = null;
    if (!moved) return;
    suppressSectorClickRef.current = true;
    const rect = dialRef.current.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 400;
    const y = ((event.clientY - rect.top) / rect.height) * 400;
    const angle = (Math.atan2(y - 200, x - 200) + Math.PI / 2 + Math.PI * 2) % (Math.PI * 2);
    moveTask(taskId, actualMinuteForDialMinute(angle / (Math.PI * 2) * 1440, effectiveDialMode));
  };
  const exportData = () => {
    const blob = new Blob([JSON.stringify({ version: 2, tasks, deletedAt }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a"); link.href = url; link.download = `dayrhythm-backup-${selectedDate}.json`; link.click();
    URL.revokeObjectURL(url); setNotice("Резервная копия скачана.");
  };
  const importData = (file?: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        if (!Array.isArray(parsed.tasks)) throw new Error("invalid");
        const imported = parsed.tasks.map((value: unknown) => normalizeTask(value)).filter((value: Task | null): value is Task => Boolean(value));
        setTasks(imported);
        if (parsed.deletedAt && typeof parsed.deletedAt === "object" && !Array.isArray(parsed.deletedAt)) setDeletedAt(parsed.deletedAt as DeletedTaskMap);
        setNotice(`Резервная копия импортирована: ${imported.length} задач.`);
      } catch { setNotice("Не удалось импортировать файл. Выберите резервную копию DayRhythm JSON."); }
    };
    reader.readAsText(file);
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#" aria-label="DayRhythm — главная"><span className="brand-mark"><span /></span><span>dayrhythm<span className="brand-ai">.ai</span></span></a>
        <div className="top-actions">
          <span className="local-label"><span className="status-dot" /> Локально на устройстве</span>
          <button className="icon-button" onClick={() => setTheme(theme === "light" ? "dark" : "light")} aria-label="Переключить тему" title="Переключить тему">{theme === "light" ? "☾" : "☀"}</button>
          <button className="outline-button backup-button" onClick={exportData}>Экспорт данных</button>
          <label className="outline-button import-button">Импорт<input type="file" accept="application/json,.json" onChange={e => importData(e.target.files?.[0])} hidden /></label>
        </div>
      </header>

      <nav className="app-navigation" aria-label="Разделы DayRhythm">
        {([
          ["schedule", "День", "◷"],
          ["calendar", "Календарь", "▦"],
          ["timeline", "Лента времени", "↕"],
          ["ai", "AI-план", "✦"],
          ["insights", "Аналитика", "▥"],
          ["inbox", "Входящие", "↓"],
          ["settings", "Настройки", "⚙"]
        ] as [AppView, string, string][]).map(([view, label, glyph]) => (
          <button key={view} className={activeView === view ? "app-nav-item active" : "app-nav-item"} onClick={() => setActiveView(view)} aria-current={activeView === view ? "page" : undefined}>
            <span>{glyph}</span>{label}
            {view === "inbox" && tasks.filter(task => task.inbox).length > 0 && <i>{tasks.filter(task => task.inbox).length}</i>}
          </button>
        ))}
      </nav>
      {notice && <button className="notice" onClick={() => setNotice("")}>{notice} <span>×</span></button>}
      {activeView === "schedule" ? (
      <>
      <section className="welcome-row">
        <div><div className="eyebrow">ТВОЙ ДЕНЬ · ТВОЙ РИТМ</div><h1>Время — твой главный ресурс.</h1><p className="subtitle">Собери день в цельную картину. Планируй не список дел, а своё время.</p></div>
        <button className="primary-button new-task-top" onClick={() => openNew()}><span>＋</span> Новая задача</button>
      </section>

      <section className="date-toolbar">
        <div className="date-switcher">
          <button className="icon-button" onClick={() => changeDate(-1)} aria-label="Предыдущий день">‹</button>
          <div><div className="date-title">{dateText(selectedDate)}</div><div className="date-subtitle">{selectedDate === todayString() ? "Твой план на сегодня" : selectedDate}</div></div>
          <button className="icon-button" onClick={() => changeDate(1)} aria-label="Следующий день">›</button>
          <button className="today-button" onClick={() => setSelectedDate(todayString())}>Сегодня</button>
        </div>
        <div className="day-stats"><div><strong>{dayTasks.length}</strong><span>задач</span></div><i /><div><strong>{Math.floor(plannedMinutes / 60)}<small>ч</small> {plannedMinutes % 60}<small>м</small></strong><span>запланировано</span></div><i /><div><strong>{doneCount}/{dayTasks.length}</strong><span>выполнено</span></div></div>
      </section>

      <div className="workspace">
        <section className="dial-panel panel">
          <div className="panel-heading"><div><div className="eyebrow">24 ЧАСА · ОДИН ВЗГЛЯД</div><h2>Круг твоего дня</h2></div><span className="live-pill"><span /> {selectedDate === todayString() ? "СЕГОДНЯ" : "ПЛАН"}</span></div>
          <div className="dial-wrap">
            <svg ref={dialRef} className="dial" viewBox="0 0 400 400" role="img" aria-label="Круговой циферблат суток" onPointerUp={onDialPointerUp}>
              <defs><filter id="softShadow" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="5" stdDeviation="7" floodOpacity=".09" /></filter></defs>
              <circle cx="200" cy="200" r="166" className="dial-track" />
              {dialHours.map((hour, index) => {
                const minute = effectiveDialMode === "24h" ? hour * 60 : effectiveDialMode === "day" ? (hour - 6) * 120 : (hour >= 18 ? hour - 18 : hour + 6) * 120;
                const major = effectiveDialMode === "24h" ? hour % 6 === 0 : hour % 2 === 0;
                const showLabel = effectiveDialMode === "24h" ? hour % 3 === 0 : hour % 2 === 0;
                const a = polar(minute, major ? 174 : 169);
                const b = polar(minute, major ? 158 : 162);
                const label = polar(minute, 145);
                return <g key={`${effectiveDialMode}-${hour}-${index}`}><line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={major ? "major-tick" : "minor-tick"} />{showLabel && <text x={label.x} y={label.y} className="hour-label">{pad(hour)}</text>}</g>;
              })}
              {dayTasks.flatMap(task => taskDialSegments(task, effectiveDialMode).map((segment, segmentIndex) => <path key={`${task.id}-${segmentIndex}`} d={sectorPath(segment.start, segment.duration, 93, 127)} fill={task.colorHex || COLORS[task.category]} opacity={task.done ? .28 : .9} stroke="var(--panel)" strokeWidth="2" className="task-sector" onPointerDown={(event) => { suppressSectorClickRef.current = false; dragRef.current = task.id; dragOriginRef.current = { x: event.clientX, y: event.clientY }; event.currentTarget.setPointerCapture(event.pointerId); }} onClick={() => { if (suppressSectorClickRef.current) { suppressSectorClickRef.current = false; return; } openEdit(task); }} tabIndex={0} role="button" aria-label={`${task.title}, ${timeText(task.start, clockFormat)}`} />))}
              <circle cx="200" cy="200" r="88" className="dial-inner" filter="url(#softShadow)" />
              <text x="200" y="178" className="center-overline">ТВОЁ ВРЕМЯ</text>
              <text x="200" y="216" className="center-time">{timeText(now, clockFormat)}</text>
              <text x="200" y="240" className="center-caption">{activeTask ? activeTask.title : "каждый час имеет значение"}</text>
              {selectedDate === todayString() && nowDialMinute !== null && <g><line x1={polar(nowDialMinute, 84).x} y1={polar(nowDialMinute, 84).y} x2={polar(nowDialMinute, 174).x} y2={polar(nowDialMinute, 174).y} className="now-line" /><circle cx={polar(nowDialMinute, 174).x} cy={polar(nowDialMinute, 174).y} r="5" className="now-dot" /></g>}
            </svg>
          </div>
          <div className="dial-hint"><span className="hint-icon">↻</span> Нажми на сектор, чтобы изменить задачу. Перетаскивай сектор для переноса по времени; режим циферблата можно сменить в настройках.</div>
          <div className="legend"><span><i className="legend-dot" style={{ background: COLORS["Работа"] }} />Работа</span><span><i className="legend-dot" style={{ background: COLORS["Спорт"] }} />Спорт</span><span><i className="legend-dot" style={{ background: COLORS["Отдых"] }} />Отдых</span><span><i className="legend-dot" style={{ background: COLORS["Быт"] }} />Быт</span><span><i className="legend-dot" style={{ background: COLORS["Личное"] }} />Личное</span></div>
          <div className="day-balance"><div className="balance-head"><span>Баланс дня</span><strong>{Math.round(plannedMinutes / 1440 * 100)}% <small>распланировано</small></strong></div><div className="balance-bar"><span style={{ width: `${Math.min(100, plannedMinutes / 1440 * 100)}%` }} /></div><div className="balance-foot"><span><i className="balance-dot planned" />{Math.floor(plannedMinutes / 60)} ч занято</span><span><i className="balance-dot free" />{Math.floor(freeMinutes / 60)} ч свободно</span></div></div>
        </section>

        <section className="tasks-panel panel">
          <div className="panel-heading task-heading"><div><div className="eyebrow">ТВОЙ СПИСОК</div><h2>План на день <span className="count-badge">{dayTasks.length}</span></h2></div><button className="add-round" onClick={() => openNew()} aria-label="Добавить задачу">＋</button></div>
          <div className="filter-row"><button className={filter === "Все" ? "filter-chip selected" : "filter-chip"} onClick={() => setFilter("Все")}>Все <span>{dayTasks.length}</span></button>{CATEGORIES.map(cat => <button key={cat} className={filter === cat ? "filter-chip selected" : "filter-chip"} onClick={() => setFilter(cat)}><i style={{ background: COLORS[cat] }} />{cat}</button>)}</div>
          <div className="task-list">
            {shownTasks.length === 0 ? <div className="empty-state"><div className="empty-art"><span>＋</span></div><h3>{dayTasks.length ? "В этой категории пусто" : "День начинается с идеи"}</h3><p>{dayTasks.length ? "Выбери другую категорию или добавь задачу." : "Добавь первую задачу и собери свой ритм на сегодня."}</p><button className="primary-button" onClick={() => openNew()}>＋ Добавить задачу</button></div> : shownTasks.map(task => <article className={task.done ? "task-card completed" : "task-card"} key={task.id}>
              <button className={task.done ? "task-check checked" : "task-check"} onClick={() => toggleDone(task.id)} aria-label={task.done ? "Отменить выполнение" : "Отметить выполненной"}>{task.done ? "✓" : ""}</button>
              <button className="task-main" onClick={() => openEdit(task)}><span className="task-time">{timeText(task.start, clockFormat)} <i /> {timeText(task.start + task.duration, clockFormat)}</span><strong>{task.emoji || CATEGORY_EMOJI[task.category]} {task.title}</strong>{task.note && <span className="task-note">{task.note}</span>}<span className="task-meta"><i style={{ background: COLORS[task.category] }} />{task.category}<span>·</span>{task.duration >= 60 ? `${Math.floor(task.duration / 60)} ч${task.duration % 60 ? ` ${task.duration % 60} мин` : ""}` : `${task.duration} мин`}</span></button>
              <button className="more-button" onClick={() => openEdit(task)} aria-label="Изменить задачу">···</button>
            </article>)}
          </div>
          {dayTasks.length > 0 && <button className="add-task-bottom" onClick={() => openNew()}>＋ Добавить задачу</button>}
          <div className="task-footer"><span><span className="status-dot" /> Данные сохраняются автоматически</span><span>{doneCount === dayTasks.length && dayTasks.length > 0 ? "Отличная работа!" : `Ещё ${dayTasks.length - doneCount} ${dayTasks.length - doneCount === 1 ? "задача" : "задач"} впереди`}</span></div>
        </section>
      </div>

      <footer className="app-footer"><span>dayrhythm.ai <span className="footer-dot">·</span> Найди свой ритм.</span><span>Твои данные остаются у тебя <span className="privacy-mark">↗</span></span></footer>
      </>
      ) : (
        <FeatureViews
          view={activeView}
          tasks={tasks}
          setTasks={setTasks}
          selectedDate={selectedDate}
          setSelectedDate={setSelectedDate}
          clockFormat={clockFormat}
          setClockFormat={setClockFormat}
          dialMode={dialMode}
          setDialMode={setDialMode}
          theme={theme}
          setTheme={setTheme}
          notificationsEnabled={notificationsEnabled}
          setNotificationsEnabled={setNotificationsEnabled}
          deletedAt={deletedAt}
          setDeletedAt={setDeletedAt}
          onCloudSessionChanged={() => setCloudAuthRevision(value => value + 1)}
          onOpenDay={(date) => { setSelectedDate(date); setActiveView("schedule"); }}
          onCreateTask={(date, inbox = false) => { if (date) setSelectedDate(date); openNew(undefined, inbox); setActiveView("schedule"); }}
          onEditTask={(task) => { openEdit(task); setActiveView("schedule"); }}
          onToggleDone={toggleDone}
          onDeleteTask={deleteTask}
          setNotice={setNotice}
        />
      )}

      {showForm && <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) resetForm(); }}><section className="task-modal" role="dialog" aria-modal="true" aria-labelledby="form-title"><div className="modal-head"><div><div className="eyebrow">{editing ? "НАСТРОЙКА ПЛАНА" : "НОВАЯ ЗАПИСЬ"}</div><h2 id="form-title">{editing ? "Изменить задачу" : "Добавить задачу"}</h2></div><button className="icon-button" onClick={resetForm} aria-label="Закрыть">×</button></div>
        <form onSubmit={saveTask}><label className="field-label">Название задачи<input autoFocus value={title} onChange={e => setTitle(e.target.value)} placeholder="Например, тренировка на станке" maxLength={100} required /></label>
          <div className="field-grid"><label className="field-label">Начало<input type="time" value={start} onChange={e => setStart(e.target.value)} required /></label><label className="field-label">Длительность<select value={duration} onChange={e => setDuration(e.target.value)}>{[5,15,30,45,60,75,90,120,150,180,240,300,360,480,600,720].map(n => <option value={n} key={n}>{n < 60 ? `${n} минут` : `${Math.floor(n / 60)} ч${n % 60 ? ` ${n % 60} мин` : ""}`}</option>)}</select></label></div>
          <label className="field-label">Категория<div className="category-picker">{CATEGORIES.map(cat => <button type="button" key={cat} onClick={() => { setCategory(cat); setEmoji(CATEGORY_EMOJI[cat]); setColorHex(COLORS[cat]); }} className={category === cat ? "category-option active" : "category-option"}><i style={{ background: COLORS[cat] }} />{cat}</button>)}</div></label>
          <div className="field-grid"><label className="field-label">Эмодзи<input value={emoji} onChange={e => setEmoji(e.target.value)} maxLength={8} placeholder="💼" /></label><label className="field-label color-field">Цвет задачи<input type="color" value={colorHex} onChange={e => setColorHex(e.target.value)} /></label></div>
          <label className="field-label">Участники <span className="optional-label">необязательно, через запятую</span><input value={participants} onChange={e => setParticipants(e.target.value)} maxLength={250} placeholder="Например, Саша, Маша" /></label>
          <div className="field-grid"><label className="field-label">Напоминание<select value={reminderMinutes} onChange={e => setReminderMinutes(e.target.value)}><option value="none">Без напоминания</option><option value="0">В момент начала</option><option value="5">За 5 минут</option><option value="10">За 10 минут</option><option value="15">За 15 минут</option><option value="30">За 30 минут</option><option value="60">За час</option></select></label><label className="field-label">Повтор<select value={recurrence} onChange={e => setRecurrence(e.target.value as Recurrence)}><option value="none">Не повторять</option><option value="daily">Каждый день</option><option value="weekly">Каждую неделю</option></select></label></div>
          <label className="inbox-check"><input type="checkbox" checked={isInboxTask} onChange={e => setIsInboxTask(e.target.checked)} /> <span><strong>Входящая задача</strong><small>Сохранять без закрепления в расписании и на циферблате.</small></span></label>
          <label className="field-label">Заметка <span className="optional-label">необязательно</span><textarea value={note} onChange={e => setNote(e.target.value)} placeholder="Что важно не забыть?" rows={2} maxLength={300} /></label>
          <div className="modal-actions">{editing && <button type="button" className="delete-button" onClick={() => { deleteTask(editing); resetForm(); }}>Удалить</button>}<button type="button" className="outline-button" onClick={resetForm}>Отмена</button><button className="primary-button" type="submit">{editing ? "Сохранить" : "Добавить задачу"}</button></div>
        </form></section></div>}
      <div className="sr-only" aria-live="polite">{notice}</div>
    </main>
  );
}
