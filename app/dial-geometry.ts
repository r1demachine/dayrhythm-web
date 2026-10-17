/**
 * Геометрия временной ленты циферблата. Этот модуль не зависит от React и DOM.
 */
export const DIAL_CONFIG = {
  cx: 210,
  cy: 210,
  viewSize: 420,

  // Основное кольцо ближайших 12 часов.
  R0: 128,
  W0: 11,

  // Прошлая часть: быстро уходит к центру и растворяется.
  R_in: 46,
  w_past_min: 1.2,
  pastFadeHours: 4,
  pastCompressionHours: 0.6,
  pastEasePower: 2.4,
  pastOpacityPower: 2.5,

  // Дальний будущий отрезок.
  R_out: 158,
  w_min: 1.6,
  farOpacity: 0.52,
  // Будущее выходит с основного кольца постепенно: 8–12 часов до начала.
  futureMainHours: 8,
  transitionHours: 4,

  horizonHours: 18,
  sampleMinutes: 2.5,
  segmentMinutes: 5,
  segmentOverlapMinutes: 0.35,
  minimumArcMinutes: 10,

  // Разводим пересекающиеся задачи по соседним дорожкам.
  laneGap: 3,
  selfTurnGap: 22,
  maxLanes: 4,
  currentWidthScale: 1.15,
} as const;

export type RibbonTask = {
  start: number;
  duration: number;
  dayOffset?: number;
  lane?: number;
  current?: boolean;
  done?: boolean;
};

export type RibbonSample = {
  /** Минуты и часы относительно текущего момента; отрицательное значение — прошлое. */
  deltaMinutes: number;
  deltaHours: number;
  /** Неразвернутый угол в радианах. Он непрерывно растёт по мере движения во времени. */
  angle: number;
  r: number;
  w: number;
  a: number;
};

export type RibbonSegment = {
  key: string;
  samples: RibbonSample[];
  path: string;
  opacity: number;
  progress: number;
  deltaMinutes: number;
};

type ProfileOptions = Partial<Pick<RibbonTask, "current" | "done" | "lane" | "duration">>;

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const smoothstep = (value: number) => {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
};

function baseProfile(deltaMinutes: number) {
  const pastLimit = DIAL_CONFIG.pastFadeHours * 60;
  const transition = DIAL_CONFIG.transitionHours * 60;
  const farLimit = DIAL_CONFIG.horizonHours * 60;

  if (deltaMinutes < 0) {
    const fadeProgress = clamp01(-deltaMinutes / pastLimit);
    const compressionProgress = clamp01((-deltaMinutes) / (DIAL_CONFIG.pastCompressionHours * 60));
    // Сжатие до внутреннего радиуса идёт за короткий интервал, а alpha затухает все 8 часов.
    const compression = 1 - Math.pow(1 - compressionProgress, DIAL_CONFIG.pastEasePower);
    return {
      r: DIAL_CONFIG.R0 - (DIAL_CONFIG.R0 - DIAL_CONFIG.R_in) * compression,
      w: DIAL_CONFIG.W0 - (DIAL_CONFIG.W0 - DIAL_CONFIG.w_past_min) * compression,
      a: Math.pow(1 - fadeProgress, DIAL_CONFIG.pastOpacityPower),
    };
  }

  const mainRingEnd = DIAL_CONFIG.futureMainHours * 60;
  if (deltaMinutes <= mainRingEnd) {
    return { r: DIAL_CONFIG.R0, w: DIAL_CONFIG.W0, a: 1 };
  }

  if (deltaMinutes <= mainRingEnd + transition) {
    const t = smoothstep((deltaMinutes - mainRingEnd) / transition);
    return {
      r: DIAL_CONFIG.R0 + (DIAL_CONFIG.R_out - DIAL_CONFIG.R0) * t,
      w: DIAL_CONFIG.W0 + (DIAL_CONFIG.w_min - DIAL_CONFIG.W0) * t,
      a: 1 + (DIAL_CONFIG.farOpacity - 1) * t,
    };
  }

  if (deltaMinutes <= farLimit) {
    return { r: DIAL_CONFIG.R_out, w: DIAL_CONFIG.w_min, a: DIAL_CONFIG.farOpacity };
  }

  return { r: DIAL_CONFIG.R_out, w: DIAL_CONFIG.w_min, a: 0 };
}

