# CPX — Codex Power Editor

CPX is a fast, dependency-free terminal code editor with Codex built directly into the editing loop. Type normally, press `Ctrl+K`, describe the code you want, and watch the result appear at your cursor. Whole-file requests update the in-memory buffer and return control to you without forcing you to leave the editor.

> **AI backend status:** CPX currently works with the Codex CLI. Support for local model backends is planned for a later release.

## Highlights

- Cursor-aware and whole-file Codex editing with one-step undo
- Non-blocking AI queues that can work across multiple tabs in parallel
- Fast navigation, regex and cross-tab search, syntax color, and lightweight diagnostics
- Ranked completion suggestions that learn from opened files and indexed projects
- Python import/member intelligence and hover documentation
- Built-in execution for Python, C, C++, JavaScript, shell, Ruby, and Rust
- Scrollable, selectable, soft-wrapped program output
- Crash recovery, external-file awareness, safe saves, and overwrite protection
- No runtime npm dependencies

## Requirements

- Node.js 20 or newer
- The Codex CLI installed and signed in (`codex --version`)
- An interactive terminal

## Quick start

No installation or root permissions are required:

```bash
cd codex-power-editor
./cpx path/to/file.js
```

Run `./cpx` with no path to begin in a new untitled tab. You can also use `npm start -- path/to/file.js` or `node src/cli.js path/to/file.js`.

To install the `cpx` command without `sudo` or system-directory permission errors:

```bash
npm install --global --prefix ~/.local .
cpx path/to/file.js
```

Most Linux desktops already include `~/.local/bin` in `PATH`. If yours does not, continue using the local `./cpx` launcher or add that directory to your shell configuration.

## Controls

| Key | Action |
| --- | --- |
| `Ctrl+K` | Open an AI prompt; insert the result at the cursor |
| `Ctrl+Shift+K` | Open an AI prompt that replaces the whole file |
| `Alt+Ctrl+K` | Whole-file fallback for terminals that cannot distinguish Shift |
| `Ctrl+R` | Save and run the active supported source file |
| `Ctrl+F` | Search plain text or a `/regex/flags` pattern |
| `F3` | Find the next match, wrapping at the end |
| `Ctrl+N` | Create a new untitled tab |
| `Ctrl+O` | Browse directories and open a file in a tab |
| `Ctrl+W` | Close the active tab; press twice to discard unsaved changes |
| `Alt+,` / `Alt+.` | Reorder the active tab |
| `Ctrl+Page Up` / `Ctrl+Page Down` | Standard previous/next tab shortcut |
| `Ctrl+Shift+Page Up` / `Ctrl+Shift+Page Down` | Reorder the active tab |
| `Alt+1` … `Alt+9` | Jump directly to a numbered tab |
| `Alt+0` | Jump directly to tab 10 |
| `Alt+Left` / `Alt+Right` | Quickly switch to the previous or next tab |
| `Ctrl+P` | Open the typed command palette |
| `F2` | Open the settings menu |
| `F12` | Show the complete in-editor shortcut reference |
| `Tab` | Accept a word suggestion; with selected text, indent every selected line |
| `Alt+J` / `Alt+K` | Select the next or previous item from the top-five suggestion menu |
| `Shift+Tab` | Outdent the current line or selected lines |
| `Ctrl+Space` | Explicitly accept the current completion, or report when none exists |
| `Ctrl+L` | Delete highlighted text, or the current line when nothing is selected; undo with `Ctrl+Z` |
| `Alt+L` | Clear the entire file; undo with `Ctrl+Z` |
| `Ctrl+G` | Go directly to a line number |
| `Ctrl+Up` / `Ctrl+Down` | Jump ten lines up or down |
| `Alt+Up` / `Alt+Down` | Alternate ten-line jump |
| `Ctrl+Left` / `Ctrl+Right` | Move by word |
| `Ctrl+Home` / `Ctrl+End` | Jump to the beginning or end of the file |
| `Shift` + movement | Select and highlight text while moving |
| `Ctrl+Shift+Left` / `Ctrl+Shift+Right` | Select by word |
| `Ctrl+Shift+Home` / `Ctrl+Shift+End` | Select to the start or end of the file |
| `Ctrl+A` | Select everything |
| `Ctrl+C` | Copy the selection to CPX and the terminal clipboard |
| `Ctrl+X` | Cut the selection |
| `Ctrl+V` | Paste text copied inside CPX |
| `Esc` | Cancel a prompt or AI request, stop a running program, or leave finished output |
| `Ctrl+S` | Save |
| `Ctrl+Z` | Undo the last edit, including a complete AI edit |
| `Ctrl+Y` | Redo the last undone edit |
| `F8` | Jump through lightweight delimiter diagnostics |
| `Ctrl+Q` | Quit; press twice to discard unsaved changes |
| Arrow keys, Home, End, Page Up/Down | Navigate |

