import { highlightLine } from "./syntax.js";
const CSI = "\x1b[";

export const colorSchemes = [
  { name:"Ocean", titleBg:24,titleFg:255,editorBg:234,editorFg:252,gutterFg:244,footerBg:236,footerFg:255,selectionBg:60,selectionFg:255,tooltipBg:238,tooltipFg:229,keywordFg:81,stringFg:150,numberFg:215,commentFg:244 },
  { name:"Midnight", titleBg:54,titleFg:255,editorBg:16,editorFg:189,gutterFg:103,footerBg:17,footerFg:153,selectionBg:99,selectionFg:255,tooltipBg:53,tooltipFg:231,keywordFg:141,stringFg:150,numberFg:216,commentFg:103 },
  { name:"Forest", titleBg:22,titleFg:231,editorBg:233,editorFg:151,gutterFg:65,footerBg:235,footerFg:114,selectionBg:29,selectionFg:231,tooltipBg:22,tooltipFg:229,keywordFg:81,stringFg:186,numberFg:215,commentFg:65 },
  { name:"Paper", titleBg:25,titleFg:255,editorBg:255,editorFg:235,gutterFg:245,footerBg:250,footerFg:235,selectionBg:153,selectionFg:16,tooltipBg:230,tooltipFg:235,keywordFg:25,stringFg:28,numberFg:130,commentFg:242 },
  { name:"Amber", titleBg:94,titleFg:230,editorBg:232,editorFg:223,gutterFg:137,footerBg:234,footerFg:214,selectionBg:130,selectionFg:230,tooltipBg:58,tooltipFg:230,keywordFg:214,stringFg:150,numberFg:203,commentFg:137 }
];

function clean(value) {
  return value.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "");
}

function crop(line, start, width) {
  const expanded = clean(line).replace(/\t/g, "    ");
  return expanded.slice(start, start + width).padEnd(width);
}

export function wrapOutput(text, width) {
  const safeWidth = Math.max(1, width);
  return text.replace(/\r/g, "").split("\n").flatMap(line => {
    const expanded = clean(line).replace(/\t/g, "    ");
    if (!expanded.length) return [""];
    const chunks = [];
    for (let offset = 0; offset < expanded.length; offset += safeWidth) chunks.push(expanded.slice(offset, offset + safeWidth));
    return chunks;
  });
}

function renderSelectedLine(line, lineStart, selection, start, width, theme, filePath) {
  const cells = [];
  const kinds=highlightLine(line,filePath);
  for (let index = 0; index < line.length; index++) {
    const character = clean(line[index]);
    const expanded = character === "\t" ? "    " : character;
    const selected = selection && lineStart + index >= selection.start && lineStart + index < selection.end;
    const style=selected?theme.selectionStyle:(theme.syntaxStyles[kinds[index]]||theme.editorStyle);
    for (const cell of expanded) cells.push({ cell, style });
  }
  const visible = cells.slice(start, start + width);
  let output = "";
  let currentStyle = "";
  for (const { cell, style } of visible) {
    if (style !== currentStyle) {
      output += style;
      currentStyle = style;
    }
    output += cell;
  }
  if (currentStyle!==theme.editorStyle) output += theme.editorStyle;
  output += " ".repeat(Math.max(0, width - visible.length));
  return output;
}

function renderRunLine(line, lineStart, selection, width, theme) {
  let output="",highlighted=false;
  for(let index=0;index<line.length;index++){
    const selected=selection&&lineStart+index>=selection.start&&lineStart+index<selection.end;
    if(selected!==highlighted){output+=selected?theme.selectionStyle:theme.editorStyle;highlighted=selected;}
    output+=line[index];
  }
  if(highlighted)output+=theme.editorStyle;
  return output+" ".repeat(Math.max(0,width-line.length));
}

function promptLabel(prompt) {
  if (prompt.kind === "goto") return "GO TO LINE";
  if (prompt.kind === "search") return "SEARCH";
  if (prompt.kind === "open") return "OPEN FILE";
  if (prompt.kind === "saveas") return "FILE NAME";
  if (prompt.kind === "mkdir") return "NEW FOLDER";
  if (prompt.kind === "command") return "COMMAND";
  return prompt.forceFile ? "AI FILE" : "AI INSERT";
}

