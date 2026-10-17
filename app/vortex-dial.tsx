"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

export type VortexTask = {
  id: string;
  title: string;
  date: string;
  start: number;
  duration: number;
  category: string;
  done: boolean;
  note: string;
  color?: string;
};

export type VortexTaskDraft = {
  date?: string;
  title: string;
  start: number;
  duration: number;
  color: string;
  note: string;
};

type Props = {
  tasks: VortexTask[];
  selectedDate: string;
  now: number;
  onAddTask: (task: VortexTaskDraft) => void;
};

export const CONFIG = {
  // Радиус и толщина главного кольца.
  R0: 112,
  W0: 12,
  // Внутренний край прошлого и внешний радиус далёкого будущего.
  R_IN: 49,
  R_OUT: 154,
  // Толщина после перехода на внешний радиус.
  w_min: 1.8,
  w_far: 1.1,
  // Длина плавного перехода после отметки +12 часов.
  tau_minutes: 90,
  past_depth_hours: 12,
  horizon_hours: 18,
  // Чем меньше шаг, тем гладче полоса, но тем больше точек SVG.
  sample_minutes: 2,
  minimum_arc_minutes: 10,
  // Расстояние между пересекающимися делами и витками длинных задач.
  lane_gap: 4.5,
  self_turn_gap: 17,
  colors: {
    work: "#6266e9",
    sport: "#f36c45",
    rest: "#20a68a",
    home: "#d6a52d",
    personal: "#bc75c9",
    extra: "#42a5f5"
  }
} as const;

type Point = { x: number; y: number };
type Occurrence = {
  key: string;
  task: VortexTask;
  startAbs: number;
  startDelta: number;
  endDelta: number;
  visibleStart: number;
  visibleEnd: number;
  lane: number;
  path: string;
  centerPath: string;
  startCap: Point;
  endCap: Point;
  startWidth: number;
  endWidth: number;
  label: string;
  labelOffset: number;
  color: string;
  current: boolean;
  status: string;
};

const pad = (n: number) => String(n).padStart(2, "0");
const wrapMinute = (n: number) => ((n % 1440) + 1440) % 1440;
const clockText = (n: number) => {
  if (Math.abs(n - 1440) < 0.01) return "24:00";
  return pad(Math.floor(wrapMinute(n) / 60)) + ":" + pad(Math.floor(wrapMinute(n) % 60));
};
const shiftDate = (date: string, days: number) => {
  const value = new Date(date + "T12:00:00");
  value.setDate(value.getDate() + days);
  return value.getFullYear() + "-" + pad(value.getMonth() + 1) + "-" + pad(value.getDate());
};
const smoothstep = (value: number) => {
  const x = Math.max(0, Math.min(1, value));
  return x * x * (3 - 2 * x);
};
const polar = (absoluteMinute: number, radius: number, cx = 200, cy = 200): Point => {
  const clockMinute = ((absoluteMinute % 720) + 720) % 720;
  const angle = clockMinute / 720 * Math.PI * 2 - Math.PI / 2;
  return {
    x: Number((cx + Math.cos(angle) * radius).toFixed(3)),
    y: Number((cy + Math.sin(angle) * radius).toFixed(3))
  };
};
const fmtDuration = (minutes: number) => {
  const rounded = Math.max(0, Math.round(minutes));
  const hours = Math.floor(rounded / 60);
  const mins = rounded % 60;
  if (hours && mins) return hours + " ч " + mins + " мин";
  if (hours) return hours + " ч";
  return mins + " мин";
};
const taskColor = (task: VortexTask) => task.color || CONFIG.colors[task.category === "Работа" ? "work" : task.category === "Спорт" ? "sport" : task.category === "Отдых" ? "rest" : task.category === "Быт" ? "home" : "personal"];

