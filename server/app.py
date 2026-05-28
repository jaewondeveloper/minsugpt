import json
import os
import random
import sqlite3
import string
from datetime import datetime
from functools import wraps

from flask import Flask, jsonify, request
from flask_cors import CORS
from itsdangerous import BadSignature, URLSafeTimedSerializer
from werkzeug.security import check_password_hash, generate_password_hash

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "auth.db")
SECRET_KEY = os.environ.get("MINSUGPT_AUTH_SECRET", "change-this-in-production")
TOKEN_MAX_AGE_SECONDS = int(os.environ.get("MINSUGPT_TOKEN_MAX_AGE_SECONDS", "864000"))

DEFAULT_USERS = [
    {"username": "admin", "email": "admin@minsugpt.local", "name": "관리자", "birthdate": "2000-01-01", "role": "admin", "approved": 1, "password": "shin0816"},
    {"username": "guest", "email": "guest@minsugpt.local", "name": "게스트", "birthdate": "2000-01-01", "role": "guest", "approved": 1, "password": "ms12345678@@"},
]

app = Flask(__name__)
app.config["JSON_AS_ASCII"] = False

default_origins = "https://minsugpt.kro.kr,https://admin.minsugpt.kro.kr"
allowed_origins_raw = os.environ.get("MINSUGPT_ALLOWED_ORIGINS", default_origins)
ALLOWED_ORIGINS = [o.strip() for o in allowed_origins_raw.split(",") if o.strip()]
CORS(app, resources={r"/api/*": {"origins": ALLOWED_ORIGINS}})
serializer = URLSafeTimedSerializer(SECRET_KEY, salt="minsugpt-auth-token")


@app.before_request
def enforce_origin():
    if not request.path.startswith("/api/"):
        return None
    origin = request.headers.get("Origin")
    if origin and origin not in ALLOWED_ORIGINS:
        return jsonify({"success": False, "error": "forbidden_origin"}), 403
    return None


def now_iso():
    return datetime.utcnow().isoformat()


