# BX Discovery — Vercel Deployment

BX Consulting Executive Discovery Session, optimised for Vercel.

## Deploy

Push to GitHub — Vercel auto-deploys on push.

Add `OPENROUTER_API_KEY` in Vercel dashboard → Settings → Environment Variables.

## Local dev

```bash
npm install -g vercel
vercel dev
```

Open `http://localhost:3000`

## API Routes

- `POST /api/generate` — proxies prompt to OpenRouter
- `GET /api/health` — confirms API key is loaded
