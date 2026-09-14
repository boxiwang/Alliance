export type TextEntryKey = {
  key: string;
  isComposing?: boolean;
  keyCode?: number;
};

// Enter confirms an active IME candidate before it should submit the message.
// keyCode 229 is retained for Safari/older Chromium, where isComposing can flip
// to false on the same key event that closes the composition session.
export function shouldSubmitTextEntry(event: TextEntryKey, compositionActive = false): boolean {
  return event.key === "Enter" && !compositionActive && !event.isComposing && event.keyCode !== 229;
}