/** Профиль радиуса, полутолщины и прозрачности для одной относительной минуты. */
export function ribbonProfile(deltaMinutes: number, options: ProfileOptions = {}) {
  const shape = baseProfile(deltaMinutes);
  const lane = Math.max(0, Math.min(DIAL_CONFIG.maxLanes, Math.floor(options.lane ?? 0)));
  const laneStep = Math.ceil(lane / 2);
  const laneDirection = lane % 2 === 1 ? -1 : 1;
  const laneOffset = lane === 0 ? 0 : laneDirection * laneStep * (shape.w * 2 + DIAL_CONFIG.laneGap);

  const currentScale =
    options.current && deltaMinutes >= 0 && deltaMinutes <= 720
      ? DIAL_CONFIG.currentWidthScale
      : 1;
  const w = shape.w * currentScale;

  // Длинные дела не ложатся на собственный виток: дальняя часть немного отводится наружу,
  // прошедшая — внутрь. Основной профиль при этом остаётся непрерывным.
  const longTaskOffset = (options.duration ?? 0) > 720
    ? deltaMinutes < 0
      ? -DIAL_CONFIG.selfTurnGap * smoothstep(-deltaMinutes / (DIAL_CONFIG.pastCompressionHours * 60))
      : deltaMinutes > DIAL_CONFIG.futureMainHours * 60
        ? DIAL_CONFIG.selfTurnGap * smoothstep((deltaMinutes - DIAL_CONFIG.futureMainHours * 60) / (DIAL_CONFIG.transitionHours * 60))
        : 0
    : 0;

  return {
    r: Math.max(12, shape.r + laneOffset + longTaskOffset),
    w,
    a: shape.a * (options.done ? 0.35 : 1),
  };
}

function angleFor(nowMin: number, deltaMinutes: number) {
  return ((nowMin + deltaMinutes) / 720) * Math.PI * 2 - Math.PI / 2;
}

/**
 * Создаёт временные точки по одной ленте. Соседние даты кодируются в dayOffset (-1, 0, +1),
 * поэтому задачи через полночь идут непрерывно и не зависят от календарной даты в угле.
 */
export function ribbonSamples(task: RibbonTask, nowMin: number): RibbonSample[] {
  if (!Number.isFinite(task.start) || !Number.isFinite(task.duration) || task.duration <= 0) return [];

  const dayOffset = task.dayOffset ?? 0;
  const absoluteStart = task.start + dayOffset * 1440;
  const startDelta = absoluteStart - nowMin;
  const endDelta = startDelta + task.duration;
  const pastLimit = -DIAL_CONFIG.pastFadeHours * 60;
  const futureLimit = DIAL_CONFIG.horizonHours * 60;

  let visibleStart = Math.max(startDelta, pastLimit);
  let visibleEnd = Math.min(endDelta, futureLimit);
  if (visibleEnd <= visibleStart) return [];

  if (visibleEnd - visibleStart < DIAL_CONFIG.minimumArcMinutes) {
    const center = (visibleStart + visibleEnd) / 2;
    visibleStart = Math.max(pastLimit, center - DIAL_CONFIG.minimumArcMinutes / 2);
    visibleEnd = Math.min(futureLimit, visibleStart + DIAL_CONFIG.minimumArcMinutes);
    visibleStart = Math.max(pastLimit, visibleEnd - DIAL_CONFIG.minimumArcMinutes);
  }

  const boundaries = [
    visibleStart,
    visibleEnd,
    startDelta,
    endDelta,
    0,
    DIAL_CONFIG.futureMainHours * 60,
    (DIAL_CONFIG.futureMainHours + DIAL_CONFIG.transitionHours) * 60,
  ].filter((value) => value >= visibleStart && value <= visibleEnd);

  const minutes = new Set<number>(boundaries);
  for (
    let value = visibleStart + DIAL_CONFIG.sampleMinutes;
    value < visibleEnd;
    value += DIAL_CONFIG.sampleMinutes
  ) {
    minutes.add(value);
  }

  const options: ProfileOptions = {
    current: task.current,
    done: task.done,
    lane: task.lane,
    duration: task.duration,
  };

  return Array.from(minutes)
    .sort((a, b) => a - b)
    .map((deltaMinutes) => {
      const shape = ribbonProfile(deltaMinutes, options);
      return {
        deltaMinutes,
        deltaHours: deltaMinutes / 60,
        angle: angleFor(nowMin, deltaMinutes),
        r: shape.r,
        w: shape.w,
        a: shape.a,
      };
    });
}

type Point = { x: number; y: number };

function pointOn(sample: RibbonSample, radiusOffset = 0): Point {
  const radius = Math.max(2, sample.r + radiusOffset);
  return {
    x: DIAL_CONFIG.cx + Math.cos(sample.angle) * radius,
    y: DIAL_CONFIG.cy + Math.sin(sample.angle) * radius,
  };
}

