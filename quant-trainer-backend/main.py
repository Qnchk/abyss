from datetime import datetime, timedelta
from pathlib import Path
from typing import List, Optional, Dict, Any

import json
from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from jose import JWTError, jwt
from passlib.context import CryptContext
from pydantic import BaseModel
from sqlalchemy import (
    create_engine,
    Column,
    Integer,
    String,
    Boolean,
    DateTime,
    ForeignKey,
    Float,
)
from sqlalchemy.orm import sessionmaker, declarative_base, relationship, Session

# ------------------- Конфиг -------------------

SECRET_KEY = "CHANGE_ME_TO_SOMETHING_RANDOM_AND_SECRET"
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 30  # 30 дней

DATABASE_URL = "sqlite:///./quant_trainer.db"

Base = declarative_base()
engine = create_engine(
    DATABASE_URL, connect_args={"check_same_thread": False}
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

from passlib.context import CryptContext

pwd_context = CryptContext(
    schemes=["pbkdf2_sha256"],
    deprecated="auto",
)

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="auth/login")

app = FastAPI(title="Quant Questions Trainer")

# CORS — фронт на 5173
# максимально либеральный CORS для локальной разработки
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=".*",   # разрешаем любой Origin
    allow_credentials=False,   # нам не нужны cookies, только Bearer-токен
    allow_methods=["*"],
    allow_headers=["*"],
)


# ------------------- Модели БД -------------------

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    progresses = relationship("UserQuestionProgress", back_populates="user")


class UserQuestionProgress(Base):
    __tablename__ = "user_question_progress"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), index=True)
    question_id = Column(Integer, index=True)

    attempts = Column(Integer, default=0)
    total_time_seconds = Column(Float, default=0.0)
    solved = Column(Boolean, default=False)
    solved_at = Column(DateTime, nullable=True)
    last_attempt_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="progresses")


Base.metadata.create_all(bind=engine)


# ------------------- Загрузка задач -------------------

DATA_FILE = Path(__file__).parent / "quant_questions.json"
if not DATA_FILE.exists():
    raise RuntimeError(f"Не найден файл с задачами: {DATA_FILE}")

with DATA_FILE.open(encoding="utf-8") as f:
    raw_questions: List[Dict[str, Any]] = json.load(f)

QUESTIONS: List[Dict[str, Any]] = []
for idx, q in enumerate(raw_questions):
    tags = q.get("tags") or []
    if isinstance(tags, str):
        try:
            tags = json.loads(tags)
        except Exception:
            tags = [tags]

    companies = q.get("companies") or []
    if isinstance(companies, str):
        try:
            companies = json.loads(companies)
        except Exception:
            companies = [companies]

    QUESTIONS.append(
        {
            "id": idx,
            **q,
            "tags": tags,
            "companies": companies,
        }
    )


# ------------------- Pydantic-схемы -------------------

class QuestionOut(BaseModel):
    id: int
    title: Optional[str]
    url: Optional[str]
    topic: Optional[str]
    tags: List[str]
    difficulty: Optional[str]
    companies: List[str]
    task_text: Optional[str]
    task_html: Optional[str]
    hint: Optional[str]
    solution: Optional[str]
    answer: Optional[str]

    # user-specific
    is_solved: bool = False
    attempts: int = 0
    avg_time_seconds: Optional[float] = None

    class Config:
        orm_mode = True


class UserCreate(BaseModel):
    username: str
    password: str


class UserRead(BaseModel):
    id: int
    username: str
    created_at: datetime

    class Config:
        orm_mode = True


class Token(BaseModel):
    access_token: str
    token_type: str


class TokenData(BaseModel):
    username: Optional[str] = None


class ProgressUpdate(BaseModel):
    time_spent_seconds: float
    solved: bool = False


class DailySolvedPoint(BaseModel):
    date: str   # YYYY-MM-DD
    solved: int

class StatsOut(BaseModel):
    total_questions: int
    solved_questions: int
    avg_time_seconds: Optional[float]
    solved_by_difficulty: Dict[str, int]
    daily_solved: List[DailySolvedPoint]
    solved_by_topic: Dict[str, int]
    solved_by_company: Dict[str, int]


