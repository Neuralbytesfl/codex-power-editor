#!/usr/bin/env node
import { EditorApp } from "./app.js";

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log(`cpx — a terminal editor with Codex at the cursor

Usage:
  cpx [file ...]

Keys:
  Ctrl+K         Ask Codex to insert code at the cursor
  Ctrl+Shift+K   Ask Codex to edit the whole file (terminal permitting)
  Ctrl+R         Save and run the active supported source file
                 In output: select/copy and scroll; only Esc returns to editor
  Ctrl+L         Delete the current line
  Alt+L          Clear the entire file
  Ctrl+G         Go to a line number
  Ctrl+Up/Down   Jump 10 lines (Alt+Up/Down also works)
  Ctrl+Left/Right Move by word
  Ctrl+Home/End  Jump to the start/end of the file
  Shift+movement Select and highlight text
  Ctrl+A/C/X/V   Select all, copy, cut, and paste
  Ctrl+F / F3    Search text or regex; find next
  Ctrl+P         Open the typed command palette
                 Try: index PATH, python-index os, or python-reindex
  Ctrl+N         Create an untitled tab
  Ctrl+O         Browse files and directories
  Ctrl+W         Close the active file tab
  Alt+, / .      Reorder the active tab
  Ctrl+PgUp/PgDn Switch tabs; add Shift to reorder
  Alt+0..9       Jump directly to tabs 1–10
  Alt+Left/Right Previous or next tab
  F2             Open settings
  F8             Jump through lightweight delimiter diagnostics
  F12            Show every available shortcut
  Tab / Shift+Tab Complete or indent / outdent
  Alt+J / Alt+K   Choose next / previous completion suggestion
  Ctrl+Space      Explicit completion fallback
  Ctrl+S         Save
  Ctrl+Z         Undo
  Ctrl+Y         Redo
  Ctrl+Q         Quit
  Esc            Close the active prompt or finished output

Tip: if Ctrl+Shift+K is not reported by your terminal, use Alt+Ctrl+K.`);
  process.exit(0);
}

const filePaths = args.filter(arg => !arg.startsWith("-"));

try {
  await new EditorApp(filePaths).start();
} catch (error) {
  console.error(`cpx: ${error.message}`);
  process.exit(1);
}
