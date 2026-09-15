const ESC = "\x1b";
const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";

// Terminal data events are arbitrary chunks, not individual keypresses.
export class InputDecoder {
  constructor() {
    this.pending = "";
    this.pasteParts = null;
  }

  get awaitingEscape() { return this.pasteParts === null && this.pending === ESC; }

  flushEscape() {
    if (!this.awaitingEscape) return [];
    this.pending = "";
    return [{ type: "key", value: ESC }];
  }

  push(chunk) {
    this.pending += chunk;
    const events = [];
    while (this.pending) {
      if (this.pasteParts !== null) {
        const end = this.pending.indexOf(PASTE_END);
        if (end >= 0) {
          this.pasteParts.push(this.pending.slice(0, end));
          events.push({ type: "paste", value: this.pasteParts.join("") });
          this.pasteParts = null;
          this.pending = this.pending.slice(end + PASTE_END.length);
          continue;
        }
        // Keep a possible partial closing marker for the next data event.
        let keep = Math.min(PASTE_END.length - 1, this.pending.length);
        while (keep && !PASTE_END.startsWith(this.pending.slice(-keep))) keep--;
        this.pasteParts.push(this.pending.slice(0, this.pending.length - keep));
        this.pending = keep ? this.pending.slice(-keep) : "";
        break;
      }

      if (this.pending.startsWith(PASTE_START)) {
        this.pasteParts = [];
        this.pending = this.pending.slice(PASTE_START.length);
        continue;
      }

      let value;
      if (this.pending[0] === ESC) {
        if (this.pending.length === 1) break;
        if (this.pending[1] === "[" || this.pending[1] === "O") {
          const match = this.pending.match(/^\x1b(?:\[[0-?]*[ -/]*|O[ -/]*)[@-~]/);
          if (!match) {
            if (/^\x1b(?:\[[0-?]*[ -/]*|O[ -/]*)$/.test(this.pending)) break;
            // Discard an invalid sequence prefix without retaining it forever.
            this.pending = this.pending.slice(2);
            continue;
          }
          value = match[0];
        } else {
          const width = this.pending.codePointAt(1) > 0xffff ? 2 : 1;
          value = this.pending.slice(0, 1 + width);
        }
      } else {
        value = this.pending.match(/^[^\x00-\x1f\x7f]+/)?.[0] || this.pending[0];
      }
      events.push({ type: "key", value });
      this.pending = this.pending.slice(value.length);
      if (value === "\r" && this.pending[0] === "\n") this.pending = this.pending.slice(1);
    }
    return events;
  }
}