# ------------------- Вспомогательные функции -------------------

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)


def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def get_user_by_username(db: Session, username: str) -> Optional[User]:
    return db.query(User).filter(User.username == username).first()


def authenticate_user(db: Session, username: str, password: str) -> Optional[User]:
    user = get_user_by_username(db, username)
    if not user:
        return None
    if not verify_password(password, user.hashed_password):
        return None
    return user


async def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Не удалось проверить учетные данные",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise credentials_exception
        token_data = TokenData(username=username)
    except JWTError:
        raise credentials_exception
    user = get_user_by_username(db, token_data.username)
    if user is None:
        raise credentials_exception
    return user


def get_progress_map(db: Session, user: User) -> Dict[int, UserQuestionProgress]:
    progresses = db.query(UserQuestionProgress).filter(
        UserQuestionProgress.user_id == user.id
    ).all()
    return {p.question_id: p for p in progresses}


def enrich_question_for_user(
    q: Dict[str, Any],
    progress: Optional[UserQuestionProgress],
) -> QuestionOut:
    avg_time = None
    attempts = 0
    solved = False
    if progress:
        attempts = progress.attempts
        if progress.attempts > 0:
            avg_time = progress.total_time_seconds / progress.attempts
        solved = progress.solved

    return QuestionOut(
        id=q["id"],
        title=q.get("title"),
        url=q.get("url"),
        topic=q.get("topic"),
        tags=q.get("tags") or [],
        difficulty=q.get("difficulty"),
        companies=q.get("companies") or [],
        task_text=q.get("task_text"),
        task_html=q.get("task_html"),
        hint=q.get("hint"),
        solution=q.get("solution"),
        answer=q.get("answer"),
        is_solved=solved,
        attempts=attempts,
        avg_time_seconds=avg_time,
    )


# ------------------- Auth эндпоинты -------------------

@app.post("/auth/register", response_model=UserRead)
def register(user_in: UserCreate, db: Session = Depends(get_db)):
    existing = get_user_by_username(db, user_in.username)
    if existing:
        raise HTTPException(status_code=400, detail="Пользователь с таким именем уже существует")
    user = User(
        username=user_in.username,
        hashed_password=get_password_hash(user_in.password),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@app.post("/auth/login", response_model=Token)
def login(
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db),
):
    user = authenticate_user(db, form_data.username, form_data.password)
    if not user:
        raise HTTPException(status_code=400, detail="Неверное имя пользователя или пароль")
    access_token = create_access_token(data={"sub": user.username})
    return Token(access_token=access_token, token_type="bearer")


@app.get("/auth/me", response_model=UserRead)
def read_me(current_user: User = Depends(get_current_user)):
    return current_user


# ------------------- Задачи -------------------


