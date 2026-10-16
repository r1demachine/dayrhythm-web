"use client";

import { FormEvent, PointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
const pad = (n: number) => String(n).padStart(2, "0");
const timeText = (minutes: number) => `${pad(Math.floor(minutes / 60) % 24)}:${pad(minutes % 60)}`;
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
  const a = polar(start, outer), b = polar(start + duration, outer);
  const c = polar(start + duration, inner), d = polar(start, inner);
  const large = duration > 360 ? 1 : 0;
  return `M ${a.x} ${a.y} A ${outer} ${outer} 0 ${large} 1 ${b.x} ${b.y} L ${c.x} ${c.y} A ${inner} ${inner} 0 ${large} 0 ${d.x} ${d.y} Z`;
};

export default function Home() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [view, setView] = useState<AppView>("day");
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
    const update = () => {
      const d = new Date();
      setNow(d.getHours() * 60 + d.getMinutes());
    };
    update();
    const timer = window.setInterval(update, 30000);
    return () => window.clearInterval(timer);
  }, []);

  const dayTasks = useMemo(() => tasks.filter(t => t.date === selectedDate).sort((a, b) => a.start - b.start), [tasks, selectedDate]);
  const shownTasks = dayTasks.filter(t => filter === "Все" || t.category === filter);
  const doneCount = dayTasks.filter(t => t.done).length;
  const plannedMinutes = dayTasks.reduce((sum, t) => sum + t.duration, 0);
  const freeMinutes = Math.max(0, 1440 - plannedMinutes);
  const activeTask = dayTasks.find(t => now >= t.start && now < t.start + t.duration);
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
  const pointerMinute = (event: PointerEvent<SVGSVGElement>) => {
    if (!dialRef.current) return 0;
    const rect = dialRef.current.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 400;
    const y = ((event.clientY - rect.top) / rect.height) * 400;
    const angle = (Math.atan2(y - 200, x - 200) + Math.PI / 2 + Math.PI * 2) % (Math.PI * 2);
    return Math.min(1435, Math.max(0, Math.round((dialAnchor + angle / (Math.PI * 2) * 720) / 15) * 15));
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
          <div className="panel-heading"><div><div className="eyebrow">12 ЧАСОВ В ФОКУСЕ · ВСЕ ДЕЛА ВИДНЫ</div><h2>Круг твоего дня</h2></div><span className="live-pill"><span /> {selectedDate === todayString() ? "СЕГОДНЯ" : "ПЛАН"}</span></div>
          <div className="dial-wrap">
            {dragPreview && <div className="drag-time-preview">Новое время: <strong>{timeText(dragPreview.minute)}</strong></div>}
            <svg ref={dialRef} className="dial" viewBox="0 0 400 400" role="img" aria-label="Круговой циферблат суток" onPointerMove={onDialPointerMove} onPointerUp={onDialPointerUp} onPointerCancel={onDialPointerCancel}>
              <defs><filter id="softShadow" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="5" stdDeviation="7" floodOpacity=".09" /></filter></defs>
              <circle cx="200" cy="200" r="166" className="dial-track" />
              {Array.from({ length: 12 }, (_, hour) => {
                const minute = hour * 60;
                const a = polar(minute, hour % 3 === 0 ? 174 : 169);
                const b = polar(minute, hour % 3 === 0 ? 158 : 163);
                return <g key={hour}><line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={hour % 3 === 0 ? "major-tick" : "minor-tick"} /><text x={polar(minute, 145).x} y={polar(minute, 145).y} className="hour-label">{timeText((dialAnchor + minute) % 1440)}</text></g>;
              })}
              {dayTasks.map(task => {
                const end = task.start + task.duration;
                const upcoming = end > dialAnchor && task.start < dialAnchor + 720;
                const offset = upcoming ? Math.max(0, task.start - dialAnchor) : ((task.start - dialAnchor) % 720 + 720) % 720;
                const duration = upcoming ? Math.min(end - Math.max(task.start, dialAnchor), 720 - offset) : Math.min(task.duration, 720);
                const inner = upcoming ? 111 : 68;
                const outer = upcoming ? 139 : 91;
                return <path key={task.id} d={sectorPath(offset, duration, inner, outer)} fill={COLORS[task.category]} opacity={task.done ? .25 : upcoming ? .92 : .48} stroke="var(--panel)" strokeWidth="2" strokeLinejoin="round" className={upcoming ? "task-sector upcoming-sector" : "task-sector overflow-sector"} onPointerDown={(event) => { suppressSectorClickRef.current = false; dragRef.current = task.id; dragOriginRef.current = { x: event.clientX, y: event.clientY }; dialRef.current?.setPointerCapture(event.pointerId); }} onClick={() => { if (suppressSectorClickRef.current) { suppressSectorClickRef.current = false; return; } openEdit(task); }} tabIndex={0} role="button" aria-label={`${task.title}, ${timeText(task.start)}`} />;
              })}
              {dragPreview && (() => {
                const task = dayTasks.find(item => item.id === dragPreview.taskId);
                const offset = Math.max(0, Math.min(720, dragPreview.minute - dialAnchor));
                return task ? <path d={sectorPath(offset, Math.min(task.duration, 720 - offset), 108, 142)} fill={COLORS[task.category]} opacity=".5" stroke="var(--text)" strokeWidth="2" strokeDasharray="5 4" pointerEvents="none" /> : null;
              })()}
              <circle cx="200" cy="200" r="55" className="dial-inner" filter="url(#softShadow)" />
              <text x="200" y="183" className="center-overline">{selectedDate === todayString() ? "СЕЙЧАС" : "НАЧАЛО ОКНА"}</text>
              <text x="200" y="215" className="center-time">{timeText(dialAnchor)}</text>
              <text x="200" y="234" className="center-caption">ближайшие 12 часов</text>
              {selectedDate === todayString() && <g><line x1={polar(0, 55).x} y1={polar(0, 55).y} x2={polar(0, 174).x} y2={polar(0, 174).y} className="now-line" /><circle cx={polar(0, 174).x} cy={polar(0, 174).y} r="5" className="now-dot" /></g>}
            </svg>
          </div>
          <div className="dial-hint"><span className="hint-icon">↻</span> Внешнее кольцо — ближайшие 12 часов. Внутреннее — прошедшие дела и задачи позже. Перетаскивай сектор: время покажется над циферблатом.</div>
          <div className="legend"><span><i className="legend-dot" style={{ background: COLORS["Работа"] }} />Работа</span><span><i className="legend-dot" style={{ background: COLORS["Спорт"] }} />Спорт</span><span><i className="legend-dot" style={{ background: COLORS["Отдых"] }} />Отдых</span><span><i className="legend-dot" style={{ background: COLORS["Быт"] }} />Быт</span><span><i className="legend-dot" style={{ background: COLORS["Личное"] }} />Личное</span></div>
          <div className="day-balance"><div className="balance-head"><span>Баланс дня</span><strong>{Math.round(plannedMinutes / 1440 * 100)}% <small>распланировано</small></strong></div><div className="balance-bar"><span style={{ width: `${Math.min(100, plannedMinutes / 1440 * 100)}%` }} /></div><div className="balance-foot"><span><i className="balance-dot planned" />{Math.floor(plannedMinutes / 60)} ч занято</span><span><i className="balance-dot free" />{Math.floor(freeMinutes / 60)} ч свободно</span></div></div>
        </section>

        <section className="tasks-panel panel">
          <div className="panel-heading task-heading"><div><div className="eyebrow">ТВОЙ СПИСОК</div><h2>План на день <span className="count-badge">{dayTasks.length}</span></h2></div><button className="add-round" onClick={() => openNew()} aria-label="Добавить задачу">＋</button></div>
          <div className="filter-row"><button className={filter === "Все" ? "filter-chip selected" : "filter-chip"} onClick={() => setFilter("Все")}>Все <span>{dayTasks.length}</span></button>{CATEGORIES.map(cat => <button key={cat} className={filter === cat ? "filter-chip selected" : "filter-chip"} onClick={() => setFilter(cat)}><i style={{ background: COLORS[cat] }} />{cat}</button>)}</div>
          <div className="task-list">
            {shownTasks.length === 0 ? <div className="empty-state"><div className="empty-art"><span>＋</span></div><h3>{dayTasks.length ? "В этой категории пусто" : "День начинается с идеи"}</h3><p>{dayTasks.length ? "Выбери другую категорию или добавь задачу." : "Добавь первую задачу и собери свой ритм на сегодня."}</p><button className="primary-button" onClick={() => openNew()}>＋ Добавить задачу</button></div> : shownTasks.map(task => <article className={task.done ? "task-card completed" : "task-card"} key={task.id}>
              <button className={task.done ? "task-check checked" : "task-check"} onClick={() => toggleDone(task.id)} aria-label={task.done ? "Отменить выполнение" : "Отметить выполненной"}>{task.done ? "✓" : ""}</button>
              <button className="task-main" onClick={() => openEdit(task)}><span className="task-time">{timeText(task.start)} <i /> {timeText(task.start + task.duration)}</span><strong>{task.title}</strong>{task.note && <span className="task-note">{task.note}</span>}<span className="task-meta"><i style={{ background: COLORS[task.category] }} />{task.category}<span>·</span>{task.duration >= 60 ? `${Math.floor(task.duration / 60)} ч${task.duration % 60 ? ` ${task.duration % 60} мин` : ""}` : `${task.duration} мин`}</span></button>
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
