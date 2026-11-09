import { useEffect, useRef, useState } from 'react'
import './App.css'
import {
  startMeetingAudioCapture,
  type MeetingAudioCaptureController,
  type MeetingAudioChunk,
} from './lib/meetingAudioCapture'

type Session = {
  id: number
  title: string
  createdAt: string
  notes?: string
  transcript?: string
  transcriptEntries?: { id: string; time: string; text: string; source?: 'you' | 'others' | 'unknown' }[]
}

type Page = 'home' | 'sessions' | 'takeaways'

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000').replace(/\/$/, '')
const WS_BASE_URL = API_BASE_URL.replace(/^http/, 'ws')

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
  source: 'you' | 'others' | 'unknown'
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
  const [sessions, setSessions] = useState<Session[]>([])
  const [activeSession, setActiveSession] = useState<Session | null>(null)
  const [isLoadingSessions, setIsLoadingSessions] = useState(true)
  const [apiError, setApiError] = useState('')
  const audioCaptureRef =
    useRef<MeetingAudioCaptureController | null>(null)
  const transcriptionSocketRef = useRef<WebSocket | null>(null)
  const pendingTranscriptionChunksRef = useRef(0)
  const closeSocketAfterPendingRef = useRef(false)

  const captureGenerationRef = useRef(0)
  const notesSaveTimeoutRef =
    useRef<ReturnType<typeof setTimeout> | null>(null)

  const [transcriptionStatus, setTranscriptionStatus] = useState<
    'off' | 'starting' | 'on' | 'error'
  >('off')
  const [transcriptionError, setTranscriptionError] = useState('')
  const [transcriptSearch, setTranscriptSearch] = useState('')
  const [capturedChunkCount, setCapturedChunkCount] = useState(0)
  const [meetingSummary, setMeetingSummary] =
    useState<MeetingSummary | null>(null)
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false)
  const [summaryError, setSummaryError] = useState('')
  const [summaryMeetingId, setSummaryMeetingId] = useState<number | null>(
    null,
  )

  useEffect(() => {
    return () => {
      captureGenerationRef.current += 1

      const capture = audioCaptureRef.current
      audioCaptureRef.current = null

      if (capture) {
        void capture.stop()
      }

      const socket = transcriptionSocketRef.current
      transcriptionSocketRef.current = null
      if (socket && socket.readyState < WebSocket.CLOSING) {
        socket.close(1000, 'Component unmounted')
      }

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

  async function createSession(title: string): Promise<boolean> {
    try {
      setApiError('')

      const meeting = await apiRequest<ApiMeeting>('/api/meetings', {
        method: 'POST',
        body: JSON.stringify({ title }),
      })

      const session = toSession(meeting)

      setSessions((current) => [session, ...current])
      setActiveSession(session)
      setShowSetup(false)
      setTranscriptSearch('')
      setTranscriptionStatus('off')
      setTranscriptionError('')

      return true
    } catch (error) {
      setApiError(
        error instanceof Error
          ? error.message
          : 'Could not create the meeting. Please try again.',
      )
      return false
    }
  }

  function closeTranscriptionSocketWhenIdle() {
    if (!closeSocketAfterPendingRef.current) return
    if (pendingTranscriptionChunksRef.current > 0) return

    const socket = transcriptionSocketRef.current
    transcriptionSocketRef.current = null
    closeSocketAfterPendingRef.current = false

    if (socket && socket.readyState < WebSocket.CLOSING) {
      socket.close(1000, 'Recording stopped')
    }
  }

  function handleTranscriptionMessage(event: MessageEvent) {
    let message: {
      type?: string
      message?: string
      segment?: ApiTranscriptSegment
    }

    try {
      message = JSON.parse(String(event.data)) as typeof message
      console.log('WS message received:', message)
    } catch {
      setTranscriptionStatus('error')
      setTranscriptionError('The transcription server returned an unreadable response.')
      return
    }

    if (message.type === 'transcript' && message.segment) {
      const segment = message.segment
      const entry = {
        id: String(segment.id),
        time: segment.time,
        text: segment.text,
        source: segment.source,
      }

      setActiveSession((current) => {
        if (!current || Number(current.id) !== Number(segment.meeting_id)) return current
        return {
          ...current,
          transcriptEntries: [...(current.transcriptEntries ?? []), entry],
        }
      })

      setSessions((current) => current.map((session) =>
        Number(session.id) === Number(segment.meeting_id)
          ? {
              ...session,
              transcriptEntries: [...(session.transcriptEntries ?? []), entry],
            }
          : session,
      ))
    }

    if (message.type === 'transcript' || message.type === 'chunk_processed' || message.type === 'error') {
      pendingTranscriptionChunksRef.current = Math.max(
        0,
        pendingTranscriptionChunksRef.current - 1,
      )
    }

    if (message.type === 'error') {
      setTranscriptionStatus('error')
      setTranscriptionError(message.message || 'Audio transcription failed.')
      closeSocketAfterPendingRef.current = true

      const capture = audioCaptureRef.current
      audioCaptureRef.current = null
      if (capture) {
        void capture.stop().finally(closeTranscriptionSocketWhenIdle)
      }
    }

    closeTranscriptionSocketWhenIdle()
  }

  async function startTranscription() {
    if (!activeSession) return

    const meetingId = activeSession.id
    const attempt = ++captureGenerationRef.current

    setTranscriptionError('')
    setCapturedChunkCount(0)
    setTranscriptionStatus('starting')
    pendingTranscriptionChunksRef.current = 0
    closeSocketAfterPendingRef.current = false

    let socket: WebSocket | null = null

    try {
      const activeSocket = new WebSocket(`${WS_BASE_URL}/api/meetings/${meetingId}/transcribe`)
      socket = activeSocket
      activeSocket.onmessage = handleTranscriptionMessage
      transcriptionSocketRef.current = activeSocket

      await new Promise<void>((resolve, reject) => {
        let settled = false

        activeSocket.addEventListener('open', () => {
          settled = true
          resolve()
        }, { once: true })

        activeSocket.addEventListener('error', () => {
          if (!settled) {
            settled = true
            reject(new Error('Could not connect to the transcription service. Check that the backend is running.'))
          }
        }, { once: true })
      })

      activeSocket.onclose = () => {
        if (transcriptionSocketRef.current === activeSocket) {
          transcriptionSocketRef.current = null
          if (audioCaptureRef.current) {
            setTranscriptionStatus('error')
            setTranscriptionError('The transcription connection closed unexpectedly. Please start recording again.')
            const capture = audioCaptureRef.current
            audioCaptureRef.current = null
            void capture.stop()
          }
        }
      }

      activeSocket.onerror = () => {
        if (audioCaptureRef.current) {
          setTranscriptionStatus('error')
          setTranscriptionError('The transcription connection encountered an error.')
        }
      }

      if (attempt !== captureGenerationRef.current) {
        closeSocketAfterPendingRef.current = true
        closeTranscriptionSocketWhenIdle()
        return
      }

      const capture = await startMeetingAudioCapture({
        onChunk: (chunk: MeetingAudioChunk) => {
          const currentSocket = transcriptionSocketRef.current
          if (!currentSocket || currentSocket.readyState !== WebSocket.OPEN) {
            setTranscriptionStatus('error')
            setTranscriptionError('Audio was captured, but the transcription connection is unavailable.')
            return
          }

          const time = new Date(chunk.capturedAt).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          })

          try {
            pendingTranscriptionChunksRef.current += 1
            currentSocket.send(JSON.stringify({
              source: chunk.source,
              mime_type: chunk.mimeType,
              time,
            }))
            currentSocket.send(chunk.blob)
            setCapturedChunkCount((count) => count + 1)
          } catch (error) {
            pendingTranscriptionChunksRef.current = Math.max(0, pendingTranscriptionChunksRef.current - 1)
            setTranscriptionStatus('error')
            setTranscriptionError(error instanceof Error ? error.message : 'Could not send an audio chunk.')
          }
        },
        onCaptureEnded: () => {
          const currentCapture = audioCaptureRef.current
          audioCaptureRef.current = null
          closeSocketAfterPendingRef.current = true

          if (currentCapture) {
            void currentCapture.stop().finally(closeTranscriptionSocketWhenIdle)
          } else {
            closeTranscriptionSocketWhenIdle()
          }

          setTranscriptionStatus('error')
          setTranscriptionError('The shared meeting audio or microphone stopped. Please start recording again.')
        },
        onError: (message) => {
          setTranscriptionStatus('error')
          setTranscriptionError(message)
          closeSocketAfterPendingRef.current = true

          const currentCapture = audioCaptureRef.current
          audioCaptureRef.current = null
          if (currentCapture) {
            void currentCapture.stop().finally(closeTranscriptionSocketWhenIdle)
          } else {
            closeTranscriptionSocketWhenIdle()
          }
        },
      })

      if (attempt !== captureGenerationRef.current) {
        await capture.stop()
        closeSocketAfterPendingRef.current = true
        closeTranscriptionSocketWhenIdle()
        return
      }

      audioCaptureRef.current = capture
      setTranscriptionStatus('on')
    } catch (error) {
      if (attempt !== captureGenerationRef.current) return

      closeSocketAfterPendingRef.current = true
      if (socket && socket.readyState < WebSocket.CLOSING) {
        socket.close()
      }
      if (transcriptionSocketRef.current === socket) {
        transcriptionSocketRef.current = null
      }

      setTranscriptionStatus('error')
      setTranscriptionError(
        error instanceof Error
          ? error.message
          : 'Could not start meeting audio capture.',
      )
    }
  }

  function stopTranscription() {
    captureGenerationRef.current += 1

    const capture = audioCaptureRef.current
    audioCaptureRef.current = null
    closeSocketAfterPendingRef.current = true

    if (capture) {
      void capture.stop().finally(closeTranscriptionSocketWhenIdle)
    } else {
      closeTranscriptionSocketWhenIdle()
    }

    setTranscriptionStatus('off')
    setTranscriptionError('')
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
        source: segment.source,
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
            <svg
              className="brand-wave"
              viewBox="0 0 32 32"
              fill="none"
              aria-hidden="true"
            >
              <path d="M5 13V19" />
              <path d="M11 8V24" />
              <path d="M16 4V28" />
              <path d="M21 10V22" />
              <path d="M27 13V19" />
            </svg>
            <span>sidekick</span>
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
                    <div className="orbit-wave">
                      <i />
                      <i />
                      <i />
                      <i />
                      <i />
                    </div>
                  </div>
                </div>

                <div className="waveform" aria-hidden="true">
                  {Array.from({ length: 33 }, (_, index) => (
                    <i
                      key={index}
                      style={{
                        height: `${12 + (Math.sin(index * 0.38) + 1) * 15 + (Math.sin(index * 0.13 + 0.8) + 1) * 9}px`,
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
                      <span className="panel-eyebrow">YOUR SESSION</span>
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

                  <div
                    className={`recording-status ${
                      isRecording
                        ? 'is-recording'
                        : transcriptionStatus === 'error'
                          ? 'has-error'
                          : ''
                    }`}
                    role="status"
                  >
                    <span className="recording-status-dot" />
                    {transcriptionStatus === 'starting'
                      ? 'Requesting microphone and meeting-tab access'
                      : isRecording
                        ? 'Capturing microphone + meeting audio'
                        : transcriptionStatus === 'error'
                          ? 'Audio capture unavailable'
                          : 'Not recording'}
                  </div>
                  {isRecording && (
                    <p className="capture-chunk-status">
                      Audio chunks captured: {capturedChunkCount}
                    </p>
                  )}

                  <p className="capture-notice">
                    Sidekick captures audio from your selected browser tab and microphone.
                    Make sure everyone has agreed to be recorded. Headphones are recommended
                    to reduce echo.
                  </p>

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
                      <span className="panel-eyebrow">LIVE CONVERSATION</span>
                      <h2>Transcript</h2>
                    </div>
                    <span className="panel-icon" aria-hidden="true">
                      ✳
                    </span>
                  </div>

                  <label
                    className="search-eyebrow"
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
                              <div className="transcript-meta">
                                <span className={`transcript-speaker ${entry.source}`}>
                                  {entry.source === 'you'
                                    ? 'You'
                                    : entry.source === 'others'
                                      ? 'Others'
                                      : 'Speaker'}
                                </span>

                                <time className="transcript-time">
                                  {entry.time}
                                </time>
                              </div>

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
                            <div className="transcript-meta">
                              <span className={`transcript-speaker ${entry.source}`}>
                                {entry.source === 'you'
                                  ? 'You'
                                  : entry.source === 'others'
                                    ? 'Others'
                                    : 'Speaker'}
                              </span>

                              <time className="transcript-time">
                                {entry.time}
                              </time>
                            </div>

                            <p className="transcript-entry-text">
                              {entry.text}
                            </p>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <p>
                        {isRecording
                          ? 'Live transcription is active. Your audio is being processed.'
                          : 'Your transcript will appear here when you record.'}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </section>
          )}

          {page === 'sessions' && (
            <section className="subpage sessions-page">
              <div className="page-hero">
                <div>
                  <p className="section-eyebrow">A RECORD OF THE ROOM</p>
                  <h1>Your sessions<span className="heading-period">.</span></h1>
                  <p className="page-intro">
                    Every conversation, safely kept in one place. Pick up right where you left off.
                  </p>
                </div>
                <div className="page-hero-aside">
                  <span className="hero-stat-number">{sessions.length.toString().padStart(2, '0')}</span>
                  <span className="hero-stat-label">SESSIONS SAVED</span>
                  <button className="start-session hero-action" onClick={() => setShowSetup(true)}>
                    New session <span aria-hidden="true">↗</span>
                  </button>
                </div>
              </div>

              {sessions.length === 0 ? (
                <div className="empty-state">
                  <span className="empty-mark">✳</span>
                  <h2>Nothing here just yet.</h2>
                  <p>Start your first session and your conversations will find a home here.</p>
                  <button className="start-session" onClick={() => setShowSetup(true)}>
                    Start a session <span aria-hidden="true">↗</span>
                  </button>
                </div>
              ) : (
                <div className="sessions-grid">
                  {sessions.map((session, index) => (
                    <article className="session-card" key={session.id}>
                      <div className="session-card-top">
                        <span className="session-card-index">{String(index + 1).padStart(2, '0')}</span>
                        <span className="session-card-symbol" aria-hidden="true">◉</span>
                      </div>
                      <div className="session-card-content">
                        <span className="session-card-label">MEETING NOTES</span>
                        <h2>{session.title}</h2>
                        <p>{session.createdAt}</p>
                      </div>
                      <div className="session-card-bottom">
                        <button
                          className="session-card-open"
                          onClick={() => { void openSession(session); }}
                        >
                          Open session <span aria-hidden="true">↗</span>
                        </button>
                        <button
                          className="delete-session"
                          onClick={() => deleteSession(session.id)}
                          aria-label={`Delete ${session.title}`}
                        >
                          Delete
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          )}

          {page === 'takeaways' && (
            <section className="subpage takeaways-page">
              <div className="page-hero">
                <div>
                  <p className="section-eyebrow">THE THINGS WORTH KEEPING</p>
                  <h1>Good things <span className="heading-italic">stick.</span></h1>
                  <p className="page-intro">
                    Turn conversations into clear notes, decisions and next steps. Choose a session to distil it.
                  </p>
                </div>
                <div className="takeaway-hero-mark" aria-hidden="true">
                  <span>✳</span>
                  <small>LESS RECAP.<br />MORE FOLLOW-THROUGH.</small>
                </div>
              </div>

              {sessions.length === 0 ? (
                <div className="empty-state takeaway-empty">
                  <span className="empty-mark">✳</span>
                  <h2>No sessions to summarize yet.</h2>
                  <p>Create a session and capture some transcript first.</p>
                  <button className="start-session" onClick={() => openPage('home')}>
                    Go to home <span aria-hidden="true">↗</span>
                  </button>
                </div>
              ) : (
                <>
                  <div className="takeaways-section-heading">
                    <div>
                      <span className="section-eyebrow">READY WHEN YOU ARE</span>
                      <h2>Choose a conversation</h2>
                    </div>
                    <span className="takeaway-count">{sessions.length} {sessions.length === 1 ? 'SESSION' : 'SESSIONS'}</span>
                  </div>

                  <div className="takeaways-grid">
                    {sessions.map((session, index) => (
                      <article className={`takeaway-card ${summaryMeetingId === session.id && meetingSummary ? 'is-summarized' : ''}`} key={session.id}>
                        <div className="takeaway-card-top">
                          <span className="takeaway-card-number">{String(index + 1).padStart(2, '0')}</span>
                          <span className="takeaway-card-icon" aria-hidden="true">✳</span>
                        </div>
                        <div className="takeaway-card-content">
                          <span className="session-card-label">CONVERSATION</span>
                          <h3>{session.title}</h3>
                          <p>{session.createdAt}</p>
                        </div>
                        <button
                          className="takeaway-generate"
                          onClick={() => generateMeetingSummary(session)}
                          disabled={isGeneratingSummary && summaryMeetingId === session.id}
                        >
                          {isGeneratingSummary && summaryMeetingId === session.id
                            ? 'Gathering the details…'
                            : summaryMeetingId === session.id && meetingSummary
                              ? 'View takeaways'
                              : 'Generate takeaways'}
                          <span aria-hidden="true">↗</span>
                        </button>
                      </article>
                    ))}
                  </div>

                  {summaryError && (
                    <p className="microphone-error" role="alert">{summaryError}</p>
                  )}

                  {meetingSummary && (
                    <section className="summary-board">
                      <div className="summary-board-heading">
                        <div>
                          <span className="section-eyebrow">YOUR MEETING, DISTILLED</span>
                          <h2>{meetingSummary.meeting_title}</h2>
                          <p>Here’s what’s worth carrying forward.</p>
                        </div>
                        <span className="summary-board-mark" aria-hidden="true">✳</span>
                      </div>

                      <article className="summary-lead">
                        <span className="summary-label">THE SHORT VERSION</span>
                        <p>{meetingSummary.summary}</p>
                      </article>

                      <div className="summary-detail-grid">
                        <article className="summary-detail-card">
                          <span className="summary-detail-number">01</span>
                          <h3>Key points</h3>
                          {meetingSummary.key_points.length > 0 ? (
                            <ul>{meetingSummary.key_points.map((point, index) => <li key={index}>{point}</li>)}</ul>
                          ) : <p>No key points were identified.</p>}
                        </article>
                        <article className="summary-detail-card">
                          <span className="summary-detail-number">02</span>
                          <h3>Decisions</h3>
                          {meetingSummary.decisions.length > 0 ? (
                            <ul>{meetingSummary.decisions.map((decision, index) => <li key={index}>{decision}</li>)}</ul>
                          ) : <p>No explicit decisions were identified.</p>}
                        </article>
                        <article className="summary-detail-card action-items-card">
                          <span className="summary-detail-number">03</span>
                          <h3>Action items</h3>
                          {meetingSummary.action_items.length > 0 ? (
                            <ul>{meetingSummary.action_items.map((item, index) => <li key={index}>{item}</li>)}</ul>
                          ) : <p>No explicit action items were identified.</p>}
                        </article>
                      </div>
                    </section>
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