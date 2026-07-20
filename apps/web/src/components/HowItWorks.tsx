// A plain-language "how a room works" panel. It doubles as the first-run intro
// (auto-opened once) and the on-demand help behind the header's "?" button, so
// there is one source of truth for the explanation. Content only — no room
// data — rendered as text nodes.

export function HowItWorks({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="How a room works"
    >
      <div className="modal-card how-card">
        <header className="how-head">
          <h2>How a ClaudeRooms room works</h2>
          <button className="btn small subtle" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <p className="muted">
          You and your team share one room around a repository. Claude only acts when
          someone explicitly asks — and anything that touches the host's machine needs the
          host's approval first.
        </p>

        <h3>The four things you can send</h3>
        <ul className="how-list">
          <li>
            <strong>Message the room</strong> — a normal message. Claude is not involved.
          </li>
          <li>
            <strong>Ask Claude — chat only</strong> — Claude answers, but cannot see your
            repository.
          </li>
          <li>
            <strong>Ask Claude — read the repo</strong> — Claude reads repository files.
            The <em>host</em> approves the request first, and the room sees exactly which
            files were read.
          </li>
          <li>
            <strong>Propose a file change</strong> — suggest a file's path and contents
            (often from Claude's answer). The host reviews the exact change and approves
            before it is written. Claude never writes on its own.
          </li>
        </ul>

        <h3>Host vs. guest</h3>
        <ul className="how-list">
          <li>
            The <strong>host</strong> runs the desktop app, connects the repo folder
            (“Connect repo folder”), invites others, and approves what Claude reads or
            writes.
          </li>
          <li>
            A <strong>guest</strong> just opens the invitation link in a browser and joins
            the conversation — no install, no repo access.
          </li>
        </ul>

        <footer className="how-foot">
          <button className="btn primary" onClick={onClose}>
            Got it
          </button>
        </footer>
      </div>
    </div>
  );
}
