"use client";

import { FormEvent, useMemo, useState } from "react";

export type WebCategory = "Работа" | "Спорт" | "Отдых" | "Быт" | "Личное";
export type WebTask = {
  id: string;
  title: string;
  date: string;
  start: number;
  duration: number;
  category: WebCategory;
  done: boolean;
  note: string;
};
export type ParsedWebTask = {
  title: string;
  description?: string;
  date: string;
  startTime: number;
  endTime: number;
  emoji?: string;
  category?: string;
};
export type FeatureView = "timeline" | "inbox" | "insights" | "ai" | "settings";

const CATEGORIES: WebCategory[] = ["Работа", "Спорт", "Отдых", "Быт", "Личное"];
const COLORS: Record<WebCategory, string> = {
  "Работа": "#6266e9",
  "Спорт": "#f36c45",
  "Отдых": "#20a68a",
  "Быт": "#d6a52d",
  "Личное": "#bc75c9"
};
const pad = (n: number) => String(n).padStart(2, "0");
const timeText = (minutes: number) => `${pad(Math.floor(minutes / 60) % 24)}:${pad(minutes % 60)}`;
const durationText = (minutes: number) => minutes >= 60 ? `${Math.floor(minutes / 60)} ч${minutes % 60 ? ` ${minutes % 60} мин` : ""}` : `${minutes} мин`;
const dateLabel = (value: string) => value ? new Date(value + "T12:00:00").toLocaleDateString("ru-RU", { day: "numeric", month: "long", weekday: "short" }) : "Без даты";

type Props = {
  view: FeatureView;
  tasks: WebTask[];
  selectedDate: string;
  theme: "light" | "dark";
  onSelectDate: (date: string) => void;
  onToggle: (id: string) => void;
  onEdit: (task: WebTask) => void;
  onAddInbox: (title: string, note: string) => void;
  onScheduleInbox: (id: string) => void;
  onAddParsed: (task: ParsedWebTask) => void;
  onThemeChange: (theme: "light" | "dark") => void;
  onExport: () => void;
  onImport: (file?: File) => void;
};

