# MinsuGPT

![License: All Rights Reserved](https://img.shields.io/badge/license-All%20Rights%20Reserved-red)


## License

This project is proprietary and distributed under **All Rights Reserved** terms. See `LICENSE`.

## Structure

| Path | Role |
|------|------|
| `index.html` | **Iframe shell only** (saving this page shows a blank frame) |
| `app/index.html` | **Real chat UI** (loaded inside the iframe) |
| `app/partials/` | HTML fragments (`mobile`, `sidebar`, `main`, `modals`) |
| `app/assets/css/` | `core.css` + `responsive.css` (media queries kept intact) |
| `app/assets/js/` | Split JS modules (cannot run without `app/index.html`) |
| `minsugpt-6.html` | Development source of truth for UI |

## Run locally

```bash
npx --yes serve .
```

Open `http://localhost:3000/` (iframe) or `http://localhost:3000/app/` (direct app).

## GitHub Pages

1. Deploy branch `main`, folder `/ (root)`
2. Entry: `https://jaewondeveloper.github.io/minsugpt/`
3. App UI: `https://jaewondeveloper.github.io/minsugpt/app/`

## Rebuild

```powershell
powershell -ExecutionPolicy Bypass -File scripts/build-github-pages.ps1
```

Always edit `minsugpt-6.html` first, then run the build script.

## API

`POST https://sigan.onrender.com/api/ai/chat`

## Auth (Flask)

- Frontend auth pages: `login.html`, `signup.html`
- Backend auth server: `server/app.py`
- Endpoints:
  - `POST /api/auth/login`
  - `POST /api/auth/signup`
  - `GET /api/auth/verify`
