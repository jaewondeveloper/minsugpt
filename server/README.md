# MinsuGPT Auth Server (Flask)

## Run

```bash
cd server
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

Default URL: `http://127.0.0.1:5000`

## Environment Variables

- `MINSUGPT_AUTH_SECRET` (required in production)
- `MINSUGPT_TOKEN_MAX_AGE_SECONDS` (default: `864000`, 10 days)
- `MINSUGPT_ALLOWED_ORIGINS` (default: `https://minsugpt.kro.kr,https://admin.minsugpt.kro.kr`)
- `PORT` (default: `5000`)

## API

- `POST /api/auth/login`
- `POST /api/auth/signup`
- `POST /api/auth/pending/cancel`
- `POST /api/auth/password/reset-complete`
- `GET /api/auth/verify` (Bearer token)
- `GET /api/chat/sessions` (Bearer token)
- `POST /api/chat/sessions` (Bearer token)
- `DELETE /api/chat/sessions/<session_id>` (Bearer token)
- `GET /api/admin/users` (admin token)
- `POST /api/admin/users/<id>/approve`
- `POST /api/admin/users/<id>/revoke-approval`
- `POST /api/admin/users/<id>/deactivate`
- `POST /api/admin/users/<id>/reset-password`
- `DELETE /api/admin/users/<id>`
- `GET /api/admin/users/<id>/usage`
- `GET /api/admin/users/<id>/sessions`
- `GET /api/health`

## Seeded Accounts

- `admin` / `shin0816` (role: admin, approved)
- `guest` / `ms12345678@@` (role: guest, approved)