export class Renderer {
  constructor(output = process.stdout) {
    this.output = output;
    this.topLine = 0;
    this.leftColumn = 0;
  }

  draw({ buffer, filePath, status, prompt, busy, runPanel, tabs, activeTabIndex, settingsPanel, helpPanel, fileBrowser, recoveryPanel, overwritePanel, settings, suggestions, suggestion, suggestionChoice, tooltip, diagnostics }) {
    const width = Math.max(30, this.output.columns || 80);
    const height = Math.max(8, this.output.rows || 24);
    const editorRows = height - 2;
    const gutter = Math.max(4, String(buffer.lines().length).length + 2);
    const contentWidth = width - gutter;
    const pos = buffer.position();
    const palette=colorSchemes[settings?.colorScheme]||colorSchemes[0];
    const theme={
      editorStyle:`${CSI}48;5;${palette.editorBg}m${CSI}38;5;${palette.editorFg}m`,
      titleStyle:`${CSI}48;5;${palette.titleBg}m${CSI}38;5;${palette.titleFg}m`,
      gutterStyle:`${CSI}48;5;${palette.editorBg}m${CSI}38;5;${palette.gutterFg}m`,
      footerStyle:`${CSI}48;5;${palette.footerBg}m${CSI}38;5;${palette.footerFg}m`,
      selectionStyle:`${CSI}48;5;${palette.selectionBg}m${CSI}38;5;${palette.selectionFg}m`,
      tooltipStyle:`${CSI}48;5;${palette.tooltipBg}m${CSI}38;5;${palette.tooltipFg}m`,
      syntaxStyles:Object.fromEntries(["keyword","string","number","comment"].map(kind=>[kind,`${CSI}48;5;${palette.editorBg}m${CSI}38;5;${palette[`${kind}Fg`]}m`]))
    };

    if (pos.line < this.topLine) this.topLine = pos.line;
    if (pos.line >= this.topLine + editorRows) this.topLine = pos.line - editorRows + 1;
    if (pos.column < this.leftColumn) this.leftColumn = pos.column;
    if (pos.column >= this.leftColumn + contentWidth) this.leftColumn = pos.column - contentWidth + 1;

    const lines = buffer.lines();
    let screen = `${CSI}?25l${CSI}H${theme.editorStyle}`;
    const tabStrip = tabs?.length > 1
      ? formatTabStrip(tabs, activeTabIndex, width - 6)
      : `${filePath || tabs?.[activeTabIndex]?.displayName || "Untitled"}${buffer.dirty ? " •" : ""}`;
    const name = recoveryPanel ? "SESSION RECOVERY" : overwritePanel ? "CONFIRM OVERWRITE" : runPanel ? runPanel.title : tabStrip;
    const title = ` CPX  ${name}`.slice(0, width).padEnd(width);
    screen += `${theme.titleStyle}${title}${theme.editorStyle}`;

    if (overwritePanel) {
      const rows=["WARNING: this file already exists.","",overwritePanel.target,"","Overwrite it?","","  [Y / Enter] Yes, replace the existing file","  [N / Esc]   No, return without saving"];
      for(let row=0;row<editorRows;row++)screen+=`\n${crop(rows[row]||"",0,width)}`;
    } else if (recoveryPanel) {
      const session=recoveryPanel.session,unsaved=session.tabs.filter(tab=>tab.text!==tab.savedText).length;
      const rows=["CPX found a session left by an unclean exit.","",`Saved: ${session.savedAt||"unknown"}`,`Tabs: ${session.tabs.length}   Unsaved: ${unsaved}`,"","Choose how to start:",`${recoveryPanel.selected===0?"›":" "} [R] Resume the recovered session`,`${recoveryPanel.selected===1?"›":" "} [N] Start a new session`,"","Use ↑/↓ and Enter, or press R/N directly."];
      for(let row=0;row<editorRows;row++)screen+=`\n${crop(rows[row]||"",0,width)}`;
    } else if (fileBrowser) {
      const rows = [`${fileBrowser.mode === "save" ? "SAVE LOCATION" : "OPEN FILE"}  ${fileBrowser.cwd}`, ""];
      if(fileBrowser.mode==="save")rows.push(`${fileBrowser.selected===0?"›":" "} ✓ [Use this folder]`);
      if (fileBrowser.error) rows.push(`Error: ${fileBrowser.error}`);
      else if (!fileBrowser.entries.length) rows.push("  (empty directory)");
      else for (let index = 0; index < fileBrowser.entries.length; index++) {
        const entry = fileBrowser.entries[index];
        const selected=fileBrowser.mode==="save"?index+1===fileBrowser.selected:index===fileBrowser.selected;
        rows.push(`${selected ? "›" : " "} ${entry.isDirectory() ? "▸" : " "} ${entry.name}${entry.isDirectory() ? "/" : ""}`);
      }
      const selectedRow = fileBrowser.selected + 2;
      const scroll = Math.max(0, selectedRow - editorRows + 1);
      for (let row = 0; row < editorRows; row++) screen += `\n${crop(rows[scroll + row] || "", 0, width)}`;
    } else if (helpPanel) {
      const rows = ["ALL SHORTCUTS  (↑/↓ or Page Up/Down scroll)", "", ...shortcutRows.slice(helpPanel.offset)];
      for (let row = 0; row < editorRows; row++) screen += `\n${crop(rows[row] || "", 0, width)}`;
    } else if (settingsPanel) {
      const rows = ["SETTINGS  (↑/↓ choose, Space toggle, ←/→ adjust, Esc save)", ""];
      for (let index = 0; index < settingDefinitions.length; index++) {
        const row = settingDefinitions[index];
        const value = row.type === "boolean" ? (settings[row.key] ? "ON" : "OFF") : row.type === "choice" ? row.values[settings[row.key]] : settings[row.key];
        rows.push(`${index === settingsPanel.selected ? "›" : " "} ${row.label.padEnd(30)} ${value}`);
      }
      for (let row = 0; row < editorRows; row++) screen += `\n${crop(rows[row] || "", 0, width)}`;
    } else if (runPanel) {
      const outputLines = wrapOutput(runPanel.output, width);
      const maxOffset = Math.max(0, outputLines.length - editorRows);
      runPanel.scrollOffset = Math.min(maxOffset, Math.max(0, runPanel.scrollOffset || 0));
      const end = outputLines.length - runPanel.scrollOffset;
      const start = Math.max(0, end - editorRows), visible = outputLines.slice(start, end);
      const a=runPanel.selectionAnchor,c=runPanel.selectionCursor;
      const selection=a===null||a===undefined||c===null||c===undefined?null:{start:Math.min(a,c),end:Math.max(a,c)};
      let lineStart=0;for(let index=0;index<start;index++)lineStart+=outputLines[index].length+1;
      for (let row = 0; row < editorRows; row++) {
        const line=visible[row]||"",body = renderRunLine(line,lineStart,selection,width,theme);
        screen += `\n${body}`;
        if(row<visible.length)lineStart+=line.length+1;
      }
    } else {
      const selection = buffer.selectionRange();
      let lineStart = 0;
      for (let index = 0; index < this.topLine; index++) lineStart += lines[index].length + 1;
      for (let row = 0; row < editorRows; row++) {
        const lineNo = this.topLine + row;
        const number = lineNo < lines.length ? String(lineNo + 1).padStart(gutter - 2) + " │" : " ".repeat(gutter - 1) + "│";
        const body = lineNo < lines.length
          ? renderSelectedLine(lines[lineNo], lineStart, selection, this.leftColumn, contentWidth,theme,filePath)
          : " ".repeat(contentWidth);
        screen += `\n${theme.gutterStyle}${number}${theme.editorStyle}${body}`;
        if (lineNo < lines.length) lineStart += lines[lineNo].length + 1;
      }
    }

    let footer;
    if (overwritePanel) {
      footer=" Existing file will not be changed without Y / Enter confirmation";
    } else if (recoveryPanel) {
      footer=" Recovery is stored locally with private file permissions";
    } else if (fileBrowser) {
      footer = fileBrowser.mode==="save"
        ? ` ↑/↓ choose  Enter select  m new folder  Backspace parent  . hidden:${fileBrowser.showHidden ? "ON" : "OFF"}`
        : ` ↑/↓ choose  Enter open  m new folder  Backspace parent  . hidden:${fileBrowser.showHidden ? "ON" : "OFF"}`;
    } else if (helpPanel) {
      footer = ` F12 / Esc / q close   ↑/↓ scroll   Offset ${helpPanel.offset}`;
    } else if (settingsPanel) {
      footer = " Settings are saved automatically in ~/.config/cpx/settings.json";
    } else if (runPanel) {
      const scroll = runPanel.scrollOffset ? ` — ${runPanel.scrollOffset} wrapped row${runPanel.scrollOffset === 1 ? "" : "s"} from bottom` : "";
      const notice=runPanel.notice?` ${runPanel.notice} —`:"";
      footer = runPanel.running ? `${notice} drag select, Ctrl+C copy; wheel/↑/↓ scroll; Esc stops${scroll}` : `${notice} drag select, Ctrl+C copy; wheel/↑/↓/Pg scroll; Esc returns${scroll}`;
    } else if (prompt) {
      footer = ` ${promptLabel(prompt)} › ${prompt.value}`;
    } else {
      const tab = tabs?.[activeTabIndex];
      const aiHint = tab?.aiRunning ? `${tab.aiStatus || "AI working"} — editor remains active` : tab?.aiQueue?.length ? `${tab.aiQueue.length} AI request${tab.aiQueue.length === 1 ? "" : "s"} queued` : "";
      const diagnosticHint=diagnostics?.length?`⚠ ${diagnostics.length} diagnostic${diagnostics.length===1?"":"s"}; F8 next`:"";
      const hint = aiHint || (suggestion ? `Tab accepts ${suggestion.word}  Alt+J/K choose (${suggestionChoice+1}/${suggestions.length})` : diagnosticHint||"Ctrl+K AI  Ctrl+F find  Ctrl+P commands  F12 help");
      const activity = busy ? ` ${busy}` : ` ${status || hint}`;
      footer = `${activity}  Ln ${pos.line + 1}, Col ${pos.column + 1}`;
    }
    screen += `\n${theme.footerStyle}${clean(footer).slice(0, width).padEnd(width)}${CSI}0m`;

    if (suggestions?.length && !overwritePanel && !recoveryPanel && !fileBrowser && !helpPanel && !settingsPanel && !runPanel && !prompt && !tooltip) {
      const cursorRow=pos.line-this.topLine+2,cursorCol=pos.column-this.leftColumn+gutter+1;
      const menuWidth=Math.min(Math.max(...suggestions.map(item=>item.word.length+5)),Math.max(12,width-2));
      const column=Math.min(Math.max(1,cursorCol),Math.max(1,width-menuWidth+1));
      const below=height-cursorRow-1>=suggestions.length,startRow=below?cursorRow+1:Math.max(2,cursorRow-suggestions.length);
      suggestions.forEach((item,index)=>{
        const marker=index===suggestionChoice?"›":" ",label=`${marker} ${index+1} ${item.word}`.slice(0,menuWidth).padEnd(menuWidth);
        screen+=`${CSI}${startRow+index};${column}H${index===suggestionChoice?theme.selectionStyle:theme.tooltipStyle}${clean(label)}${CSI}0m`;
      });
    }

    if (tooltip && !overwritePanel && !recoveryPanel && !fileBrowser && !helpPanel && !settingsPanel && !runPanel && !prompt) {
      const text = ` ${tooltip.word}: ${tooltip.definition} `.slice(0, Math.max(10, width - 2));
      const row = Math.min(height - 1, Math.max(2, tooltip.y + 1));
      const column = Math.min(Math.max(1, tooltip.x), Math.max(1, width - text.length + 1));
      screen += `${CSI}${row};${column}H${theme.tooltipStyle}${clean(text)}${CSI}0m`;
    }

    if (overwritePanel || recoveryPanel || fileBrowser || helpPanel || settingsPanel || runPanel) {
      screen += `${CSI}?25l`;
    } else if (prompt) {
      const x = Math.min(width, ` ${promptLabel(prompt)} › `.length + prompt.value.length + 1);
      screen += `${CSI}${height};${x}H${CSI}?25h`;
    } else {
      const cursorRow = pos.line - this.topLine + 2;
      const cursorCol = pos.column - this.leftColumn + gutter + 1;
      screen += `${CSI}${cursorRow};${cursorCol}H${busy ? "" : `${CSI}?25h`}`;
    }
    this.output.write(screen);
  }