Text copied with `Ctrl+C` is also sent through OSC 52, which lets supported terminals place it on the operating-system clipboard. `Ctrl+V` always pastes CPX's internal clipboard. Your terminal's normal paste shortcut—commonly `Ctrl+Shift+V`—can paste text copied from other applications.

## Tabs, search, suggestions, and file watching

Open several files at startup with `./cpx one.py two.c three.cpp`, create an empty tab with `Ctrl+N`, or browse the filesystem with `Ctrl+O`. In the browser, use arrows and Enter to navigate, Backspace to visit the parent directory, `.` to show hidden files, `m` to create and enter a new folder, and `n` to create an untitled tab. Saving an untitled tab first opens a navigator for choosing the parent folder. Select `[Use this folder]`, press Enter, and then type only the new filename. A filename containing missing folders, such as `tools/generated/main.py`, creates those parent folders automatically. Selecting an existing file prefills its name, and CPX requires explicit Y/Enter confirmation before overwriting any existing file. Tabs are numbered, the active tab is bracketed, `*` means unsaved, and `!` means a dirty buffer also changed on disk. Each tab preserves its own vertical and horizontal scroll position. When the tab list is wider than the terminal, it collapses around the active tab so the current file never disappears.

## Crash recovery

CPX writes an atomic private session journal while it runs. The journal contains open tabs, saved and unsaved buffer contents, cursor positions, selections, and viewports. If CPX or the computer exits uncleanly, the next launch asks whether to Resume the recovered session or Start New. A normal intentional quit removes the journal, so routine launches do not show a recovery prompt.

Search is case-insensitive contains-search by default. Prefix a query with `=` for an exact word match, such as `=render`. When regex search is enabled, expressions such as `/class\s+\w+/g` or `/todo/gi` are accepted. Matches are highlighted, `F3` advances, and search can continue across every open tab. Cross-tab search can be disabled in Settings.

The persistent knowledge index learns identifiers and reusable code phrases from every opened or saved file. Suggestions are matched without case sensitivity and capitalization variants are composed into one ranked entry. Up to five matches appear beside the cursor: language-specific vocabulary ranks first, a compact general programming dictionary fills common gaps, and indexed cross-language terms remain available when useful. Use `Alt+J` / `Alt+K` to choose and `Tab` to accept. The index keeps the 5,000 strongest words and 2,000 phrases, providing a much larger vocabulary while keeping memory and disk usage bounded. Settings and indexed knowledge persist in `~/.config/cpx/settings.json` (or `$XDG_CONFIG_HOME/cpx/settings.json`). Automatic learning can be disabled in Settings.

To teach CPX from files without opening them, press `Ctrl+P` and run `index PATH`. PATH may be one file or a complete directory, for example `index src` or `index helpers.py`. Directory scans ignore dependency, build, cache, Git, virtual-environment, binary, and oversized files; they are capped at 500 files and 10 MB per run. Use `index-status` to see the stored word/phrase count or `clear-index` to reset it.

Python and C/C++ keywords and common built-ins are always available as completion candidates, so prefixes such as `pri`, `ret`, and `enu` work even in a new file. `Tab` accepts a visible candidate before performing indentation. `Ctrl+Space` provides an explicit completion-only shortcut.

Python member completion understands imports. After `import os`, typing `os.` immediately offers ranked members such as `os.path`, `os.listdir`, and `os.getcwd`; aliases such as `import json as js` work too. CPX ships prebuilt indexes for common standard-library modules. Use `python-index MODULE` to rebuild one module from the installed Python environment, or `python-reindex` to refresh every module imported by the active file. Rebuilt indexes persist with the rest of the completion knowledge.

When hover documentation is enabled, moving the mouse over a supported keyword or built-in displays a compact signature and explanation. CPX also recognizes Python, JavaScript, C, and C++ functions defined in the current file and shows their local signature. Python assignments are inferred too: hovering variables assigned strings, tuples, dictionaries, lists, sets, integers, floats, booleans, or annotated values shows their type. Disable hover documentation from Settings if you prefer terminal-native mouse behavior.

External-file watching uses one low-frequency polling loop for all tabs rather than a watcher per file. Clean buffers reload automatically. Dirty buffers are preserved and marked with `!` so CPX never silently destroys unsaved work.