def db_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def ensure_column(conn, table_name, column_name, column_def):
    info = conn.execute(f"PRAGMA table_info({table_name})").fetchall()
    columns = {row["name"] for row in info}
    if column_name in columns:
        return
    conn.execute(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {column_def}")
    conn.commit()


def init_db():
    conn = db_conn()
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            name TEXT NOT NULL,
            birthdate TEXT,
            role TEXT NOT NULL DEFAULT 'guest',
            approved INTEGER NOT NULL DEFAULT 0,
            disabled INTEGER NOT NULL DEFAULT 0,
            must_reset_password INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS chat_sessions (
            id TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            messages_json TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
        """
    )
    ensure_column(conn, "users", "disabled", "INTEGER NOT NULL DEFAULT 0")
    ensure_column(conn, "users", "must_reset_password", "INTEGER NOT NULL DEFAULT 0")
    conn.commit()
    conn.close()


def seed_default_users():
    conn = db_conn()
    for u in DEFAULT_USERS:
        existing = conn.execute("SELECT id FROM users WHERE username = ? OR email = ?", (u["username"], u["email"])).fetchone()
        if existing:
            continue
        conn.execute(
            """
            INSERT INTO users (username, email, password_hash, name, birthdate, role, approved, disabled, must_reset_password, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?)
            """,
            (u["username"], u["email"], generate_password_hash(u["password"]), u["name"], u["birthdate"], u["role"], u["approved"], now_iso()),
        )
    conn.commit()
    conn.close()


def create_token(user):
    return serializer.dumps({"uid": user["id"], "username": user["username"], "role": user["role"]})


def parse_bearer_token():
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return None
    return auth[7:].strip()


def auth_required(handler):
    @wraps(handler)
    def wrapper(*args, **kwargs):
        token = parse_bearer_token()
        if not token:
            return jsonify({"success": False, "error": "missing_token"}), 401
        try:
            payload = serializer.loads(token, max_age=TOKEN_MAX_AGE_SECONDS)
        except BadSignature:
            return jsonify({"success": False, "error": "invalid_token"}), 401
        conn = db_conn()
        user = conn.execute(
            "SELECT id, username, email, name, birthdate, role, approved, disabled, must_reset_password FROM users WHERE id = ?",
            (payload.get("uid"),),
        ).fetchone()
        conn.close()
        if not user:
            return jsonify({"success": False, "error": "user_not_found"}), 401
        if int(user["disabled"]) == 1:
            return jsonify({"success": False, "error": "account_disabled"}), 403
        if int(user["approved"]) != 1:
            return jsonify({"success": False, "error": "unapproved"}), 403
        request.user = user
        return handler(*args, **kwargs)

    return wrapper


def admin_required(handler):
    @wraps(handler)
    def wrapper(*args, **kwargs):
        if request.user["role"] != "admin":
            return jsonify({"success": False, "error": "admin_only"}), 403
        return handler(*args, **kwargs)

    return wrapper


def user_to_json(user):
    return {
        "id": user["id"],
        "username": user["username"],
        "email": user["email"],
        "name": user["name"],
        "birthdate": user["birthdate"],
        "role": user["role"],
        "approved": bool(user["approved"]),
        "disabled": bool(user["disabled"]),
        "mustResetPassword": bool(user["must_reset_password"]),
    }


def row_to_session(row):
    try:
        messages = json.loads(row["messages_json"] or "[]")
    except json.JSONDecodeError:
        messages = []
    return {"id": row["id"], "title": row["title"], "messages": messages, "updatedAt": row["updated_at"]}


def random_temp_password(length=12):
    chars = string.ascii_letters + string.digits + "!@#$%^&*"
    return "".join(random.choice(chars) for _ in range(length))


@app.get("/api/health")
def health():
    return jsonify({"success": True, "service": "minsugpt-auth"})


@app.post("/api/auth/signup")
def signup():
    data = request.get_json(silent=True) or {}
    username = (data.get("username") or data.get("email") or "").strip().lower()
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""
    name = (data.get("name") or "").strip()
    birthdate = (data.get("birthdate") or "").strip()
    if not username or not email or not password or not name:
        return jsonify({"success": False, "error": "필수 항목이 비어 있습니다."}), 400
    if len(password) < 8:
        return jsonify({"success": False, "error": "비밀번호는 최소 8자 이상이어야 합니다."}), 400
    conn = db_conn()
    exists = conn.execute("SELECT id FROM users WHERE username = ? OR email = ?", (username, email)).fetchone()
    if exists:
        conn.close()
        return jsonify({"success": False, "error": "이미 사용 중인 계정입니다."}), 409
    conn.execute(
        """
        INSERT INTO users (username, email, password_hash, name, birthdate, role, approved, disabled, must_reset_password, created_at)
        VALUES (?, ?, ?, ?, ?, 'guest', 0, 0, 0, ?)
        """,
        (username, email, generate_password_hash(password), name, birthdate, now_iso()),
    )
    conn.commit()
    conn.close()
    return jsonify({"success": True, "message": "회원가입 요청이 완료되었습니다. 관리자 승인을 기다려주세요."}), 201


@app.post("/api/auth/pending/cancel")
def cancel_pending_signup():
    data = request.get_json(silent=True) or {}
    identifier = (data.get("identifier") or data.get("username") or data.get("email") or "").strip().lower()
    password = data.get("password") or ""
    if not identifier or not password:
        return jsonify({"success": False, "error": "아이디/이메일과 비밀번호를 입력해주세요."}), 400
    conn = db_conn()
    user = conn.execute("SELECT id, password_hash, approved FROM users WHERE username = ? OR email = ?", (identifier, identifier)).fetchone()
    if not user or not check_password_hash(user["password_hash"], password):
        conn.close()
        return jsonify({"success": False, "error": "invalid_credentials"}), 401
    if int(user["approved"]) == 1:
        conn.close()
        return jsonify({"success": False, "error": "already_approved"}), 409
    conn.execute("DELETE FROM chat_sessions WHERE user_id = ?", (user["id"],))
    conn.execute("DELETE FROM users WHERE id = ?", (user["id"],))
    conn.commit()
    conn.close()
    return jsonify({"success": True, "message": "승인 대기 계정이 삭제되었습니다."})


@app.post("/api/auth/login")
def login():
    data = request.get_json(silent=True) or {}
    identifier = (data.get("identifier") or data.get("username") or data.get("email") or "").strip().lower()
    password = data.get("password") or ""
    if not identifier or not password:
        return jsonify({"success": False, "error": "아이디/이메일과 비밀번호를 입력해주세요."}), 400
    conn = db_conn()
    user = conn.execute(
        "SELECT id, username, email, name, birthdate, role, approved, disabled, must_reset_password, password_hash FROM users WHERE username = ? OR email = ?",
        (identifier, identifier),
    ).fetchone()
    conn.close()
    if not user or not check_password_hash(user["password_hash"], password):
        return jsonify({"success": False, "error": "invalid_credentials", "message": "아이디 또는 비밀번호가 일치하지 않습니다."}), 401
    if int(user["disabled"]) == 1:
        return jsonify({"success": False, "error": "account_disabled", "message": "비활성화된 계정입니다."}), 403
    if int(user["approved"]) != 1:
        return jsonify({"success": False, "error": "unapproved", "message": "관리자 승인 후 로그인할 수 있습니다."}), 403
    if int(user["must_reset_password"]) == 1:
        return jsonify({"success": False, "error": "password_reset_required", "message": "비밀번호가 초기화되었습니다. 새 비밀번호를 설정해주세요."}), 403
    return jsonify({"success": True, "token": create_token(user), "user": user_to_json(user)})


@app.post("/api/auth/password/reset-complete")
def complete_password_reset():
    data = request.get_json(silent=True) or {}
    identifier = (data.get("identifier") or data.get("username") or data.get("email") or "").strip().lower()
    password = data.get("password") or ""
    new_password = data.get("newPassword") or ""
    if not identifier or not password or not new_password:
        return jsonify({"success": False, "error": "필수 항목이 비어 있습니다."}), 400
    if len(new_password) < 8:
        return jsonify({"success": False, "error": "새 비밀번호는 최소 8자 이상이어야 합니다."}), 400
    conn = db_conn()
    user = conn.execute(
        "SELECT id, must_reset_password, password_hash FROM users WHERE username = ? OR email = ?",
        (identifier, identifier),
    ).fetchone()
    if not user or not check_password_hash(user["password_hash"], password):
        conn.close()
        return jsonify({"success": False, "error": "invalid_credentials"}), 401
    if int(user["must_reset_password"]) != 1:
        conn.close()
        return jsonify({"success": False, "error": "reset_not_required"}), 409
    conn.execute("UPDATE users SET password_hash = ?, must_reset_password = 0 WHERE id = ?", (generate_password_hash(new_password), user["id"]))
    conn.commit()
    conn.close()
    return jsonify({"success": True, "message": "비밀번호가 변경되었습니다."})


@app.get("/api/auth/verify")
@auth_required
def verify():
    return jsonify({"success": True, "user": user_to_json(request.user)})


@app.get("/api/chat/sessions")
@auth_required
def list_sessions():
    conn = db_conn()
    rows = conn.execute(
        "SELECT id, title, messages_json, updated_at FROM chat_sessions WHERE user_id = ? ORDER BY datetime(updated_at) DESC",
        (request.user["id"],),
    ).fetchall()
    conn.close()
    return jsonify({"success": True, "sessions": [row_to_session(r) for r in rows]})


@app.post("/api/chat/sessions")
@auth_required
def upsert_session():
    data = request.get_json(silent=True) or {}
    sid = (data.get("id") or "").strip()
    title = (data.get("title") or "새 채팅").strip() or "새 채팅"
    messages = data.get("messages")
    updated_at = (data.get("updatedAt") or now_iso()).strip()
    if not sid:
        return jsonify({"success": False, "error": "session id가 필요합니다."}), 400
    if not isinstance(messages, list):
        return jsonify({"success": False, "error": "messages는 배열이어야 합니다."}), 400
    conn = db_conn()
    exists = conn.execute("SELECT id FROM chat_sessions WHERE id = ? AND user_id = ?", (sid, request.user["id"])).fetchone()
    if exists:
        conn.execute(
            "UPDATE chat_sessions SET title = ?, messages_json = ?, updated_at = ? WHERE id = ? AND user_id = ?",
            (title, json.dumps(messages, ensure_ascii=False), updated_at, sid, request.user["id"]),
        )
    else:
        conn.execute(
            "INSERT INTO chat_sessions (id, user_id, title, messages_json, updated_at, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (sid, request.user["id"], title, json.dumps(messages, ensure_ascii=False), updated_at, now_iso()),
        )
    conn.commit()
    row = conn.execute(
        "SELECT id, title, messages_json, updated_at FROM chat_sessions WHERE id = ? AND user_id = ?",
        (sid, request.user["id"]),
    ).fetchone()
    conn.close()
    return jsonify({"success": True, "session": row_to_session(row)})


@app.delete("/api/chat/sessions/<session_id>")
@auth_required
def delete_session(session_id):
    conn = db_conn()
    conn.execute("DELETE FROM chat_sessions WHERE id = ? AND user_id = ?", (session_id, request.user["id"]))
    conn.commit()
    conn.close()
    return jsonify({"success": True, "deleted": session_id})


@app.get("/api/admin/users")
@auth_required
@admin_required
def admin_list_users():
    conn = db_conn()
    rows = conn.execute(
        "SELECT id, username, email, name, birthdate, role, approved, disabled, must_reset_password, created_at FROM users ORDER BY datetime(created_at) DESC"
    ).fetchall()
    conn.close()
    return jsonify({"success": True, "users": [dict(r) for r in rows]})


@app.post("/api/admin/users/<int:user_id>/approve")
@auth_required
@admin_required
def admin_approve_user(user_id):
    conn = db_conn()
    conn.execute("UPDATE users SET approved = 1 WHERE id = ?", (user_id,))
    conn.commit()
    conn.close()
    return jsonify({"success": True})


@app.post("/api/admin/users/<int:user_id>/revoke-approval")
@auth_required
@admin_required
def admin_revoke_approval(user_id):
    conn = db_conn()
    conn.execute("UPDATE users SET approved = 0 WHERE id = ?", (user_id,))
    conn.commit()
    conn.close()
    return jsonify({"success": True})


@app.post("/api/admin/users/<int:user_id>/deactivate")
@auth_required
@admin_required
def admin_deactivate_user(user_id):
    data = request.get_json(silent=True) or {}
    disabled = 1 if bool(data.get("disabled", True)) else 0
    conn = db_conn()
    conn.execute("UPDATE users SET disabled = ? WHERE id = ?", (disabled, user_id))
    conn.commit()
    conn.close()
    return jsonify({"success": True, "disabled": bool(disabled)})


@app.post("/api/admin/users/<int:user_id>/reset-password")
@auth_required
@admin_required
def admin_reset_password(user_id):
    data = request.get_json(silent=True) or {}
    temp_password = (data.get("tempPassword") or "").strip() or random_temp_password()
    conn = db_conn()
    conn.execute("UPDATE users SET password_hash = ?, must_reset_password = 1 WHERE id = ?", (generate_password_hash(temp_password), user_id))
    conn.commit()
    conn.close()
    return jsonify({"success": True, "tempPassword": temp_password})


@app.delete("/api/admin/users/<int:user_id>")
@auth_required
@admin_required
def admin_delete_user(user_id):
    conn = db_conn()
    conn.execute("DELETE FROM chat_sessions WHERE user_id = ?", (user_id,))
    conn.execute("DELETE FROM users WHERE id = ?", (user_id,))
    conn.commit()
    conn.close()
    return jsonify({"success": True, "deletedUserId": user_id})


@app.get("/api/admin/users/<int:user_id>/usage")
@auth_required
@admin_required
def admin_user_usage(user_id):
    conn = db_conn()
    rows = conn.execute("SELECT messages_json FROM chat_sessions WHERE user_id = ?", (user_id,)).fetchall()
    conn.close()
    sessions = len(rows)
    messages = 0
    user_messages = 0
    assistant_messages = 0
    for r in rows:
        try:
            ms = json.loads(r["messages_json"] or "[]")
        except json.JSONDecodeError:
            ms = []
        messages += len(ms)
        for m in ms:
            if m.get("role") == "user":
                user_messages += 1
            elif m.get("role") == "assistant":
                assistant_messages += 1
    return jsonify({"success": True, "usage": {"sessions": sessions, "messages": messages, "userMessages": user_messages, "assistantMessages": assistant_messages}})


@app.get("/api/admin/users/<int:user_id>/sessions")
@auth_required
@admin_required
def admin_user_sessions(user_id):
    conn = db_conn()
    rows = conn.execute(
        "SELECT id, title, messages_json, updated_at FROM chat_sessions WHERE user_id = ? ORDER BY datetime(updated_at) DESC",
        (user_id,),
    ).fetchall()
    conn.close()
    return jsonify({"success": True, "sessions": [row_to_session(r) for r in rows]})


def bootstrap():
    init_db()
    seed_default_users()


bootstrap()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "5000")), debug=True)
