"use client";

import { FormEvent, MouseEvent as ReactMouseEvent, PointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import FeaturePanels, { FeatureView, ParsedWebTask } from "./feature-panels";

type Category = "Работа" | "Спорт" | "Отдых" | "Быт" | "Личное";
type Task = {
  id: string;
  title: string;
  date: string;
  start: number;
  duration: number;
  category: Category;
  done: boolean;
  note: string;
};
type AppView = "day" | FeatureView;
type DialMode = "focus12" | "circle24" | "list24";
const CATEGORIES: Category[] = ["Работа", "Спорт", "Отдых", "Быт", "Личное"];
const COLORS: Record<Category, string> = {
  "Работа": "#6266e9",
  "Спорт": "#f36c45",
  "Отдых": "#20a68a",
  "Быт": "#d6a52d",
  "Личное": "#bc75c9"
};
const STORAGE_KEY = "dayrhythm.tasks.v1";
const THEME_KEY = "dayrhythm.theme.v1";
const DIAL_MODE_KEY = "dayrhythm.dial-mode.v1";
const pad = (n: number) => String(n).padStart(2, "0");
const timeText = (minutes: number) => `${pad(Math.floor(minutes / 60) % 24)}:${pad(minutes % 60)}`;
const endTimeText = (minutes: number) => minutes === 1440 ? "24:00" : timeText(minutes);
const shiftDate = (date: string, delta: number) => {
  const value = new Date(date + "T12:00:00");
  value.setDate(value.getDate() + delta);
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
};
const dateText = (date: string) => new Date(date + "T12:00:00").toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" });
const todayString = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const makeId = () => typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const polar = (minutes: number, radius: number, cx = 200, cy = 200) => {
  const angle = (minutes / 720) * Math.PI * 2 - Math.PI / 2;
  // Стабилизируем SVG-атрибуты: сервер и браузер могут чуть различаться в последних знаках Math.sin/cos.
  return {
    x: Number((cx + Math.cos(angle) * radius).toFixed(3)),
    y: Number((cy + Math.sin(angle) * radius).toFixed(3))
  };
};
const sectorPath = (start: number, duration: number, inner: number, outer: number) => {
  const radius = (inner + outer) / 2;
  const a = polar(start, radius);
  const b = polar(start + duration, radius);
  const visibleDuration = Math.max(0, Math.min(720, duration));
  if (visibleDuration === 0) return "";
  if (visibleDuration >= 720) {
    const opposite = polar(start + 360, radius);
    return `M ${a.x} ${a.y} A ${radius} ${radius} 0 0 1 ${opposite.x} ${opposite.y} A ${radius} ${radius} 0 0 1 ${a.x} ${a.y}`;
  }
  const large = visibleDuration > 360 ? 1 : 0;
  return `M ${a.x} ${a.y} A ${radius} ${radius} 0 ${large} 1 ${b.x} ${b.y}`;
};
const polar24 = (minutes: number, radius: number, cx = 200, cy = 200) => {
  const angle = (minutes / 1440) * Math.PI * 2 - Math.PI / 2;
  return {
    x: Number((cx + Math.cos(angle) * radius).toFixed(3)),
    y: Number((cy + Math.sin(angle) * radius).toFixed(3))
  };
};
const sectorPath24 = (start: number, duration: number, inner: number, outer: number) => {
  const radius = (inner + outer) / 2;
  const visibleDuration = Math.max(0, Math.min(1440, duration));
  if (visibleDuration === 0) return "";
  const a = polar24(start, radius);
  const b = polar24(start + visibleDuration, radius);
  if (visibleDuration >= 1440) {
    const opposite = polar24(start + 720, radius);
    return `M ${a.x} ${a.y} A ${radius} ${radius} 0 0 1 ${opposite.x} ${opposite.y} A ${radius} ${radius} 0 0 1 ${a.x} ${a.y}`;
  }
  const large = visibleDuration > 720 ? 1 : 0;
  return `M ${a.x} ${a.y} A ${radius} ${radius} 0 ${large} 1 ${b.x} ${b.y}`;
};
const taskArcLabel = (task: Task, visibleDuration: number, radius: number, period: number) => {
  const arcLength = visibleDuration / period * Math.PI * 2 * radius;
  const maxChars = Math.floor(arcLength / 5.2);
  const endMinute = task.start + task.duration;
  const timeRange = `${timeText(task.start)}–${endTimeText(endMinute)}`;
  const compactRange = `${pad(Math.floor(task.start / 60))}–${pad(endMinute === 1440 ? 24 : Math.floor(endMinute / 60) % 24)}`;
  const fullLabel = `${task.title} · ${timeRange}`;
  if (maxChars >= fullLabel.length) return fullLabel;
  if (maxChars >= compactRange.length + 5) {
    const titleChars = maxChars - compactRange.length - 3;
    const shortTitle = task.title.length > titleChars ? `${task.title.slice(0, titleChars - 1)}…` : task.title;
    return `${shortTitle} · ${compactRange}`;
  }
  if (maxChars >= compactRange.length) return compactRange;
  return "";
};

export default function Home() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [view, setView] = useState<AppView>("day");
  const [dialMode, setDialMode] = useState<DialMode>("focus12");
  const [selectedDate, setSelectedDate] = useState(todayString);
  const [ready, setReady] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [editing, setEditing] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [start, setStart] = useState("09:00");
  const [duration, setDuration] = useState("60");
  const [category, setCategory] = useState<Category>("Работа");
  const [note, setNote] = useState("");
  const [filter, setFilter] = useState<"Все" | Category>("Все");
  const [now, setNow] = useState(0);
  const [notice, setNotice] = useState("");
  const [dragPreview, setDragPreview] = useState<{ taskId: string; minute: number } | null>(null);
  const [taskTooltip, setTaskTooltip] = useState<{ taskId: string; x: number; y: number } | null>(null);
  const dialWrapRef = useRef<HTMLDivElement>(null);
  const dialRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<string | null>(null);
  const dragOriginRef = useRef<{ x: number; y: number } | null>(null);
  const suppressSectorClickRef = useRef(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setTasks(JSON.parse(saved) as Task[]);
      const savedTheme = localStorage.getItem(THEME_KEY);
      if (savedTheme === "dark" || savedTheme === "light") setTheme(savedTheme);
      const savedDialMode = localStorage.getItem(DIAL_MODE_KEY);
      if (savedDialMode === "focus12" || savedDialMode === "circle24" || savedDialMode === "list24") setDialMode(savedDialMode);
    } catch { setNotice("Не удалось прочитать сохранённые данные браузера."); }
    setReady(true);
  }, []);
  useEffect(() => {
    if (ready) localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
  }, [tasks, ready]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    if (ready) localStorage.setItem(THEME_KEY, theme);
  }, [theme, ready]);
  useEffect(() => {
    if (ready) localStorage.setItem(DIAL_MODE_KEY, dialMode);
  }, [dialMode, ready]);
  useEffect(() => {
    const update = () => {
      const d = new Date();
      setNow(d.getHours() * 60 + d.getMinutes());
    };
    update();
    const timer = window.setInterval(update, 30000);
    return () => window.clearInterval(timer);
  }, []);

  const dayTasks = useMemo(() => tasks.filter(t => t.date === selectedDate).sort((a, b) => a.start - b.start), [tasks, selectedDate]);
  const nextDayTasks = useMemo(() => tasks.filter(t => t.date === shiftDate(selectedDate, 1)).sort((a, b) => a.start - b.start), [tasks, selectedDate]);
  const shownTasks = dayTasks.filter(t => filter === "Все" || t.category === filter);
  const doneCount = dayTasks.filter(t => t.done).length;
  const plannedMinutes = dayTasks.reduce((sum, t) => sum + t.duration, 0);
  const freeMinutes = Math.max(0, 1440 - plannedMinutes);
  const changeDate = (delta: number) => {
    const d = new Date(selectedDate + "T12:00:00");
    d.setDate(d.getDate() + delta);
    setSelectedDate(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
  };
  const resetForm = () => {
    setEditing(null); setTitle(""); setStart("09:00"); setDuration("60"); setCategory("Работа"); setNote(""); setShowForm(false);
  };
  const openNew = (minute?: number) => {
    setEditing(null); setTitle(""); setStart(timeText(minute ?? 540)); setDuration("60"); setCategory("Работа"); setNote(""); setShowForm(true);
  };
  const openEdit = (task: Task) => {
    setEditing(task.id); setTitle(task.title); setStart(timeText(task.start)); setDuration(String(task.duration)); setCategory(task.category); setNote(task.note); setShowForm(true);
  };
  const saveTask = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const [h, m] = start.split(":").map(Number);
    const startMinutes = h * 60 + m;
    const length = Math.min(1440 - startMinutes, Math.max(5, Number(duration) || 60));
    if (!title.trim()) return;
    if (editing) {
      setTasks(old => old.map(t => t.id === editing ? { ...t, title: title.trim(), date: selectedDate, start: startMinutes, duration: length, category, note: note.trim() } : t));
    } else {
      setTasks(old => [...old, { id: makeId(), title: title.trim(), date: selectedDate, start: startMinutes, duration: length, category, done: false, note: note.trim() }]);
    }
    resetForm();
  };
  const toggleDone = (id: string) => setTasks(old => old.map(t => t.id === id ? { ...t, done: !t.done } : t));
  const deleteTask = (id: string) => setTasks(old => old.filter(t => t.id !== id));
  const moveTask = useCallback((id: string, minute: number) => {
    setTasks(old => old.map(t => t.id === id ? { ...t, start: Math.min(1435, Math.max(0, Math.round(minute / 15) * 15)), duration: Math.min(t.duration, 1440 - Math.min(1435, Math.max(0, Math.round(minute / 15) * 15))) } : t));
  }, []);
  const dialAnchor = selectedDate === todayString() ? now : 540;
  const updateTaskTooltip = (event: ReactMouseEvent<SVGElement>, task: Task) => {
    const rect = dialWrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const margin = Math.min(140, Math.max(20, rect.width / 2 - 8));
    setTaskTooltip({
      taskId: task.id,
      x: Math.max(margin, Math.min(rect.width - margin, event.clientX - rect.left)),
      y: Math.max(90, event.clientY - rect.top)
    });
  };
  const pointerMinute = (event: PointerEvent<SVGSVGElement>) => {
    if (!dialRef.current) return 0;
    const rect = dialRef.current.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 400;
    const y = ((event.clientY - rect.top) / rect.height) * 400;
    const angle = (Math.atan2(y - 200, x - 200) + Math.PI / 2 + Math.PI * 2) % (Math.PI * 2);
    if (dialMode === "circle24") {
      return Math.min(1435, Math.max(0, Math.round((angle / (Math.PI * 2) * 1440) / 15) * 15));
    }
    const clockMinute = angle / (Math.PI * 2) * 720;
    const radius = Math.hypot(x - 200, y - 200);
    // Внутреннее кольцо выбирает 00:00–11:45, внешнее — 12:00–23:45.
    const halfDayStart = radius < 117 ? 0 : 720;
    return Math.min(1435, Math.max(0, Math.round((halfDayStart + clockMinute) / 15) * 15));
  };
  const onDialPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    if (!dragRef.current || !dragOriginRef.current) return;
    const origin = dragOriginRef.current;
    if (Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 8) {
      setDragPreview({ taskId: dragRef.current, minute: pointerMinute(event) });
    }
  };
  const onDialPointerUp = (event: PointerEvent<SVGSVGElement>) => {
    const taskId = dragRef.current;
    const origin = dragOriginRef.current;
    const moved = origin ? Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 8 : false;
    dragRef.current = null;
    dragOriginRef.current = null;
    if (taskId && moved) {
      suppressSectorClickRef.current = true;
      moveTask(taskId, pointerMinute(event));
    }
    setDragPreview(null);
  };
  const onDialPointerCancel = () => {
    dragRef.current = null;
    dragOriginRef.current = null;
    setDragPreview(null);
  };
  const exportData = () => {
    const blob = new Blob([JSON.stringify({ version: 1, tasks }, null, 2)], { type: "application/json" });
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
        const valid = parsed.tasks.every((task: Task) => task && typeof task.id === "string" && typeof task.title === "string" && typeof task.start === "number" && typeof task.duration === "number" && (task.date === "" || /^\d{4}-\d{2}-\d{2}$/.test(task.date)));
        if (!valid) throw new Error("invalid task schema");
        setTasks(parsed.tasks); setNotice("Резервная копия импортирована.");
      } catch { setNotice("Не удалось импортировать файл. Выберите резервную копию DayRhythm JSON."); }
    };
    reader.readAsText(file);
  };
  const addInboxTask = (taskTitle: string, taskNote: string) => {
    setTasks(old => [...old, { id: makeId(), title: taskTitle, date: "", start: 540, duration: 60, category: "Личное", done: false, note: taskNote }]);
    setNotice("Задача добавлена во входящие.");
  };
  const scheduleInboxTask = (id: string) => {
    setTasks(old => old.map(task => task.id === id ? { ...task, date: selectedDate, start: 540 } : task));
    setNotice("Задача добавлена в расписание на 09:00. Проверь время на циферблате.");
  };
  const addParsedTask = (task: ParsedWebTask) => {
    const categoryValue = CATEGORIES.includes(task.category as Category) ? task.category as Category : "Личное";
    const startMinutes = Math.max(0, Math.min(1439, Math.round(task.startTime * 60)));
    const endMinutes = Math.max(startMinutes + 5, Math.min(1440, Math.round(task.endTime * 60)));
    setTasks(old => [...old, { id: makeId(), title: task.title.trim(), date: task.date, start: startMinutes, duration: Math.min(1440 - startMinutes, endMinutes - startMinutes), category: categoryValue, done: false, note: task.description || "" }]);
    setNotice("Добавлена задача «" + task.title + "».");
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

      <nav className="feature-nav" aria-label="Разделы приложения">
        {([{ id: "day", label: "Мой день" }, { id: "timeline", label: "Timeline" }, { id: "inbox", label: "Входящие" }, { id: "insights", label: "Аналитика" }, { id: "ai", label: "AI-планировщик" }, { id: "settings", label: "Настройки" }] as {id: AppView; label: string}[]).map(item => <button key={item.id} className={view === item.id ? "feature-nav-item active" : "feature-nav-item"} onClick={() => setView(item.id)}>{item.label}{item.id === "inbox" && tasks.filter(task => !task.date).length > 0 ? <span>{tasks.filter(task => !task.date).length}</span> : null}</button>)}
      </nav>

      {view === "day" && <>
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

      {notice && <button className="notice" onClick={() => setNotice("")}>{notice} <span>×</span></button>}

      <div className="workspace">
        <section className="dial-panel panel">
          <div className="panel-heading"><div><div className="eyebrow">{dialMode === "focus12" ? "12 ЧАСОВ · УТРО И ВЕЧЕР" : dialMode === "circle24" ? "24 ЧАСА · ПОЛНЫЙ КРУГ" : "24 ЧАСА · СПИСОК ПО ЧАСАМ"}</div><h2>{dialMode === "list24" ? "Расписание на сутки" : "Круг твоего дня"}</h2></div><span className="live-pill"><span /> {selectedDate === todayString() ? "СЕГОДНЯ" : "ПЛАН"}</span></div>
          <div className="dial-mode-switch" role="group" aria-label="Способ отображения расписания">
            <button className={dialMode === "focus12" ? "dial-mode-option active" : "dial-mode-option"} onClick={() => { setDialMode("focus12"); setTaskTooltip(null); }}>12 часов</button>
            <button className={dialMode === "circle24" ? "dial-mode-option active" : "dial-mode-option"} onClick={() => { setDialMode("circle24"); setTaskTooltip(null); }}>Круг 24 ч</button>
            <button className={dialMode === "list24" ? "dial-mode-option active" : "dial-mode-option"} onClick={() => { setDialMode("list24"); setTaskTooltip(null); }}>Список 24 ч</button>
          </div>
          <div className={dialMode === "list24" ? "dial-wrap dial-wrap-list" : "dial-wrap"} ref={dialWrapRef}>
            {dragPreview && dialMode !== "list24" && <div className="drag-time-preview">Новое время: <strong>{timeText(dragPreview.minute)}</strong></div>}
            {dialMode === "list24" ? (
              <div className="day-hours-list" aria-label="Список расписания с 00:00 до 24:00">
                {Array.from({ length: 24 }, (_, hour) => {
                  const hourTasks = dayTasks.filter(task => Math.floor(task.start / 60) === hour);
                  return <div className={hourTasks.length ? "day-hour-row has-tasks" : "day-hour-row"} key={hour}>
                    <div className="day-hour-label">{pad(hour)}:00</div>
                    <div className="day-hour-content">
                      {hourTasks.length ? hourTasks.map(task => <button className="day-hour-task" key={task.id} onClick={() => openEdit(task)} style={{ borderLeftColor: COLORS[task.category] }}>
                        <span className="day-hour-task-time">{timeText(task.start)}–{endTimeText(task.start + task.duration)}</span>
                        <strong>{task.title}</strong>
                        {task.note && <span className="day-hour-task-note">{task.note}</span>}
                        <span className="day-hour-task-category">{task.category}</span>
                      </button>) : <span className="day-hour-free">Свободно</span>}
                    </div>
                  </div>;
                })}
              </div>
            ) : (
              <svg ref={dialRef} className={dialMode === "circle24" ? "dial dial-24" : "dial"} viewBox="0 0 400 400" role="img" aria-label={dialMode === "circle24" ? "Круговой циферблат всех 24 часов" : "Два кольца: утренние и вечерние задачи"} onPointerMove={onDialPointerMove} onPointerUp={onDialPointerUp} onPointerCancel={onDialPointerCancel}>
                <defs><filter id="softShadow" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="5" stdDeviation="7" floodOpacity=".09" /></filter></defs>
                <circle cx="200" cy="200" r="166" className="dial-track" />
                {dialMode === "focus12" ? (
                  <>
                    <circle cx="200" cy="200" r="103" className="dial-morning-track" />
                    <circle cx="200" cy="200" r="130" className="dial-afternoon-track" />
                    {Array.from({ length: 12 }, (_, hour) => {
                      const minute = hour * 60;
                      const hourLabel = hour === 0 ? "12" : pad(hour);
                      const a = polar(minute, hour % 3 === 0 ? 174 : 169);
                      const b = polar(minute, hour % 3 === 0 ? 158 : 163);
                      return <g key={hour}><line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={hour % 3 === 0 ? "major-tick" : "minor-tick"} /><text x={polar(minute, 145).x} y={polar(minute, 145).y} className="hour-label">{hourLabel}</text></g>;
                    })}
                    {nextDayTasks.flatMap(task => {
                      const end = task.start + task.duration;
                      const morningDuration = task.start < 720 ? Math.min(task.duration, 720 - task.start) : 0;
                      const afternoonStart = Math.max(task.start, 720);
                      const afternoonDuration = Math.max(0, end - afternoonStart);
                      const ghost = (segmentStart: number, segmentDuration: number, radius: number, suffix: string) => <path key={task.id + "-next-" + suffix} d={sectorPath(segmentStart % 720, segmentDuration, radius - 2, radius + 2)} fill="none" stroke={COLORS[task.category]} strokeWidth="7" strokeLinecap="round" opacity=".24" className="next-day-task" onMouseMove={event => updateTaskTooltip(event, task)} onMouseLeave={() => setTaskTooltip(null)} pointerEvents="stroke" />;
                      return [
                        morningDuration > 0 ? ghost(task.start, morningDuration, 75, "am") : null,
                        afternoonDuration > 0 ? ghost(afternoonStart, afternoonDuration, 157, "pm") : null
                      ];
                    })}
                    {dayTasks.flatMap(task => {
                      const end = task.start + task.duration;
                      const upcoming = end > dialAnchor && task.start < dialAnchor + 720;
                      const renderSegment = (segmentStart: number, segmentDuration: number, morning: boolean, suffix: string) => {
                        const offset = segmentStart % 720;
                        const inner = morning ? 91 : 118;
                        const outer = morning ? 115 : 142;
                        const radius = (inner + outer) / 2;
                        const pathId = "task-arc-" + task.id + "-" + suffix;
                        const label = taskArcLabel(task, segmentDuration, radius, 720);
                        return <g key={task.id + "-" + suffix} className="task-arc-interactive" onMouseMove={event => updateTaskTooltip(event, task)} onMouseLeave={() => setTaskTooltip(null)} onPointerDown={event => { suppressSectorClickRef.current = false; dragRef.current = task.id; dragOriginRef.current = { x: event.clientX, y: event.clientY }; dialRef.current?.setPointerCapture(event.pointerId); }} onClick={() => { if (suppressSectorClickRef.current) { suppressSectorClickRef.current = false; return; } openEdit(task); }} tabIndex={0} role="button" aria-label={task.title + ", " + timeText(task.start) + "–" + endTimeText(task.start + task.duration)}>
                          <path id={pathId} d={sectorPath(offset, segmentDuration, inner, outer)} fill="none" stroke={COLORS[task.category]} strokeWidth={outer - inner} strokeLinecap="round" opacity={task.done ? .25 : upcoming ? .92 : .48} className={upcoming ? "task-sector upcoming-sector" : "task-sector overflow-sector"} />
                          {label && <text className="task-arc-label"><textPath href={"#" + pathId} startOffset="50%" textAnchor="middle">{label}</textPath></text>}
                        </g>;
                      };
                      const morningDuration = task.start < 720 ? Math.min(task.duration, 720 - task.start) : 0;
                      const afternoonStart = Math.max(task.start, 720);
                      const afternoonDuration = Math.max(0, end - afternoonStart);
                      return [
                        morningDuration > 0 ? renderSegment(task.start, morningDuration, true, "am") : null,
                        afternoonDuration > 0 ? renderSegment(afternoonStart, afternoonDuration, false, "pm") : null
                      ];
                    })}
                    {dayTasks.filter(task => task.start < 720 && task.start + task.duration > 720).map(task => <line key={task.id + "-noon-bridge"} x1={polar(720, 103).x} y1={polar(720, 103).y} x2={polar(720, 130).x} y2={polar(720, 130).y} stroke={COLORS[task.category]} strokeWidth="24" strokeLinecap="round" opacity={task.done ? .25 : .92} className="task-noon-bridge" onMouseMove={event => updateTaskTooltip(event, task)} onMouseLeave={() => setTaskTooltip(null)} onPointerDown={event => { suppressSectorClickRef.current = false; dragRef.current = task.id; dragOriginRef.current = { x: event.clientX, y: event.clientY }; dialRef.current?.setPointerCapture(event.pointerId); }} onClick={() => { if (suppressSectorClickRef.current) { suppressSectorClickRef.current = false; return; } openEdit(task); }} />)}
                    {dragPreview && (() => {
                      const task = dayTasks.find(item => item.id === dragPreview.taskId);
                      if (!task) return null;
                      const end = dragPreview.minute + task.duration;
                      const morningDuration = dragPreview.minute < 720 ? Math.min(task.duration, 720 - dragPreview.minute) : 0;
                      const afternoonStart = Math.max(dragPreview.minute, 720);
                      const afternoonDuration = Math.max(0, end - afternoonStart);
                      return <>
                        {morningDuration > 0 && <path d={sectorPath(dragPreview.minute, morningDuration, 91, 115)} fill="none" stroke={COLORS[task.category]} strokeWidth="24" strokeLinecap="round" opacity=".65" strokeDasharray="6 5" pointerEvents="none" />}
                        {afternoonDuration > 0 && <path d={sectorPath(afternoonStart, afternoonDuration, 118, 142)} fill="none" stroke={COLORS[task.category]} strokeWidth="24" strokeLinecap="round" opacity=".65" strokeDasharray="6 5" pointerEvents="none" />}
                        {morningDuration > 0 && afternoonDuration > 0 && <line x1={polar(720, 103).x} y1={polar(720, 103).y} x2={polar(720, 130).x} y2={polar(720, 130).y} stroke={COLORS[task.category]} strokeWidth="24" strokeLinecap="round" opacity=".65" strokeDasharray="6 5" pointerEvents="none" />}
                      </>;
                    })()}
                    <circle cx="200" cy="200" r="55" className="dial-inner" filter="url(#softShadow)" />
                    <text x="200" y="183" className="center-overline">{selectedDate === todayString() ? "СЕЙЧАС" : "НАЧАЛО ДНЯ"}</text>
                    <text x="200" y="215" className="center-time">{timeText(dialAnchor)}</text>
                    <text x="200" y="234" className="center-caption">00:00–12:00 / 12:00–24:00</text>
                    {selectedDate === todayString() && <g><line x1={polar(dialAnchor % 720, 55).x} y1={polar(dialAnchor % 720, 55).y} x2={polar(dialAnchor % 720, 174).x} y2={polar(dialAnchor % 720, 174).y} className="now-line" /><circle cx={polar(dialAnchor % 720, 174).x} cy={polar(dialAnchor % 720, 174).y} r="5" className="now-dot" /></g>}
                  </>
                ) : (
                  <>
                    <circle cx="200" cy="200" r="120" className="dial-24-track" />
                    <circle cx="200" cy="200" r="154" className="dial-nextday-track" />
                    {Array.from({ length: 24 }, (_, hour) => {
                      const minute = hour * 60;
                      const a = polar24(minute, hour % 6 === 0 ? 174 : 169);
                      const b = polar24(minute, hour % 6 === 0 ? 158 : 163);
                      return <g key={hour}><line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={hour % 6 === 0 ? "major-tick" : "minor-tick"} />{hour % 2 === 0 && <text x={polar24(minute, 143).x} y={polar24(minute, 143).y} className="hour-label">{pad(hour)}</text>}</g>;
                    })}
                    {nextDayTasks.map(task => {
                      const radius = 154;
                      const label = taskArcLabel(task, task.duration, radius, 1440);
                      const pathId = "next24-arc-" + task.id;
                      return <g key={pathId} className="next-day-task" onMouseMove={event => updateTaskTooltip(event, task)} onMouseLeave={() => setTaskTooltip(null)}>
                        <path id={pathId} d={sectorPath24(task.start, task.duration, 151, 157)} fill="none" stroke={COLORS[task.category]} strokeWidth="6" strokeLinecap="round" opacity=".23" />
                        {label && <text className="task-arc-label future-arc-label"><textPath href={"#" + pathId} startOffset="50%" textAnchor="middle">{label}</textPath></text>}
                      </g>;
                    })}
                    {dayTasks.map(task => {
                      const radius = 120;
                      const pathId = "task-24-arc-" + task.id;
                      const label = taskArcLabel(task, task.duration, radius, 1440);
                      const upcoming = task.start + task.duration > dialAnchor && task.start < dialAnchor + 720;
                      return <g key={pathId} className="task-arc-interactive" onMouseMove={event => updateTaskTooltip(event, task)} onMouseLeave={() => setTaskTooltip(null)} onPointerDown={event => { suppressSectorClickRef.current = false; dragRef.current = task.id; dragOriginRef.current = { x: event.clientX, y: event.clientY }; dialRef.current?.setPointerCapture(event.pointerId); }} onClick={() => { if (suppressSectorClickRef.current) { suppressSectorClickRef.current = false; return; } openEdit(task); }} tabIndex={0} role="button" aria-label={task.title + ", " + timeText(task.start) + "–" + endTimeText(task.start + task.duration)}>
                        <path id={pathId} d={sectorPath24(task.start, task.duration, 108, 132)} fill="none" stroke={COLORS[task.category]} strokeWidth="24" strokeLinecap="round" opacity={task.done ? .25 : upcoming ? .92 : .48} className={upcoming ? "task-sector upcoming-sector" : "task-sector overflow-sector"} />
                        {label && <text className="task-arc-label"><textPath href={"#" + pathId} startOffset="50%" textAnchor="middle">{label}</textPath></text>}
                      </g>;
                    })}
                    <circle cx="200" cy="200" r="55" className="dial-inner" filter="url(#softShadow)" />
                    <text x="200" y="183" className="center-overline">{selectedDate === todayString() ? "СЕЙЧАС" : "24 ЧАСА"}</text>
                    <text x="200" y="215" className="center-time">{selectedDate === todayString() ? timeText(now) : "24 ч"}</text>
                    <text x="200" y="234" className="center-caption">00:00–24:00</text>
                    {selectedDate === todayString() && <g><line x1={polar24(now, 55).x} y1={polar24(now, 55).y} x2={polar24(now, 174).x} y2={polar24(now, 174).y} className="now-line" /><circle cx={polar24(now, 174).x} cy={polar24(now, 174).y} r="5" className="now-dot" /></g>}
                  </>
                )}
              </svg>
            )}
            {taskTooltip && [...dayTasks, ...nextDayTasks].some(task => task.id === taskTooltip.taskId) && (() => {
              const task = [...dayTasks, ...nextDayTasks].find(item => item.id === taskTooltip.taskId);
              return task ? <div className="task-hover-tooltip" style={{ left: taskTooltip.x, top: taskTooltip.y }}>
                <strong>{task.title}</strong>
                <span className="task-hover-time">{timeText(task.start)}–{endTimeText(task.start + task.duration)}</span>
                <span className="task-hover-date">{task.date === selectedDate ? "Выбранный день" : "Следующий день"} · {task.category}</span>
                <p>{task.note || "Описание не добавлено."}</p>
              </div> : null;
            })()}
          </div>
          <div className="dial-hint"><span className="hint-icon">↻</span> {dialMode === "focus12" ? "Внутреннее кольцо — 00:00–12:00, внешнее — 12:00–24:00. Задачи следующего дня показаны тонкими полупрозрачными дугами." : dialMode === "circle24" ? "Полный круг показывает 24 часа. При наведении видны название, время и описание задачи." : "Список содержит все 24 часа выбранного дня. Нажми на задачу, чтобы изменить её."}</div>
          <div className="legend"><span><i className="legend-dot" style={{ background: COLORS["Работа"] }} />Работа</span><span><i className="legend-dot" style={{ background: COLORS["Спорт"] }} />Спорт</span><span><i className="legend-dot" style={{ background: COLORS["Отдых"] }} />Отдых</span><span><i className="legend-dot" style={{ background: COLORS["Быт"] }} />Быт</span><span><i className="legend-dot" style={{ background: COLORS["Личное"] }} />Личное</span></div>
          <div className="day-balance"><div className="balance-head"><span>Баланс дня</span><strong>{Math.round(plannedMinutes / 1440 * 100)}% <small>распланировано</small></strong></div><div className="balance-bar"><span style={{ width: `${Math.min(100, plannedMinutes / 1440 * 100)}%` }} /></div><div className="balance-foot"><span><i className="balance-dot planned" />{Math.floor(plannedMinutes / 60)} ч занято</span><span><i className="balance-dot free" />{Math.floor(freeMinutes / 60)} ч свободно</span></div></div>
        </section>

        <section className="tasks-panel panel">
          <div className="panel-heading task-heading"><div><div className="eyebrow">ТВОЙ СПИСОК</div><h2>План на день <span className="count-badge">{dayTasks.length}</span></h2></div><button className="add-round" onClick={() => openNew()} aria-label="Добавить задачу">＋</button></div>
          <div className="filter-row"><button className={filter === "Все" ? "filter-chip selected" : "filter-chip"} onClick={() => setFilter("Все")}>Все <span>{dayTasks.length}</span></button>{CATEGORIES.map(cat => <button key={cat} className={filter === cat ? "filter-chip selected" : "filter-chip"} onClick={() => setFilter(cat)}><i style={{ background: COLORS[cat] }} />{cat}</button>)}</div>
          <div className="task-list">
            {shownTasks.length === 0 ? <div className="empty-state"><div className="empty-art"><span>＋</span></div><h3>{dayTasks.length ? "В этой категории пусто" : "День начинается с идеи"}</h3><p>{dayTasks.length ? "Выбери другую категорию или добавь задачу." : "Добавь первую задачу и собери свой ритм на сегодня."}</p><button className="primary-button" onClick={() => openNew()}>＋ Добавить задачу</button></div> : shownTasks.map(task => <article className={task.done ? "task-card completed" : "task-card"} key={task.id}>
              <button className={task.done ? "task-check checked" : "task-check"} onClick={() => toggleDone(task.id)} aria-label={task.done ? "Отменить выполнение" : "Отметить выполненной"}>{task.done ? "✓" : ""}</button>
              <button className="task-main" onClick={() => openEdit(task)}><span className="task-time">{timeText(task.start)} <i /> {endTimeText(task.start + task.duration)}</span><strong>{task.title}</strong>{task.note && <span className="task-note">{task.note}</span>}<span className="task-meta"><i style={{ background: COLORS[task.category] }} />{task.category}<span>·</span>{task.duration >= 60 ? `${Math.floor(task.duration / 60)} ч${task.duration % 60 ? ` ${task.duration % 60} мин` : ""}` : `${task.duration} мин`}</span></button>
              <button className="more-button" onClick={() => openEdit(task)} aria-label="Изменить задачу">···</button>
            </article>)}
          </div>
          {dayTasks.length > 0 && <button className="add-task-bottom" onClick={() => openNew()}>＋ Добавить задачу</button>}
          <div className="task-footer"><span><span className="status-dot" /> Данные сохраняются автоматически</span><span>{doneCount === dayTasks.length && dayTasks.length > 0 ? "Отличная работа!" : `Ещё ${dayTasks.length - doneCount} ${dayTasks.length - doneCount === 1 ? "задача" : "задач"} впереди`}</span></div>
        </section>
      </div>

      <footer className="app-footer"><span>dayrhythm.ai <span className="footer-dot">·</span> Найди свой ритм.</span><span>Твои данные остаются у тебя <span className="privacy-mark">↗</span></span></footer>
      </>}

      {view !== "day" && <FeaturePanels
        view={view}
        tasks={tasks}
        selectedDate={selectedDate}
        theme={theme}
        onSelectDate={setSelectedDate}
        onToggle={toggleDone}
        onEdit={openEdit}
        onAddInbox={addInboxTask}
        onScheduleInbox={scheduleInboxTask}
        onAddParsed={addParsedTask}
        onThemeChange={setTheme}
        onExport={exportData}
        onImport={importData}
      />}

      {showForm && <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) resetForm(); }}><section className="task-modal" role="dialog" aria-modal="true" aria-labelledby="form-title"><div className="modal-head"><div><div className="eyebrow">{editing ? "НАСТРОЙКА ПЛАНА" : "НОВАЯ ЗАПИСЬ"}</div><h2 id="form-title">{editing ? "Изменить задачу" : "Добавить задачу"}</h2></div><button className="icon-button" onClick={resetForm} aria-label="Закрыть">×</button></div>
        <form onSubmit={saveTask}><label className="field-label">Название задачи<input autoFocus value={title} onChange={e => setTitle(e.target.value)} placeholder="Например, тренировка на станке" maxLength={100} required /></label>
          <div className="field-grid"><label className="field-label">Начало<input type="time" value={start} onChange={e => setStart(e.target.value)} required /></label><label className="field-label">Длительность<select value={duration} onChange={e => setDuration(e.target.value)}>{[5,15,30,45,60,75,90,120,150,180,240,300,360,480,600,720].map(n => <option value={n} key={n}>{n < 60 ? `${n} минут` : `${Math.floor(n / 60)} ч${n % 60 ? ` ${n % 60} мин` : ""}`}</option>)}</select></label></div>
          <label className="field-label">Категория<div className="category-picker">{CATEGORIES.map(cat => <button type="button" key={cat} onClick={() => setCategory(cat)} className={category === cat ? "category-option active" : "category-option"}><i style={{ background: COLORS[cat] }} />{cat}</button>)}</div></label>
          <label className="field-label">Заметка <span className="optional-label">необязательно</span><textarea value={note} onChange={e => setNote(e.target.value)} placeholder="Что важно не забыть?" rows={2} maxLength={300} /></label>
          <div className="modal-actions">{editing && <button type="button" className="delete-button" onClick={() => { deleteTask(editing); resetForm(); }}>Удалить</button>}<button type="button" className="outline-button" onClick={resetForm}>Отмена</button><button className="primary-button" type="submit">{editing ? "Сохранить" : "Добавить задачу"}</button></div>
        </form></section></div>}
      <div className="sr-only" aria-live="polite">{notice}</div>
    </main>
  );
}
