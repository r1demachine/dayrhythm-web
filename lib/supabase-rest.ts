import type { Task } from "@/lib/dayrhythm";

export interface CloudUser {
  id: string;
  email?: string;
}
export interface CloudSession {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  user: CloudUser;
}
export interface DeletedTaskMap {
  [id: string]: number;
}

type CloudRow = {
  id: string;
  task: Task | null;
  updated_at: string;
  is_deleted: boolean;
};

const SESSION_KEY = "dayrhythm.supabase.session.v1";
const CLOUD_TABLE = "dayrhythm_tasks";

export function getSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/$/, "");
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  return url && anonKey ? { url, anonKey } : null;
}

export function getSavedSession(): CloudSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as CloudSession;
    if (!value.access_token || !value.refresh_token || !value.user?.id) return null;
    return value;
  } catch {
    return null;
  }
}

export function saveSession(session: CloudSession | null) {
  if (typeof window === "undefined") return;
  if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  else localStorage.removeItem(SESSION_KEY);
}

function sessionFromPayload(payload: Record<string, unknown>): CloudSession | null {
  const user = payload.user as Record<string, unknown> | undefined;
  if (typeof payload.access_token !== "string" || typeof payload.refresh_token !== "string" || typeof user?.id !== "string") return null;
  return {
    access_token: payload.access_token,
    refresh_token: payload.refresh_token,
    expires_at: Number(payload.expires_at) || Math.floor(Date.now() / 1000) + (Number(payload.expires_in) || 3600),
    user: { id: user.id, email: typeof user.email === "string" ? user.email : undefined }
  };
}

async function authRequest(path: string, body: Record<string, unknown>, token?: string) {
  const config = getSupabaseConfig();
  if (!config) throw new Error("Облачный режим не настроен. Добавь NEXT_PUBLIC_SUPABASE_URL и NEXT_PUBLIC_SUPABASE_ANON_KEY в .env.local.");
  const response = await fetch(config.url + "/auth/v1/" + path, {
    method: "POST",
    headers: {
      apikey: config.anonKey,
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {})
    },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = String((payload as Record<string, unknown>).msg ?? (payload as Record<string, unknown>).message ?? (payload as Record<string, unknown>).error_description ?? (payload as Record<string, unknown>).error ?? "Ошибка Supabase Auth.");
    throw new Error(message);
  }
  return payload as Record<string, unknown>;
}

export async function signInWithPassword(email: string, password: string) {
  const payload = await authRequest("token?grant_type=password", { email, password });
  const session = sessionFromPayload(payload);
  if (!session) throw new Error("Supabase не вернул сессию. Возможно, требуется подтвердить email.");
  saveSession(session);
  return session;
}

export async function signUpWithPassword(email: string, password: string) {
  const payload = await authRequest("signup", { email, password });
  const session = sessionFromPayload(payload);
  if (session) saveSession(session);
  return { session, message: session ? "Аккаунт создан." : "Аккаунт создан. Подтверди email по ссылке из письма, затем войди." };
}

export async function signOut() {
  const session = getSavedSession();
  const config = getSupabaseConfig();
  try {
    if (session && config) {
      await fetch(config.url + "/auth/v1/logout", {
        method: "POST",
        headers: { apikey: config.anonKey, Authorization: "Bearer " + session.access_token }
      });
    }
  } finally {
    saveSession(null);
  }
}

async function refreshSession(session: CloudSession): Promise<CloudSession> {
  if (session.expires_at > Math.floor(Date.now() / 1000) + 90) return session;
  const payload = await authRequest("token?grant_type=refresh_token", { refresh_token: session.refresh_token });
  const updated = sessionFromPayload(payload);
  if (!updated) throw new Error("Не удалось обновить сессию. Войди в аккаунт повторно.");
  saveSession(updated);
  return updated;
}

async function cloudRequest(path: string, session: CloudSession, init: RequestInit = {}) {
  const config = getSupabaseConfig();
  if (!config) throw new Error("Облачный режим не настроен. Добавь параметры Supabase в .env.local.");
  const current = await refreshSession(session);
  const response = await fetch(config.url + "/rest/v1/" + path, {
    ...init,
    headers: {
      apikey: config.anonKey,
      Authorization: "Bearer " + current.access_token,
      "Content-Type": "application/json",
      ...(init.headers ?? {})
    }
  });
  if (!response.ok) {
    const message = await response.text().catch(() => "");
    throw new Error(message || `Облачный запрос завершился с HTTP ${response.status}.`);
  }
  const text = await response.text();
  return { current, payload: text ? JSON.parse(text) as unknown : null };
}