Python, C/C++, and JavaScript-family files receive theme-aware syntax coloring for keywords, strings, numbers, and comments. CPX also caches lightweight unmatched-delimiter diagnostics; the footer reports them and `F8` jumps to each location. Diagnostics wait for a brief typing pause and run in a worker thread, keeping large-file keystrokes responsive. These checks are intentionally fast and local rather than a replacement for a language server.

## Settings

Press `F2`, use the arrow keys to choose a setting, Space to toggle it, and left/right to adjust numeric values or cycle choices. `Esc` closes and saves the menu. Available settings include auto-indent, suggestions, completion learning, external-file watching, regex and cross-tab search, indentation width, the maximum number of parallel AI jobs, and five complete color schemes: Ocean, Midnight, Forest, Paper, and Amber. A scheme changes editor foreground/background, chrome, selections, and tooltips; terminal font family and size remain controlled by the terminal emulator.

## Commands and parallel AI

Press `Ctrl+P` and type commands such as `new`, `browse`, `tab 3`, `find value`, `word render`, `open src/app.js`, `index src`, `index-status`, `next-tab`, `move-tab-right`, `save`, `run`, `ai add validation`, or `ai-file refactor this module`. `shortcuts` opens the complete reference. Shortcut actions also have command equivalents.

AI requests are queued per tab and run in order on that tab. Different tabs run concurrently up to the configurable limit. A `↻` in the tab bar means running and `…` means queued. You can continue typing, searching, running code, and changing tabs while AI works. Use the `cancel-ai` command to cancel queued and active work on the current tab.

Terminal font size is controlled by the terminal emulator. Common shortcuts are `Ctrl+Shift+=` to enlarge, `Ctrl+Shift+-` to shrink, and `Ctrl+Shift+0` to reset; CPX intentionally leaves these for the terminal.

Press `F12` at any time while editing to open a complete shortcut reference. Scroll with the arrow keys or Page Up/Down, then close it with `F12`, `Esc`, or `q`.

## Running code

Press `Ctrl+R` to save and run the current file. Program output is shown inside CPX, and long output lines soft-wrap to the next terminal row instead of being clipped at the right edge. Drag with the mouse to select output and press `Ctrl+C` to copy it to CPX and the system clipboard. Dragging a selection against the top or bottom edge scrolls the output while preserving and extending the highlight. The mouse wheel, Up/Down, and Page Up/Page Down review output taller than the screen; Home and End jump to the oldest and newest output. The output view stays open if you accidentally type or click. With no selection, `Ctrl+C` or `Esc` stops a running program; after it finishes, only `Esc` returns to the editor.

| File type | Command |
| --- | --- |
| `.py` | `python3 file.py` |
| `.c` | `gcc` with warnings enabled, followed by the compiled program |
| `.cc`, `.cpp`, `.cxx` | `g++ -std=c++17` with warnings enabled, followed by the compiled program |
| `.js`, `.mjs`, `.cjs` | `node` |
| `.sh` | `bash` |
| `.rb` | `ruby` |
| `.rs` | `rustc`, followed by the compiled program |

Compiled executables are placed in a temporary directory and removed after each run.

## How AI editing works

CPX currently sends the unsaved buffer, file name, cursor offset, and your instruction to `codex exec`. Codex runs read-only and returns a structured edit. CPX applies that result only to its in-memory buffer:

- Cursor edits are rendered progressively at the original cursor position.
- Whole-file edits replace the buffer but do not touch disk until `Ctrl+S`.
- `Esc` cancels an active request.
- `Ctrl+Z` reverts the entire AI edit in one step.

This separation prevents the agent and editor from racing to write the same file.

### Local models

The backend boundary is intentionally small so additional providers can be added without changing the editing workflow. Local model support is on the roadmap; it is not included in the current release. For now, AI editing requires an installed and authenticated Codex CLI. All non-AI editing, navigation, search, indexing, running, and recovery features remain local.

## Example prompts

At a cursor inside a JavaScript file, press `Ctrl+K` and try:

```text
add an async function that retries fetch three times with exponential backoff
```

Use `Ctrl+Shift+K` for changes such as:

```text
refactor this module to TypeScript and add useful error messages
```

## Development

```bash
npm test
```

CPX intentionally uses only Node built-ins, so there is no dependency installation step.

Run the reproducible 100,000-line performance check with `npm run benchmark`. See `BENCHMARK_IMPROVEMENTS.md` for the before/after response to the hands-on review.

## Roadmap

- Pluggable local-model backends
- Richer language intelligence and diagnostics
- Project navigation and Git-aware workflows
- Additional customization for shortcuts and editor behavior

Contributions and focused bug reports are welcome.
