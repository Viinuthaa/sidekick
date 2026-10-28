import { useEffect, useRef, useState } from 'react'
import './App.css'

type Session = {
  id: number
  title: string
  createdAt: string
  notes?: string
  transcript?: string
  transcriptEntries?: { id: string; time: string; text: string }[]
}

type SpeechResult = {
  isFinal: boolean
  0: { transcript: string }
}

type SpeechRecognitionEventLike = {
  resultIndex: number
  results: ArrayLike<SpeechResult>
}

type SpeechRecognitionLike = {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
}

type SpeechRecognitionWindow = Window & {
  SpeechRecognition?: new () => SpeechRecognitionLike
  webkitSpeechRecognition?: new () => SpeechRecognitionLike
}

type Page = 'home' | 'sessions' | 'takeaways'

const API_BASE_URL = 'http://127.0.0.1:8000'

type ApiMeeting = {
  id: number
  title: string
  transcript: string
  notes: string
  created_at: string
}

type ApiTranscriptSegment = {
  id: number
  meeting_id: number
  time: string
  text: string
}

function toSession(meeting: ApiMeeting): Session {
  return {
    id: meeting.id,
    title: meeting.title,
    createdAt: new Date(meeting.created_at).toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }),
    notes: meeting.notes ?? '',
    transcript: meeting.transcript ?? '',
    transcriptEntries: [],
  }
}

async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })

  if (!response.ok) {
    throw new Error(`API request failed (${response.status})`)
  }

  if (response.status === 204) {
    return undefined as T
  }

  return response.json() as Promise<T>
}

