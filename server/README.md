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
- `MINSUGPT_TOKEN_MAX_AGE_SECONDS` (default: `604800`)
- `MINSUGPT_CORS_ORIGINS` (default: `*`, comma-separated)
- `PORT` (default: `5000`)

## API

- `POST /api/auth/login`
- `POST /api/auth/signup`
- `GET /api/auth/verify` (Bearer token)
- `GET /api/health`

## Seeded Accounts

- `admin` / `shin0816` (role: admin, approved)
- `guest` / `ms12345678@@` (role: guest, approved)