function spline(points: Point[]): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0].x.toFixed(3)} ${points[0].y.toFixed(3)}`;

  let path = `M ${points[0].x.toFixed(3)} ${points[0].y.toFixed(3)}`;
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    path += ` C ${c1x.toFixed(3)} ${c1y.toFixed(3)}, ${c2x.toFixed(3)} ${c2y.toFixed(3)}, ${p2.x.toFixed(3)} ${p2.y.toFixed(3)}`;
  }
  return path;
}

function contourPath(samples: RibbonSample[], roundedEnds: boolean): string {
  if (samples.length < 2) return "";
  const outer = samples.map((sample) => pointOn(sample, sample.w));
  const inner = samples.slice().reverse().map((sample) => pointOn(sample, -sample.w));
  let path = spline(outer);

  const last = samples[samples.length - 1];
  const first = samples[0];
  const outerLast = outer[outer.length - 1];
  const innerLast = inner[0];
  const innerPath = spline(inner);
  const innerCurve = innerPath.slice(innerPath.indexOf(" C "));
  const outerFirst = outer[0];
  const innerFirst = inner[inner.length - 1];

  if (roundedEnds) {
    path += ` A ${Math.max(0.8, last.w).toFixed(3)} ${Math.max(0.8, last.w).toFixed(3)} 0 0 1 ${innerLast.x.toFixed(3)} ${innerLast.y.toFixed(3)}`;
  } else {
    path += ` L ${innerLast.x.toFixed(3)} ${innerLast.y.toFixed(3)}`;
  }

  if (innerCurve) {
    path += innerCurve;
  } else {
    path += ` L ${innerFirst.x.toFixed(3)} ${innerFirst.y.toFixed(3)}`;
  }

  if (roundedEnds) {
    path += ` A ${Math.max(0.8, first.w).toFixed(3)} ${Math.max(0.8, first.w).toFixed(3)} 0 0 1 ${outerFirst.x.toFixed(3)} ${outerFirst.y.toFixed(3)} Z`;
  } else {
    path += " Z";
  }

  // Эти ссылки явно оставлены для наглядности соответствия концов контура.
  void outerLast;
  return path;
}

/** Сглаженный закрытый контур ленты с полукруглыми торцами. */
export function ribbonPath(samples: RibbonSample[]): string {
  return contourPath(samples, true);
}

/** Сглаженная осевая линия, используемая для textPath и увеличенной hit-area. */
export function ribbonCenterPath(samples: RibbonSample[]): string {
  return spline(samples.map((sample) => pointOn(sample)));
}

function interpolateSample(samples: RibbonSample[], at: number): RibbonSample {
  if (at <= samples[0].deltaMinutes) return samples[0];
  if (at >= samples[samples.length - 1].deltaMinutes) return samples[samples.length - 1];

  let index = 0;
  while (index < samples.length - 1 && samples[index + 1].deltaMinutes < at) index += 1;
  const left = samples[index];
  const right = samples[index + 1];
  const ratio = (at - left.deltaMinutes) / (right.deltaMinutes - left.deltaMinutes);
  return {
    deltaMinutes: at,
    deltaHours: at / 60,
    angle: left.angle + (right.angle - left.angle) * ratio,
    r: left.r + (right.r - left.r) * ratio,
    w: left.w + (right.w - left.w) * ratio,
    a: left.a + (right.a - left.a) * ratio,
  };
}

function sampleWindow(samples: RibbonSample[], start: number, end: number): RibbonSample[] {
  const result = [interpolateSample(samples, start)];
  samples.forEach((sample) => {
    if (sample.deltaMinutes > start && sample.deltaMinutes < end) result.push(sample);
  });
  result.push(interpolateSample(samples, end));
  return result;
}

/**
 * Короткие залитые участки дают управляемое затухание вдоль ленты без stroke-opacity
 * и без швов round-linecap. Соседние сегменты слегка перекрываются.
 */
export function ribbonSegments(samples: RibbonSample[]): RibbonSegment[] {
  if (samples.length < 2) return [];
  const first = samples[0].deltaMinutes;
  const last = samples[samples.length - 1].deltaMinutes;
  const span = Math.max(1, last - first);
  const segments: RibbonSegment[] = [];
  const step = DIAL_CONFIG.segmentMinutes;
  const halfOverlap = DIAL_CONFIG.segmentOverlapMinutes / 2;

  let segmentStart = first;
  let index = 0;
  while (segmentStart < last) {
    const coreEnd = Math.min(last, segmentStart + step);
    const from = Math.max(first, segmentStart - halfOverlap);
    const to = Math.min(last, coreEnd + halfOverlap);
    const window = sampleWindow(samples, from, to);
    const midpoint = (segmentStart + coreEnd) / 2;
    const centerSample = interpolateSample(samples, midpoint);
    const progress = clamp01((midpoint - first) / span);

    segments.push({
      key: `${index}-${Math.round(segmentStart * 100) / 100}`,
      samples: window,
      path: contourPath(window, false),
      opacity: centerSample.a,
      progress,
      deltaMinutes: midpoint,
    });
    segmentStart = coreEnd;
    index += 1;
  }

  return segments;
}

/** Удобная точка на осевой линии в заданный относительный момент. */
export function ribbonPointAt(samples: RibbonSample[], deltaMinutes: number): Point | null {
  if (samples.length === 0) return null;
  const sample = interpolateSample(samples, deltaMinutes);
  return pointOn(sample);
}

/** Точки полутолщины — используются для рисования маркера и стрелки. */
export function ribbonPointOnEdge(sample: RibbonSample, edge: "inner" | "outer" = "inner"): Point {
  return pointOn(sample, edge === "inner" ? -sample.w : sample.w);
}

export function dialPolar(absoluteMinute: number, radius: number): Point {
  const angle = angleFor(absoluteMinute, 0);
  return {
    x: DIAL_CONFIG.cx + Math.cos(angle) * radius,
    y: DIAL_CONFIG.cy + Math.sin(angle) * radius,
  };
}