function App() {
  const [page, setPage] = useState<Page>('home')
  const [showSetup, setShowSetup] = useState(false)
  const [meetingTitle, setMeetingTitle] = useState('')
  const [sessions, setSessions] = useState<Session[]>([])
  const [activeSession, setActiveSession] = useState<Session | null>(null)
  const [isLoadingSessions, setIsLoadingSessions] = useState(true)
  const [apiError, setApiError] = useState('')
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const transcriptRef = useRef('')
  const [transcriptionStatus, setTranscriptionStatus] = useState<
    'off' | 'starting' | 'on' | 'error'
  >('off')
  const [transcriptionError, setTranscriptionError] = useState('')
  const [interimTranscript, setInterimTranscript] = useState('')

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop()
      recognitionRef.current = null
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    async function fetchSessions() {
      try {
        setApiError('')
        const meetings = await apiRequest<ApiMeeting[]>('/api/meetings')

        if (!cancelled) {
          setSessions(meetings.map(toSession))
        }
      } catch (error) {
        if (!cancelled) {
          setApiError(
            error instanceof Error
              ? error.message
              : 'Could not load your meetings.',
          )
        }
      } finally {
        if (!cancelled) {
          setIsLoadingSessions(false)
        }
      }
    }

    void fetchSessions()

    return () => {
      cancelled = true
    }
  }, [])

  function startTranscription() {
    if (!activeSession) return

    transcriptRef.current = activeSession.transcript ?? ''
    setTranscriptionError('')
    setInterimTranscript('')

    const speechWindow = window as SpeechRecognitionWindow
    const Recognition =
      speechWindow.SpeechRecognition ??
      speechWindow.webkitSpeechRecognition

    if (!Recognition) {
      setTranscriptionStatus('error')
      setTranscriptionError(
        'Live speech recognition is not supported in this browser. Try a current version of Google Chrome or Microsoft Edge.',
      )
      return
    }

    try {
      const recognition = new Recognition()
      recognition.lang = 'en-US'
      recognition.continuous = true
      recognition.interimResults = true

      recognition.onresult = (event) => {
        let finalText = ''
        let interimText = ''

        for (
          let index = event.resultIndex;
          index < event.results.length;
          index += 1
        ) {
          const result = event.results[index]
          if (!result?.[0]?.transcript) continue

          if (result.isFinal) {
            finalText += `${result[0].transcript.trim()} `
          } else {
            interimText += `${result[0].transcript} `
          }
        }

        if (finalText.trim()) {
          const addition = finalText.trim()
          transcriptRef.current = transcriptRef.current
            ? `${transcriptRef.current} ${addition}`
            : addition

          const entry = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            time: new Date().toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            }),
            text: addition,
          }

          void apiRequest<ApiTranscriptSegment>(
            `/api/meetings/${activeSession.id}/segments`,
            {
              method: 'POST',
              body: JSON.stringify({
                time: entry.time,
                text: entry.text,
              }),
            },
          ).then((savedSegment) => {
            const savedEntry = {
              id: String(savedSegment.id),
              time: savedSegment.time,
              text: savedSegment.text,
            }

            setSessions((current) =>
              current.map((session) =>
                session.id === activeSession.id
                  ? {
                      ...session,
                      transcriptEntries: (session.transcriptEntries ?? []).map(
                        (item) => item.id === entry.id ? savedEntry : item,
                      ),
                    }
                  : session,
              ),
            )

            setActiveSession((current) => {
              if (!current || current.id !== activeSession.id) return current

              return {
                ...current,
                transcriptEntries: (current.transcriptEntries ?? []).map(
                  (item) => item.id === entry.id ? savedEntry : item,
                ),
              }
            })
          }).catch((error) => {
            console.error('Could not save transcript segment:', error)
            setApiError('Transcript segment could not be saved to the database.')
          })

          setSessions((current) =>
            current.map((session) => {
              if (session.id !== activeSession.id) return session

              const existing = session.transcript?.trim() ?? ''

              return {
                ...session,
                transcript: existing
                  ? `${existing} ${addition}`
                  : addition,
                transcriptEntries: [
                  ...(session.transcriptEntries ?? []),
                  entry,
                ],
              }
            }),
          )

          setActiveSession((current) => {
            if (!current || current.id !== activeSession.id) {
              return current
            }

            const existing = current.transcript?.trim() ?? ''

            return {
              ...current,
              transcript: existing
                ? `${existing} ${addition}`
                : addition,
              transcriptEntries: [
                ...(current.transcriptEntries ?? []),
                entry,
              ],
            }
          })
        }

        setInterimTranscript(interimText.trim())
      }

      recognition.onerror = (event) => {
        setTranscriptionStatus('error')

        if (
          event.error === 'not-allowed' ||
          event.error === 'service-not-allowed'
        ) {
          setTranscriptionError(
            'Microphone or speech recognition permission was denied. Check your browser permissions and try again.',
          )
        } else if (event.error === 'no-speech') {
          setTranscriptionError(
            'No speech was detected. Try speaking closer to your microphone.',
          )
        } else {
          setTranscriptionError(
            `Speech recognition stopped: ${event.error}. You can try starting it again.`,
          )
        }

        recognitionRef.current = null
      }

      recognition.onend = () => {
        if (recognitionRef.current === recognition) {
          recognitionRef.current = null
          setTranscriptionStatus((status) =>
            status === 'on' ? 'off' : status,
          )
        }
      }

      recognitionRef.current = recognition
      setTranscriptionStatus('starting')
      recognition.start()
      setTranscriptionStatus('on')
    } catch {
      recognitionRef.current = null
      setTranscriptionStatus('error')
      setTranscriptionError(
        'Could not start speech recognition. Check your browser permissions and try again.',
      )
    }
  }

  function stopTranscription() {
    recognitionRef.current?.stop()
    recognitionRef.current = null
    setTranscriptionStatus('off')
    setInterimTranscript('')
    setTranscriptionError('')
  }

  async function createSession(
    event: React.FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault()

    const title = meetingTitle.trim()
    if (!title) return

    try {
      setApiError('')

      const meeting = await apiRequest<ApiMeeting>('/api/meetings', {
        method: 'POST',
        body: JSON.stringify({
          title,
          transcript: '',
          notes: '',
        }),
      })

      const session = toSession(meeting)

      setSessions((current) => [session, ...current])
      setActiveSession(session)
      setMeetingTitle('')
      setShowSetup(false)
      setPage('sessions')
    } catch (error) {
      setApiError(
        error instanceof Error
          ? error.message
          : 'Could not create the meeting. Please try again.',
      )
    }
  }

  async function deleteSession(id: number) {
    try {
      setApiError('')

      await apiRequest<void>(`/api/meetings/${id}`, {
        method: 'DELETE',
      })

      if (activeSession?.id === id) {
        stopTranscription()
        setActiveSession(null)
      }

      setSessions((current) =>
        current.filter((session) => session.id !== id),
      )
    } catch (error) {
      setApiError(
        error instanceof Error
          ? error.message
          : 'Could not delete the meeting. Please try again.',
      )
    }
  }

  async function updateNotes(notes: string) {
    if (!activeSession) return

    const sessionId = activeSession.id
    const updatedSession = { ...activeSession, notes }

    setActiveSession(updatedSession)
    setSessions((current) =>
      current.map((session) =>
        session.id === sessionId ? updatedSession : session,
      ),
    )

    try {
      setApiError('')

      await apiRequest<ApiMeeting>(`/api/meetings/${sessionId}`, {
        method: 'PATCH',
        body: JSON.stringify({ notes }),
      })
    } catch (error) {
      setApiError(
        error instanceof Error
          ? error.message
          : 'Could not save your notes.',
      )
    }
  }

  function openPage(nextPage: Page) {
    stopTranscription()
    setPage(nextPage)
    setActiveSession(null)
  }

  async function openSession(session: Session) {
    if (activeSession?.id !== session.id) {
      stopTranscription()
    }

    setActiveSession(session)
    setPage('sessions')
    setApiError('')

    try {
      const segments = await apiRequest<ApiTranscriptSegment[]>(
        `/api/meetings/${session.id}/segments`,
      )
      const transcriptEntries = segments.map((segment) => ({
        id: String(segment.id),
        time: segment.time,
        text: segment.text,
      }))

      setSessions((current) =>
        current.map((item) =>
          item.id === session.id ? { ...item, transcriptEntries } : item,
        ),
      )
      setActiveSession((current) =>
        current?.id === session.id
          ? { ...current, transcriptEntries }
          : current,
      )
    } catch (error) {
      setApiError(
        error instanceof Error
          ? error.message
          : 'Could not load the saved transcript segments.',
      )
    }
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
          </button>        </nav>

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
          {apiError && (
            <p className="microphone-error" role="alert">
              {apiError}
            </p>
          )}

          {isLoadingSessions && (
            <p className="microphone-disclaimer" role="status">
              Loading your sessions…
            </p>
          )}

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
                    <span className="session-index">
                      01 / YOUR NEXT SESSION
                    </span>
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
                    <span className="mic-symbol" aria-hidden="true">
                      ◉
                    </span>
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
              {activeSession ? (
                <div className="meeting-room">
                  <button
                    className="back-link"
                    onClick={() => {
                      stopTranscription()
                      setActiveSession(null)
                    }}
                  >
                    ← All sessions
                  </button>

                  <div className="meeting-room-heading">
                    <div>
                      <span className="session-index">
                        YOUR MEETING SPACE
                      </span>
                      <h1>{activeSession.title}</h1>
                      <p className="session-date">
                        Created {activeSession.createdAt}
                      </p>
                    </div>

                    <button
                      className="delete-session"
                      onClick={() => deleteSession(activeSession.id)}
                    >
                      Delete session
                    </button>
                  </div>

                  <div className="meeting-status">
                    <span className="meeting-status-dot" />
                    <span>SESSION WORKSPACE</span>
                    <span className="meeting-status-divider">/</span>
                    <span>NOT RECORDING</span>
                  </div>

                  <div className="meeting-room-grid">
                    <section className="meeting-panel conversation-panel">
                      <div className="panel-heading">
                        <div>
                          <span className="panel-overline">
                            01 / THE ROOM
                          </span>
                          <h2>Conversation</h2>
                        </div>
                        <span className="panel-icon" aria-hidden="true">
                          ◌
                        </span>
                      </div>

                      <div
                        className="transcript-content"
                        aria-live="polite"
                        aria-relevant="additions text"
                      >
                        {activeSession.transcriptEntries?.length ? (
                          <div className="transcript-entry-list">
                            {activeSession.transcriptEntries.map((entry) => (
                              <article
                                className="transcript-entry"
                                key={entry.id}
                              >
                                <time className="transcript-time">
                                  {entry.time}
                                </time>
                                <p className="transcript-entry-text">
                                  {entry.text}
                                </p>
                              </article>
                            ))}
                          </div>
                        ) : activeSession.transcript ? (
                          <article className="transcript-entry transcript-legacy-entry">
                            <span className="transcript-time">
                              Earlier transcript
                            </span>
                            <p className="transcript-entry-text">
                              {activeSession.transcript}
                            </p>
                          </article>
                        ) : (
                          <div className="conversation-empty">
                            <div
                              className="conversation-mark"
                              aria-hidden="true"
                            >
                              <span />
                              <span />
                              <span />
                              <span />
                              <span />
                            </div>
                            <h3>Your words, as they happen.</h3>
                            <p>
                              Start live transcription and recognized speech
                              will appear here, with a timestamp for each
                              captured segment.
                            </p>
                          </div>
                        )}

                        {interimTranscript && (
                          <article className="transcript-entry transcript-entry-pending">
                            <span className="transcript-time">
                              Listening now
                            </span>
                            <p className="transcript-interim">
                              {interimTranscript}
                            </p>
                          </article>
                        )}
                      </div>

                      <div className="microphone-setup">
                        <div className="microphone-status-line">
                          <span
                            className={`microphone-status-dot ${
                              transcriptionStatus === 'on'
                                ? 'on'
                                : transcriptionStatus === 'error'
                                  ? 'error'
                                  : transcriptionStatus === 'starting'
                                    ? 'requesting'
                                    : ''
                            }`}
                          />
                          <span>
                            {transcriptionStatus === 'on'
                              ? 'Live transcription is on'
                              : transcriptionStatus === 'starting'
                                ? 'Starting speech recognition…'
                                : transcriptionStatus === 'error'
                                  ? 'Transcription unavailable'
                                  : 'Live transcription is off'}
                          </span>
                        </div>

                        {transcriptionError && (
                          <p className="microphone-error" role="alert">
                            {transcriptionError}
                          </p>
                        )}

                        {transcriptionStatus === 'on' ? (
                          <button
                            className="microphone-button microphone-stop"
                            onClick={stopTranscription}
                          >
                            <span aria-hidden="true">■</span> Stop
                            transcription
                          </button>
                        ) : (
                          <button
                            className="microphone-button"
                            onClick={startTranscription}
                            disabled={transcriptionStatus === 'starting'}
                          >
                            <span aria-hidden="true">◉</span>
                            {transcriptionStatus === 'starting'
                              ? 'Starting…'
                              : 'Start live transcription'}
                          </button>
                        )}

                        <p className="microphone-disclaimer">
                          Uses your browser’s speech recognition. Support and
                          processing vary by browser; speech may be sent to the
                          browser provider’s service.
                        </p>
                      </div>

                      <div className="panel-footer">
                        <span>
                          Transcript ·{' '}
                          {activeSession.transcriptEntries?.length ??
                            (activeSession.transcript ? 1 : 0)}{' '}
                          segments
                        </span>
                        <span>
                          {transcriptionStatus === 'on'
                            ? 'Listening for speech'
                            : 'Saved to this session'}
                        </span>
                      </div>
                    </section>

                    <section className="meeting-panel notes-panel">
                      <div className="panel-heading">
                        <div>
                          <span className="panel-overline">
                            02 / KEEP CLOSE
                          </span>
                          <h2>Your notes</h2>
                        </div>
                        <span className="panel-icon" aria-hidden="true">
                          ✳
                        </span>
                      </div>

                      <p className="notes-intro">
                        Catch a thought before it slips away.
                      </p>

                      <label
                        className="notes-label"
                        htmlFor="meeting-notes"
                      >
                        PERSONAL MEETING NOTES
                      </label>

                      <textarea
                        id="meeting-notes"
                        className="meeting-notes-input"
                        value={activeSession.notes ?? ''}
                        onChange={(event) =>
                          updateNotes(event.target.value)
                        }
                        placeholder={
                          '• Things to follow up on...\n\n• Questions to ask...\n\n• Ideas worth keeping...'
                        }
                      />

                      <div className="panel-footer notes-footer">
                        <span>Private workspace</span>
                        <span>Saved automatically</span>
                      </div>
                    </section>
                  </div>
                </div>
              ) : (
                <>
                  <p className="kicker">
                    YOUR MEETINGS, IN ONE PLACE
                  </p>

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

                  {sessions.length === 0 ? (
                    <div className="empty-state">
                      <span className="empty-mark">↗</span>
                      <h2>Nothing here just yet.</h2>
                      <p>Your first session will start the story.</p>

                      <button
                        className="start-session"
                        onClick={() => setShowSetup(true)}
                      >
                        Create your first session{' '}
                        <span aria-hidden="true">↗</span>
                      </button>
                    </div>
                  ) : (
                    <div className="session-list">
                      {sessions.map((session) => (
                        <div className="session-row" key={session.id}>
                          <button
                            className="session-row-open"
                            onClick={() => openSession(session)}
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
                </>
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
            if (event.target === event.currentTarget) {
              setShowSetup(false)
            }
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