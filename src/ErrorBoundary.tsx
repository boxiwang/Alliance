import React from "react";
import { reportClientError } from "./lib/error-reporting";

type Props = { children: React.ReactNode };
type State = { crashed: boolean };

// Catches render crashes so a friend sees a recoverable panel (not a white
// screen) and the crash is reported to the backend.
export default class ErrorBoundary extends React.Component<Props, State> {
  state: State = { crashed: false };

  static getDerivedStateFromError(): State {
    return { crashed: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    reportClientError("react", error.message, error.stack, { componentStack: info.componentStack?.slice(0, 1500) });
  }

  render() {
    if (!this.state.crashed) return this.props.children;
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, color: "#dbe2f3", fontFamily: "system-ui, sans-serif", textAlign: "center" }}>
        <div style={{ maxWidth: 380 }}>
          <div style={{ font: "700 34px system-ui", marginBottom: 10 }}>✦</div>
          <h1 style={{ font: "700 18px system-ui", margin: "0 0 8px" }}>The frontier hit turbulence</h1>
          <p style={{ color: "#93a1c2", fontSize: 13, lineHeight: 1.5, margin: "0 0 18px" }}>Something crashed and we&apos;ve logged it. Your progress is saved — reload to jump back in.</p>
          <button onClick={() => window.location.reload()} style={{ padding: "10px 22px", borderRadius: 10, border: "1px solid #2b6f8f", background: "#123", color: "#9fe8ff", font: "700 12px system-ui", letterSpacing: ".06em", cursor: "pointer", textTransform: "uppercase" }}>Reload</button>
        </div>
      </div>
    );
  }
}