  reset() {
    this.output.write(`${CSI}0m${CSI}?25h${CSI}2J${CSI}H`);
  }

  resetViewport() { this.topLine = 0; this.leftColumn = 0; }
  viewport() { return { topLine: this.topLine, leftColumn: this.leftColumn }; }
  setViewport(viewport = {}) { this.topLine = viewport.topLine || 0; this.leftColumn = viewport.leftColumn || 0; }
  indexAtScreen(x, y, buffer) {
    const lines = buffer.lines();
    const gutter = Math.max(4, String(lines.length).length + 2);
    if (y < 2 || y >= (this.output.rows || 24) || x <= gutter) return null;
    const line = this.topLine + y - 2;
    if (line < 0 || line >= lines.length) return null;
    const displayColumn = this.leftColumn + x - gutter - 1;
    let display = 0, raw = 0;
    while (raw < lines[line].length && display < displayColumn) {
      display += lines[line][raw] === "\t" ? 4 : 1;
      raw++;
    }
    let lineStart = 0;
    for (let index = 0; index < line; index++) lineStart += lines[index].length + 1;
    return lineStart + Math.min(raw, lines[line].length);
  }
}

function basenamePath(path) { return path?.split(/[\\/]/).pop() || "Untitled"; }

export function formatTabStrip(tabs, activeIndex, width) {
  const labels = tabs.map((tab, index) => {
    const state = `${tab.buffer.dirty ? "*" : ""}${tab.externalChanged ? "!" : ""}${tab.aiRunning ? "↻" : tab.aiQueue?.length ? "…" : ""}`;
    const text = `${index + 1}:${tab.displayName || basenamePath(tab.filePath)}${state}`;
    return index === activeIndex ? `[${text}]` : ` ${text} `;
  });
  const complete = labels.join("│");
  if (complete.length <= width) return complete;

  let start = activeIndex, end = activeIndex;
  const rendered = () => `${start > 0 ? "…│" : ""}${labels.slice(start, end + 1).join("│")}${end < labels.length - 1 ? "│…" : ""}`;
  while (true) {
    const left = start > 0 ? start - 1 : null;
    const right = end < labels.length - 1 ? end + 1 : null;
    const preferLeft = left !== null && (right === null || activeIndex - left <= right - activeIndex);
    const nextStart = preferLeft ? left : start;
    const nextEnd = preferLeft ? end : right;
    if (nextStart === null || nextEnd === null) break;
    const candidate = `${nextStart > 0 ? "…│" : ""}${labels.slice(nextStart, nextEnd + 1).join("│")}${nextEnd < labels.length - 1 ? "│…" : ""}`;
    if (candidate.length > width) break;
    start = nextStart; end = nextEnd;
  }
  const result = rendered();
  return result.length <= width ? result : labels[activeIndex].slice(0, width);
}

