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

type MeetingSummary = {
  meeting_id: number
  meeting_title: string
  summary: string
  key_points: string[]
  decisions: string[]
  action_items: string[]
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
  let response: Response

  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    })
  } catch {
    throw new Error(
      'Could not connect to the Sidekick API. Make sure the backend is running.',
    )
  }

  if (!response.ok) {
    let message = ''

    try {
      const errorBody: unknown = await response.json()

      if (
        errorBody &&
        typeof errorBody === 'object' &&
        'detail' in errorBody &&
        typeof errorBody.detail === 'string' &&
        errorBody.detail.trim()
      ) {
        message = errorBody.detail
      } else if (
        errorBody &&
        typeof errorBody === 'object' &&
        'message' in errorBody &&
        typeof errorBody.message === 'string' &&
        errorBody.message.trim()
      ) {
        message = errorBody.message
      }
    } catch {
      // The server did not return a readable JSON error body.
    }

    if (!message && response.status === 404) {
      message = 'The requested resource could not be found (404).'
    } else if (!message && response.status >= 500) {
      message = 'The server encountered a problem. Please try again.'
    } else if (!message) {
      message = `The request failed (${response.status}).`
    }

    throw new Error(message)
  }

  if (response.status === 204) {
    return undefined as T
  }

  return response.json() as Promise<T>
}

