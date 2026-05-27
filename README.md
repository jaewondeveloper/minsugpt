# MinsuGPT

Gemini-style chat UI for [MinsuGPT API](https://sigan.onrender.com).

## License

This project is proprietary and distributed under **All Rights Reserved** terms. See `LICENSE`.

## Run locally

This project is split into multiple assets. **Open `index.html` directly in a browser** after serving the folder (required for script loading):

```bash
npx --yes serve .
```

Or use any static file server pointed at this directory.

> Single files under `assets/` are not meant to run alone.

## GitHub Pages

1. Push this repo to `jaewondeveloper/minsugpt`
2. Repository **Settings → Pages → Build and deployment → Source**: Deploy from branch `main`, folder `/ (root)`
3. Site URL: `https://jaewondeveloper.github.io/minsugpt/`

## Rebuild from source monolith

```powershell
powershell -ExecutionPolicy Bypass -File scripts/build-github-pages.ps1
```

Source reference: `minsugpt-6.html` (development bundle).

## API

Chat requests go to `https://sigan.onrender.com/api/ai/chat` (POST JSON).
