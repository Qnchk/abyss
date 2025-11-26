import React, { useEffect, useMemo, useState } from "react";
import {
  login,
  register,
  logout,
  getCurrentUser,
  fetchQuestions,
  fetchStats,
  updateProgress,
  resetProgress,
} from "./api";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  BarChart,
  Bar,
} from "recharts";

import type { Question, User, Stats } from "./api";
import "./App.css";



// Чтобы TS не ругался на window.MathJax
declare global {
  interface Window {
    MathJax?: {
      typesetPromise?: () => Promise<void>;
    };
  }
}

type ViewMode = "questions" | "stats" | "training";

interface Filters {
  difficulty: string;
  company: string;
  topics: string[];
  tags: string[];
  search: string;
  onlyUnsolved: boolean;
}

type ConfettiPiece = {
  id: number;
  left: number;
  size: number;
  color: string;
  duration: number;
  delay: number;
  rotation: number;
  drift: number;
};

const defaultFilters: Filters = {
  difficulty: "",
  company: "",
  topics: [],
  tags: [],
  search: "",
  onlyUnsolved: false,
};

function formatPlainTextToHtml(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped.replace(/\n/g, "<br/>");
}

const QuestionText: React.FC<{
  html?: string | null;
  text?: string | null;
  className?: string;
  contentClassName?: string;
}> = React.memo(({ html, text, className, contentClassName }) => {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const content = React.useMemo(() => {
    if (html) return html;
    if (text) return formatPlainTextToHtml(text);
    return "";
  }, [html, text]);

  React.useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    if (el.dataset.raw === content) return;
    el.dataset.raw = content;
    el.innerHTML = content;

    const mj = window.MathJax;
    const ready = mj?.startup?.promise || Promise.resolve();
    ready
      .then(() => {
        if (mj && typeof mj.typesetPromise === "function") {
          return mj.typesetPromise([el]);
        }
        return null;
      })
      .catch(() => {
        /* ignore */
      });
  }, [content]);

  return (
    <div className={className}>
      <div ref={containerRef} className={contentClassName} />
    </div>
  );
});
QuestionText.displayName = "QuestionText";

