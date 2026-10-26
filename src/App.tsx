
import { useEffect, useState } from 'react'
import './App.css'

type Session = {
  id: number
  title: string
  createdAt: string
}

type Page = 'home' | 'sessions' | 'takeaways'

const STORAGE_KEY = 'sidekick-sessions'

function loadSessions(): Session[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (!saved) return []

    const parsed: unknown = JSON.parse(saved)
    if (!Array.isArray(parsed)) return []

    return parsed.filter(
      (item): item is Session =>
        typeof item === 'object' &&
        item !== null &&
        typeof item.id === 'number' &&
        typeof item.title === 'string' &&
        typeof item.createdAt === 'string',
    )
  } catch {
    return []
  }
}

function App() {
  const [page, setPage] = useState<Page>('home')
  const [showSetup, setShowSetup] = useState(false)
  const [meetingTitle, setMeetingTitle] = useState('')
  const [sessions, setSessions] = useState<Session[]>(loadSessions)
  const [activeSession, setActiveSession] = useState<Session | null>(null)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions))
    } catch (error) {
      console.error('Could not save Sidekick sessions:', error)
    }
  }, [sessions])

  function createSession(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const title = meetingTitle.trim()
    if (!title) return

    const session: Session = {
      id: Date.now(),
      title,
      createdAt: new Date().toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }),
    }

    setSessions((current) => [session, ...current])
    setActiveSession(session)
    setMeetingTitle('')
    setShowSetup(false)
    setPage('sessions')
  }

  function deleteSession(id: number) {
    setSessions((current) => current.filter((session) => session.id !== id))

    if (activeSession?.id === id) {
      setActiveSession(null)
    }
  }

  function openPage(nextPage: Page) {
    setPage(nextPage)
    setActiveSession(null)
  }

  return (
    <div className="sidekick">
      <aside className="rail">
        <p className="rail-label">YOUR WORKSPACE</p>

        <nav className="rail-nav" aria-label="Main navigation">
          <button
            className={`rail-link ${page === 'home' ? 'selected' : ''}`}
            onClick={() => openPage('home')}
          >
            <span aria-hidden="true">⌂</span>
            Home
          </button>

          <button
            className={`rail-link ${page === 'sessions' ? 'selected' : ''}`}
            onClick={() => openPage('sessions')}
          >
            <span aria-hidden="true">◷</span>
            Sessions
            {sessions.length > 0 && (
              <span className="nav-count">{sessions.length}</span>
            )}
          </button>

          <button
            className={`rail-link ${page === 'takeaways' ? 'selected' : ''}`}
            onClick={() => openPage('takeaways')}
          >
            <span aria-hidden="true">↗</span>
            Your takeaways
          </button>
        </nav>

        <div className="rail-bottom">
          <span className="avatar">s</span>
          <div>
            <strong>Your Sidekick</strong>
            <span>Here for the details</span>
          </div>
        </div>
      </aside>

      <main className="page">
        <header className="topline">
          <a
            className="header-wordmark"
            href="#home"
            onClick={(event) => {
              event.preventDefault()
              openPage('home')
            }}
          >
            sidekick
          </a>

          <span className="availability">
            <i />
            YOUR SPACE IS READY
          </span>
        </header>

        <div className="content">
          {page === 'home' && !activeSession && (
            <>
              <section className="intro">
                <h1>
                  Be in the room.
                  <br />
                  <span>We’ll keep the thread.</span>
                </h1>

                <p className="intro-copy">
                  Your meetings move fast. Sidekick helps you hold on to what
                  matters, so you can focus on the conversation in front of you.
                </p>
              </section>

              <section className="session">
                <div className="session-top">
                  <div>
                    <span className="session-index">01 / YOUR NEXT SESSION</span>
                    <h2>Pull up a chair.</h2>
                  </div>

                  <div className="orbit" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                    <div className="orbit-core">s.</div>
                  </div>
                </div>

                <div className="waveform" aria-hidden="true">
                  {Array.from({ length: 39 }, (_, index) => (
                    <i
                      key={index}
                      style={{
                        height: `${
                          9 +
                          Math.abs(Math.sin(index * 0.58)) * 52 +
                          Math.abs(Math.cos(index * 0.23)) * 18
                        }px`,
                      }}
                    />
                  ))}
                </div>

                <div className="session-bottom">
                  <div className="session-caption">
                    <span className="mic-symbol" aria-hidden="true">◉</span>
                    <div>
                      <strong>A little more present.</strong>
                      <span>Start with a name. The rest can follow.</span>
                    </div>
                  </div>

                  <button
                    className="start-session"
                    onClick={() => setShowSetup(true)}
                  >
                    Start a session <span aria-hidden="true">↗</span>
                  </button>
                </div>
              </section>

              <section className="principles">
                <p>
                  Be present in the conversation.
                  <br />
                  <span>We’ll take care of what comes after.</span>
                </p>
              </section>

              <section className="history">
                <div>
                  <h2>
                    {sessions.length === 0
                      ? 'Your recent sessions will find a home here.'
                      : `${sessions.length} session${sessions.length === 1 ? '' : 's'} and counting.`}
                  </h2>
                </div>

                <button
                  className="history-arrow"
                  aria-label="View sessions"
                  onClick={() => openPage('sessions')}
                >
                  →
                </button>
              </section>
            </>
          )}

          {page === 'sessions' && (
            <section className="subpage">
              <p className="kicker">YOUR MEETINGS, IN ONE PLACE</p>

              <div className="subpage-heading">
                <div>
                  <h1>Your sessions.</h1>
                  <p className="intro-copy">
                    Every conversation starts somewhere.
                  </p>
                </div>

                <button
                  className="start-session"
                  onClick={() => setShowSetup(true)}
                >
                  New session <span aria-hidden="true">↗</span>
                </button>
              </div>

              {activeSession ? (
                <div className="session-detail">
                  <button
                    className="back-link"
                    onClick={() => setActiveSession(null)}
                  >
                    ← All sessions
                  </button>

                  <span className="session-index">SESSION DETAILS</span>
                  <h2>{activeSession.title}</h2>
                  <p className="session-date">
                    Created {activeSession.createdAt}
                  </p>

                  <button
                    className="delete-session detail-delete"
                    onClick={() => deleteSession(activeSession.id)}
                  >
                    Delete session
                  </button>

                  <div className="capture-placeholder">
                    <div className="orbit detail-orbit" aria-hidden="true">
                      <span />
                      <span />
                      <span />
                      <div className="orbit-core">s.</div>
                    </div>

                    <h3>The conversation starts here.</h3>
                    <p>
                      Session setup is ready. Live audio capture and
                      transcription will be added in a later feature.
                    </p>
                    <span className="coming-soon">
                      LIVE CAPTURE · COMING NEXT
                    </span>
                  </div>
                </div>
              ) : sessions.length === 0 ? (
                <div className="empty-state">
                  <span className="empty-mark">↗</span>
                  <h2>Nothing here just yet.</h2>
                  <p>Your first session will start the story.</p>

                  <button
                    className="start-session"
                    onClick={() => setShowSetup(true)}
                  >
                    Create your first session <span aria-hidden="true">↗</span>
                  </button>
                </div>
              ) : (
                <div className="session-list">
                  {sessions.map((session) => (
                    <div className="session-row" key={session.id}>
                      <button
                        className="session-row-open"
                        onClick={() => setActiveSession(session)}
                      >
                        <span className="row-symbol">↗</span>
                        <span className="row-details">
                          <strong>{session.title}</strong>
                          <small>{session.createdAt}</small>
                        </span>
                        <span className="row-arrow">→</span>
                      </button>

                      <button
                        className="delete-session"
                        aria-label={`Delete ${session.title}`}
                        title="Delete session"
                        onClick={() => deleteSession(session.id)}
                      >
                        Delete
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {page === 'takeaways' && (
            <section className="subpage">
              <p className="kicker">THE THINGS WORTH KEEPING</p>
              <h1>Your takeaways.</h1>

              <div className="empty-state takeaway-empty">
                <span className="empty-mark">✳</span>
                <h2>Space for the important bits.</h2>
                <p>
                  Meeting summaries and action items will live here once
                  transcription and meeting insights are implemented.
                </p>
              </div>
            </section>
          )}

          <footer className="footer">
            <span>SIDEKICK © 2026</span>
            <span>MADE FOR THE MOMENTS THAT MATTER</span>
          </footer>
        </div>
      </main>

      {showSetup && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setShowSetup(false)
          }}
        >
          <section
            className="setup-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="setup-title"
          >
            <button
              className="modal-close"
              aria-label="Close dialog"
              onClick={() => setShowSetup(false)}
            >
              ×
            </button>

            <p className="kicker">MAKE YOURSELF AT HOME</p>
            <h2 id="setup-title">What are we meeting about?</h2>
            <p className="modal-description">
              Give this session a name. You can change direction later.
            </p>

            <form onSubmit={createSession}>
              <label htmlFor="meeting-title">SESSION NAME</label>
              <input
                id="meeting-title"
                autoFocus
                autoComplete="off"
                value={meetingTitle}
                onChange={(event) => setMeetingTitle(event.target.value)}
                placeholder="e.g. Project brainstorm"
                maxLength={100}
                required
              />

              <button className="start-session modal-submit" type="submit">
                Create session <span aria-hidden="true">↗</span>
              </button>
            </form>
          </section>
        </div>
      )}
    </div>
  )
}

export default App
