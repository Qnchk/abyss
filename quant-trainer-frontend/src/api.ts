// src/api.ts

export interface Question {
  id: number;
  title?: string;
  url?: string;
  topic?: string;
  tags: string[];
  difficulty?: string;
  companies: string[];
  task_text?: string;
  task_html?: string;
  hint?: string;
  solution?: string;
  answer?: string;
  is_solved: boolean;
  attempts: number;
  avg_time_seconds?: number | null;
}

export interface User {
  id: number;
  username: string;
  created_at: string;
}

export interface DailySolvedPoint {
  date: string;
  solved: number;
}

export interface Stats {
  total_questions: number;
  solved_questions: number;
  avg_time_seconds: number | null;
  solved_by_difficulty: Record<string, number>;
  daily_solved?: DailySolvedPoint[];
  solved_by_topic?: Record<string, number>;
  solved_by_company?: Record<string, number>;
}

// Базовый адрес бекенда: можно переопределить через VITE_API_URL, по умолчанию — локальный dev.
const API_URL = ((import.meta.env.VITE_API_URL as string | undefined) || "http://127.0.0.1:8000")
  .trim()
  .replace(/\/+$/, "");

// eslint-disable-next-line no-console
console.info("[quant-trainer] API base URL:", API_URL);

function getToken(): string | null {
  return localStorage.getItem("token");
}

function setToken(token: string | null) {
  if (token) {
    localStorage.setItem("token", token);
  } else {
    localStorage.removeItem("token");
  }
}

function extractErrorMessage(text: string): string {
  let message = text;
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed === "string") {
      message = parsed;
    } else if (parsed?.detail) {
      if (typeof parsed.detail === "string") {
        message = parsed.detail;
      } else if (Array.isArray(parsed.detail)) {
        message = parsed.detail
          .map((item: any) => item?.msg || item?.detail || JSON.stringify(item))
          .join("; ");
      } else {
        message = JSON.stringify(parsed.detail);
      }
    }
  } catch {
    /* ignore parse errors */
  }
  return message;
}

function formatBodySnippet(text: string): string {
  return text.slice(0, 300).replace(/\s+/g, " ").trim();
}

async function ensureJson<T>(res: Response, url: string): Promise<T> {
  const text = await res.text();
  if (!res.ok) {
    const msg = `Запрос к ${url} вернул ${res.status}. ${extractErrorMessage(text)}`;
    // eslint-disable-next-line no-console
    console.error(msg);
    throw new Error(msg);
  }
  try {
    return JSON.parse(text) as T;
  } catch (err) {
    const ct = res.headers.get("content-type") || "unknown";
    const snippet = formatBodySnippet(text) || "<empty>";
    const msg = `Не удалось разобрать JSON от бекенда (${url}). status=${res.status}, content-type=${ct}. Начало ответа: ${snippet}`;
    // eslint-disable-next-line no-console
    console.error(msg);
    throw new Error(msg);
  }
}

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string> | undefined),
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const url = `${API_URL}${path}`;
  const res = await fetch(url, {
    ...options,
    headers,
  });
  return ensureJson<T>(res, url);
}

export async function register(username: string, password: string): Promise<User> {
  return apiFetch<User>("/auth/register", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

export async function login(username: string, password: string): Promise<void> {
  // FastAPI ждёт form-data для /auth/login
  const formData = new FormData();
  formData.append("username", username);
  formData.append("password", password);

  const url = `${API_URL}/auth/login`;
  const res = await fetch(url, {
    method: "POST",
    body: formData
  });

  const data = await ensureJson<{ access_token: string }>(res, url);
  setToken(data.access_token);
}

export function logout() {
  setToken(null);
}

export async function getCurrentUser(): Promise<User> {
  return apiFetch<User>("/auth/me");
}

export async function fetchQuestions(params: {
  difficulty?: string;
  topic?: string;
  company?: string;
  tag?: string;
  search?: string;
  only_unsolved?: boolean;
} = {}): Promise<Question[]> {
  let url: URL;
  try {
    url = new URL(`${API_URL}/questions`);
  } catch (err: any) {
    const msg = `Не удалось собрать URL для /questions. base="${API_URL}". ${err?.message || err}`;
    // eslint-disable-next-line no-console
    console.error(msg);
    throw new Error(msg);
  }
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") {
      url.searchParams.set(k, String(v));
    }
  });

  const token = getToken();
  const headers: HeadersInit = {};
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(url.toString(), { headers });
  return ensureJson<Question[]>(res, url.toString());
}

export async function updateProgress(
  questionId: number,
  time_spent_seconds: number,
  solved: boolean
): Promise<void> {
  await apiFetch(`/questions/${questionId}/progress`, {
    method: "POST",
    body: JSON.stringify({ time_spent_seconds, solved }),
  });
}

export async function fetchStats(): Promise<Stats> {
  return apiFetch<Stats>("/stats");
}

export async function resetProgress(): Promise<void> {
  await apiFetch("/progress/reset", { method: "POST" });
}