@app.get("/questions", response_model=List[QuestionOut])
def list_questions(
    difficulty: Optional[str] = None,
    topic: Optional[str] = None,
    company: Optional[str] = None,
    tag: Optional[str] = None,
    search: Optional[str] = None,
    only_unsolved: bool = False,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    progress_map = get_progress_map(db, current_user)

    filtered = QUESTIONS
    if difficulty:
        filtered = [q for q in filtered if (q.get("difficulty") or "").lower() == difficulty.lower()]
    if topic:
        filtered = [q for q in filtered if (q.get("topic") or "").lower() == topic.lower()]
    if company:
        filtered = [
            q for q in filtered
            if any(company.lower() in (c or "").lower() for c in (q.get("companies") or []))
        ]
    if tag:
        filtered = [
            q for q in filtered
            if any(tag.lower() in (t or "").lower() for t in (q.get("tags") or []))
        ]
    if search:
        s = search.lower()
        filtered = [
            q for q in filtered
            if s in (q.get("title") or "").lower()
            or s in (q.get("task_text") or "").lower()
        ]

    result: List[QuestionOut] = []
    for q in filtered:
        prog = progress_map.get(q["id"])
        qo = enrich_question_for_user(q, prog)
        if only_unsolved and qo.is_solved:
            continue
        result.append(qo)

    return result

def build_all_questions_for_user(
    db: Session,
    current_user: User,
) -> List[QuestionOut]:
    """
    Собирает все вопросы из QUESTIONS и подмешивает к ним прогресс текущего пользователя.
    Это ровно то же, что делает list_questions, только без фильтров.
    """
    progress_map = get_progress_map(db, current_user)
    result: List[QuestionOut] = []
    for q in QUESTIONS:
        prog = progress_map.get(q["id"])
        result.append(enrich_question_for_user(q, prog))
    return result

@app.get("/questions/{question_id}", response_model=QuestionOut)
def get_question(
    question_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if question_id < 0 or question_id >= len(QUESTIONS):
        raise HTTPException(status_code=404, detail="Задача не найдена")

    progress_map = get_progress_map(db, current_user)
    prog = progress_map.get(question_id)
    return enrich_question_for_user(QUESTIONS[question_id], prog)


@app.post("/questions/{question_id}/progress")
def update_progress(
    question_id: int,
    payload: ProgressUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if question_id < 0 or question_id >= len(QUESTIONS):
        raise HTTPException(status_code=404, detail="Задача не найдена")

    prog = (
        db.query(UserQuestionProgress)
        .filter(
            UserQuestionProgress.user_id == current_user.id,
            UserQuestionProgress.question_id == question_id,
        )
        .first()
    )
    if not prog:
        prog = UserQuestionProgress(
            user_id=current_user.id,
            question_id=question_id,
            attempts=0,
            total_time_seconds=0.0,
            solved=False,
        )
        db.add(prog)
    elif payload.solved and prog.solved:
        # Уже решена — не считаем повторные клики в статистику
        return {"status": "already_solved"}

    prog.attempts += 1
    prog.total_time_seconds += float(payload.time_spent_seconds)
    prog.last_attempt_at = datetime.utcnow()

    if payload.solved and not prog.solved:
        prog.solved = True
        prog.solved_at = datetime.utcnow()

    db.commit()
    db.refresh(prog)

    return {"status": "ok"}


@app.post("/progress/reset")
def reset_progress(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    (
        db.query(UserQuestionProgress)
        .filter(UserQuestionProgress.user_id == current_user.id)
        .delete(synchronize_session=False)
    )
    db.commit()
    return {"status": "reset"}


# ------------------- Статистика -------------------

@app.get("/")
def root():
    return {"status": "ok", "msg": "Quant Trainer backend is running"}


@app.get("/stats", response_model=StatsOut)
def get_stats(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # Берём все вопросы с учётом прогресса пользователя
    questions = build_all_questions_for_user(db, current_user)

    total_questions = len(questions)
    solved_questions = sum(1 for q in questions if q.is_solved)

    # среднее время только по решённым задачам, где есть avg_time_seconds
    times = [
        q.avg_time_seconds
        for q in questions
        if q.is_solved and q.avg_time_seconds is not None
    ]
    avg_time = sum(times) / len(times) if times else None

    solved_by_difficulty: Dict[str, int] = {}
    solved_by_topic: Dict[str, int] = {}
    solved_by_company: Dict[str, int] = {}

    for q in questions:
        if not q.is_solved:
            continue

        # сложность
        diff = q.difficulty or "Unknown"
        solved_by_difficulty[diff] = solved_by_difficulty.get(diff, 0) + 1

        # темы
        if q.topic:
            solved_by_topic[q.topic] = solved_by_topic.get(q.topic, 0) + 1

        # фонды (companies)
        for c in q.companies or []:
            solved_by_company[c] = solved_by_company.get(c, 0) + 1

    # Пока у нас нет в БД даты решения, график по дням будет пустым
    daily_solved: List[DailySolvedPoint] = []

    return StatsOut(
        total_questions=total_questions,
        solved_questions=solved_questions,
        avg_time_seconds=avg_time,
        solved_by_difficulty=solved_by_difficulty,
        daily_solved=daily_solved,
        solved_by_topic=solved_by_topic,
        solved_by_company=solved_by_company,
    )
