# emerieco.sounds — Independent Music Review Platform

A complete full-stack web application for **emerieco.sounds**, featuring the cosmic emerald loading screen, page/section warp transitions, audio file & link submissions, live priority queue, Stripe Skip/Super Skip checkout support, and an `/admin` review console.

## Project Structure

```text
emerieco-sounds/
├── public/
│   ├── index.html       # Main storefront, cosmic loader, warp transitions, queue & submission form
│   └── admin.html       # Admin console (/admin) to listen, score (0–10), and publish reviews
├── data/                # Auto-created JSON database (data/db.json)
├── uploads/             # Uploaded audio files (MP3, WAV, M4A, AAC, OGG, FLAC up to 30 MB)
├── server.js            # Express backend & API routes
├── package.json         # Dependencies & start script
└── .env.example         # Environment configuration template
```

## Quick Start

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment variables:**
   ```bash
   cp .env.example .env
   ```
   Edit `.env` to set your `ADMIN_PASSWORD` (and optional `STRIPE_SECRET_KEY` if enabling paid Skip / Super Skip).

3. **Run the server:**
   ```bash
   npm start
   ```

4. **Open in your browser:**
   - Homepage: `http://localhost:3000`
   - Admin Console: `http://localhost:3000/admin`
