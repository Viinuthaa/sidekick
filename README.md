# Sidekick

A real-time meeting copilot that helps capture conversations and turn them into organised meeting notes.

**Live Demo:** https://sidekick-live.vercel.app

## Preview

![Sidekick Dashboard](screenshot.png)

## About

Sidekick makes it easier to keep track of what's discussed during a meeting. It captures speech through the browser, stores transcripts and lets users generate summaries, key discussion points, decisions and action items.

The idea is simple: spend less time writing things down and more time participating in the conversation.

## Features

- **Meeting sessions** – Create, view and manage individual meetings.
- **Live transcription** – Convert speech into text using browser-based speech recognition.
- **Meeting notes** – Write and save notes for each session.
- **Transcript history** – Store and revisit previous meeting conversations.
- **Transcript search** – Find information across saved transcripts.
- **AI takeaways** – Generate meeting summaries, key points, decisions and action items.

## Built With

- React, TypeScript and Vite
- Python and FastAPI
- PostgreSQL (Neon) and SQLAlchemy
- OpenAI-compatible API and Groq
- Web Speech API

## How It Works

1. Create a meeting session.
2. Start transcription and speak into your microphone.
3. Speech is converted into text and saved as transcript segments.
4. Add notes to the meeting whenever needed.
5. Generate takeaways to get a summary, key points, decisions and action items.

## Running Locally

Clone the repository:

```bash
git clone https://github.com/Viinuthaa/sidekick.git
cd sidekick
```

Install frontend dependencies:

```bash
npm install
```

Set up the backend:

```bash
cd backend
python -m venv .venv
```

Activate the environment on Windows:

```powershell
.venv\Scripts\Activate.ps1
```

Install dependencies:

```bash
pip install -r requirements.txt
```

Create a `.env` file inside `backend/`:

```env
DATABASE_URL=your_neon_database_url
OPENAI_API_KEY=your_openai_api_key
OPENAI_MODEL=your_openai_model
GROQ_API_KEY=your_groq_api_key
GROQ_MODEL=your_groq_model
```

Start the backend:

```bash
uvicorn main:app --reload
```

In another terminal, from the project root, start the frontend:

```bash
npm run dev
```

The frontend uses `http://127.0.0.1:8000` as its default API URL. Set `VITE_API_BASE_URL` to override it.

## Project Structure

```text
sidekick/
├── backend/
│   ├── main.py
│   ├── database.py
│   ├── models.py
│   └── requirements.txt
├── docs/
│   └── dashboard.png
├── public/
├── src/
│   ├── App.tsx
│   ├── App.css
│   └── main.tsx
├── index.html
└── package.json
```