function App() {
  const [page, setPage] = useState<Page>('home')
  const [showSetup, setShowSetup] = useState(false)
  const [, setMeetingTitle] = useState('')
  const [sessions, setSessions] = useState<Session[]>([])
  const [activeSession, setActiveSession] = useState<Session | null>(null)
  const [isLoadingSessions, setIsLoadingSessions] = useState(true)
  const [apiError, setApiError] = useState('')
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const transcriptRef = useRef('')
  const notesSaveTimeoutRef =
    useRef<ReturnType<typeof setTimeout> | null>(null)

  const [transcriptionStatus, setTranscriptionStatus] = useState<
    'off' | 'starting' | 'on' | 'error'
  >('off')
  const [transcriptionError, setTranscriptionError] = useState('')
  const [, setInterimTranscript] = useState('')
  const [transcriptSearch, setTranscriptSearch] = useState('')

  const [meetingSummary, setMeetingSummary] =
    useState<MeetingSummary | null>(null)
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false)
  const [summaryError, setSummaryError] = useState('')
  const [summaryMeetingId, setSummaryMeetingId] = useState<number | null>(
    null,
  )

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop()
      recognitionRef.current = null

      if (notesSaveTimeoutRef.current) {
        clearTimeout(notesSaveTimeoutRef.current)
      }
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
          )
            .then((savedSegment) => {
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
                        transcriptEntries: (
                          session.transcriptEntries ?? []
                        ).map((item) =>
                          item.id === entry.id ? savedEntry : item,
                        ),
                      }
                    : session,
                ),
              )

              setActiveSession((current) => {
                if (
                  !current ||
                  current.id !== activeSession.id
                ) {
                  return current
                }

                return {
                  ...current,
                  transcriptEntries: (
                    current.transcriptEntries ?? []
                  ).map((item) =>
                    item.id === entry.id ? savedEntry : item,
                  ),
                }
              })
            })
            .catch((error) => {
              console.error('Could not save transcript segment:', error)
              setApiError(
                'Transcript segment could not be saved to the database.',
              )
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
            if (
              !current ||
              current.id !== activeSession.id
            ) {
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

  async function createSession(title: string): Promise<Session | null> {
    const trimmedTitle = title.trim()
    if (!trimmedTitle) return null

    try {
      setApiError('')

      const meeting = await apiRequest<ApiMeeting>('/api/meetings', {
        method: 'POST',
        body: JSON.stringify({
          title: trimmedTitle,
          transcript: '',
          notes: '',
        }),
      })

      const session = toSession(meeting)

      setSessions((current) => [session, ...current])
      setActiveSession(session)
      setMeetingTitle('')
      setShowSetup(false)
      setPage('home')
      return session
    } catch (error) {
      setApiError(
        error instanceof Error
          ? error.message
          : 'Could not create the meeting. Please try again.',
      )
      return null
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

  function updateNotes(notes: string) {
    if (!activeSession) return

    const sessionId = activeSession.id

    setActiveSession((current) =>
      current?.id === sessionId ? { ...current, notes } : current,
    )

    setSessions((current) =>
      current.map((session) =>
        session.id === sessionId ? { ...session, notes } : session,
      ),
    )

    if (notesSaveTimeoutRef.current) {
      clearTimeout(notesSaveTimeoutRef.current)
    }

    notesSaveTimeoutRef.current = setTimeout(() => {
      notesSaveTimeoutRef.current = null

      void apiRequest<ApiMeeting>(`/api/meetings/${sessionId}`, {
        method: 'PATCH',
        body: JSON.stringify({ notes }),
      })
        .then(() => {
          setApiError('')
        })
        .catch((error) => {
          console.error('Could not save notes:', error)
          setApiError(
            error instanceof Error
              ? `Notes could not be saved: ${error.message}`
              : 'Could not save your notes.',
          )
        })
    }, 500)
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
    setPage('home')
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

  const transcriptEntries = activeSession?.transcriptEntries ?? []
  const searchQuery = transcriptSearch.trim().toLowerCase()

  const visibleTranscriptEntries = searchQuery
    ? transcriptEntries.filter((entry) =>
        entry.text.toLowerCase().includes(searchQuery),
      )
    : transcriptEntries

  const isRecording =
    transcriptionStatus === 'on' || transcriptionStatus === 'starting'
  const microphoneError = transcriptionError

  async function generateMeetingSummary(session: Session) {
    setIsGeneratingSummary(true)
    setSummaryError('')
    setMeetingSummary(null)
    setSummaryMeetingId(session.id)

    try {
      const result = await apiRequest<MeetingSummary>(
        `/api/meetings/${session.id}/summary`,
        { method: 'POST' },
      )

      setMeetingSummary(result)
    } catch (error) {
      setSummaryError(
        error instanceof Error
          ? error.message
          : 'Could not generate the meeting summary.',
      )
    } finally {
      setIsGeneratingSummary(false)
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

          {page === 'home' && activeSession && (
            <section className="meeting-room">
              <div className="meeting-room-grid">
                <div className="meeting-panel">
                  <div className="panel-heading">
                    <div>
                      <span className="panel-overline">YOUR SESSION</span>
                      <h2>{activeSession.title}</h2>
                    </div>
                    <span className="panel-icon" aria-hidden="true">
                      ◉
                    </span>
                  </div>

                  <div className="meeting-controls">
                    <button
                      className="start-session"
                      onClick={isRecording ? stopTranscription : startTranscription}
                    >
                      {isRecording ? 'Stop recording' : 'Start recording'}
                      <span aria-hidden="true">
                        {isRecording ? ' ■' : ' ↗'}
                      </span>
                    </button>

                    <button
                      className="secondary-button"
                      onClick={() => setActiveSession(null)}
                    >
                      Back to home
                    </button>
                  </div>

                  {microphoneError && (
                    <p className="microphone-error" role="alert">
                      {microphoneError}
                    </p>
                  )}

                  <div className="meeting-notes">
                    <label htmlFor="meeting-notes">Your notes</label>
                    <textarea
                      id="meeting-notes"
                      className="meeting-notes-input"
                      value={activeSession.notes}
                      onChange={(event) =>
                        updateNotes(event.target.value)
                      }
                      placeholder="Capture your thoughts here..."
                    />
                  </div>
                </div>

                <div className="meeting-panel">
                  <div className="panel-heading">
                    <div>
                      <span className="panel-overline">LIVE CONVERSATION</span>
                      <h2>Transcript</h2>
                    </div>
                    <span className="panel-icon" aria-hidden="true">
                      ✳
                    </span>
                  </div>

                  <label
                    className="notes-label"
                    htmlFor="transcript-search"
                  >
                    SEARCH TRANSCRIPT
                  </label>

                  <input
                    id="transcript-search"
                    className="transcript-search-input"
                    type="search"
                    value={transcriptSearch}
                    onChange={(event) =>
                      setTranscriptSearch(event.target.value)
                    }
                    placeholder="Find a word or phrase..."
                    aria-label="Search transcript"
                  />

                  <div
                    className="transcript-content"
                    aria-live="polite"
                    aria-relevant="additions text"
                  >
                    {searchQuery ? (
                      visibleTranscriptEntries.length > 0 ? (
                        <div className="transcript-entry-list">
                          {visibleTranscriptEntries.map((entry) => (
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
                      ) : (
                        <div className="conversation-empty">
                          <h3>No matching transcript segments.</h3>
                          <p>Try another word or clear your search.</p>
                        </div>
                      )
                    ) : transcriptEntries.length > 0 ? (
                      <div className="transcript-entry-list">
                        {transcriptEntries.map((entry) => (
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
                    ) : (
                      <p>
                        {isRecording
                          ? 'Listening for speech...'
                          : 'Your transcript will appear here when you record.'}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </section>
          )}

          {page === 'sessions' && (
            <section className="subpage">
              <p className="kicker">A RECORD OF THE ROOM</p>
              <h1>Your sessions.</h1>

              {sessions.length === 0 ? (
                <div className="empty-state">
                  <span className="empty-mark">✳</span>
                  <h2>Nothing here just yet.</h2>
                  <p>
                    Start your first session and your conversations will find
                    a home here.
                  </p>
                  <button
                    className="start-session"
                    onClick={() => openPage('home')}
                  >
                    Start a session <span aria-hidden="true">↗</span>
                  </button>
                </div>
              ) : (
                <div className="session-list">
                  {sessions.map((session) => (
                    <div className="session-row" key={session.id}>
                      <button
                        className="session-row-open"
                        onClick={() => {
                          void openSession(session);
                        }}
                      >
                        <span className="row-symbol">◉</span>
                        <span className="row-details">
                          <strong>{session.title}</strong>
                          <small>
                            {session.createdAt}
                          </small>
                        </span>
                        <span className="row-arrow">→</span>
                      </button>

                      <button
                        className="delete-session"
                        onClick={() => deleteSession(session.id)}
                        aria-label={`Delete ${session.title}`}
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

              {sessions.length === 0 ? (
                <div className="empty-state takeaway-empty">
                  <span className="empty-mark">✳</span>
                  <h2>No sessions to summarize yet.</h2>
                  <p>
                    Create a session and capture some transcript first.
                  </p>
                </div>
              ) : (
                <>
                  <div className="session-list">
                    {sessions.map((session) => (
                      <div className="session-row" key={session.id}>
                        <button
                          className="session-row-open"
                          onClick={() => generateMeetingSummary(session)}
                          disabled={
                            isGeneratingSummary &&
                            summaryMeetingId === session.id
                          }
                        >
                          <span className="row-symbol">✳</span>
                          <span className="row-details">
                            <strong>{session.title}</strong>
                            <small>
                              {isGeneratingSummary &&
                              summaryMeetingId === session.id
                                ? 'Generating takeaways…'
                                : 'Generate AI summary'}
                            </small>
                          </span>
                          <span className="row-arrow">→</span>
                        </button>
                      </div>
                    ))}
                  </div>

                  {summaryError && (
                    <p className="microphone-error" role="alert">
                      {summaryError}
                    </p>
                  )}

                  {meetingSummary && (
                    <div
                      className="meeting-panel"
                      style={{ marginTop: '24px' }}
                    >
                      <div className="panel-heading">
                        <div>
                          <span className="panel-overline">
                            YOUR MEETING, DISTILLED
                          </span>
                          <h2>{meetingSummary.meeting_title}</h2>
                        </div>
                        <span className="panel-icon" aria-hidden="true">
                          ✳
                        </span>
                      </div>

                      <h3>Summary</h3>
                      <p>{meetingSummary.summary}</p>

                      <h3>Key points</h3>
                      {meetingSummary.key_points.length > 0 ? (
                        <ul>
                          {meetingSummary.key_points.map((point, index) => (
                            <li key={index}>{point}</li>
                          ))}
                        </ul>
                      ) : (
                        <p>No key points were identified.</p>
                      )}

                      <h3>Decisions</h3>
                      {meetingSummary.decisions.length > 0 ? (
                        <ul>
                          {meetingSummary.decisions.map(
                            (decision, index) => (
                              <li key={index}>{decision}</li>
                            ),
                          )}
                        </ul>
                      ) : (
                        <p>No explicit decisions were identified.</p>
                      )}

                      <h3>Action items</h3>
                      {meetingSummary.action_items.length > 0 ? (
                        <ul>
                          {meetingSummary.action_items.map((item, index) => (
                            <li key={index}>{item}</li>
                          ))}
                        </ul>
                      ) : (
                        <p>No explicit action items were identified.</p>
                      )}
                    </div>
                  )}
                </>
              )}
            </section>
          )}
        </div>

        <footer className="footer">
          <span>Sidekick © {new Date().getFullYear()}</span>
          <span>A little more present.</span>
        </footer>
      </main>

      {showSetup && (
        <div
          className="modal-backdrop"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setShowSetup(false);
            }
          }}
        >
          <div
            className="setup-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="setup-title"
          >
            <button
              className="modal-close"
              onClick={() => setShowSetup(false)}
              aria-label="Close dialog"
            >
              ×
            </button>

            <p className="kicker">A NEW CONVERSATION</p>
            <h2 id="setup-title">What are we walking into?</h2>
            <p>
              Give this session a name. You can figure out the rest as you go.
            </p>

            <form
              onSubmit={async (event) => {
                event.preventDefault();
                const formData = new FormData(event.currentTarget);
                const title = String(formData.get('title') ?? '').trim();

                if (!title) return;

                const created = await createSession(title);
                if (created) {
                  setPage('home');
                }
              }}
            >
              <label htmlFor="session-title">Session name</label>
              <input
                id="session-title"
                name="title"
                type="text"
                placeholder="e.g. Product brainstorm"
                autoFocus
                required
              />

              <button className="start-session" type="submit">
                Create session <span aria-hidden="true">↗</span>
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;