function shapeAt(delta: number, lane: number, taskDuration: number) {
  const pastDepth = CONFIG.past_depth_hours * 60;
  let radius = CONFIG.R0;
  let width = CONFIG.W0;

  if (delta < 0) {
    const progress = smoothstep((-delta) / pastDepth);
    radius = CONFIG.R0 - (CONFIG.R0 - CONFIG.R_IN) * progress;
    width = CONFIG.W0 - (CONFIG.W0 - CONFIG.w_min) * progress;
  } else if (delta <= 720) {
    radius = CONFIG.R0;
    width = CONFIG.W0;
  } else if (delta <= 720 + CONFIG.tau_minutes) {
    const progress = smoothstep((delta - 720) / CONFIG.tau_minutes);
    radius = CONFIG.R0 + (CONFIG.R_OUT - CONFIG.R0) * progress;
    width = CONFIG.W0 + (CONFIG.w_min - CONFIG.W0) * progress;
  } else {
    radius = CONFIG.R_OUT;
    width = CONFIG.w_far;
  }

  if (taskDuration > 720) {
    if (delta < 0) {
      radius -= CONFIG.self_turn_gap * smoothstep((-delta) / pastDepth);
    } else if (delta > 720) {
      radius += CONFIG.self_turn_gap * smoothstep((delta - 720) / CONFIG.tau_minutes);
    }
  }

  radius += Math.min(lane, 4) * CONFIG.lane_gap;
  if (delta >= 720 + CONFIG.tau_minutes) width = CONFIG.w_far;
  return { radius, width };
}

function buildRibbonPath(start: number, end: number, now: number, lane: number, taskDuration: number) {
  const visibleLength = Math.max(0, end - start);
  const count = Math.max(2, Math.ceil(visibleLength / CONFIG.sample_minutes));
  const samples = new Set<number>();
  for (let i = 0; i <= count; i += 1) samples.add(start + visibleLength * i / count);
  [-CONFIG.past_depth_hours * 60, 0, 720, 720 + CONFIG.tau_minutes, CONFIG.horizon_hours * 60].forEach(boundary => {
    if (boundary >= start && boundary <= end) samples.add(boundary);
  });
  const times = Array.from(samples).sort((a, b) => a - b);
  const outer: Point[] = [];
  const inner: Point[] = [];
  const center: Point[] = [];
  const widths: number[] = [];
  times.forEach(delta => {
    const shape = shapeAt(delta, lane, taskDuration);
    const clockMinute = now + delta;
    outer.push(polar(clockMinute, shape.radius + shape.width));
    inner.push(polar(clockMinute, Math.max(8, shape.radius - shape.width)));
    center.push(polar(clockMinute, shape.radius));
    widths.push(shape.width);
  });
  const outerPath = outer.map((p, i) => (i === 0 ? "M " : "L ") + p.x + " " + p.y).join(" ");
  const innerPath = inner.slice().reverse().map(p => "L " + p.x + " " + p.y).join(" ");
  const path = outerPath + " " + innerPath + " Z";
  const centerPath = center.map((p, i) => (i === 0 ? "M " : "L ") + p.x + " " + p.y).join(" ");
  const widest = widths.reduce((best, width, i) => width > widths[best] ? i : best, 0);
  const widePoint = times[widest];
  const mainStart = Math.max(start, 0);
  const mainEnd = Math.min(end, 720);
  const labelPoint = mainEnd > mainStart ? (mainStart + mainEnd) / 2 : widePoint;
  const labelOffset = Math.max(0, Math.min(100, (labelPoint - start) / Math.max(1, visibleLength) * 100));
  return {
    path,
    centerPath,
    startCap: center[0],
    endCap: center[center.length - 1],
    startWidth: widths[0],
    endWidth: widths[widths.length - 1],
    labelOffset
  };
}

function labelFor(task: VortexTask, duration: number, visibleLength: number) {
  const arcMinutes = Math.min(duration, visibleLength);
  const approxPixels = arcMinutes / 720 * Math.PI * 2 * CONFIG.R0;
  if (approxPixels < 45) return "";
  const startText = clockText(task.start);
  const endText = clockText(wrapMinute(task.start + task.duration));
  const range = startText + "–" + endText;
  const maximumChars = Math.floor(approxPixels / 5.8);
  const full = task.title + " · " + range;
  if (maximumChars >= full.length) return full;
  if (maximumChars >= range.length + 5) {
    const titleLength = maximumChars - range.length - 3;
    return task.title.slice(0, Math.max(2, titleLength - 1)) + "… · " + range;
  }
  if (maximumChars >= range.length) return range;
  return "";
}

function assignLanes(events: Array<Omit<Occurrence, "lane" | "path" | "centerPath" | "startCap" | "endCap" | "startWidth" | "endWidth" | "label" | "labelOffset" | "color" | "current" | "status">>) {
  const laneEnds: number[] = [];
  return events.slice().sort((a, b) => a.visibleStart - b.visibleStart || a.visibleEnd - b.visibleEnd).map(event => {
    let lane = laneEnds.findIndex(end => end <= event.visibleStart);
    if (lane < 0) lane = laneEnds.length;
    laneEnds[lane] = event.visibleEnd;
    return { ...event, lane: Math.min(lane, 4) };
  });
}

