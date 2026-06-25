# ONE Browser

Manitec empire's own web proxy browser. No third-party dependency.

## Stack
- Next.js 14 · React 18 · Tailwind CSS

## Routes
- `GET /api/proxy?url=` — proxy any asset (image, CSS, JS, font)
- `POST /api/proxy` — fetch full HTML page, rewrite all links/assets

## Deploy
```bash
vercel --prod
```
