import { useEffect, useState } from "react";
import { submitAlphaFeedback } from "./lib/backend";

type FeedbackCategory = "bug" | "ux" | "balance" | "other";

export default function AlphaFeedback({ address, page }: { address: string; page: string }) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<FeedbackCategory>("bug");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open]);

  async function send() {
    const body = message.trim();
    if (body.length < 5 || busy) return;
    setBusy(true); setStatus("");
    try {
      await submitAlphaFeedback(address, { category, page, message: body });
      setMessage(""); setStatus("Sent. Thank you.");
      window.setTimeout(() => { setOpen(false); setStatus(""); }, 900);
    } catch { setStatus("Could not send. Try again."); }
    finally { setBusy(false); }
  }

  return <>
    <button className="alpha-feedback-trigger" onClick={() => setOpen(true)}>FEEDBACK</button>
    {open && <div className="alpha-feedback-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
      <section className="alpha-feedback-panel" role="dialog" aria-modal="true" aria-label="Send alpha feedback">
        <header><div><small>PRIVATE ALPHA</small><b>Send feedback</b></div><button aria-label="Close feedback" onClick={() => setOpen(false)}>×</button></header>
        <label><span>TYPE</span><select value={category} onChange={(event) => setCategory(event.target.value as FeedbackCategory)}><option value="bug">Bug</option><option value="ux">Hard to understand</option><option value="balance">Balance</option><option value="other">Other</option></select></label>
        <label><span>WHAT HAPPENED?</span><textarea autoFocus maxLength={2000} value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Tell us what you did, what happened, and what you expected." /></label>
        <footer><small>{status || `PAGE · ${page.toUpperCase()}`}</small><button disabled={message.trim().length < 5 || busy} onClick={() => void send()}>{busy ? "SENDING…" : "SEND"}</button></footer>
      </section>
    </div>}
  </>;
}
