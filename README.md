# Sidekick — Real-Time Meeting Copilot

Sidekick is a meeting assistant that helps capture conversations, maintain transcripts, and turn discussions into structured meeting takeaways.

It helps users focus on conversations while keeping important points, decisions, and action items organised.

## Features

- **Meeting Sessions:** Create, manage, and revisit meeting sessions.
- **Live Transcription:** Capture speech using browser-based speech recognition.
- **Meeting Notes:** Write and save notes for individual sessions.
- **Transcript Storage:** Persist meeting transcripts and session data.
- **AI-Powered Takeaways:** Generate summaries, key discussion points, decisions, and action items.
- **Transcript Search:** Search through saved meeting conversations.

## Tech Stack

| Layer | Technologies |
|---|---|
| Frontend | React, TypeScript, Vite |
| Backend | Python, FastAPI |
| Database | PostgreSQL, Neon |
| ORM | SQLAlchemy |
| AI | OpenAI-compatible API |
| Speech Recognition | Browser SpeechRecognition API |

## Project Structure

```text
sidekick/
├── backend/
│   ├── main.py
│   ├── database.py
│   ├── models.py
│   └── requirements.txt
├── public/
├── src/
│   ├── App.tsx
│   ├── App.css
│   └── main.tsx
├── index.html
└── package.json
```

## Run Locally

**1. Clone the repository**

```bash
git clone https://github.com/Viinuthaa/sidekick.git
cd sidekick
```

**2. Install frontend dependencies**

```bash
npm install
```

**3. Start the backend**

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload
```

Configure the backend environment variables, including your PostgreSQL connection string and AI API credentials, before starting the backend.

**4. Start the frontend**

In a separate terminal:

```bash
npm run dev
```