const rowTime = (row: CloudRow) => new Date(row.updated_at).getTime() || 0;

export async function syncTasksWithCloud(
  suppliedSession: CloudSession,
  localTasks: Task[],
  deletedAt: DeletedTaskMap
): Promise<{ tasks: Task[]; deletedAt: DeletedTaskMap; session: CloudSession }> {
  const first = await cloudRequest(
    `${CLOUD_TABLE}?select=id,task,updated_at,is_deleted&order=updated_at.asc`,
    suppliedSession
  );
  const session = first.current;
  const remote = (Array.isArray(first.payload) ? first.payload : []) as CloudRow[];
  const remoteById = new Map(remote.map(row => [row.id, row]));
  const localById = new Map(localTasks.map(task => [task.id, task]));
  const outgoing: Array<Record<string, unknown>> = [];

  for (const task of localTasks) {
    const localTime = Number(task.updatedAt) || 0;
    const remoteRow = remoteById.get(task.id);
    if (!remoteRow || localTime > rowTime(remoteRow) || remoteRow.is_deleted && localTime > rowTime(remoteRow)) {
      outgoing.push({
        id: task.id,
        user_id: session.user.id,
        task,
        updated_at: new Date(Math.max(localTime, Date.now())).toISOString(),
        is_deleted: false
      });
    }
  }
  for (const [id, deletedTime] of Object.entries(deletedAt)) {
    const remoteRow = remoteById.get(id);
    if (!remoteRow || deletedTime > rowTime(remoteRow)) {
      outgoing.push({
        id,
        user_id: session.user.id,
        task: null,
        updated_at: new Date(deletedTime).toISOString(),
        is_deleted: true
      });
    }
  }
  if (outgoing.length) {
    const response = await cloudRequest(
      `${CLOUD_TABLE}?on_conflict=id`,
      session,
      {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(outgoing)
      }
    );
    // Prefer return=minimal intentionally avoids sending the whole dataset back.
    void response.payload;
  }

  const second = await cloudRequest(
    `${CLOUD_TABLE}?select=id,task,updated_at,is_deleted&order=updated_at.asc`,
    session
  );
  const mergedRemote = (Array.isArray(second.payload) ? second.payload : []) as CloudRow[];
  const merged = new Map<string, { task: Task; time: number }>();
  const mergedDeleted: DeletedTaskMap = { ...deletedAt };

  for (const row of mergedRemote) {
    const timestamp = rowTime(row);
    if (row.is_deleted) {
      mergedDeleted[row.id] = Math.max(mergedDeleted[row.id] ?? 0, timestamp);
      merged.delete(row.id);
      continue;
    }
    if (!row.task) continue;
    const localTask = localById.get(row.id);
    const localTime = Number(localTask?.updatedAt) || 0;
    if (localTask && localTime > timestamp) {
      merged.set(row.id, { task: localTask, time: localTime });
    } else {
      const normalized = {
        ...row.task,
        updatedAt: timestamp
      } as Task;
      merged.set(row.id, { task: normalized, time: timestamp });
      delete mergedDeleted[row.id];
    }
  }

  for (const task of localTasks) {
    const timestamp = Number(task.updatedAt) || 0;
    const remoteTime = mergedRemote.find(row => row.id === task.id);
    const deletedTime = mergedDeleted[task.id] ?? 0;
    if (timestamp > deletedTime && (!remoteTime || timestamp > rowTime(remoteTime))) {
      merged.set(task.id, { task, time: timestamp });
      delete mergedDeleted[task.id];
    } else if (deletedTime >= timestamp) {
      merged.delete(task.id);
    }
  }

  return {
    tasks: Array.from(merged.values()).sort((a, b) => (a.task.date + String(a.task.start).padStart(4, "0")).localeCompare(b.task.date + String(b.task.start).padStart(4, "0"))).map(value => value.task),
    deletedAt: mergedDeleted,
    session: second.current
  };
}