export default function FeaturePanels(props: Props) {
  const { view, tasks, selectedDate } = props;
  const [inboxTitle, setInboxTitle] = useState("");
  const [inboxNote, setInboxNote] = useState("");
  const [prompt, setPrompt] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");
  const [parsed, setParsed] = useState<ParsedWebTask[]>([]);
  const [uploadName, setUploadName] = useState("");

  const dayTasks = useMemo(() => tasks.filter(task => task.date === selectedDate).sort((a, b) => a.start - b.start), [tasks, selectedDate]);
  const inboxTasks = useMemo(() => tasks.filter(task => !task.date).sort((a, b) => a.title.localeCompare(b.title, "ru")), [tasks]);
  const planned = dayTasks.reduce((sum, task) => sum + task.duration, 0);
  const completed = dayTasks.filter(task => task.done).length;
  const byCategory = CATEGORIES.map(category => ({
    category,
    minutes: dayTasks.filter(task => task.category === category).reduce((sum, task) => sum + task.duration, 0),
    count: dayTasks.filter(task => task.category === category).length
  })).filter(item => item.minutes > 0);
  const hourly = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    minutes: dayTasks.reduce((sum, task) => {
      const overlap = Math.max(0, Math.min(task.start + task.duration, (hour + 1) * 60) - Math.max(task.start, hour * 60));
      return sum + overlap;
    }, 0)
  }));
  const free = Math.max(0, 1440 - planned);
  const topCategory = [...byCategory].sort((a, b) => b.minutes - a.minutes)[0];

  const addInbox = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!inboxTitle.trim()) return;
    props.onAddInbox(inboxTitle.trim(), inboxNote.trim());
    setInboxTitle("");
    setInboxNote("");
  };

  const parseSchedule = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!prompt.trim()) return;
    setAiLoading(true);
    setAiError("");
    setParsed([]);
    try {
      const response = await fetch("/api/ai/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, currentDate: selectedDate })
      });
      const data = await response.json() as { tasks?: ParsedWebTask[]; error?: string };
      if (!response.ok) throw new Error(data.error || "Не удалось разобрать расписание.");
      if (!data.tasks?.length) throw new Error("AI не нашёл задач. Попробуй уточнить время и названия.");
      setParsed(data.tasks);
    } catch (error) {
      setAiError(error instanceof Error ? error.message : "Ошибка AI-планировщика.");
    } finally {
      setAiLoading(false);
    }
  };

  const parseImage = async (file?: File) => {
    if (!file) return;
    setUploadName(file.name);
    setAiError("Разбор изображений будет включён после настройки Gemini API. Сейчас доступен разбор текста.");
  };

  if (view === "timeline") return (
    <section className="feature-page">
      <div className="feature-heading"><div><div className="eyebrow">РАСПИСАНИЕ ПО ВРЕМЕНИ</div><h2>Timeline</h2><p>Хронологическая шкала дня с продолжительностью каждой задачи.</p></div><input aria-label="Дата расписания" type="date" value={selectedDate} onChange={e => props.onSelectDate(e.target.value)} /></div>
      <div className="timeline-summary"><div><strong>{dayTasks.length}</strong><span>задач</span></div><div><strong>{durationText(planned)}</strong><span>занято</span></div><div><strong>{durationText(free)}</strong><span>свободно</span></div></div>
      <div className="timeline-ruler">{Array.from({ length: 25 }, (_, hour) => <div className="timeline-hour" key={hour}><span>{pad(hour % 24)}:00</span><i /></div>)}</div>
      <div className="timeline-events">{dayTasks.length === 0 ? <div className="feature-empty"><h3>На этот день пока нет задач</h3><p>Создай задачу на главном экране, чтобы она появилась на шкале.</p></div> : dayTasks.map(task => <article className="timeline-event" key={task.id} style={{ borderLeftColor: COLORS[task.category] }}><div className="timeline-event-time">{timeText(task.start)} — {timeText(task.start + task.duration)}</div><button className="timeline-event-title" onClick={() => props.onEdit(task)}>{task.done ? "✓ " : ""}{task.title}</button><div className="timeline-event-meta">{task.category} · {durationText(task.duration)}{task.note ? ` · ${task.note}` : ""}</div><button className="small-action" onClick={() => props.onToggle(task.id)}>{task.done ? "Вернуть в план" : "Выполнено"}</button></article>)}</div>
    </section>
  );

  if (view === "inbox") return (
    <section className="feature-page">
      <div className="feature-heading"><div><div className="eyebrow">СНАЧАЛА СОБЕРИ, ПОТОМ РАСПЛАНИРУЙ</div><h2>Входящие</h2><p>Быстро записывай идеи и дела без времени. Позже добавь их в расписание.</p></div><span className="count-badge">{inboxTasks.length}</span></div>
      <form className="inbox-capture panel" onSubmit={addInbox}><label className="field-label">Что нужно сделать?<input value={inboxTitle} onChange={e => setInboxTitle(e.target.value)} placeholder="Например, записаться к врачу" maxLength={120} required /></label><label className="field-label">Заметка <span className="optional-label">необязательно</span><textarea value={inboxNote} onChange={e => setInboxNote(e.target.value)} placeholder="Контекст, детали, ссылка…" rows={2} maxLength={500} /></label><button className="primary-button" type="submit">＋ Добавить во входящие</button></form>
      <div className="inbox-list">{inboxTasks.length === 0 ? <div className="feature-empty"><h3>Входящие пока пусты</h3><p>Добавь сюда любое дело, даже если ещё не знаешь, когда его выполнить.</p></div> : inboxTasks.map(task => <article className="inbox-item panel" key={task.id}><span className="inbox-marker">↳</span><div className="inbox-item-main"><strong>{task.title}</strong>{task.note && <p>{task.note}</p>}<span>Без даты · {task.category}</span></div><button className="small-action" onClick={() => props.onScheduleInbox(task.id)}>Запланировать на {dateLabel(selectedDate)}</button><button className="small-action" onClick={() => props.onEdit(task)}>Изменить</button></article>)}</div>
    </section>
  );

  if (view === "insights") return (
    <section className="feature-page">
      <div className="feature-heading"><div><div className="eyebrow">АНАЛИЗ ВРЕМЕНИ</div><h2>Аналитика дня</h2><p>{dateLabel(selectedDate)} · обзор распределения времени и выполнения плана.</p></div><input aria-label="Дата аналитики" type="date" value={selectedDate} onChange={e => props.onSelectDate(e.target.value)} /></div>
      <div className="insight-stat-grid"><article className="insight-stat panel"><span>Всего задач</span><strong>{dayTasks.length}</strong><small>{completed} выполнено</small></article><article className="insight-stat panel"><span>Запланировано</span><strong>{durationText(planned)}</strong><small>{Math.round(planned / 1440 * 100)}% суток</small></article><article className="insight-stat panel"><span>Свободное время</span><strong>{durationText(free)}</strong><small>с учётом длительности задач</small></article><article className="insight-stat panel"><span>Выполнение</span><strong>{dayTasks.length ? Math.round(completed / dayTasks.length * 100) : 0}%</strong><small>доля закрытых задач</small></article></div>
      <div className="insight-grid"><article className="panel insight-card"><h3>Распределение времени</h3>{byCategory.length ? byCategory.map(item => <div className="category-bar-row" key={item.category}><div><span><i style={{ background: COLORS[item.category] }} />{item.category}</span><strong>{durationText(item.minutes)}</strong></div><div className="category-bar"><i style={{ width: `${planned ? item.minutes / planned * 100 : 0}%`, background: COLORS[item.category] }} /></div></div>) : <p className="muted-copy">Добавь задачи, чтобы увидеть распределение времени.</p>}</article>
      <article className="panel insight-card"><h3>Занятость по часам</h3><div className="hourly-chart">{hourly.map(item => <div className="hourly-column" key={item.hour} title={`${pad(item.hour)}:00 — ${item.minutes} мин`}><div className="hourly-track"><i style={{ height: `${item.minutes / 60 * 100}%`, background: item.minutes ? "var(--accent-ink)" : "var(--line)" }} /></div><span>{item.hour % 3 === 0 ? pad(item.hour) : ""}</span></div>)}</div></article></div>
      <div className="panel insight-summary"><div><div className="eyebrow">КРАТКИЙ ВЫВОД</div><h3>{!dayTasks.length ? "План пока пуст" : topCategory ? `Больше всего времени — «${topCategory.category.toLowerCase()}»` : "Продолжай планировать"}</h3><p>{!dayTasks.length ? "Добавь несколько задач, чтобы получить сводку дня." : `Запланировано ${durationText(planned)}, свободно ${durationText(free)}. ${completed} из ${dayTasks.length} задач завершены.`}</p></div><div className="insight-ring" style={{ background: `conic-gradient(var(--accent-ink) ${dayTasks.length ? completed / dayTasks.length * 100 : 0}%, var(--line) 0)` }}><span>{dayTasks.length ? Math.round(completed / dayTasks.length * 100) : 0}%</span></div></div>
    </section>
  );

  if (view === "ai") return (
    <section className="feature-page">
      <div className="feature-heading"><div><div className="eyebrow">ПЛАНИРОВАНИЕ НА ЕСТЕСТВЕННОМ ЯЗЫКЕ</div><h2>AI-планировщик</h2><p>Опиши день обычным текстом — AI превратит его в список задач с датами и временем.</p></div><span className="live-pill"><span /> Groq API</span></div>
      <div className="ai-layout"><form className="panel ai-form" onSubmit={parseSchedule}><label className="field-label">Опиши расписание<textarea value={prompt} onChange={e => setPrompt(e.target.value)} rows={6} placeholder="Например: завтра в 8 завтрак, с 10 до 12 работа над проектом, в 18 тренировка на час. В среду в 15 встреча с командой." required /></label><div className="ai-examples"><button type="button" onClick={() => setPrompt("Завтра в 8:00 завтрак на 30 минут, с 10:00 до 12:00 работа над проектом, в 18:00 тренировка на 90 минут.")}>Пример расписания</button><button type="button" onClick={() => setPrompt("Сегодня: 9:00 планирование на 30 минут, 10:00 глубокая работа до 12:00, 13:00 обед на час, 18:30 велотренировка на 90 минут.")}>Пример рабочего дня</button></div><button className="primary-button" type="submit" disabled={aiLoading}>{aiLoading ? "Разбираю расписание…" : "✦ Составить расписание"}</button>{aiError && <p className="ai-error" role="alert">{aiError}</p>}<p className="ai-disclaimer">Для работы требуется GROQ_API_KEY в локальном .env.local. Ключ не передаётся в браузер.</p></form>
      <div className="panel ai-results"><div className="panel-heading"><div><div className="eyebrow">РЕЗУЛЬТАТ</div><h3>Предложенные задачи</h3></div><span className="count-badge">{parsed.length}</span></div>{parsed.length ? <>{parsed.map((task,index) => <article className="ai-task" key={`${task.date}-${task.startTime}-${index}`}><div><strong>{task.title}</strong><span>{dateLabel(task.date)} · {timeText(Math.round(task.startTime * 60))}–{timeText(Math.round(task.endTime * 60))}</span>{task.description && <p>{task.description}</p>}</div><button className="small-action" onClick={() => { props.onAddParsed(task); setParsed(old => old.filter((_,i) => i !== index)); }}>Добавить</button></article>)}<button className="outline-button" onClick={() => { parsed.forEach(props.onAddParsed); setParsed([]); }}>Добавить все в календарь</button></> : <div className="feature-empty"><div className="empty-art"><span>✦</span></div><h3>Готов к твоим идеям</h3><p>После анализа здесь появятся задачи, которые можно добавить в план по одной или все сразу.</p></div>}<div className="ai-image-import"><label className="field-label">Разобрать фото расписания <input type="file" accept="image/*" onChange={e => void parseImage(e.target.files?.[0])} /></label>{uploadName && <small>Выбрано: {uploadName}</small>}</div></div></div>
    </section>
  );

  return (
    <section className="feature-page">
      <div className="feature-heading"><div><div className="eyebrow">ПЕРСОНАЛИЗАЦИЯ</div><h2>Настройки</h2><p>Управляй оформлением и резервными копиями локальных данных.</p></div></div>
      <div className="settings-grid"><article className="panel settings-card"><h3>Внешний вид</h3><p>Выбери тему интерфейса.</p><div className="settings-options"><button className={props.theme === "light" ? "category-option active" : "category-option"} onClick={() => props.onThemeChange("light")}>☀ Светлая</button><button className={props.theme === "dark" ? "category-option active" : "category-option"} onClick={() => props.onThemeChange("dark")}>☾ Тёмная</button></div></article><article className="panel settings-card"><h3>Данные и резервная копия</h3><p>Скачай JSON-файл или восстанови задачи из ранее созданной копии.</p><div className="settings-options"><button className="primary-button" onClick={props.onExport}>Экспорт JSON</button><label className="outline-button">Импорт JSON<input type="file" accept="application/json,.json" hidden onChange={e => props.onImport(e.target.files?.[0])} /></label></div><small>Данные пока хранятся только в этом браузере. Облачная синхронизация будет добавлена отдельным этапом.</small></article><article className="panel settings-card"><h3>Хранилище</h3><p>Сейчас в локальном расписании хранится {tasks.length} задач, из них {inboxTasks.length} — во входящих.</p><p className="muted-copy">Не очищай данные сайта, если не сохранил резервную копию.</p></article><article className="panel settings-card"><h3>Интеграции</h3><p>Подготовка к следующему этапу переноса.</p><ul><li>AI-планирование — доступно после настройки ключа Groq.</li><li>Аккаунты и синхронизация — требуется Supabase.</li><li>Календарь и напоминания — веб-разрешения браузера вместо iOS API.</li></ul></article></div>
    </section>
  );
}
