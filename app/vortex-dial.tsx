"use client";

import { FormEvent, PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  DIAL_CONFIG,
  dialPolar,
  ribbonCenterPath,
  ribbonPath,
  ribbonPointAt,
  ribbonProfile,
  ribbonSamples,
  ribbonSegments,
  type RibbonSample,
} from "./dial-geometry";

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
  onMoveTask?: (taskId: string, minute: number) => void;
  isReady?: boolean;
};

type Point = { x: number; y: number };
type EventGeometry = {
  key: string;
  task: VortexTask;
  dayOffset: number;
  startDelta: number;
  endDelta: number;
  current: boolean;
  status: string;
  samples: RibbonSample[];
  segments: ReturnType<typeof ribbonSegments>;
  centerPath: string;
  labelPath: string;
  label: string;
  color: string;
  labelColor: string;
  currentPoint: Point | null;
};

const CATEGORY_COLORS: Record<string, string> = {
  Работа: "#6266e9",
  Спорт: "#e9623b",
  Отдых: "#168d75",
  Быт: "#b48617",
  Личное: "#9b58b5",
};
const pad = (value: number) => String(value).padStart(2, "0");
const wrapMinute = (value: number) => ((value % 1440) + 1440) % 1440;
const clockText = (value: number) => {
  if (Math.abs(value - 1440) < 0.01) return "24:00";
  const minute = wrapMinute(value);
  return pad(Math.floor(minute / 60)) + ":" + pad(Math.floor(minute % 60));
};
const shiftDate = (date: string, days: number) => {
  const value = new Date(date + "T12:00:00");
  value.setDate(value.getDate() + days);
  return value.getFullYear() + "-" + pad(value.getMonth() + 1) + "-" + pad(value.getDate());
};
const fmtDuration = (minutes: number) => {
  const rounded = Math.max(0, Math.round(minutes));
  const hours = Math.floor(rounded / 60);
  const mins = rounded % 60;
  if (hours && mins) return hours + " ч " + mins + " мин";
  if (hours) return hours + " ч";
  return mins + " мин";
};
const taskColor = (task: VortexTask) => task.color || CATEGORY_COLORS[task.category] || CATEGORY_COLORS.Личное;

function hexRgb(value: string) {
  const match = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(value);
  if (!match) return { r: 98, g: 102, b: 233 };
  return { r: parseInt(match[1], 16), g: parseInt(match[2], 16), b: parseInt(match[3], 16) };
}

function mixColor(color: string, target: string, amount: number) {
  const sourceRgb = hexRgb(color);
  const targetRgb = hexRgb(target);
  const blend = Math.max(0, Math.min(1, amount));
  const channel = (a: number, b: number) => Math.round(a + (b - a) * blend).toString(16).padStart(2, "0");
  return "#" + channel(sourceRgb.r, targetRgb.r) + channel(sourceRgb.g, targetRgb.g) + channel(sourceRgb.b, targetRgb.b);
}

function colorForSegment(color: string, progress: number, done: boolean) {
  const desaturated = done ? mixColor(color, "#858585", 0.7) : color;
  return mixColor(desaturated, "#ffffff", (1 - progress) * 0.25);
}

function readableLabelColor(color: string) {
  const { r, g, b } = hexRgb(color);
  const linear = (channel: number) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
  };
  const luminance = 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
  return luminance > 0.44 ? "#242620" : "#ffffff";
}

function buildLabel(task: VortexTask, samples: RibbonSample[]) {
  if (samples.length < 2) return "";
  const start = samples[0].deltaMinutes;
  const end = samples[samples.length - 1].deltaMinutes;
  const arcLength = Math.max(0, end - start) / 720 * Math.PI * 2 * DIAL_CONFIG.R0;
  if (arcLength < 64) return "";
  const startText = clockText(task.start);
  const endText = clockText(wrapMinute(task.start + task.duration));
  const timeRange = startText + "–" + endText;
  const maximumChars = Math.floor(arcLength / 5.5);
  const full = task.title + " · " + timeRange;
  if (maximumChars >= full.length) return full;
  if (maximumChars >= timeRange.length + 4) {
    const titleLength = maximumChars - timeRange.length - 3;
    return task.title.slice(0, Math.max(2, titleLength - 1)) + "… · " + timeRange;
  }
  return maximumChars >= timeRange.length ? timeRange : "";
}