const App: React.FC = () => {
  const [user, setUser] = useState<User | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const [selectedQuestion, setSelectedQuestion] = useState<Question | null>(null);
  const [view, setView] = useState<ViewMode>("questions");

  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authUsername, setAuthUsername] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [startTime, setStartTime] = useState<number | null>(null);
  const [showHint, setShowHint] = useState(false);
  const [showSolution, setShowSolution] = useState(false);
  const [showAnswer, setShowAnswer] = useState(false);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  // -------- Training mode state --------
  const [trainingQuestion, setTrainingQuestion] = useState<Question | null>(null);
  const [trainingModeRunning, setTrainingModeRunning] = useState(false);
  const [trainingStartTime, setTrainingStartTime] = useState<number | null>(null);
  const [trainingElapsedSec, setTrainingElapsedSec] = useState(0);
  const [trainingShowHint, setTrainingShowHint] = useState(false);
  const [trainingShowSolution, setTrainingShowSolution] = useState(false);
  const [trainingShowAnswer, setTrainingShowAnswer] = useState(false);
  const [trainingInfoMessage, setTrainingInfoMessage] = useState<string | null>(null);
  const [showTopicPicker, setShowTopicPicker] = useState(false);
  const [showTagPicker, setShowTagPicker] = useState(false);
  const [resettingProgress, setResettingProgress] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [recentSolvedId, setRecentSolvedId] = useState<number | null>(null);
  const solvedPulseTimer = React.useRef<number | null>(null);
  const mathJaxTimer = React.useRef<number | null>(null);
  const [confettiPieces, setConfettiPieces] = useState<ConfettiPiece[]>([]);
  const confettiTimer = React.useRef<number | null>(null);

  function scheduleMathJax() {
    if (mathJaxTimer.current) {
      window.clearTimeout(mathJaxTimer.current);
    }
    mathJaxTimer.current = window.setTimeout(() => {
      const mj = window.MathJax;
      const ready = mj?.startup?.promise || Promise.resolve();
      ready
        .then(() => {
          if (mj && typeof mj.typesetPromise === "function") {
            return mj.typesetPromise();
          }
          return null;
        })
        .catch(() => {
          /* ignore MathJax errors */
        })
        .finally(() => {
          mathJaxTimer.current = null;
        });
    }, 120);
  }

  // -------- Инициализация (если есть токен) --------
  useEffect(() => {
    async function init() {
      const token = localStorage.getItem("token");
      if (!token) return;

      try {
        const u = await getCurrentUser();
        setUser(u);
        await reloadQuestions();
        await reloadStats();
      } catch {
        localStorage.removeItem("token");
      }
    }
    init();
    scheduleMathJax();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -------- Подгрузка задач и статистики --------

  async function reloadQuestions() {
    const qs = await fetchQuestions();
    setQuestions(qs);

    if (selectedQuestion) {
      const updated = qs.find((q) => q.id === selectedQuestion.id);
      if (updated) {
        setSelectedQuestion(updated);
      }
    }
    if (trainingQuestion) {
      const updatedTraining = qs.find((q) => q.id === trainingQuestion.id);
      if (updatedTraining) {
        setTrainingQuestion(updatedTraining);
      }
    }
  }

  async function reloadStats() {
    const s = await fetchStats();
    setStats(s);
  }

  // -------- Справочники для фильтров --------

  const uniqueDifficulties = useMemo(
    () =>
      Array.from(
        new Set(questions.map((q) => q.difficulty).filter((x): x is string => Boolean(x)))
      ),
    [questions]
  );

  const uniqueTopics = useMemo(
    () =>
      Array.from(
        new Set(questions.map((q) => q.topic).filter((x): x is string => Boolean(x)))
      ).sort(),
    [questions]
  );
  const uniqueTags = useMemo(
    () =>
      Array.from(
        new Set(
          questions
            .flatMap((q) => q.tags || [])
            .filter((x): x is string => Boolean(x))
        )
      ).sort(),
    [questions]
  );

  const hasActiveFilters =
    !!filters.difficulty ||
    !!filters.company ||
    filters.topics.length > 0 ||
    filters.tags.length > 0 ||
    !!filters.onlyUnsolved ||
    !!filters.search;

  const progressPercent = useMemo(() => {
    if (!stats || stats.total_questions === 0) return 0;
    return (stats.solved_questions / stats.total_questions) * 100;
  }, [stats]);

  // -------- Применение фильтров (классический режим) --------

  const filteredQuestions = useMemo(() => {
    return questions.filter((q) => {
      if (filters.difficulty && q.difficulty !== filters.difficulty) return false;
      if (filters.topics.length > 0) {
        if (!q.topic || !filters.topics.includes(q.topic)) return false;
      }
      if (filters.company && !(q.companies || []).includes(filters.company)) return false;
      if (filters.tags.length > 0) {
        const qTags = q.tags || [];
        const hasAll = filters.tags.every((t) => qTags.includes(t));
        if (!hasAll) return false;
      }
      if (filters.onlyUnsolved && q.is_solved) return false;

      if (filters.search) {
        const s = filters.search.toLowerCase();
        const haystack = `${q.title || ""} ${q.task_text || ""}`.toLowerCase();
        if (!haystack.includes(s)) return false;
      }
      return true;
    });
  }, [questions, filters]);

  // -------- Авторизация --------

  async function handleAuthSubmit(e: React.FormEvent) {
    e.preventDefault();
    setAuthError(null);
    setLoading(true);
    try {
      if (authMode === "register") {
        await register(authUsername, authPassword);
        await login(authUsername, authPassword);
      } else {
        await login(authUsername, authPassword);
      }
      const u = await getCurrentUser();
      setUser(u);
      await reloadQuestions();
      await reloadStats();
    } catch (err: any) {
      setAuthError(err.message || "Ошибка аутентификации");
    } finally {
      setLoading(false);
    }
  }

  function handleLogout() {
    logout();
    setUser(null);
    setQuestions([]);
    setStats(null);
    setSelectedQuestion(null);
    setStartTime(null);
    setFilters(defaultFilters);
    setTrainingModeRunning(false);
    setTrainingQuestion(null);
  }

  async function handleResetProgress() {
    const confirmed = window.confirm("Сбросить прогресс по решённым задачам?");
    if (!confirmed) return;
    setResettingProgress(true);
    try {
      await resetProgress();
      setSelectedQuestion(null);
      setTrainingModeRunning(false);
      setTrainingQuestion(null);
      await reloadQuestions();
      await reloadStats();
    } catch (err: any) {
      alert(`Не удалось сбросить прогресс: ${err.message}`);
    } finally {
      setResettingProgress(false);
    }
  }

  function triggerSolvedPulse(id: number) {
    setRecentSolvedId(id);
    if (solvedPulseTimer.current) {
      window.clearTimeout(solvedPulseTimer.current);
    }
    solvedPulseTimer.current = window.setTimeout(() => {
      setRecentSolvedId(null);
      solvedPulseTimer.current = null;
    }, 1200);
  }

  function spawnConfetti() {
    const colors = ["#22c55e", "#a855f7", "#3b82f6", "#f97316", "#eab308"];
    const pieces: ConfettiPiece[] = Array.from({ length: 28 }).map((_, idx) => {
      const size = 6 + Math.random() * 6;
      return {
        id: Date.now() + idx,
        left: 15 + Math.random() * 70,
        size,
        color: colors[Math.floor(Math.random() * colors.length)],
        duration: 900 + Math.random() * 500,
        delay: Math.random() * 120,
        rotation: Math.random() * 360,
        drift: -40 + Math.random() * 80,
      };
    });
    setConfettiPieces(pieces);
    if (confettiTimer.current) {
      window.clearTimeout(confettiTimer.current);
    }
    confettiTimer.current = window.setTimeout(() => {
      setConfettiPieces([]);
      confettiTimer.current = null;
    }, 1400);
  }

  useEffect(
    () => () => {
      if (solvedPulseTimer.current) {
        window.clearTimeout(solvedPulseTimer.current);
      }
      if (confettiTimer.current) {
        window.clearTimeout(confettiTimer.current);
      }
      if (mathJaxTimer.current) {
        window.clearTimeout(mathJaxTimer.current);
      }
    },
    []
  );

  // -------- Работа с задачами (обычный режим) --------

  function handleSelectQuestion(q: Question) {
    if (selectedQuestion && selectedQuestion.id === q.id) {
      // повторный клик по той же задаче — не трогаем контент, чтобы не дёргать MathJax
      setStartTime(Date.now());
      return;
    }
    setSelectedQuestion(q);
    setStartTime(Date.now());
    setShowHint(false);
    setShowSolution(false);
    setShowAnswer(false);
    setInfoMessage(null);
  }

  async function handleMarkSolved(solved: boolean) {
    if (!selectedQuestion) return;
    if (solved && selectedQuestion.is_solved) {
      setInfoMessage("Задача уже отмечена как решённая.");
      return;
    }
    const end = Date.now();
    const deltaSec =
      startTime !== null ? Math.max(1, Math.round((end - startTime) / 1000)) : 60;

    try {
      await updateProgress(selectedQuestion.id, deltaSec, solved);
      await reloadQuestions();
      await reloadStats();
      if (solved) {
        triggerSolvedPulse(selectedQuestion.id);
        spawnConfetti();
      }
      setInfoMessage(
        solved
          ? `Отлично! Задача отмечена как решённая (время ~${deltaSec} сек).`
          : `Попытка сохранена (время ~${deltaSec} сек).`
      );
      setStartTime(Date.now());
    } catch (err: any) {
      setInfoMessage(`Ошибка при сохранении прогресса: ${err.message}`);
    }
  }

  // -------- Training mode: выбор вопроса и таймер --------

  function pickRandomTrainingQuestion(): Question | null {
    if (!questions.length) return null;
    const unsolved = questions.filter((q) => !q.is_solved);
    const pool = unsolved.length ? unsolved : questions;
    if (!pool.length) return null;
    const idx = Math.floor(Math.random() * pool.length);
    return pool[idx];
  }

  async function startTrainingSession() {
    setView("training");
    setTrainingInfoMessage(null);

    if (!questions.length) {
      try {
        await reloadQuestions();
      } catch {
        setTrainingInfoMessage("Не удалось загрузить задачи.");
        return;
      }
    }

    const q = pickRandomTrainingQuestion();
    if (!q) {
      setTrainingModeRunning(false);
      setTrainingQuestion(null);
      setTrainingInfoMessage("Нет задач для тренировки.");
      return;
    }

    setTrainingQuestion(q);
    setTrainingModeRunning(true);
    setTrainingStartTime(Date.now());
    setTrainingElapsedSec(0);
    setTrainingShowHint(false);
    setTrainingShowSolution(false);
    setTrainingShowAnswer(false);
  }

  function stopTrainingSession() {
    setTrainingModeRunning(false);
    setTrainingQuestion(null);
    setTrainingStartTime(null);
    setTrainingElapsedSec(0);
    setTrainingShowHint(false);
    setTrainingShowSolution(false);
    setTrainingShowAnswer(false);
    setTrainingInfoMessage(null);
  }

  // обновление таймера training mode
  useEffect(() => {
    if (!trainingModeRunning || !trainingStartTime) return;

    const id = window.setInterval(() => {
      setTrainingElapsedSec(
        Math.max(0, Math.floor((Date.now() - trainingStartTime) / 1000))
      );
    }, 1000);

    return () => {
      window.clearInterval(id);
    };
  }, [trainingModeRunning, trainingStartTime]);

  // обработчики «решена» / «пропустить» в training mode
  async function handleTrainingMark(solved: boolean) {
    if (!trainingQuestion) return;
    if (solved && trainingQuestion.is_solved) {
      setTrainingInfoMessage("Эта задача уже была решена.");
      return;
    }
    const now = Date.now();
    const deltaSec =
      trainingStartTime !== null
        ? Math.max(1, Math.round((now - trainingStartTime) / 1000))
        : 60;

    try {
      await updateProgress(trainingQuestion.id, deltaSec, solved);
      await reloadQuestions();
      await reloadStats();
      if (solved) {
        triggerSolvedPulse(trainingQuestion.id);
        spawnConfetti();
      }
    } catch (err: any) {
      setTrainingInfoMessage(`Ошибка при сохранении прогресса: ${err.message}`);
      return;
    }

    const next = pickRandomTrainingQuestion();
    if (!next) {
      setTrainingModeRunning(false);
      setTrainingQuestion(null);
      setTrainingStartTime(null);
      setTrainingElapsedSec(0);
      setTrainingInfoMessage("Все задачи решены. Хорошая работа!");
      return;
    }

    setTrainingQuestion(next);
    setTrainingStartTime(Date.now());
    setTrainingElapsedSec(0);
    setTrainingShowHint(false);
    setTrainingShowSolution(false);
    setTrainingShowAnswer(false);
    setTrainingInfoMessage(null);
  }

  function formatTime(sec: number): string {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    const mm = m < 10 ? `0${m}` : String(m);
    const ss = s < 10 ? `0${s}` : String(s);
    return `${mm}:${ss}`;
  }

  // -------- LaTeX (MathJax) --------

  useEffect(() => {
    scheduleMathJax();
  }, [
    selectedQuestion?.id,
    selectedQuestion?.task_html,
    selectedQuestion?.task_text,
    showHint,
    showSolution,
    showAnswer,
    trainingQuestion?.id,
    trainingQuestion?.task_html,
    trainingQuestion?.task_text,
    trainingShowHint,
    trainingShowSolution,
    trainingShowAnswer,
  ]);

  // -------- Экраны --------

  if (!user) {
    // экран логина / регистрации
    return (
      <div className="app auth-screen">
        <div className="auth-card">
          <h1>Abyss</h1>
          <p className="auth-subtitle">Тренажёр по задачам из quant_questions.json</p>

          <div className="auth-tabs">
            <button
              className={authMode === "login" ? "active" : ""}
              onClick={() => setAuthMode("login")}
            >
              Вход
            </button>
            <button
              className={authMode === "register" ? "active" : ""}
              onClick={() => setAuthMode("register")}
            >
              Регистрация
            </button>
          </div>

          <form onSubmit={handleAuthSubmit} className="auth-form">
            <label>
              Логин
              <input
                value={authUsername}
                onChange={(e) => setAuthUsername(e.target.value)}
                required
              />
            </label>
            <label>
              Пароль
              <input
                type="password"
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
                required
              />
            </label>
            {authError && <div className="auth-error">{authError}</div>}
            <button type="submit" disabled={loading}>
              {loading ? "..." : authMode === "login" ? "Войти" : "Создать аккаунт"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // основной интерфейс
  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-left">
          <h1>Abyss</h1>
          <span className="topbar-subtitle">
            {stats
              ? `Решено: ${stats.solved_questions}/${stats.total_questions}`
              : "Загрузка статистики..."}
          </span>
          {stats && (
            <div className="progress-bar-container">
              <div className="progress-bar-track">
                <div
                  className="progress-bar-fill"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <span className="progress-bar-label">
                {Math.round(progressPercent)}%
              </span>
            </div>
          )}
        </div>
        <div className="topbar-right">
          <span className="topbar-user">@{user.username}</span>
          <a
            className="icon-button"
            href="https://t.me/my_abyss31"
            target="_blank"
            rel="noreferrer"
            aria-label="Перейти в Telegram-канал"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M21.5 3.5 2.8 10.5c-.9.34-.88 1.64.04 1.94l4.4 1.47 1.72 5.42c.26.82 1.34 1.02 1.9.36l2.65-3.16 4.35 3.42c.72.56 1.79.16 1.99-.74l3.1-14.17c.22-1.02-.77-1.86-1.84-1.54Z"
                fill="url(#tg)"
              />
              <defs>
                <linearGradient id="tg" x1="3" y1="12" x2="21" y2="12" gradientUnits="userSpaceOnUse">
                  <stop stop-color="#37aee2" />
                  <stop offset="1" stop-color="#1e96c8" />
                </linearGradient>
              </defs>
            </svg>
          </a>
          <button
            onClick={() => {
              setView("questions");
              setTrainingModeRunning(false);
            }}
            className={view === "questions" ? "active" : ""}
          >
            Задачи
          </button>
          <button
            onClick={() => {
              void startTrainingSession();
            }}
            className={view === "training" ? "active" : ""}
          >
            Тренировка
          </button>
          <button
            onClick={() => {
              setView("stats");
              setTrainingModeRunning(false);
            }}
            className={view === "stats" ? "active" : ""}
          >
            Статистика
          </button>
          <button className="logout-btn" onClick={handleLogout}>
            Выйти
          </button>
        </div>
      </header>

      <div className="confetti-layer">
        {confettiPieces.map((p) => (
          <div
            key={p.id}
            className="confetti-piece"
            style={{
              left: `${p.left}%`,
              width: `${p.size}px`,
              height: `${p.size * 1.6}px`,
              background: p.color,
              transform: `rotate(${p.rotation}deg)`,
              animationDuration: `${p.duration}ms`,
              animationDelay: `${p.delay}ms`,
              ["--drift" as any]: `${p.drift}px`,
            }}
          />
        ))}
      </div>

      <div className={"layout" + (sidebarCollapsed ? " sidebar-collapsed" : "")}>
        <div className="sidebar-toggle-container">
          <button
            className="sidebar-toggle"
            onClick={() => setSidebarCollapsed((v) => !v)}
            aria-label={sidebarCollapsed ? "Развернуть панель" : "Свернуть панель"}
          >
            {sidebarCollapsed ? "»" : "«"}
          </button>
        </div>
        {/* Сайдбар */}
        <aside className={"sidebar" + (sidebarCollapsed ? " collapsed" : "")}>
          <section className="card">
            <h2>Фильтры</h2>

            <label>
              Поиск
              <input
                value={filters.search}
                onChange={(e) =>
                  setFilters((prev) => ({ ...prev, search: e.target.value }))
                }
                placeholder="по названию или тексту задачи"
              />
            </label>

            <div className="filter-block">
              <div className="filter-label">Сложность</div>
              <div className="difficulty-chips">
                <button
                  className={
                    "difficulty-chip" + (!filters.difficulty ? " active" : "")
                  }
                  onClick={() =>
                    setFilters((prev) => ({ ...prev, difficulty: "" }))
                  }
                >
                  Все
                </button>
                {uniqueDifficulties.map((d) => (
                  <button
                    key={d}
                    className={
                      "difficulty-chip" +
                      (filters.difficulty === d ? " active" : "")
                    }
                    onClick={() =>
                      setFilters((prev) => ({
                        ...prev,
                        difficulty: prev.difficulty === d ? "" : d,
                      }))
                    }
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>

            <div className="filter-block">
              <div className="filter-label">Топики</div>
              <div className="tag-picker">
                <button
                  type="button"
                  className="tag-picker-toggle"
                  onClick={() => setShowTopicPicker((v) => !v)}
                >
                  {filters.topics.length > 0
                    ? `Выбрано: ${filters.topics.length}`
                    : "Выбрать топики"}
                  <span className="chevron">{showTopicPicker ? "▲" : "▼"}</span>
                </button>

                {filters.topics.length > 0 && (
                  <div className="selected-tag-chips">
                    {filters.topics.map((t) => (
                      <button
                        key={t}
                        className="chip chip-clickable"
                        onClick={() =>
                          setFilters((prev) => ({
                            ...prev,
                            topics: prev.topics.filter((x) => x !== t),
                          }))
                        }
                      >
                        {t} <span>×</span>
                      </button>
                    ))}
                  </div>
                )}

                {showTopicPicker && (
                  <div className="tag-picker-panel">
                    {uniqueTopics.length === 0 && (
                      <div className="tag-picker-empty">Нет топиков</div>
                    )}
                    {uniqueTopics.map((t) => {
                      const checked = filters.topics.includes(t);
                      return (
                        <label
                          key={t}
                          className={"tag-option" + (checked ? " active" : "")}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() =>
                              setFilters((prev) => {
                                const next = checked
                                  ? prev.topics.filter((x) => x !== t)
                                  : [...prev.topics, t];
                                return { ...prev, topics: next };
                              })
                            }
                          />
                          <span>{t}</span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <div className="filter-block">
              <div className="filter-label">Теги</div>
              <div className="tag-picker">
                <button
                  type="button"
                  className="tag-picker-toggle"
                  onClick={() => setShowTagPicker((v) => !v)}
                >
                  {filters.tags.length > 0
                    ? `Выбрано: ${filters.tags.length}`
                    : "Выбрать теги"}
                  <span className="chevron">{showTagPicker ? "▲" : "▼"}</span>
                </button>

                {filters.tags.length > 0 && (
                  <div className="selected-tag-chips">
                    {filters.tags.map((t) => (
                      <button
                        key={t}
                        className="chip chip-clickable"
                        onClick={() =>
                          setFilters((prev) => ({
                            ...prev,
                            tags: prev.tags.filter((x) => x !== t),
                          }))
                        }
                      >
                        {t} <span>×</span>
                      </button>
                    ))}
                  </div>
                )}

                {showTagPicker && (
                  <div className="tag-picker-panel">
                    {uniqueTags.length === 0 && (
                      <div className="tag-picker-empty">Нет тегов</div>
                    )}
                    {uniqueTags.map((t) => {
                      const checked = filters.tags.includes(t);
                      return (
                        <label
                          key={t}
                          className={"tag-option" + (checked ? " active" : "")}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() =>
                              setFilters((prev) => {
                                const next = checked
                                  ? prev.tags.filter((x) => x !== t)
                                  : [...prev.tags, t];
                                return { ...prev, tags: next };
                              })
                            }
                          />
                          <span>{t}</span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={filters.onlyUnsolved}
                onChange={(e) =>
                  setFilters((prev) => ({
                    ...prev,
                    onlyUnsolved: e.target.checked,
                  }))
                }
              />
              Только нерешённые
            </label>

            <div className="filter-actions">
              <button
                onClick={() => {
                  setFilters(defaultFilters);
                  setShowTopicPicker(false);
                  setShowTagPicker(false);
                }}
              >
                Сбросить фильтры
              </button>
            </div>
          </section>

          <section className="card">
            <h2>Краткая статистика</h2>
            {stats ? (
              <div className="stats-summary">
                <div>
                  <span>Решено задач:</span>
                  <strong>
                    {stats.solved_questions}/{stats.total_questions}
                  </strong>
                </div>
                <div>
                  <span>Среднее время:</span>
                  <strong>
                    {stats.avg_time_seconds
                      ? `${Math.round(stats.avg_time_seconds)} сек`
                      : "нет данных"}
                  </strong>
                </div>
                <div className="stats-difficulty">
                  <span>По сложности:</span>
                  <ul>
                    {Object.entries(stats.solved_by_difficulty).map(
                      ([diff, count]) => (
                        <li key={diff}>
                          {diff}: {count}
                        </li>
                      )
                    )}
                  </ul>
                </div>
              </div>
            ) : (
              <p>Загрузка...</p>
            )}
          </section>
        </aside>

        {/* Центральная часть */}
        <main className="main-content">
          {view === "questions" && (
            <div className="questions-layout">
              <section className="card questions-list">
                <h2>
                  Задачи{" "}
                  <span className="badge">
                    {filteredQuestions.length}/{questions.length}
                  </span>
                </h2>

                {hasActiveFilters && (
                  <div className="active-filters">
                    <span className="active-filters-label">Фильтры:</span>
                    {filters.difficulty && (
                      <button
                        className="active-filter-chip"
                        onClick={() =>
                          setFilters((prev) => ({ ...prev, difficulty: "" }))
                        }
                      >
                        Сложность: {filters.difficulty} <span>×</span>
                      </button>
                    )}
                    {filters.topics.map((t) => (
                      <button
                        key={t}
                        className="active-filter-chip"
                        onClick={() =>
                          setFilters((prev) => ({
                            ...prev,
                            topics: prev.topics.filter((x) => x !== t),
                          }))
                        }
                      >
                        Топик: {t} <span>×</span>
                      </button>
                    ))}
                    {filters.company && (
                      <button
                        className="active-filter-chip"
                        onClick={() =>
                          setFilters((prev) => ({ ...prev, company: "" }))
                        }
                      >
                        Фонд: {filters.company} <span>×</span>
                      </button>
                    )}
                    {filters.tags.map((t) => (
                      <button
                        key={t}
                        className="active-filter-chip"
                        onClick={() =>
                          setFilters((prev) => ({
                            ...prev,
                            tags: prev.tags.filter((x) => x !== t),
                          }))
                        }
                      >
                        Тег: {t} <span>×</span>
                      </button>
                    ))}
                    {filters.onlyUnsolved && (
                      <button
                        className="active-filter-chip"
                        onClick={() =>
                          setFilters((prev) => ({
                            ...prev,
                            onlyUnsolved: false,
                          }))
                        }
                      >
                        Только нерешённые <span>×</span>
                      </button>
                    )}
                    {filters.search && (
                      <button
                        className="active-filter-chip"
                        onClick={() =>
                          setFilters((prev) => ({ ...prev, search: "" }))
                        }
                      >
                        Поиск: “{filters.search}” <span>×</span>
                      </button>
                    )}
                    <button
                      className="clear-filters-link"
                      onClick={() => setFilters(defaultFilters)}
                    >
                      Сбросить все
                    </button>
                  </div>
                )}

                <div className="questions-scroll">
                  {filteredQuestions.map((q) => (
                    <div
                      key={q.id}
                      className={
                        "question-row" +
                        (selectedQuestion && selectedQuestion.id === q.id
                          ? " selected"
                          : "") +
                        (q.is_solved ? " solved" : "") +
                        (recentSolvedId === q.id ? " solved-pulse" : "")
                      }
                      onClick={() => handleSelectQuestion(q)}
                    >
                      <div className="question-row-main">
                        <span className="question-title">
                          {q.title || `Задача #${q.id}`}
                        </span>
                      </div>
                      <div className="question-row-meta">
                        {q.difficulty && (
                          <button
                            className="chip chip-clickable chip-difficulty"
                            onClick={(e) => {
                              e.stopPropagation();
                              setFilters((prev) => ({
                                ...prev,
                                difficulty:
                                  prev.difficulty === q.difficulty
                                    ? ""
                                    : q.difficulty || "",
                              }));
                            }}
                          >
                            {q.difficulty}
                          </button>
                        )}
                        {q.topic && (
                          <button
                            className="chip chip-clickable chip-topic"
                            onClick={(e) => {
                              e.stopPropagation();
                              setFilters((prev) => ({
                                ...prev,
                                topics: prev.topics.includes(q.topic || "")
                                  ? prev.topics.filter((x) => x !== q.topic)
                                  : q.topic
                                  ? [...prev.topics, q.topic]
                                  : prev.topics,
                              }));
                            }}
                          >
                            {q.topic}
                          </button>
                        )}
                        {q.companies && q.companies.length > 0 && (
                          <span className="meta-item">
                            {q.companies.slice(0, 2).map((c) => (
                              <button
                                key={c}
                                className="chip chip-clickable"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setFilters((prev) => ({
                                    ...prev,
                                    company: prev.company === c ? "" : c,
                                  }));
                                }}
                              >
                                {c}
                              </button>
                            ))}
                            {q.companies.length > 2 && (
                              <span className="meta-text">
                                +{q.companies.length - 2}
                              </span>
                            )}
                          </span>
                        )}
                        {q.tags && q.tags.length > 0 && (
                          <span className="meta-item">
                            {q.tags.slice(0, 3).map((t) => (
                              <button
                                key={t}
                                className="chip chip-clickable"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setFilters((prev) => ({
                                    ...prev,
                                    tags: prev.tags.includes(t)
                                      ? prev.tags.filter((x) => x !== t)
                                      : [...prev.tags, t],
                                  }));
                                }}
                              >
                                {t}
                              </button>
                            ))}
                            {q.tags.length > 3 && (
                              <span className="meta-text">
                                +{q.tags.length - 3}
                              </span>
                            )}
                          </span>
                        )}
                        <span className="meta-item">
                          Попыток: {q.attempts}{" "}
                          {q.avg_time_seconds
                            ? `· ~${Math.round(q.avg_time_seconds)} сек`
                            : ""}
                        </span>
                      </div>
                    </div>
                  ))}
                  {filteredQuestions.length === 0 && (
                    <p className="empty-state">Нет задач под текущие фильтры.</p>
                  )}
                </div>
              </section>

              <section className="card question-detail">
                <h2>Детали задачи</h2>
                {!selectedQuestion && <p>Выбери задачу слева.</p>}

                {selectedQuestion && (
                  <div className="question-body">
                    <h3>
                      {selectedQuestion.title || `Задача #${selectedQuestion.id}`}
                    </h3>

                    <div className="question-tags">
                      {selectedQuestion.difficulty && (
                        <span className="chip chip-difficulty">
                          Сложность: {selectedQuestion.difficulty}
                        </span>
                      )}
                      {selectedQuestion.topic && (
                        <span className="chip chip-topic">
                          Топик: {selectedQuestion.topic}
                        </span>
                      )}
                      {selectedQuestion.companies &&
                        selectedQuestion.companies.length > 0 && (
                          <span className="chip">
                            Компании: {selectedQuestion.companies.join(", ")}
                          </span>
                        )}
                    </div>

                    <QuestionText
                      html={selectedQuestion.task_html}
                      text={selectedQuestion.task_text}
                      className="question-text"
                    />

                    <div className="question-actions">
                      <button onClick={() => setShowHint((v) => !v)}>
                        {showHint ? "Скрыть подсказку" : "Показать подсказку"}
                      </button>
                      <button onClick={() => setShowSolution((v) => !v)}>
                        {showSolution ? "Скрыть решение" : "Показать решение"}
                      </button>
                      <button onClick={() => setShowAnswer((v) => !v)}>
                        {showAnswer ? "Скрыть краткий ответ" : "Показать краткий ответ"}
                      </button>
                    </div>

                    {showHint && selectedQuestion.hint && (
                      <div className="reveal-block">
                        <h4>Подсказка</h4>
                        <QuestionText
                          text={selectedQuestion.hint}
                          className="formatted-text-wrapper"
                          contentClassName="formatted-text"
                        />
                      </div>
                    )}

                    {showSolution && selectedQuestion.solution && (
                      <div className="reveal-block">
                        <h4>Решение</h4>
                        <QuestionText
                          text={selectedQuestion.solution}
                          className="formatted-text-wrapper"
                          contentClassName="formatted-text"
                        />
                      </div>
                    )}

                    {showAnswer && selectedQuestion.answer && (
                      <div className="reveal-block">
                        <h4>Ответ</h4>
                        <QuestionText
                          text={selectedQuestion.answer}
                          className="formatted-text-wrapper"
                          contentClassName="formatted-text"
                        />
                      </div>
                    )}

                    <div className="question-footer">
                      <button
                        className="btn-success"
                        onClick={() => handleMarkSolved(true)}
                      >
                        Отметить как решённую
                      </button>
                      <button
                        className="btn-secondary"
                        onClick={() => handleMarkSolved(false)}
                      >
                        Сохранить попытку
                      </button>
                      {infoMessage && (
                        <div className="info-message">{infoMessage}</div>
                      )}
                    </div>
                  </div>
                )}
              </section>
            </div>
          )}

          {view === "training" && (
            <section className="card training-card">
              <div className="training-header">
                <div>
                  <h2>Training mode</h2>
                  <p className="training-subtitle">
                    Случайная задача (приоритет — нерешённые)
                  </p>
                </div>
                <div className="training-timer">
                  <span className="training-timer-label">Время</span>
                  <span className="training-timer-value">
                    {formatTime(trainingElapsedSec)}
                  </span>
                </div>
              </div>

              {!trainingQuestion && (
                <p className="empty-state">
                  {trainingInfoMessage || "Нет задач для тренировки."}
                </p>
              )}

              {trainingQuestion && (
                <>
                  <div className="training-meta-row">
                    <span className="chip chip-difficulty">
                      {trainingQuestion.difficulty || "No difficulty"}
                    </span>
                    {trainingQuestion.topic && (
                      <span className="chip chip-topic">{trainingQuestion.topic}</span>
                    )}
                    {trainingQuestion.companies &&
                      trainingQuestion.companies.length > 0 && (
                        <span className="chip">
                          {trainingQuestion.companies.join(", ")}
                        </span>
                      )}
                  </div>

                  <QuestionText
                    html={trainingQuestion.task_html}
                    text={trainingQuestion.task_text}
                    className="question-text training-question-text"
                  />

                  <div className="training-actions-primary">
                    <button
                      className="btn-training"
                      onClick={() =>
                        setTrainingShowHint((prev) => !prev)
                      }
                    >
                      {trainingShowHint ? "Скрыть подсказку" : "Подсказка"}
                    </button>
                    <button
                      className="btn-training"
                      onClick={() =>
                        setTrainingShowSolution((prev) => !prev)
                      }
                    >
                      {trainingShowSolution ? "Скрыть решение" : "Решение"}
                    </button>
                    <button
                      className="btn-training"
                      onClick={() =>
                        setTrainingShowAnswer((prev) => !prev)
                      }
                    >
                      {trainingShowAnswer ? "Скрыть ответ" : "Ответ"}
                    </button>
                  </div>

                  {trainingShowHint && trainingQuestion.hint && (
                    <div className="reveal-block">
                      <h4>Подсказка</h4>
                      <QuestionText
                        text={trainingQuestion.hint}
                        className="formatted-text-wrapper"
                        contentClassName="formatted-text"
                      />
                    </div>
                  )}

                  {trainingShowSolution && trainingQuestion.solution && (
                    <div className="reveal-block">
                      <h4>Решение</h4>
                      <QuestionText
                        text={trainingQuestion.solution}
                        className="formatted-text-wrapper"
                        contentClassName="formatted-text"
                      />
                    </div>
                  )}

                  {trainingShowAnswer && trainingQuestion.answer && (
                    <div className="reveal-block">
                      <h4>Ответ</h4>
                      <QuestionText
                        text={trainingQuestion.answer}
                        className="formatted-text-wrapper"
                        contentClassName="formatted-text"
                      />
                    </div>
                  )}

                  <div className="training-footer">
                    <button
                      className="btn-success training-btn-wide"
                      onClick={() => void handleTrainingMark(true)}
                    >
                      Задача решена → следующая
                    </button>
                    <button
                      className="btn-secondary training-btn-wide"
                      onClick={() => void handleTrainingMark(false)}
                    >
                      Пропустить / попытка → следующая
                    </button>
                    <button
                      className="btn-secondary training-exit-btn"
                      onClick={stopTrainingSession}
                    >
                      Выйти из тренировки
                    </button>
                    {trainingInfoMessage && (
                      <div className="info-message training-info">
                        {trainingInfoMessage}
                      </div>
                    )}
                  </div>
                </>
              )}
            </section>
          )}

          {view === "stats" && (
            <section className="card stats-page">
              <div className="stats-header">
                <h2>Подробная статистика</h2>
                <button
                  className="btn-secondary reset-progress-btn"
                  onClick={() => void handleResetProgress()}
                  disabled={resettingProgress}
                >
                  {resettingProgress ? "Сброс..." : "Сбросить прогресс"}
                </button>
              </div>
              {stats ? (
                <div className="stats-body">
                  <div className="stats-kpis">
                    <div className="kpi-card">
                      <span>Всего задач</span>
                      <strong>{stats.total_questions}</strong>
                    </div>
                    <div className="kpi-card">
                      <span>Решено</span>
                      <strong>
                        {stats.solved_questions} / {stats.total_questions}
                      </strong>
                      <small>
                        {Math.round(
                          (stats.solved_questions / Math.max(1, stats.total_questions)) *
                            100
                        )}
                        %
                      </small>
                    </div>
                    <div className="kpi-card">
                      <span>Среднее время</span>
                      <strong>
                        {stats.avg_time_seconds
                          ? `${Math.round(stats.avg_time_seconds)} сек`
                          : "нет данных"}
                      </strong>
                    </div>
                  </div>

                  <div className="stats-charts">
                    <div className="stats-chart wide">
                      <div className="stats-chart-header">
                        <h3>Прогресс по дням</h3>
                        <span className="chart-meta">
                          {stats.daily_solved && stats.daily_solved.length > 0
                            ? `${stats.daily_solved.length} точек`
                            : "нет данных"}
                        </span>
                      </div>
                      {stats.daily_solved && stats.daily_solved.length > 0 ? (
                        <ResponsiveContainer width="100%" height={300}>
                          <LineChart data={stats.daily_solved}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                            <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                            <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                            <Tooltip />
                            <Line
                              type="monotone"
                              dataKey="solved"
                              stroke="#3b82f6"
                              strokeWidth={3}
                              dot={{ r: 3 }}
                              activeDot={{ r: 5 }}
                            />
                          </LineChart>
                        </ResponsiveContainer>
                      ) : (
                        <p className="stats-hint">Пока нет решённых задач по дням.</p>
                      )}
                    </div>

                    <div className="stats-chart">
                      <div className="stats-chart-header">
                        <h3>Решено по темам</h3>
                        <span className="chart-meta">
                          {stats.solved_by_topic &&
                          Object.keys(stats.solved_by_topic).length > 0
                            ? `${Object.keys(stats.solved_by_topic).length} тем`
                            : "нет данных"}
                        </span>
                      </div>
                      {stats.solved_by_topic &&
                      Object.keys(stats.solved_by_topic).length > 0 ? (
                        <ResponsiveContainer width="100%" height={280}>
                          <BarChart
                            data={Object.entries(stats.solved_by_topic).map(
                              ([name, count]) => ({ name, count })
                            )}
                          >
                            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                            <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                            <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                            <Tooltip />
                            <Bar dataKey="count" fill="#22c55e" radius={[6, 6, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      ) : (
                        <p className="stats-hint">Пока нет решённых задач по темам.</p>
                      )}
                    </div>

                    <div className="stats-chart">
                      <div className="stats-chart-header">
                        <h3>Решено по фондам</h3>
                        <span className="chart-meta">
                          {stats.solved_by_company &&
                          Object.keys(stats.solved_by_company).length > 0
                            ? `${Object.keys(stats.solved_by_company).length} фондов`
                            : "нет данных"}
                        </span>
                      </div>
                      {stats.solved_by_company &&
                      Object.keys(stats.solved_by_company).length > 0 ? (
                        <ResponsiveContainer width="100%" height={280}>
                          <BarChart
                            data={Object.entries(stats.solved_by_company).map(
                              ([name, count]) => ({ name, count })
                            )}
                          >
                            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                            <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                            <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                            <Tooltip />
                            <Bar dataKey="count" fill="#f97316" radius={[6, 6, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      ) : (
                        <p className="stats-hint">Пока нет решённых задач по фондам.</p>
                      )}
                    </div>

                    <div className="stats-chart">
                      <div className="stats-chart-header">
                        <h3>Решено по сложности</h3>
                      </div>
                      {stats.solved_by_difficulty &&
                      Object.keys(stats.solved_by_difficulty).length > 0 ? (
                        <ResponsiveContainer width="100%" height={240}>
                          <BarChart
                            data={Object.entries(stats.solved_by_difficulty).map(
                              ([name, count]) => ({ name, count })
                            )}
                            layout="vertical"
                            margin={{ left: 30 }}
                          >
                            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                            <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                            <YAxis
                              dataKey="name"
                              type="category"
                              tick={{ fontSize: 11 }}
                              width={70}
                            />
                            <Tooltip />
                            <Bar dataKey="count" fill="#a855f7" radius={[0, 8, 8, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      ) : (
                        <p className="stats-hint">
                          Пока нет решённых задач по уровням сложности.
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <p>Загрузка...</p>
              )}
            </section>
          )}
        </main>
      </div>
    </div>
  );
};

export default App;
