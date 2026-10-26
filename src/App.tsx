
import './App.css'

function App() {
  return (
    <main className="sidekick">
      <aside className="rail">
        <div className="rail-label">YOUR SPACE</div>

        <nav className="rail-nav">
          <a className="rail-link selected" href="#home">
            <span>⌂</span> Home
          </a>
          <a className="rail-link" href="#sessions">
            <span>◷</span> Sessions
          </a>
          <a className="rail-link" href="#library">
            <span>↗</span> Your takeaways
          </a>
        </nav>

        <div className="rail-bottom">
          <span className="avatar">V</span>
          <div>
            <strong>My workspace</strong>
            <span>Just for you</span>
          </div>
        </div>
      </aside>

      <section className="page" id="home">
        <header className="topline">
          <span>MONDAY, MADE A LITTLE EASIER</span>
          <span className="availability">
            <i /> YOUR SPACE IS READY
          </span>
          <a className="header-wordmark" href="#home" aria-label="Sidekick home">
            sidekick
          </a>
        </header>

        <div className="content">
          <section className="intro">
            <p className="kicker">A QUIETER KIND OF COPILOT</p>
            <h1>
              Be in the room.
              <br />
              <span>We'll keep the thread.</span>
            </h1>
            <p className="intro-copy">
              No frantic typing. No wondering what you missed.
              Just you in the conversation, with a little help
              remembering what matters.
            </p>
          </section>

          <section className="session" id="sessions">
            <div className="session-top">
              <div>
                <span className="session-index">YOUR NEXT CONVERSATION</span>
                <h2>Pull up a chair.</h2>
              </div>
              <div className="orbit" aria-hidden="true">
                <span />
                <span />
                <span />
                <div className="orbit-core">
                  <span>sk</span>
                </div>
              </div>
            </div>

            <div className="waveform" aria-hidden="true">
              {[18, 28, 13, 36, 48, 25, 16, 39, 56, 31, 19, 44,
                26, 15, 35, 50, 22, 40, 17, 29, 46, 21, 34, 14,
                42, 25, 37, 18, 49, 30, 16, 39, 23, 45, 19, 32,
                12, 36, 24, 42].map((height, index) => (
                <i key={index} style={{ height: `${height}px` }} />
              ))}
            </div>

            <div className="session-bottom">
              <div className="session-caption">
                <span className="mic-symbol">◉</span>
                <div>
                  <strong>One conversation at a time.</strong>
                  <span>Start when you're ready.</span>
                </div>
              </div>
              <button
                className="start-session"
                type="button"
                onClick={() => alert('Live sessions are coming soon!')}
              >
                Start a session <span>↗</span>
              </button>
            </div>
          </section>

          <section className="principles">
            <p>
              Be present in the conversation.
              <span> We'll take care of what comes after.</span>
            </p>
          </section>

          <section className="history" id="library">
            <div>
              <span className="history-label">WHEN YOU'RE READY</span>
              <h2>Your conversations will find a home here.</h2>
            </div>
            <span className="history-arrow">↘</span>
          </section>

          <footer className="footer">
            <span>Made for conversations that matter.</span>
            <span>sidekick <b>✳</b></span>
          </footer>
        </div>
      </section>
    </main>
  )
}

export default App