function samplesForCurrentRing(samples: RibbonSample[]) {
  return samples.filter((sample) => sample.deltaMinutes >= 0 && sample.deltaMinutes <= 720);
}

function taskStatus(startDelta: number, endDelta: number, current: boolean) {
  if (current) return "Осталось " + fmtDuration(endDelta);
  if (startDelta > 0) return "Начнётся через " + fmtDuration(startDelta);
  return "Завершилось " + fmtDuration(-endDelta) + " назад";
}

function buildDemoTasks(selectedDate: string): VortexTaskDraft[] {
  const prevDate = shiftDate(selectedDate, -1);
  return [
    { date: selectedDate, title: "Утренний фокус", start: 8 * 60, duration: 150, color: CATEGORY_COLORS.Работа, note: "Дело уже идёт: прошлая часть должна сужаться к центру." },
    { date: selectedDate, title: "Короткая встреча", start: 8 * 60 + 45, duration: 90, color: CATEGORY_COLORS.Спорт, note: "Перекрывается с утренним фокусом — проверка дорожек." },
    { date: selectedDate, title: "Рабочий блок", start: 14 * 60, duration: 120, color: CATEGORY_COLORS.Работа, note: "Обычная дуга внутри ближайших 12 часов." },
    { date: selectedDate, title: "Вечерняя прогулка", start: 20 * 60, duration: 120, color: CATEGORY_COLORS.Отдых, note: "Переходит на тонкую внешнюю ленту." },
    { date: selectedDate, title: "Дело через полночь", start: 23 * 60, duration: 180, color: CATEGORY_COLORS.Быт, note: "Окончание в 02:00 следующего дня." },
    { date: prevDate, title: "Ночная смена", start: 23 * 60, duration: 360, color: CATEGORY_COLORS.Личное, note: "Перекрывает полночь и активно до 05:00." },
  ];
}

function wallClockMinute() {
  const date = new Date();
  return date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60 + date.getMilliseconds() / 60000;
}

