import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

type AIAction = "parse-schedule" | "parse-schedule-images" | "insights" | "analytics" | "task-insight";
type AIRequest = {
  action?: AIAction;
  prompt?: string;
  model?: "groq" | "gemini";
  date?: string;
  startDate?: string;
  endDate?: string;
  tasks?: unknown[];
  task?: Record<string, unknown>;
  images?: string[];
};

const rateWindowMs = 15 * 60 * 1000;
const rateLimit = new Map<string, { startedAt: number; count: number }>();
const maxBodyBytes = 14 * 1024 * 1024;

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const current = rateLimit.get(ip);
  if (!current || now - current.startedAt > rateWindowMs) {
    rateLimit.set(ip, { startedAt: now, count: 1 });
    return false;
  }
  current.count += 1;
  return current.count > 24;
}

function cleanJSON<T>(text: string): T {
  const trimmed = text.trim().replace(/^\x60\x60\x60(?:json)?\s*/i, "").replace(/\s*\x60\x60\x60$/, "");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("AI provider returned malformed JSON.");
  return JSON.parse(trimmed.slice(start, end + 1)) as T;
}

function taskPrompt(prompt: string, baseDate: string) {
  return `You are the schedule parser for DayRhythm. Current local date is ${baseDate}. Parse the user's request into a JSON object with one property "tasks", an array of tasks. Each task must have: title (short string), description (string), startTime (minutes since midnight, integer 0-1439), endTime (minutes since midnight, integer greater than startTime and at most 1440), date (YYYY-MM-DD), emoji (one suitable emoji), colorHex (#RRGGBB), category (one of work, health, rest, home, personal). Use local time, infer dates from today/tomorrow/weekday, infer duration from context, otherwise use 60 minutes. If am/pm is ambiguous, infer from context. Do not invent a task not requested. Return JSON only. User request: ${prompt}`;
}

function instructionsFor(body: AIRequest) {
  const serializedTasks = JSON.stringify(body.tasks ?? []);
  switch (body.action) {
    case "parse-schedule":
    case "parse-schedule-images":
      return taskPrompt(String(body.prompt ?? "Extract the schedule in the attached image(s)."), body.date ?? new Date().toISOString().slice(0, 10));
    case "insights":
      return `Analyze the user's one-day schedule for ${body.date ?? "the selected day"}. Tasks JSON: ${serializedTasks}. Return a JSON object with "insights": exactly five concise, personalized observations in the user's language. Derive them only from the given data; include time balance, free time, focus or overload only when supported. Never claim medical facts or invent task details.`;
    case "analytics":
      return `Analyze the events in range ${body.startDate ?? "unknown"} to ${body.endDate ?? "unknown"}. Tasks JSON: ${serializedTasks}. Return JSON: {"summary":string,"totalTasks":number,"completedTasks":number,"totalHours":number,"categoryBreakdown":object with category name:number of hours,"averageTasksPerDay":number,"mostProductiveDay":string or null,"suggestions":string[]}. Calculate metrics only from input and don't invent missing dates.`;
    case "task-insight":
      return `Give practical scheduling advice for this task, based only on its details: ${JSON.stringify(body.task ?? {})}. Return JSON {"insight":string,"suggestions":string[],"estimatedFocusLevel":"low"|"medium"|"high"}. Do not give health or clinical advice.`;
    default:
      throw new Error("Unknown AI action.");
  }
}

async function callGroq(prompt: string, model?: string): Promise<unknown> {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error("GROQ_API_KEY is not configured. Add it to .env.local and restart the development server.");
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: model || process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
      temperature: 0.2,
      max_completion_tokens: 2400,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "Return valid JSON only. Follow the exact output contract in the user message." },
        { role: "user", content: prompt }
      ]
    }),
    signal: AbortSignal.timeout(50000)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(payload?.error?.message ?? `Groq request failed with HTTP ${response.status}`));
  const text = payload?.choices?.[0]?.message?.content;
  if (typeof text !== "string") throw new Error("Groq returned an empty response.");
  return cleanJSON(text);
}

async function callGemini(prompt: string, images: string[] = []): Promise<unknown> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not configured. Add it to .env.local and restart the development server.");
  const parts: Array<Record<string, unknown>> = [{ text: prompt }];
  for (const dataUrl of images) {
    const match = dataUrl.match(/^data:(image\/(?:png|jpeg|webp|heic|heif));base64,([a-zA-Z0-9+/=]+)$/i);
    if (!match) throw new Error("A selected image has an unsupported type or invalid encoding.");
    if (match[2].length > 5_600_000) throw new Error("Each image must be smaller than about 4 MB.");
    parts.push({ inlineData: { mimeType: match[1].toLowerCase(), data: match[2] } });
  }
  const model = process.env.GEMINI_MODEL || "gemini-3.8-flash";
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: "You are a careful scheduling assistant. Return valid JSON only, follow the requested schema, and do not invent tasks." }] },
      contents: [{ role: "user", parts }],
      generationConfig: { responseMimeType: "application/json", temperature: 0.2 }
    }),
    signal: AbortSignal.timeout(50000)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(payload?.error?.message ?? `Gemini request failed with HTTP ${response.status}`));
  const text = payload?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("");
  if (typeof text !== "string" || !text) throw new Error("Gemini returned an empty response.");
  return cleanJSON(text);
}

export async function GET() {
  return NextResponse.json({
    groqConfigured: Boolean(process.env.GROQ_API_KEY),
    geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
    supabaseConfigured: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  });
}

export async function POST(request: NextRequest) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > maxBodyBytes) {
    return NextResponse.json({ error: "Request is too large. Use up to 3 images, each under 4 MB." }, { status: 413 });
  }
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || request.headers.get("x-real-ip") || "local";
  if (rateLimited(ip)) {
    return NextResponse.json({ error: "Too many AI requests. Try again in 15 minutes." }, { status: 429 });
  }
  let body: AIRequest;
  try {
    body = await request.json() as AIRequest;
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  if (!body.action || !["parse-schedule", "parse-schedule-images", "insights", "analytics", "task-insight"].includes(body.action)) {
    return NextResponse.json({ error: "Unknown AI action." }, { status: 400 });
  }
  if (body.action === "parse-schedule-images") {
    if (!Array.isArray(body.images) || body.images.length < 1 || body.images.length > 3) {
      return NextResponse.json({ error: "Choose between 1 and 3 images." }, { status: 400 });
    }
    body.model = "gemini";
  }
  try {
    const prompt = instructionsFor(body);
    const result = body.model === "gemini" || body.action === "parse-schedule-images"
      ? await callGemini(prompt, body.action === "parse-schedule-images" ? body.images : [])
      : await callGroq(prompt);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The AI request failed.";
    const status = /not configured/i.test(message) ? 503 : /too large/i.test(message) ? 413 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
