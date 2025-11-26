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
  
  const API_URL = "http://127.0.0.1:8000";
  
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

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: HeadersInit = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
  
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(extractErrorMessage(text));
  }

  return res.json();
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

  const res = await fetch(`${API_URL}/auth/login`, {
    method: "POST",
    body: formData,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(extractErrorMessage(text));
  }
  
    const data = await res.json();
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
    const url = new URL(`${API_URL}/questions`);
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
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`API error ${res.status}: ${text}`);
    }
    return res.json();
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
  