export default function VortexDial({ tasks, selectedDate, now, onAddTask, onMoveTask, isReady = true }: Props) {
  const [simulation, setSimulation] = useState(false);
  const [simulationMinute, setSimulationMinute] = useState(Math.max(0, Math.min(1439, now)));
  const [liveMinute, setLiveMinute] = useState(now);
  const [hoveredTask, setHoveredTask] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftStart, setDraftStart] = useState("09:00");
  const [draftEnd, setDraftEnd] = useState("10:00");
  const [draftColor, setDraftColor] = useState<string>(CATEGORY_COLORS.Работа);
  const [draftNote, setDraftNote] = useState("");
  const [formError, setFormError] = useState("");
  const [dragPreview, setDragPreview] = useState<{ taskId: string; minute: number; dayOffset: number } | null>(null);

  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{ taskId: string; dayOffset: number; startX: number; startY: number } | null>(null);
  const movedRef = useRef(false);
  const suppressClickRef = useRef(false);
  const demoLoadedRef = useRef(false);
  const devTimeOverrideRef = useRef(false);

  // ?now=09:00 — только для локальной разработки и быстрой визуальной проверки.
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    const match = /^\s*(\d{1,2}):([0-5]\d)\s*$/.exec(new URLSearchParams(window.location.search).get("now") || "");
    if (!match) return;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour > 24 || (hour === 24 && minute !== 0)) return;
    const value = hour * 60 + minute;
    const initial = value === 1440 ? 0 : value;
    devTimeOverrideRef.current = true;
    setSimulationMinute(initial);
    setSimulation(true);
  }, []);

  // В обычном режиме циферблат перетекает между минутами через requestAnimationFrame.
  // В системном режиме reduced motion оставляем секундное обновление без интерполяции.
  useEffect(() => {
    if (simulation) return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    let lastUpdate = 0;
    let interval = 0;

    if (media.matches) {
      const update = () => setLiveMinute(wallClockMinute());
      update();
      interval = window.setInterval(update, 1000);
      return () => window.clearInterval(interval);
    }

    const animate = (timestamp: number) => {
      if (timestamp - lastUpdate >= 40) {
        const target = wallClockMinute();
        setLiveMinute((previous) => {
          let delta = target - previous;
          if (delta < -720) delta += 1440;
          if (delta > 720) delta -= 1440;
          const next = previous + delta * 0.18;
          return wrapMinute(Math.abs(next - target) < 0.001 ? target : next);
        });
        lastUpdate = timestamp;
      }
      frame = window.requestAnimationFrame(animate);
    };
    frame = window.requestAnimationFrame(animate);
    return () => window.cancelAnimationFrame(frame);
  }, [simulation]);

  useEffect(() => {
    if (!simulation && !devTimeOverrideRef.current) setSimulationMinute(Math.max(0, Math.min(1439, now)));
  }, [now, simulation]);

  const effectiveNow = simulation ? simulationMinute : liveMinute;
  const prevDate = useMemo(() => shiftDate(selectedDate, -1), [selectedDate]);
  const nextDate = useMemo(() => shiftDate(selectedDate, 1), [selectedDate]);
  const taskDates = useMemo(() => new Map<string, number>([[prevDate, -1], [selectedDate, 0], [nextDate, 1]]), [prevDate, selectedDate, nextDate]);
  useEffect(() => {
    if (process.env.NODE_ENV !== "development" || !isReady || demoLoadedRef.current) return;
    if (new URLSearchParams(window.location.search).get("demo") !== "1") return;
    demoLoadedRef.current = true;
    const demo = buildDemoTasks(selectedDate);
    demo.filter((item) => !tasks.some((task) => task.date === item.date && task.title === item.title && task.start === item.start && task.duration === item.duration))
      .forEach(onAddTask);
  }, [isReady, selectedDate, tasks, onAddTask]);


  const events = useMemo<EventGeometry[]>(() => {
    const prepared = tasks.flatMap((task) => {
      const dayOffset = taskDates.get(task.date);
      if (dayOffset === undefined || task.duration <= 0) return [];
      const startDelta = task.start + dayOffset * 1440 - effectiveNow;
      const endDelta = startDelta + task.duration;
      const visiblePast = -DIAL_CONFIG.pastFadeHours * 60;
      const visibleFuture = DIAL_CONFIG.horizonHours * 60;
      if (endDelta < visiblePast || startDelta > visibleFuture) return [];
      const current = !task.done && startDelta <= 0 && endDelta > 0;
      return [{ task, dayOffset, startDelta, endDelta, current, key: task.id + "-" + task.date }];
    }).sort((a, b) => a.startDelta - b.startDelta || a.endDelta - b.endDelta);

    const lanes: number[] = [];
    const withLanes = prepared.map((event) => {
      let lane = lanes.findIndex((end) => end <= event.startDelta);
      if (lane < 0) lane = lanes.length;
      lanes[lane] = event.endDelta;
      return { ...event, lane: Math.min(lane, DIAL_CONFIG.maxLanes) };
    });

    return withLanes.flatMap((event) => {
      const samples = ribbonSamples({
        start: event.task.start,
        duration: event.task.duration,
        dayOffset: event.dayOffset,
        lane: event.lane,
        current: event.current,
        done: event.task.done,
      }, effectiveNow);
      if (samples.length < 2) return [];
      const segments = ribbonSegments(samples);
      const centerPath = ribbonCenterPath(samples);
      const ringSamples = samplesForCurrentRing(samples);
      const labelPath = ribbonCenterPath(ringSamples);
      const middle = ribbonProfile(360, { lane: event.lane, current: event.current, done: event.task.done, duration: event.task.duration });
      const label = middle.w * 2 >= 14 ? buildLabel(event.task, ringSamples) : "";
      const color = taskColor(event.task);
      return [{
        ...event,
        samples,
        segments,
        centerPath,
        labelPath,
        label,
        color,
        labelColor: readableLabelColor(colorForSegment(color, 0.75, event.task.done)),
        currentPoint: event.current ? ribbonPointAt(samples, 0) : null,
        status: taskStatus(event.startDelta, event.endDelta, event.current),
      }];
    });
  }, [tasks, taskDates, effectiveNow]);

  const currentTask = events.find((event) => event.current);
  const hoveredEvent = events.find((event) => event.key === hoveredTask);
  const cursor = dialPolar(effectiveNow, DIAL_CONFIG.R0 - DIAL_CONFIG.W0);
  const guideSamples = useMemo(() => {
    const startAbs = effectiveNow - DIAL_CONFIG.pastFadeHours * 60;
    const normalizedStart = wrapMinute(startAbs);
    const dayOffset = Math.floor(startAbs / 1440);
    return ribbonSamples({
      start: normalizedStart,
      dayOffset,
      duration: DIAL_CONFIG.pastFadeHours * 60 + DIAL_CONFIG.horizonHours * 60,
      lane: 0,
    }, effectiveNow);
  }, [effectiveNow]);
  const guidePath = useMemo(() => ribbonCenterPath(guideSamples), [guideSamples]);

  const hourLabels = [0, 180, 360, 540].map((clockMinute) => {
    const currentHalfDay = Math.floor(effectiveNow / 720) * 720;
    let absoluteMinute = currentHalfDay + clockMinute;
    while (absoluteMinute < effectiveNow - 0.01) absoluteMinute += 720;
    const absoluteHour = Math.floor(absoluteMinute / 60);
    const label = absoluteHour === 0 ? "24" : String(absoluteHour % 24 || 24);
    const point = dialPolar(clockMinute, 191);
    return { label, x: point.x, y: point.y, clockMinute };
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
    const demo = buildDemoTasks(selectedDate);
    demo.filter((item) => !tasks.some((task) => task.date === item.date && task.title === item.title && task.start === item.start && task.duration === item.duration))
      .forEach(onAddTask);
  };

  const pointerMinute = (event: ReactPointerEvent<SVGSVGElement>, taskStart: number) => {
    const svg = svgRef.current;
    if (!svg) return taskStart;
    const rect = svg.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * DIAL_CONFIG.viewSize;
    const y = ((event.clientY - rect.top) / rect.height) * DIAL_CONFIG.viewSize;
    const angle = (Math.atan2(y - DIAL_CONFIG.cy, x - DIAL_CONFIG.cx) + Math.PI / 2 + Math.PI * 2) % (Math.PI * 2);
    const halfDay = taskStart >= 720 ? 720 : 0;
    return Math.max(0, Math.min(1435, Math.round((halfDay + angle / (Math.PI * 2) * 720) / 15) * 15));
  };

  const onEventPointerDown = (event: ReactPointerEvent<SVGElement>, geometry: EventGeometry) => {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    dragRef.current = {
      taskId: geometry.task.id,
      dayOffset: geometry.dayOffset,
      startX: event.clientX,
      startY: event.clientY,
    };
    movedRef.current = false;
    svgRef.current?.setPointerCapture(event.pointerId);
  };

  const onDialPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
    if (distance <= 7) return;
    movedRef.current = true;
    const task = tasks.find((item) => item.id === drag.taskId);
    if (!task) return;
    setDragPreview({ taskId: drag.taskId, minute: pointerMinute(event, task.start), dayOffset: drag.dayOffset });
  };

  const onDialPointerUp = (event: ReactPointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    if (movedRef.current) {
      const task = tasks.find((item) => item.id === drag.taskId);
      if (task) {
        const minute = pointerMinute(event, task.start);
        onMoveTask?.(drag.taskId, minute);
        suppressClickRef.current = true;
        window.setTimeout(() => { suppressClickRef.current = false; }, 0);
      }
    }
    setDragPreview(null);
  };

  const onDialPointerCancel = () => {
    dragRef.current = null;
    movedRef.current = false;
    setDragPreview(null);
  };

  const preview = dragPreview ? (() => {
    const task = tasks.find((item) => item.id === dragPreview.taskId);
    if (!task) return null;
    const previewSamples = ribbonSamples({
      start: dragPreview.minute,
      duration: task.duration,
      dayOffset: dragPreview.dayOffset,
      current: false,
      done: task.done,
    }, effectiveNow);
    return { task, path: ribbonPath(previewSamples), color: taskColor(task) };
  })() : null;

  return (
    <section className="vortex-view">
      <div className="vortex-toolbar">
        <div className="vortex-mode-description">
          <span className="vortex-kicker">ДИНАМИЧЕСКАЯ ШКАЛА ВРЕМЕНИ</span>
          <strong>Водоворот ближайших 18 часов</strong>
          <small>Прошлое сжимается и растворяется; дальние дела уходят наружу.</small>
        </div>
        <div className="vortex-actions">
          <button className="outline-button" type="button" onClick={() => setFormOpen(true)}>＋ Дело</button>
          <button className="outline-button" type="button" onClick={addDemoTasks}>Демо-дела</button>
        </div>
      </div>

      <div className="vortex-simulation">
        <label className="vortex-simulation-toggle">
          <input type="checkbox" checked={simulation} onChange={(event) => setSimulation(event.target.checked)} />
          <span>Симуляция времени</span>
        </label>
        <div className="vortex-slider-label"><span>Сейчас</span><strong>{clockText(effectiveNow)}</strong></div>
        <input
          className="vortex-time-slider"
          type="range"
          min={0}
          max={1439}
          step={1}
          value={simulation ? simulationMinute : Math.floor(wrapMinute(liveMinute))}
          disabled={!simulation}
          onChange={(event) => setSimulationMinute(Number(event.target.value))}
          aria-label="Симулируемое время от 00:00 до 23:59"
        />
        <div className="vortex-slider-ends"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>24:00</span></div>
      </div>

      <div className="vortex-stage">
        <svg
          ref={svgRef}
          className="vortex-dial"
          viewBox={`0 0 ${DIAL_CONFIG.viewSize} ${DIAL_CONFIG.viewSize}`}
          role="img"
          aria-label="Водоворот дел: прошлое сжимается к центру, ближайшие 12 часов выделены толстой лентой"
          onPointerMove={onDialPointerMove}
          onPointerUp={onDialPointerUp}
          onPointerCancel={onDialPointerCancel}
        >
          <defs>
            <filter id="vortex-current-glow" x="-40%" y="-40%" width="180%" height="180%">
              <feGaussianBlur stdDeviation="3.2" />
            </filter>
          </defs>

          <circle cx={DIAL_CONFIG.cx} cy={DIAL_CONFIG.cy} r="76" className="vortex-orbit-guide" />
          <circle cx={DIAL_CONFIG.cx} cy={DIAL_CONFIG.cy} r="174" className="vortex-orbit-guide vortex-orbit-guide-outer" />
          <path d={guidePath} className="vortex-spiral-guide" />

          {Array.from({ length: 12 }, (_, hour) => {
            const tickMinute = hour * 60;
            const major = hour % 3 === 0;
            const inner = dialPolar(tickMinute, 169);
            const outer = dialPolar(tickMinute, major ? 174 : 172);
            return <line key={hour} x1={inner.x} y1={inner.y} x2={outer.x} y2={outer.y} className={major ? "vortex-tick vortex-tick-major" : "vortex-tick"} />;
          })}

          {hourLabels.map((item) => (
            <text key={item.clockMinute} x={item.x} y={item.y} className="vortex-hour-label">{item.label}</text>
          ))}

          {events.map((event) => (
            <g
              key={event.key}
              className="vortex-event"
              role="button"
              tabIndex={0}
              aria-label={event.task.title + ", " + clockText(event.task.start) + "–" + clockText(wrapMinute(event.task.start + event.task.duration))}
              onPointerEnter={(pointerEvent) => { if (pointerEvent.pointerType !== "touch") setHoveredTask(event.key); }}
              onPointerLeave={(pointerEvent) => { if (pointerEvent.pointerType !== "touch") setHoveredTask(null); }}
              onPointerDown={(pointerEvent) => onEventPointerDown(pointerEvent, event)}
              onClick={() => {
                if (suppressClickRef.current) {
                  suppressClickRef.current = false;
                  return;
                }
                setHoveredTask((previous) => previous === event.key ? null : event.key);
              }}
              onKeyDown={(keyEvent) => {
                if (keyEvent.key === "Enter" || keyEvent.key === " ") {
                  keyEvent.preventDefault();
                  setHoveredTask((previous) => previous === event.key ? null : event.key);
                }
              }}
            >
              <path id={"vortex-center-" + event.key} d={event.centerPath} fill="none" stroke="none" />
              <path id={"vortex-label-" + event.key} d={event.labelPath} fill="none" stroke="none" />

              {event.current && event.segments.map((segment) => (
                <path
                  key={"glow-" + segment.key}
                  d={segment.path}
                  fill={event.color}
                  fillOpacity={segment.opacity * 0.18}
                  filter="url(#vortex-current-glow)"
                  pointerEvents="none"
                />
              ))}

              {event.segments.map((segment) => (
                <path
                  key={segment.key}
                  d={segment.path}
                  fill={colorForSegment(event.color, segment.progress, event.task.done)}
                  fillOpacity={segment.opacity}
                  className="vortex-ribbon-segment"
                  pointerEvents="visibleFill"
                />
              ))}

              <path
                d={event.centerPath}
                className="vortex-hit-area"
                fill="none"
                stroke="transparent"
                strokeWidth="10"
                pointerEvents="stroke"
              />

              {event.samples.length > 1 && (() => {
                const first = event.samples[0];
                const last = event.samples[event.samples.length - 1];
                const startPoint = ribbonPointAt(event.samples, first.deltaMinutes);
                const endPoint = ribbonPointAt(event.samples, last.deltaMinutes);
                if (!startPoint || !endPoint) return null;
                const startProgress = 0;
                const endProgress = 1;
                return <>
                  <circle cx={startPoint.x} cy={startPoint.y} r={first.w} fill={colorForSegment(event.color, startProgress, event.task.done)} fillOpacity={first.a} className="vortex-ribbon-cap" pointerEvents="none" />
                  <circle cx={endPoint.x} cy={endPoint.y} r={last.w} fill={colorForSegment(event.color, endProgress, event.task.done)} fillOpacity={last.a} className="vortex-ribbon-cap" pointerEvents="none" />
                </>;
              })()}

              {event.currentPoint && (
                <g className="vortex-current-head" pointerEvents="none">
                  <circle cx={event.currentPoint.x} cy={event.currentPoint.y} r="5.5" className="vortex-current-head-glow" />
                  <circle cx={event.currentPoint.x} cy={event.currentPoint.y} r="2.8" className="vortex-current-head-dot" />
                </g>
              )}

              {event.label && (
                <text className="vortex-label" fill={event.labelColor}>
                  <textPath href={"#vortex-label-" + event.key} startOffset="50%" textAnchor="middle">{event.label}</textPath>
                </text>
              )}
            </g>
          ))}

          {preview && (
            <g className="vortex-drag-preview" pointerEvents="none">
              <path d={preview.path} fill={preview.color} fillOpacity=".12" />
              <path d={preview.path} fill="none" stroke={preview.color} strokeWidth="1.2" strokeDasharray="4 4" opacity=".65" />
            </g>
          )}

          <line x1={DIAL_CONFIG.cx} y1={DIAL_CONFIG.cy} x2={cursor.x} y2={cursor.y} className="vortex-now-line" />
          <circle cx={cursor.x} cy={cursor.y} r="5.2" className="vortex-now-pulse" />
          <circle cx={cursor.x} cy={cursor.y} r="2.5" className="vortex-now-dot" />

          <circle cx={DIAL_CONFIG.cx} cy={DIAL_CONFIG.cy} r="37" className="vortex-center" />
          <text x={DIAL_CONFIG.cx} y={DIAL_CONFIG.cy - 17} className="vortex-center-overline">{simulation ? "СИМУЛЯЦИЯ" : "СЕЙЧАС"}</text>
          <text x={DIAL_CONFIG.cx} y={DIAL_CONFIG.cy + 7} className="vortex-center-time">{clockText(effectiveNow)}</text>
          <text x={DIAL_CONFIG.cx} y={DIAL_CONFIG.cy + 24} className="vortex-center-task">
            {currentTask ? currentTask.task.title.slice(0, 17) : events.length ? "ближайшие дела" : "добавь первое дело"}
          </text>
        </svg>

        {hoveredEvent && (
          <div className="vortex-tooltip">
            <strong>{hoveredEvent.task.title}</strong>
            <span className="vortex-tooltip-time">{clockText(hoveredEvent.task.start)}–{clockText(wrapMinute(hoveredEvent.task.start + hoveredEvent.task.duration))}</span>
            <span>Длительность: {fmtDuration(hoveredEvent.task.duration)}</span>
            <span>{hoveredEvent.status}</span>
            {hoveredEvent.task.date !== selectedDate && <span>{hoveredEvent.dayOffset < 0 ? "Предыдущий день" : "Следующий день"}</span>}
            <p>{hoveredEvent.task.note || "Описание не добавлено."}</p>
          </div>
        )}
        {events.length === 0 && <div className="vortex-empty">В этом временном окне нет дел. Нажми «+ Дело» или добавь демо-дела.</div>}
        {dragPreview && <div className="vortex-drag-time">Новое время: <strong>{clockText(dragPreview.minute)}</strong></div>}
      </div>

      <div className="vortex-note">Цвет меняется вдоль ленты: начало мягче, конец насыщеннее. Затухание зависит от времени относительно текущего момента; дела после +12 часов становятся тонкими и выходят на внешний радиус.</div>

      {formOpen && (
        <div className="vortex-form-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setFormOpen(false); }}>
          <section className="vortex-form-card" role="dialog" aria-modal="true" aria-labelledby="vortex-form-title">
            <div className="vortex-form-heading">
              <div><span className="vortex-kicker">НОВОЕ ДЕЛО</span><h3 id="vortex-form-title">Добавить в водоворот</h3></div>
              <button className="icon-button" type="button" onClick={() => setFormOpen(false)} aria-label="Закрыть">×</button>
            </div>
            <form onSubmit={addTask}>
              <label className="field-label">Название<input autoFocus value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)} maxLength={100} placeholder="Например, тренировка" required /></label>
              <div className="field-grid">
                <label className="field-label">Начало<input type="time" value={draftStart} onChange={(event) => setDraftStart(event.target.value)} required /></label>
                <label className="field-label">Конец<input type="time" value={draftEnd} onChange={(event) => setDraftEnd(event.target.value)} required /></label>
              </div>
              <label className="field-label">Цвет<input className="vortex-color-input" type="color" value={draftColor} onChange={(event) => setDraftColor(event.target.value)} /></label>
              <label className="field-label">Описание<textarea value={draftNote} onChange={(event) => setDraftNote(event.target.value)} maxLength={500} rows={3} placeholder="Что важно знать об этом деле?" /></label>
              {formError && <p className="vortex-form-error">{formError}</p>}
              <div className="modal-actions"><button className="outline-button" type="button" onClick={() => setFormOpen(false)}>Отмена</button><button className="primary-button" type="submit">Добавить дело</button></div>
            </form>
            <p className="vortex-form-help">Если время окончания раньше начала, дело автоматически продолжается через полночь.</p>
          </section>
        </div>
      )}
    </section>
  );
}