const settingDefinitions = [
  { key: "autoIndent", label: "Auto indentation", type: "boolean" },
  { key: "suggestions", label: "Word suggestions", type: "boolean" },
  { key: "watchFiles", label: "Watch external changes", type: "boolean" },
  { key: "regexSearch", label: "Regex search", type: "boolean" },
  { key: "searchAcrossTabs", label: "Search across tabs", type: "boolean" },
  { key: "maxParallelAI", label: "Parallel AI jobs", type: "number" },
  { key: "hoverDocs", label: "Mouse hover documentation", type: "boolean" },
  { key: "knowledgeIndex", label: "Learn completions from files", type: "boolean" },
  { key: "colorScheme", label: "Color scheme", type: "choice", values: colorSchemes.map(scheme=>scheme.name) },
  { key: "tabSize", label: "Indent width", type: "number" }
];

const shortcutRows = [
  "AI",
  "  Ctrl+K              Insert AI-generated code at the cursor",
  "  Ctrl+Shift+K        Ask AI to edit the whole file",
  "  Esc                 Cancel an AI prompt",
  "  command: cancel-ai  Cancel AI work on the active tab",
  "",
  "FILES AND TABS",
  "  Ctrl+S              Save the active file",
  "  Ctrl+N              Create an untitled tab",
  "  Ctrl+O              Browse files and directories",
  "  File browser: m     Create and enter a new folder",
  "  Ctrl+W              Close the active file tab",
  "  Alt+, / Alt+.       Move the active tab left / right",
  "  Alt+Left/Right      Previous / next tab",
  "  Ctrl+PgUp/PgDn      Previous / next tab",
  "  Ctrl+Shift+PgUp/Dn  Move the active tab left / right",
  "  Alt+0..9            Jump to a numbered tab",
  "  Ctrl+Q              Quit; press twice with unsaved tabs",
  "",
  "EDITING",
  "  Ctrl+Z              Undo",
  "  Ctrl+Y              Redo",
  "  Ctrl+L / Alt+L      Delete selection or line / clear file",
  "  Ctrl+A/C/X/V        Select all / copy / cut / paste",
  "  Shift+movement      Select and highlight text",
  "  Tab                 Accept suggestion or indent",
  "  Alt+J / Alt+K       Choose next / previous suggestion",
  "  Ctrl+Space          Explicitly accept a completion",
  "  Shift+Tab           Outdent current line or selection",
  "",
  "NAVIGATION AND SEARCH",
  "  Ctrl+F / F3         Search / next match (supports /regex/flags)",
  "  Ctrl+P              Open command palette",
  "  Ctrl+G              Go to a line",
  "  Ctrl+Up/Down        Jump 10 lines",
  "  Ctrl+Left/Right     Move by word",
  "  Ctrl+Home/End       Start / end of file",
  "  Page Up/Down        Move one screen",
  "",
  "TOOLS",
  "  Ctrl+R              Save and run the active supported source file",
  "  Run output: drag to select; edges auto-scroll; Ctrl+C copies",
  "  Run output: Home/End oldest/newest; only Esc returns to editor",
  "  F2                  Settings",
  "  F8                  Jump through lightweight diagnostics",
  "                      Includes five foreground/background color schemes",
  "  F12                 This shortcut reference"
  ,"",
  "COMMAND PALETTE EXAMPLES",
  "  tab 3 | next-tab | prev-tab | move-tab-left | move-tab-right",
  "  new | browse | open PATH | close | save | run | quit | undo | redo",
  "  index PATH | index-status | clear-index",
  "  python-index MODULE | python-reindex (modules imported in active file)",
  "  find TEXT | word WORD | goto LINE | delete-line | clear",
  "  select-all | copy | cut | paste | indent | outdent",
  "  ai PROMPT | ai-file PROMPT | cancel-ai | settings | shortcuts"
  ,"  left | right | up | down | word-left | word-right | page-up/down",
  "  top | bottom | next-match | diagnostics | complete | suggestion-next/prev",
  "",
  "TERMINAL FONT (handled by your terminal, not CPX)",
  "  Ctrl+Shift+= / -    Increase / decrease font size",
  "  Ctrl+Shift+0        Reset terminal font size"
  ,"",
  "HOVER DOCUMENTATION",
  "  Move the mouse over Python/C/C++ keywords or local functions",
  "  Toggle hover documentation from F2 Settings"
];