export default function VortexDial({ tasks, selectedDate, now, onAddTask }: Props) {
  const [simulation, setSimulation] = useState(false);
  const [simulationMinute, setSimulationMinute] = useState(Math.max(0, Math.min(1440, now)));
  const [hoveredTask, setHoveredTask] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftStart, setDraftStart] = useState("09:00");
  const [draftEnd, setDraftEnd] = useState("10:00");
  const [draftColor, setDraftColor] = useState<string>(CONFIG.colors.work);
  const [draftNote, setDraftNote] = useState("");
  const [formError, setFormError] = useState("");
  const [liveMinute, setLiveMinute] = useState(now);

  useEffect(() => {
    const update = () => {
      const date = new Date();
      setLiveMinute(date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60);
    };
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!simulation) setSimulationMinute(Math.max(0, Math.min(1440, now)));
  }, [now, simulation]);

  const effectiveNow = simulation ? simulationMinute : liveMinute;
  const prevDate = useMemo(() => shiftDate(selectedDate, -1), [selectedDate]);
  const nextDate = useMemo(() => shiftDate(selectedDate, 1), [selectedDate]);

  const events = useMemo(() => {
    const candidates: Array<Omit<Occurrence, "lane" | "path" | "centerPath" | "startCap" | "endCap" | "startWidth" | "endWidth" | "label" | "labelOffset" | "color" | "current" | "status">> = [];
    const taskDates = new Map<string, number>([[prevDate, -1440], [selectedDate, 0], [nextDate, 1440]]);
    const pastDepth = CONFIG.past_depth_hours * 60;
    const horizon = CONFIG.horizon_hours * 60;
    tasks.forEach(task => {
      if (!taskDates.has(task.date)) return;
      const startAbs = (taskDates.get(task.date) || 0) + task.start;
      const startDelta = startAbs - effectiveNow;
      const endDelta = startDelta + task.duration;
      if (endDelta <= 0 || endDelta < -pastDepth || startDelta > horizon) return;
      let visibleStart = Math.max(startDelta, -pastDepth);
      let visibleEnd = Math.min(endDelta, horizon);
      if (visibleEnd - visibleStart < CONFIG.minimum_arc_minutes && startDelta <= horizon && endDelta >= -pastDepth) {
        visibleEnd = Math.min(horizon, visibleStart + CONFIG.minimum_arc_minutes);
        visibleStart = Math.max(-pastDepth, visibleEnd - CONFIG.minimum_arc_minutes);
      }
      if (visibleEnd <= visibleStart) return;
      candidates.push({
        key: task.id + "-" + task.date,
        task,
        startAbs,
        startDelta,
        endDelta,
        visibleStart,
        visibleEnd
      });
    });
    return assignLanes(candidates).map(event => {
      const ribbon = buildRibbonPath(event.visibleStart, event.visibleEnd, effectiveNow, event.lane, event.task.duration);
      const duration = event.visibleEnd - event.visibleStart;
      const current = event.startDelta <= 0 && event.endDelta > 0;
      const status = current
        ? "Осталось " + fmtDuration(event.endDelta)
        : event.startDelta > 0
          ? "Начнётся через " + fmtDuration(event.startDelta)
          : "Завершилось " + fmtDuration(-event.endDelta) + " назад";
      return {
        ...event,
        ...ribbon,
        label: labelFor(event.task, event.task.duration, duration),
        color: taskColor(event.task),
        current,
        status
      };
    });
  }, [tasks, prevDate, selectedDate, nextDate, effectiveNow]);

  const currentTask = events.find(event => event.current);
  const cursor = polar(effectiveNow, CONFIG.R_OUT + 12);
  const hourLabels = [0, 3, 6, 9].map(hour => {
    const currentHour = Math.floor(effectiveNow / 60);
    let candidate = Math.floor(currentHour / 12) * 720 + hour * 60;
    while (candidate < currentHour * 60) candidate += 720;
    const absoluteHour = Math.floor(candidate / 60);
    const label = absoluteHour % 24 === 0 ? "24/0" : String(absoluteHour % 24);
    const point = polar(hour * 60, CONFIG.R_OUT + 23);
    return { label, x: point.x, y: point.y, hour };
  });

  const addTask = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const startParts = draftStart.split(":").map(Number);
    const endParts = draftEnd.split(":").map(Number);
    const start = startParts[0] * 60 + startParts[1];
    const end = endParts[0] * 60 + endParts[1];
    const duration = (end - start + 1440) % 1440;
    if (!draftTitle.trim()) {
      setFormError("Введи название дела.");
      return;
    }
    if (duration === 0) {
      setFormError("Время окончания должно отличаться от начала.");
      return;
    }
    onAddTask({ title: draftTitle.trim(), start, duration, color: draftColor, note: draftNote.trim() });
    setDraftTitle("");
    setDraftNote("");
    setDraftStart("09:00");
    setDraftEnd("10:00");
    setFormError("");
    setFormOpen(false);
  };

  const addDemoTasks = () => {
    const demo = [
      { date: selectedDate, title: "Фокус и планирование", start: 8 * 60, duration: 150, color: CONFIG.colors.work, note: "Текущее дело с видимым прошлым участком." },
      { date: selectedDate, title: "Рабочий блок", start: 14 * 60, duration: 120, color: CONFIG.colors.sport, note: "Полная дуга в основном 12-часовом кольце." },
      { date: selectedDate, title: "Вечерний план", start: 20 * 60, duration: 120, color: CONFIG.colors.rest, note: "Переходит в тонкую внешнюю дугу после 12 часов." },
      { date: selectedDate, title: "Ночной блок", start: 2 * 60, duration: 120, color: CONFIG.colors.personal, note: "Демо для симуляции 03:00." },
      { date: nextDate, title: "Ночной блок", start: 2 * 60, duration: 120, color: CONFIG.colors.personal, note: "Повтор на следующую ночь для теста горизонта 18 часов." }
    ];
    demo.forEach(item => onAddTask({ date: item.date, title: item.title, start: item.start, duration: item.duration, color: item.color, note: item.note }));
  };

  return (
    <section className="vortex-view">
      <div className="vortex-toolbar">
        <div className="vortex-mode-description">
          <span className="vortex-kicker">ДИНАМИЧЕСКАЯ ШКАЛА ВРЕМЕНИ</span>
          <strong>Водоворот ближайших 18 часов</strong>
          <small>Прошлое сужается к центру, дальние дела уходят наружу.</small>
        </div>
        <div className="vortex-actions">
          <button className="outline-button" type="button" onClick={() => setFormOpen(true)}>＋ Дело</button>
          <button className="outline-button" type="button" onClick={addDemoTasks}>Демо-дела</button>
        </div>
      </div>

      <div className="vortex-simulation">
        <label className="vortex-simulation-toggle">
          <input type="checkbox" checked={simulation} onChange={event => setSimulation(event.target.checked)} />
          <span>Симуляция времени</span>
        </label>
        <div className="vortex-slider-label"><span>Сейчас</span><strong>{clockText(effectiveNow)}</strong></div>
        <input className="vortex-time-slider" type="range" min={0} max={1440} step={1} value={simulation ? simulationMinute : Math.floor(liveMinute)} disabled={!simulation} onChange={event => setSimulationMinute(Number(event.target.value))} aria-label="Симулируемое время от 00:00 до 24:00" />
        <div className="vortex-slider-ends"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>24:00</span></div>
      </div>

      <div className="vortex-stage">
        <svg className="vortex-dial" viewBox="0 0 400 400" role="img" aria-label="Водоворот расписания на 12-часовом циферблате">
          <defs>
            <filter id="vortexShadow" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="5" stdDeviation="7" floodOpacity=".09" /></filter>
          </defs>
          <circle cx="200" cy="200" r={CONFIG.R_OUT} className="vortex-track" />
          <circle cx="200" cy="200" r={CONFIG.R0} className="vortex-main-track" />
          {hourLabels.map(item => <g key={item.hour}>
            <text x={item.x} y={item.y} className="vortex-hour-label">{item.label}</text>
            <circle cx={polar(item.hour * 60, CONFIG.R_OUT - 12).x} cy={polar(item.hour * 60, CONFIG.R_OUT - 12).y} r="2.3" className="vortex-hour-dot" />
          </g>)}
          {events.map(event => <g key={event.key} className="vortex-event" role="button" tabIndex={0} aria-label={event.task.title + ", " + clockText(event.task.start) + "–" + clockText(wrapMinute(event.task.start + event.task.duration))}>
            <path id={"vortex-center-" + event.key} d={event.centerPath} fill="none" stroke="none" />
            <path d={event.path} fill={event.color} opacity={event.task.done ? .28 : event.current ? .98 : event.endDelta <= 0 ? .48 : event.startDelta >= 720 + CONFIG.tau_minutes ? .45 : .88} className="vortex-ribbon" onMouseEnter={() => setHoveredTask(event.key)} onMouseLeave={() => setHoveredTask(null)} onClick={() => setHoveredTask(event.key)} />
            <circle cx={event.startCap.x} cy={event.startCap.y} r={event.startWidth} fill={event.color} opacity={event.task.done ? .28 : event.current ? .98 : .86} className="vortex-cap" pointerEvents="none" />
            <circle cx={event.endCap.x} cy={event.endCap.y} r={event.endWidth} fill={event.color} opacity={event.task.done ? .28 : event.current ? .98 : .86} className="vortex-cap" pointerEvents="none" />
            {event.label && <text className="vortex-label"><textPath href={"#vortex-center-" + event.key} startOffset={event.labelOffset + "%"} textAnchor="middle">{event.label}</textPath></text>}
          </g>)}
          <line x1="200" y1="200" x2={cursor.x} y2={cursor.y} className="vortex-now-line" />
          <circle cx={cursor.x} cy={cursor.y} r="4.5" className="vortex-now-dot" />
          <circle cx="200" cy="200" r="43" className="vortex-center" filter="url(#vortexShadow)" />
          <text x="200" y="190" className="vortex-center-overline">{simulation ? "СИМУЛЯЦИЯ" : "СЕЙЧАС"}</text>
          <text x="200" y="216" className="vortex-center-time">{clockText(effectiveNow)}</text>
          <text x="200" y="234" className="vortex-center-task">{currentTask ? currentTask.task.title.slice(0, 20) : events.length ? "ближайшие дела" : "добавь первое дело"}</text>
        </svg>

        {hoveredTask && events.some(event => event.key === hoveredTask) && (() => {
          const event = events.find(item => item.key === hoveredTask);
          if (!event) return null;
          const taskDuration = event.task.duration;
          return <div className="vortex-tooltip">
            <strong>{event.task.title}</strong>
            <span className="vortex-tooltip-time">{clockText(event.task.start)}–{clockText(wrapMinute(event.task.start + taskDuration))}</span>
            <span>Длительность: {fmtDuration(taskDuration)}</span>
            <span>{event.status}</span>
            <p>{event.task.note || "Описание не добавлено."}</p>
          </div>;
        })()}
        {events.length === 0 && <div className="vortex-empty">В этом временном окне нет дел. Нажми «+ Дело» или добавь демо-дела.</div>}
      </div>

      <div className="vortex-note">Положение определяется временем суток, радиус и толщина — временем относительно текущего момента. Серая область за основным кольцом — ближайшие часы после 12-часового окна.</div>

      {formOpen && <div className="vortex-form-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setFormOpen(false); }}>
        <section className="vortex-form-card" role="dialog" aria-modal="true" aria-labelledby="vortex-form-title">
          <div className="vortex-form-heading"><div><span className="vortex-kicker">НОВОЕ ДЕЛО</span><h3 id="vortex-form-title">Добавить в водоворот</h3></div><button className="icon-button" type="button" onClick={() => setFormOpen(false)} aria-label="Закрыть">×</button></div>
          <form onSubmit={addTask}>
            <label className="field-label">Название<input autoFocus value={draftTitle} onChange={event => setDraftTitle(event.target.value)} maxLength={100} placeholder="Например, тренировка" required /></label>
            <div className="field-grid">
              <label className="field-label">Начало<input type="time" value={draftStart} onChange={event => setDraftStart(event.target.value)} required /></label>
              <label className="field-label">Конец<input type="time" value={draftEnd} onChange={event => setDraftEnd(event.target.value)} required /></label>
            </div>
            <label className="field-label">Цвет<input className="vortex-color-input" type="color" value={draftColor} onChange={event => setDraftColor(event.target.value)} /></label>
            <label className="field-label">Описание<textarea value={draftNote} onChange={event => setDraftNote(event.target.value)} maxLength={500} rows={3} placeholder="Что важно знать об этом деле?" /></label>
            {formError && <p className="vortex-form-error">{formError}</p>}
            <div className="modal-actions"><button className="outline-button" type="button" onClick={() => setFormOpen(false)}>Отмена</button><button className="primary-button" type="submit">Добавить дело</button></div>
          </form>
          <p className="vortex-form-help">Если время окончания раньше начала, дело автоматически продолжается через полночь.</p>
        </section>
      </div>}
    </section>
  );
}
