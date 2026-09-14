import { readFile, writeFile, mkdir, stat, readdir } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { TextBuffer } from "./buffer.js";
import { Renderer, wrapOutput } from "./renderer.js";
import { askCodex } from "./ai.js";
import { runSource } from "./runner.js";
import { loadSettings, saveSettings, settingRows } from "./settings.js";
import { definitionForWord, generalWords, languageWords } from "./language.js";
import { extractKnowledge, mergeKnowledge, scanKnowledgePath } from "./indexer.js";
import { inspectPythonModule, pythonImportAliases, pythonMemberSuggestions } from "./python-index.js";
import { Worker } from "node:worker_threads";
import { clearRecoverySession, loadRecoverySession, saveRecoverySession, snapshotSession } from "./session.js";

const keys = {
  "\x1b[A":"up", "\x1b[B":"down", "\x1b[C":"right", "\x1b[D":"left",
  "\x1b[H":"home", "\x1b[F":"end", "\x1bOH":"home", "\x1bOF":"end",
  "\x1b[3~":"delete", "\x1b[5~":"pageup", "\x1b[6~":"pagedown",
  "\x1b[1;5A":"fastup", "\x1b[1;5B":"fastdown", "\x1b[1;3A":"fastup", "\x1b[1;3B":"fastdown",
  "\x1b[1;5C":"wordright", "\x1b[1;5D":"wordleft", "\x1b[1;5H":"filestart", "\x1b[1;5F":"fileend",
  "\x1b[1;5~":"filestart", "\x1b[4;5~":"fileend",
  "\x1b[1;2A":"selectup", "\x1b[1;2B":"selectdown", "\x1b[1;2C":"selectright", "\x1b[1;2D":"selectleft",
  "\x1b[1;2H":"selecthome", "\x1b[1;2F":"selectend",
  "\x1b[1;6C":"selectwordright", "\x1b[1;6D":"selectwordleft",
  "\x1b[1;6H":"selectfilestart", "\x1b[1;6F":"selectfileend"
};

export function parseSearchPattern(value, regexEnabled = true) {
  if (regexEnabled && value.startsWith("/") && value.lastIndexOf("/") > 0) {
    const slash = value.lastIndexOf("/");
    let flags = value.slice(slash + 1);
    if (!flags.includes("g")) flags += "g";
    return { source: value.slice(1, slash), flags, mode: "regex" };
  }
  const exact = value.startsWith("=");
  const text = exact ? value.slice(1) : value;
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return { source: exact ? `\\b${escaped}\\b` : escaped, flags: "gi", mode: exact ? "word" : "contains" };
}

export function locateAnchor(text, before, after, fallback = 0) {
  const needle = before + after;
  if (needle) {
    const first = text.indexOf(needle);
    if (first >= 0 && text.indexOf(needle, first + 1) < 0) return first + before.length;
  }
  if (before) {
    const index = text.lastIndexOf(before);
    if (index >= 0 && (!after || text.slice(index + before.length).startsWith(after))) return index + before.length;
  }
  return Math.min(fallback, text.length);
}

export class EditorApp {
  constructor(filePaths, { input = process.stdin, output = process.stdout } = {}) {
    this.initialFilePaths = (Array.isArray(filePaths) ? filePaths : [filePaths]).map(path => resolve(path));
    this.projectRoot = process.cwd(); this.input = input; this.output = output;
    this.renderer = new Renderer(output); this.tabs = []; this.activeTabIndex = 0;
    this.status = ""; this.prompt = null; this.busy = ""; this.abortController = null;
    this.runPanel = null; this.settingsPanel = null; this.helpPanel = false; this.closed = false; this.clipboard = "";
    this.lastSearch = null; this.settings = null; this.watchTimer = null; this.pendingCloseIndex = null;
    this.activeAIJobs = 0; this.nextAIJobId = 1; this.tooltip = null; this.fileBrowser = null; this.untitledCount = 0;
    this.suggestionChoice = 0; this.suggestionSignature = "";
    this.diagnosticIndex = -1;
    this.recoveryPanel=null;this.overwritePanel=null;this.recoveryReady=false;this.recoveryTimer=null;this.recoveryWritePromise=null;
  }
  get activeTab() { return this.tabs[this.activeTabIndex]; }
  get buffer() { return this.activeTab.buffer; }
  get filePath() { return this.activeTab.filePath; }
  get suggestions() { return this.getSuggestions(); }
  get suggestion() { const list=this.getSuggestions();return list[this.suggestionChoice%Math.max(1,list.length)]||null; }
  get diagnostics() {
    if(this.recoveryPanel)return [];
    const tab=this.activeTab;if(!tab)return [];
    if(tab.diagnosticText!==tab.buffer.text&&tab.diagnosticPendingText!==tab.buffer.text)this.scheduleDiagnostics(tab,tab.buffer.text);
    return tab.diagnostics||[];
  }
  scheduleDiagnostics(tab,text) {
    clearTimeout(tab.diagnosticTimer);tab.diagnosticWorker?.terminate();tab.diagnosticWorker=null;tab.diagnosticPendingText=text;
    tab.diagnosticTimer=setTimeout(()=>{
      if(this.closed||tab.buffer.text!==text)return;
      const worker=new Worker(new URL("./diagnostic-worker.js",import.meta.url),{workerData:{text}});tab.diagnosticWorker=worker;worker.unref();
      worker.once("message",items=>{if(tab.buffer.text===text){tab.diagnosticText=text;tab.diagnostics=items;}if(tab.diagnosticWorker===worker)tab.diagnosticWorker=null;this.render();});
      worker.once("error",()=>{if(tab.diagnosticWorker===worker)tab.diagnosticWorker=null;});
    },300);tab.diagnosticTimer.unref?.();
  }

  async start() {
    this.settings = await loadSettings();
    const recovery=await loadRecoverySession();
    for (const path of this.initialFilePaths) await this.openFile(path, false);
    if (!this.input.isTTY || !this.output.isTTY) throw new Error("CPX needs an interactive terminal");
    this.input.setRawMode(true); this.input.setEncoding("utf8"); this.input.resume();
    this.input.on("data", chunk => this.handleInput(chunk)); this.output.on("resize", () => this.render());
    process.on("SIGINT", this.onSignal); process.on("SIGTERM", this.onSignal);
    this.output.write("\x1b[?1049h\x1b[?2004h\x1b[?1003h\x1b[?1006h");
    if (!this.tabs.length) this.newUntitled(false);
    if(recovery)this.recoveryPanel={session:recovery,selected:0};else this.recoveryReady=true;
    this.watchTimer = setInterval(() => void this.checkExternalChanges(), 1000); this.watchTimer.unref?.();
    this.render();
  }

  async openFile(path, announce = true) {
    const filePath = resolve(path), existing = this.tabs.findIndex(tab => tab.filePath === filePath);
    if (existing >= 0) { this.saveActiveViewport(); this.activeTabIndex = existing; this.restoreActiveViewport(); this.status = `Switched to ${basename(filePath)}`; return; }
    let text = "", mtimeMs = null, isNew = false;
    try { const [contents, info] = await Promise.all([readFile(filePath, "utf8"), stat(filePath)]); text = contents; mtimeMs = info.mtimeMs; }
    catch (error) { if (error.code !== "ENOENT") throw error; isNew = true; }
    this.saveActiveViewport();
    this.tabs.push({ filePath, buffer: new TextBuffer(text), mtimeMs, ignoreExternalUntil: 0, externalChanged: false, viewport: { topLine: 0, leftColumn: 0 }, aiQueue: [], aiRunning: false, aiController: null, aiStatus: "" });
    this.activeTabIndex = this.tabs.length - 1; this.learnText(text); this.restoreActiveViewport();
    if (announce || isNew) this.status = isNew ? `New tab: ${basename(filePath)}` : `Opened ${basename(filePath)}`;
  }

  newUntitled(renderNow = true) {
    this.saveActiveViewport(); const displayName=`Untitled ${++this.untitledCount}`;
    this.tabs.push({filePath:null,displayName,buffer:new TextBuffer(""),mtimeMs:null,ignoreExternalUntil:0,externalChanged:false,viewport:{topLine:0,leftColumn:0},aiQueue:[],aiRunning:false,aiController:null,aiStatus:""});
    this.activeTabIndex=this.tabs.length-1;this.restoreActiveViewport();this.status=`Created ${displayName}`;if(renderNow)this.render();
  }

  tabName(tab=this.activeTab) { return tab?.filePath ? basename(tab.filePath) : tab?.displayName || "Untitled"; }

  onSignal = () => { if (this.runPanel?.running) this.abortController?.abort(); else this.close(); };
  render() { this.renderer.draw(this);this.scheduleRecoverySave(); }

  handleInput(chunk) {
    if (this.closed) return;
    if (this.handleMouse(chunk)) return;
    this.tooltip = null;
    if(this.recoveryPanel)return this.handleRecoveryPanel(chunk);
    if(this.overwritePanel)return this.handleOverwritePanel(chunk);
    if (this.runPanel) return this.handleRunPanel(chunk);
    if (this.fileBrowser) return this.handleFileBrowser(chunk);
    if (this.helpPanel) {
      if (["\x1b", "q", "\x1b[24~"].includes(chunk)) { this.helpPanel = false; this.status = "Closed shortcuts"; }
      else if (chunk === "\x1b[A") this.helpPanel.offset = Math.max(0, this.helpPanel.offset - 1);
      else if (chunk === "\x1b[B") this.helpPanel.offset = Math.min(60, this.helpPanel.offset + 1);
      else if (chunk === "\x1b[5~") this.helpPanel.offset = Math.max(0, this.helpPanel.offset - 10);
      else if (chunk === "\x1b[6~") this.helpPanel.offset = Math.min(60, this.helpPanel.offset + 10);
      this.render(); return;
    }
    if (this.settingsPanel) return this.handleSettingsPanel(chunk);
    if (this.prompt) return this.handlePrompt(chunk);
    if (chunk === "\x11") return this.tryQuit();
    if (chunk === "\x13") return void this.save();
    if (chunk === "\x12") return void this.runProgram();
    if (chunk === "\x03") return this.copySelection();
    if (chunk === "\x18") return this.cutSelection();
    if (chunk === "\x16") return this.pasteClipboard();
    if (chunk === "\x01") { this.buffer.selectAll(); this.status = "Selected all"; return this.render(); }
    if (chunk === "\x00") return this.acceptSuggestionOrIndent(true);
    if (chunk === "\x1bj") return this.cycleSuggestion(1);
    if (chunk === "\x1bk") return this.cycleSuggestion(-1);
    if (chunk === "\x06") return this.openPrompt("search", this.lastSearch?.value || "");
    if (chunk === "\x10") return this.openPrompt("command");
    if (chunk === "\x07") return this.openPrompt("goto");
    if (chunk === "\x0f") return void this.openFileBrowser();
    if (chunk === "\x0e") return this.newUntitled();
    if (chunk === "\x17") return this.closeTab();
    if (chunk === "\x0c") { const selected=this.buffer.hasSelection();selected?this.buffer.deleteSelection():this.buffer.deleteLine();this.status = `${selected?"Deleted selection":"Deleted line"} — Ctrl+Z to undo`; return this.render(); }
    if (chunk === "\x1bl" || chunk === "\x1bL") { this.buffer.clear(); this.status = "Cleared file — Ctrl+Z to undo"; return this.render(); }
    if (chunk === "\x0b") return this.openPrompt("ai", "", false);
    if (chunk === "\x1b[107;6u" || chunk === "\x1b\x0b") return this.openPrompt("ai", "", true);
    if (["\x1bOQ", "\x1b[12~"].includes(chunk)) { this.settingsPanel = { selected: 0 }; return this.render(); }
    if (["\x1b[19~"].includes(chunk)) return this.showNextDiagnostic();
    if (chunk === "\x1b[24~") { this.helpPanel = { offset: 0 }; return this.render(); }
    if (["\x1bOR", "\x1b[13~"].includes(chunk)) return this.findNext();
    if (["\x1b[1;5I", "\x1b[27;5;9~"].includes(chunk)) return this.switchTab(1);
    if (["\x1b[1;6Z", "\x1b[27;6;9~"].includes(chunk)) return this.switchTab(-1);
    if (chunk === "\x1b[5;5~") return this.switchTab(-1);
    if (chunk === "\x1b[6;5~") return this.switchTab(1);
    if (chunk === "\x1b[5;6~") return this.reorderTab(-1);
    if (chunk === "\x1b[6;6~") return this.reorderTab(1);
    if (chunk === "\x1b[1;3D") return this.switchTab(-1);
    if (chunk === "\x1b[1;3C") return this.switchTab(1);
    if (/^\x1b[0-9]$/.test(chunk)) return this.switchToTab(chunk[1] === "0" ? 9 : Number(chunk[1]) - 1);
    if (chunk === "\x1b,") return this.reorderTab(-1);
    if (chunk === "\x1b.") return this.reorderTab(1);
    if (chunk === "\x1a") { this.buffer.undo(); this.status = "Undid last edit"; return this.render(); }
    if (chunk === "\x19") { this.status=this.buffer.redo()?"Redid last edit":"Nothing to redo";return this.render(); }
    if (chunk === "\x1b[Z") { this.buffer.outdentLines(this.settings.tabSize); this.status = "Outdented"; return this.render(); }
    this.status = "";
    if (chunk === "\t") return this.acceptSuggestionOrIndent();
    if (chunk === "\x7f" || chunk === "\b") this.buffer.backspace();
    else if (chunk === "\r" || chunk === "\n") this.settings.autoIndent ? this.buffer.newlineWithIndent(this.settings.tabSize) : this.buffer.insert("\n");
    else if (keys[chunk]) this.handleKey(keys[chunk]);
    else if (chunk.startsWith("\x1b[200~") && chunk.endsWith("\x1b[201~")) this.buffer.insert(chunk.slice(6, -6).replace(/\r\n?/g, "\n"));
    else if (!chunk.includes("\x1b") && !/[\x00-\x08\x0b-\x1f\x7f]/.test(chunk.replace(/[\n\r\t]/g, ""))) this.buffer.insert(chunk.replace(/\r\n?/g, "\n"));
    this.render();
  }

  handleKey(key) {
    const selecting = key.startsWith("select"); selecting ? this.buffer.startSelection() : this.buffer.clearSelection();
    const move = selecting ? key.slice(6) : key;
    if (move === "left") this.buffer.moveLeft(); else if (move === "right") this.buffer.moveRight();
    else if (move === "up") this.buffer.moveVertical(-1); else if (move === "down") this.buffer.moveVertical(1);
    else if (move === "home") this.buffer.moveHome(); else if (move === "end") this.buffer.moveEnd();
    else if (key === "delete") this.buffer.deleteForward();
    else if (key === "pageup") this.buffer.moveVertical(-(this.output.rows - 3)); else if (key === "pagedown") this.buffer.moveVertical(this.output.rows - 3);
    else if (key === "fastup") this.buffer.moveVertical(-10); else if (key === "fastdown") this.buffer.moveVertical(10);
    else if (move === "wordleft") this.buffer.moveWordLeft(); else if (move === "wordright") this.buffer.moveWordRight();
    else if (move === "filestart") this.buffer.moveFileStart(); else if (move === "fileend") this.buffer.moveFileEnd();
  }

  handleMouse(chunk) {
    const match = chunk.match(/^\x1b\[<(\d+);(\d+);(\d+)([mM])$/);
    if (!match) return false;
    if (this.runPanel) return this.handleRunMouse(match);
    if (!this.settings?.hoverDocs) return false;
    const code=Number(match[1]), x=Number(match[2]), y=Number(match[3]);
    if ((code & 32) === 0) return true;
    const index=this.renderer.indexAtScreen?.(x,y,this.buffer);
    if (index === null || index === undefined) { if(this.tooltip){this.tooltip=null;this.render();} return true; }
    const left=this.buffer.text.slice(0,index+1).match(/[A-Za-z_][A-Za-z0-9_]*$/)?.[0]||"";
    const start=index+1-left.length;
    const right=this.buffer.text.slice(index+1).match(/^[A-Za-z0-9_]*/)?.[0]||"";
    const word=left+right, definition=word&&definitionForWord(this.filePath || "",word,this.buffer.text);
    const next=definition?{word,definition,x,y}:null;
    if(JSON.stringify(next)!==JSON.stringify(this.tooltip)){this.tooltip=next;this.render();}
    return true;
  }

  runOutputLayout() {
    const width=Math.max(30,this.output.columns||80),editorRows=Math.max(6,(this.output.rows||24)-2);
    const lines=wrapOutput(this.runPanel.output,width),maxOffset=Math.max(0,lines.length-editorRows);
    this.runPanel.scrollOffset=Math.min(maxOffset,Math.max(0,this.runPanel.scrollOffset||0));
    const end=lines.length-this.runPanel.scrollOffset,start=Math.max(0,end-editorRows);
    return {width,editorRows,lines,start,end,text:lines.join("\n")};
  }

  runOutputIndex(x,y) {
    const layout=this.runOutputLayout(),lineIndex=layout.start+y-2;
    if(y<2||y>=2+layout.editorRows||lineIndex<layout.start||lineIndex>=layout.end)return null;
    let index=0;for(let line=0;line<lineIndex;line++)index+=layout.lines[line].length+1;
    return index+Math.min(Math.max(0,x-1),layout.lines[lineIndex].length);
  }

  handleRunMouse(match) {
    const code=Number(match[1]),x=Number(match[2]),y=Number(match[3]),event=match[4];
    if(code===64){this.runPanel.scrollOffset+=3;this.render();return true;}
    if(code===65){this.runPanel.scrollOffset=Math.max(0,this.runPanel.scrollOffset-3);this.render();return true;}
    const dragging=(code&32)&&this.runPanel.mouseSelecting;
    const firstRow=2,lastRow=Math.max(firstRow,(this.output.rows||24)-1);
    let selectionY=y;
    if(dragging&&y<=firstRow){this.runPanel.scrollOffset+=1;selectionY=firstRow;}
    else if(dragging&&y>=lastRow){this.runPanel.scrollOffset=Math.max(0,this.runPanel.scrollOffset-1);selectionY=lastRow;}
    const index=this.runOutputIndex(x,selectionY);
    if(index===null)return true;
    if(code===0&&event==="M"){this.runPanel.selectionAnchor=index;this.runPanel.selectionCursor=index;this.runPanel.mouseSelecting=true;}
    else if(dragging)this.runPanel.selectionCursor=index;
    else if(event==="m"||code===3){this.runPanel.selectionCursor=index;this.runPanel.mouseSelecting=false;}
    this.render();return true;
  }

  copyRunSelection() {
    const panel=this.runPanel,a=panel.selectionAnchor,c=panel.selectionCursor;
    if(a===null||a===undefined||c===null||c===undefined||a===c)return false;
    const text=this.runOutputLayout().text.slice(Math.min(a,c),Math.max(a,c));
    this.clipboard=text;this.output.write(`\x1b]52;c;${Buffer.from(text).toString("base64")}\x07`);
    panel.notice=`Copied ${text.length} output character${text.length===1?"":"s"}`;this.render();return true;
  }

  handleRunPanel(chunk) {
    if (chunk === "\x03" && this.copyRunSelection()) return;
    if (chunk === "\x1b[A") { this.runPanel.scrollOffset += 1; return this.render(); }
    if (chunk === "\x1b[B") { this.runPanel.scrollOffset = Math.max(0, this.runPanel.scrollOffset - 1); return this.render(); }
    if (chunk === "\x1b[5~") { this.runPanel.scrollOffset += Math.max(1, this.output.rows - 4); return this.render(); }
    if (chunk === "\x1b[6~") { this.runPanel.scrollOffset = Math.max(0, this.runPanel.scrollOffset - Math.max(1, this.output.rows - 4)); return this.render(); }
    if (chunk === "\x1b[H" || chunk === "\x1bOH") { this.runPanel.scrollOffset = Number.MAX_SAFE_INTEGER; return this.render(); }
    if (chunk === "\x1b[F" || chunk === "\x1bOF") { this.runPanel.scrollOffset = 0; return this.render(); }
    if (this.runPanel.running) { if (chunk === "\x1b" || chunk === "\x03") { this.abortController?.abort(); this.runPanel.status = "Stopping…"; this.render(); } }
    else if (chunk === "\x1b") { this.runPanel = null; this.status = "Returned from program"; this.render(); }
  }

  handleRecoveryPanel(chunk){
    if(chunk==="\x1b[A"||chunk==="\x1b[D"||chunk.toLowerCase()==="r")this.recoveryPanel.selected=0;
    else if(chunk==="\x1b[B"||chunk==="\x1b[C"||chunk.toLowerCase()==="n")this.recoveryPanel.selected=1;
    if(chunk==="\r"||chunk==="\n"||chunk.toLowerCase()==="r"||chunk.toLowerCase()==="n"){
      const resume=this.recoveryPanel.selected===0,session=this.recoveryPanel.session;this.recoveryPanel=null;
      if(resume)this.restoreRecoverySession(session);else{this.recoveryReady=false;void clearRecoverySession().finally(()=>{this.recoveryReady=true;this.scheduleRecoverySave();});this.status="Started a new session";}
    }
    this.render();
  }

  restoreRecoverySession(session){
    for(const tab of this.tabs){clearTimeout(tab.diagnosticTimer);tab.diagnosticWorker?.terminate();}
    this.tabs=[];
    for(const saved of session.tabs){const buffer=new TextBuffer(saved.text||"");buffer.savedText=saved.savedText??buffer.text;buffer.dirty=buffer.text!==buffer.savedText;buffer.cursor=Math.min(saved.cursor||0,buffer.text.length);buffer.selectionAnchor=saved.selectionAnchor??null;
      this.tabs.push({filePath:saved.filePath||null,displayName:saved.displayName||null,buffer,mtimeMs:saved.mtimeMs??null,ignoreExternalUntil:0,externalChanged:false,viewport:saved.viewport||{topLine:0,leftColumn:0},aiQueue:[],aiRunning:false,aiController:null,aiStatus:""});}
    this.activeTabIndex=Math.max(0,Math.min(session.activeTabIndex||0,this.tabs.length-1));this.untitledCount=this.tabs.filter(tab=>!tab.filePath).length;this.restoreActiveViewport();this.recoveryReady=true;this.status=`Resumed ${this.tabs.length} recovered tab${this.tabs.length===1?"":"s"}`;
  }

  scheduleRecoverySave(){
    if(!this.recoveryReady||this.closed||this.recoveryTimer||this.recoveryWritePromise||!this.tabs.length)return;
    this.recoveryTimer=setTimeout(()=>{this.recoveryTimer=null;if(this.closed)return;this.saveActiveViewport();const session=snapshotSession(this.tabs,this.activeTabIndex);this.recoveryWritePromise=saveRecoverySession(session).catch(()=>{}).finally(()=>{this.recoveryWritePromise=null;});},500);
    this.recoveryTimer.unref?.();
  }

  async openFileBrowser(cwd = this.filePath ? dirname(this.filePath) : this.projectRoot) {
    this.fileBrowser={mode:"open",cwd,entries:[],selected:0,showHidden:false,error:""};
    await this.refreshFileBrowser();this.render();
  }

  async openSaveBrowser(cwd = this.filePath ? dirname(this.filePath) : this.projectRoot) {
    this.fileBrowser={mode:"save",cwd,entries:[],selected:0,showHidden:false,error:""};
    await this.refreshFileBrowser();this.render();
  }

  async refreshFileBrowser() {
    try {
      const items=await readdir(this.fileBrowser.cwd,{withFileTypes:true});
      this.fileBrowser.entries=items.filter(item=>this.fileBrowser.showHidden||!item.name.startsWith("."))
        .sort((a,b)=>Number(b.isDirectory())-Number(a.isDirectory())||a.name.localeCompare(b.name));
      const max=this.fileBrowser.mode==="save"?this.fileBrowser.entries.length:Math.max(0,this.fileBrowser.entries.length-1);
      this.fileBrowser.selected=Math.min(this.fileBrowser.selected,max);this.fileBrowser.error="";
    } catch(error){this.fileBrowser.entries=[];this.fileBrowser.error=error.message;}
  }

  handleFileBrowser(chunk) {
    const browser=this.fileBrowser;
    if(chunk==="\x1b"||chunk==="q"){this.fileBrowser=null;this.status="File browser closed";return this.render();}
    if(chunk==="\x1b[A")browser.selected=Math.max(0,browser.selected-1);
    else if(chunk==="\x1b[B")browser.selected=Math.min(browser.mode==="save"?browser.entries.length:Math.max(0,browser.entries.length-1),browser.selected+1);
    else if(chunk==="\x1b[5~")browser.selected=Math.max(0,browser.selected-10);
    else if(chunk==="\x1b[6~")browser.selected=Math.min(browser.mode==="save"?browser.entries.length:Math.max(0,browser.entries.length-1),browser.selected+10);
    else if(chunk==="."){browser.showHidden=!browser.showHidden;void this.refreshFileBrowser().then(()=>this.render());return;}
    else if(chunk==="\x7f"||chunk==="\b"){browser.cwd=dirname(browser.cwd);browser.selected=0;void this.refreshFileBrowser().then(()=>this.render());return;}
    else if(chunk==="n"&&browser.mode==="open"){this.fileBrowser=null;return this.newUntitled();}
    else if(chunk.toLowerCase()==="m"){this.fileBrowser=null;this.prompt={kind:"mkdir",value:"",directory:browser.cwd,browserMode:browser.mode};return this.render();}
    else if(chunk==="\r"||chunk==="\n"){
      if(browser.mode==="save"&&browser.selected===0){const directory=browser.cwd;this.fileBrowser=null;this.prompt={kind:"saveas",value:"",directory};return this.render();}
      const item=browser.entries[browser.selected-(browser.mode==="save"?1:0)];if(!item)return;
      const target=resolve(browser.cwd,item.name);
      if(item.isDirectory()){browser.cwd=target;browser.selected=0;void this.refreshFileBrowser().then(()=>this.render());}
      else if(browser.mode==="save"){const directory=browser.cwd;this.fileBrowser=null;this.prompt={kind:"saveas",value:item.name,directory};this.render();}
      else{this.fileBrowser=null;void this.openFile(target).then(()=>this.render()).catch(error=>{this.status=error.message;this.render();});}
      return;
    }
    this.render();
  }

  copySelection() {
    const value = this.buffer.selectedText();
    if (!value) this.status = "Nothing selected";
    else { this.clipboard = value; this.output.write(`\x1b]52;c;${Buffer.from(value).toString("base64")}\x07`); this.status = `Copied ${value.length} characters`; }
    this.render();
  }
  cutSelection() { const value = this.buffer.selectedText(); if (!value) this.status = "Nothing selected"; else { this.clipboard = value; this.buffer.deleteSelection(); this.status = `Cut ${value.length} characters`; } this.render(); }
  pasteClipboard() { if (!this.clipboard) this.status = "CPX clipboard empty; use the terminal paste shortcut for external text"; else { this.buffer.insert(this.clipboard); this.status = `Pasted ${this.clipboard.length} characters`; } this.render(); }

  openPrompt(kind, value = "", forceFile = false) { this.prompt = { kind, value, forceFile }; this.render(); }
  handlePrompt(chunk) {
    if (chunk === "\x1b") { this.prompt = null; this.status = "Prompt cancelled"; return this.render(); }
    if (chunk === "\x7f" || chunk === "\b") this.prompt.value = this.prompt.value.slice(0, -1);
    else if (chunk === "\r" || chunk === "\n") {
      const request = this.prompt;
      if (request.kind === "goto") { this.prompt = null; const line = parseInt(request.value, 10); if (line > 0) { this.buffer.goToLine(line); this.status = `Jumped to line ${this.buffer.position().line + 1}`; } else this.status = "Line number must be positive"; this.render(); }
      else if (request.kind === "search") { this.prompt = null; this.search(request.value); }
      else if (request.kind === "command") { this.prompt = null; this.executeCommand(request.value); }
      else if (request.kind === "open") { this.prompt = null; if (request.value.trim()) void this.openFile(resolve(this.projectRoot, request.value.trim())).then(() => this.render()).catch(e => { this.status = e.message; this.render(); }); }
      else if (request.kind === "saveas") {
        this.prompt = null;
        if (!request.value.trim()) { this.status = "Save cancelled"; this.render(); }
        else void this.finishSaveAs(request.directory || this.projectRoot,request.value.trim());
      }
      else if(request.kind==="mkdir"){this.prompt=null;if(!request.value.trim()){this.status="Folder creation cancelled";this.render();}else void this.createFolder(request);}
      else if (request.value.trim()) void this.runAI();
      return;
    } else if (this.prompt.kind === "goto" && /^\d+$/.test(chunk)) this.prompt.value += chunk;
    else if (this.prompt.kind !== "goto" && !chunk.includes("\x1b") && !/[\x00-\x08\x0b-\x1f\x7f]/.test(chunk)) this.prompt.value += chunk.replace(/[\r\n]/g, " ");
    this.render();
  }

  search(value) {
    if (!value) { this.status = "Search is empty"; return this.render(); }
    try {
      this.lastSearch = { value, ...parseSearchPattern(value, this.settings.regexSearch) }; this.findNext();
    } catch (error) { this.status = `Invalid pattern: ${error.message}`; this.render(); }
  }
  findNext() {
    if (!this.lastSearch) return this.openPrompt("search");
    const active = this.activeTabIndex;
    const indices = this.settings.searchAcrossTabs
      ? Array.from({ length: this.tabs.length }, (_, offset) => (active + offset) % this.tabs.length)
      : [active];
    let found = null;
    for (const index of indices) {
      const tab = this.tabs[index], regex = new RegExp(this.lastSearch.source, this.lastSearch.flags);
      regex.lastIndex = index === active ? (tab.buffer.selectionRange()?.end ?? tab.buffer.cursor) : 0;
      const match = regex.exec(tab.buffer.text);
      if (match) { found = { index, match, wrapped: index < active }; break; }
    }
    if (!found) {
      const regex = new RegExp(this.lastSearch.source, this.lastSearch.flags); regex.lastIndex = 0;
      const match = regex.exec(this.tabs[active].buffer.text);
      if (match && match.index < (this.tabs[active].buffer.selectionRange()?.end ?? this.tabs[active].buffer.cursor)) found = { index: active, match, wrapped: true };
    }
    if (!found) this.status = `No ${this.lastSearch.mode} match for ${this.lastSearch.value}`;
    else {
      if (found.index !== active) { this.saveActiveViewport(); this.activeTabIndex = found.index; this.restoreActiveViewport(); }
      this.buffer.selectionAnchor = found.match.index; this.buffer.cursor = found.match.index + Math.max(1, found.match[0].length);
      this.status = `${found.wrapped ? "Wrapped — " : ""}${this.lastSearch.mode} match in ${this.tabName()} at line ${this.buffer.position().line + 1}; F3 next`;
    }
    this.render();
  }

  executeCommand(input) {
    const trimmed = input.trim(), space = trimmed.indexOf(" ");
    const command = (space < 0 ? trimmed : trimmed.slice(0, space)).toLowerCase();
    const argument = space < 0 ? "" : trimmed.slice(space + 1).trim();
    const movement = name => { this.buffer.clearSelection(); this.buffer[name](); this.status = command; this.render(); };
    if (!command || ["help", "commands", "shortcuts"].includes(command)) { this.helpPanel = { offset: 0 }; return this.render(); }
    if (["new", "new-tab"].includes(command)) return this.newUntitled();
    if (["browse", "file-browser"].includes(command)) return void this.openFileBrowser();
    if (command === "save") return void this.save();
    if (command === "run") return void this.runProgram();
    if (command === "quit") return this.tryQuit();
    if (command === "undo") { this.buffer.undo(); this.status = "Undid last edit"; return this.render(); }
    if (command === "redo") { this.status=this.buffer.redo()?"Redid last edit":"Nothing to redo";return this.render(); }
    if (command === "open" && argument) return void this.openFile(resolve(this.projectRoot, argument)).then(() => this.render()).catch(e => { this.status=e.message; this.render(); });
    if (command === "close") return this.closeTab();
    if (command === "tab") return this.switchToTab(Number(argument) - 1);
    if (command === "next-tab") return this.switchTab(1);
    if (command === "prev-tab") return this.switchTab(-1);
    if (command === "move-tab-left") return this.reorderTab(-1);
    if (command === "move-tab-right") return this.reorderTab(1);
    if (command === "find" && argument) return this.search(argument);
    if (["index","index-file","index-dir"].includes(command) && argument) return void this.indexPath(argument);
    if (command === "python-index" && argument) return void this.indexPythonModules([argument]);
    if (command === "python-reindex") return void this.indexPythonModules(Object.values(pythonImportAliases(this.buffer.text)));
    if (command === "index-status") { const words=Object.keys(this.settings.learnedWords||{}).length,phrases=Object.keys(this.settings.learnedPhrases||{}).length;this.status=`Knowledge index: ${words} words, ${phrases} phrases`;return this.render(); }
    if (command === "clear-index") { this.settings.learnedWords={};this.settings.learnedPhrases={};void saveSettings(this.settings);this.status="Cleared completion knowledge index";return this.render(); }
    if (command === "word" && argument) return this.search(`=${argument}`);
    if (command === "next-match") return this.findNext();
    if (command === "diagnostics") return this.showNextDiagnostic();
    if (command === "goto") { this.buffer.goToLine(Number(argument)); this.status=`Jumped to line ${this.buffer.position().line+1}`; return this.render(); }
    if (command === "delete-line") { this.buffer.deleteLine(); this.status="Deleted line"; return this.render(); }
    if (command === "clear") { this.buffer.clear(); this.status="Cleared file — Ctrl+Z to undo"; return this.render(); }
    if (command === "select-all") { this.buffer.selectAll(); this.status="Selected all"; return this.render(); }
    if (command === "copy") return this.copySelection();
    if (command === "cut") return this.cutSelection();
    if (command === "paste") return this.pasteClipboard();
    if (command === "indent") { this.buffer.indentLines(this.settings.tabSize); this.status="Indented"; return this.render(); }
    if (command === "outdent") { this.buffer.outdentLines(this.settings.tabSize); this.status="Outdented"; return this.render(); }
    if (command === "complete") return this.acceptSuggestionOrIndent();
    if (command === "suggestion-next") return this.cycleSuggestion(1);
    if (command === "suggestion-prev") return this.cycleSuggestion(-1);
    if (command === "left") return movement("moveLeft");
    if (command === "right") return movement("moveRight");
    if (command === "up") { this.buffer.moveVertical(-1); this.status="up"; return this.render(); }
    if (command === "down") { this.buffer.moveVertical(1); this.status="down"; return this.render(); }
    if (command === "word-left") return movement("moveWordLeft");
    if (command === "word-right") return movement("moveWordRight");
    if (command === "page-up") { this.buffer.moveVertical(-(this.output.rows-3)); this.status="page-up"; return this.render(); }
    if (command === "page-down") { this.buffer.moveVertical(this.output.rows-3); this.status="page-down"; return this.render(); }
    if (command === "settings") { this.settingsPanel={selected:0}; return this.render(); }
    if ((command === "ai" || command === "ai-file") && argument) { this.prompt={kind:"ai",value:argument,forceFile:command==="ai-file"}; return void this.runAI(); }
    if (command === "cancel-ai") return this.cancelAI();
    if (command === "top") return movement("moveFileStart");
    if (command === "bottom") return movement("moveFileEnd");
    this.status = `Unknown or incomplete command: ${trimmed}`; this.render();
  }

  learnText(text) { if (!this.settings?.knowledgeIndex) return; mergeKnowledge(this.settings,extractKnowledge(text)); }
  async indexPath(path) {
    const target=resolve(this.projectRoot,path);this.status=`Indexing ${path}…`;this.render();
    try{
      const result=await scanKnowledgePath(target,{onFile:(_file,progress)=>{if(progress.files%25===0){this.status=`Indexing… ${progress.files} files`;this.render();}}});
      mergeKnowledge(this.settings,result);await saveSettings(this.settings);
      this.status=`Indexed ${result.files} files: ${Object.keys(result.words).length} words, ${Object.keys(result.phrases).length} phrases`;
    }catch(error){this.status=`Index failed: ${error.message}`;}
    this.render();
  }
  async indexPythonModules(modules) {
    const unique=[...new Set(modules)].slice(0,50);if(!unique.length){this.status="No imported Python modules found";return this.render();}
    this.settings.pythonMembers||={};let indexed=0;
    for(const module of unique){this.status=`Indexing Python module ${module}…`;this.render();try{this.settings.pythonMembers[module]=await inspectPythonModule(module);indexed++;}catch(error){this.status=`Python index failed for ${module}: ${error.message}`;this.render();return;}}
    const stored=Object.keys(this.settings.pythonMembers);for(const module of stored.slice(0,Math.max(0,stored.length-50)))delete this.settings.pythonMembers[module];
    await saveSettings(this.settings);this.status=`Indexed ${indexed} Python module${indexed===1?"":"s"}`;this.render();
  }
  getSuggestions() {
    if (!this.settings?.suggestions || !this.activeTab || this.buffer.hasSelection()) return [];
    const before=this.buffer.text.slice(0,this.buffer.cursor),linePrefix=(before.slice(before.lastIndexOf("\n")+1).match(/^\s*(.*)$/)?.[1]||"");
    const candidates=[];
    const memberMatch=before.match(/([A-Za-z_]\w*)\.([A-Za-z_]\w*)?$/);
    if(memberMatch){const members=pythonMemberSuggestions(this.buffer.text,memberMatch[1],memberMatch[2]||"",this.settings.pythonMembers);if(members.length){const signature=`member\0${memberMatch[0]}\0${members.map(item=>item.word).join("\0")}`;if(signature!==this.suggestionSignature){this.suggestionSignature=signature;this.suggestionChoice=0;}return members;}}
    if(linePrefix.length>=2){
      const lowerLine=linePrefix.toLowerCase();
      for(const [phrase,score] of Object.entries(this.settings.learnedPhrases||{}))if(phrase.length>linePrefix.length&&phrase.toLowerCase().startsWith(lowerLine))candidates.push({word:phrase,suffix:phrase.slice(linePrefix.length),phrase:true,score:2000+score});
    }
    const prefix = this.buffer.currentWordPrefix();
    if(prefix.length>=2){
      const lower=prefix.toLowerCase(),addWords=(words,boost)=>{for(const [word,raw] of Object.entries(words))if(word.length>prefix.length&&word.toLowerCase().startsWith(lower))candidates.push({word,suffix:word.slice(prefix.length),score:boost+(typeof raw==="number"?raw:0)});};
      addWords(this.settings.learnedWords||{},1000);addWords(generalWords,3000);addWords(languageWords(this.filePath||""),5000);
    }
    const unique=new Map();
    for(const candidate of candidates){const key=candidate.word.toLowerCase();if(!unique.has(key)||unique.get(key).score<candidate.score)unique.set(key,candidate);}
    const list=[...unique.values()].sort((a,b)=>b.score-a.score||a.word.length-b.word.length||a.word.localeCompare(b.word)).slice(0,5);
    const signature=`${linePrefix}\0${prefix}\0${list.map(item=>item.word).join("\0")}`;
    if(signature!==this.suggestionSignature){this.suggestionSignature=signature;this.suggestionChoice=0;}
    return list;
  }
  cycleSuggestion(delta) { const list=this.getSuggestions();if(!list.length){this.status="No suggestions available";}else{this.suggestionChoice=(this.suggestionChoice+delta+list.length)%list.length;this.status=`Suggestion ${this.suggestionChoice+1}/${list.length}: ${list[this.suggestionChoice].word}`;}this.render(); }
  showNextDiagnostic() { const items=this.diagnostics;if(!items.length){this.status=this.activeTab.diagnosticPendingText!==this.activeTab.diagnosticText?"Diagnostics are updating in the background…":"No lightweight diagnostics";return this.render();}this.diagnosticIndex=(this.diagnosticIndex+1)%items.length;const item=items[this.diagnosticIndex];this.buffer.cursor=this.buffer.indexAt(item.line,item.column);this.buffer.clearSelection();this.status=`Diagnostic ${this.diagnosticIndex+1}/${items.length}: ${item.message}`;this.render(); }
  acceptSuggestionOrIndent(explicit = false) { const suggestion = this.suggestion; if (this.buffer.hasSelection()) { this.buffer.indentLines(this.settings.tabSize); this.status = "Indented selection"; } else if (suggestion) { this.buffer.insert(suggestion.suffix); this.status = `Completed ${suggestion.word}`; } else if(explicit){this.status="No completion available";} else {const column=this.buffer.position().column,count=this.settings.tabSize-(column%this.settings.tabSize);this.buffer.insert(" ".repeat(count));this.status="Indented";} this.render(); }

  handleSettingsPanel(chunk) {
    const panel = this.settingsPanel;
    if (chunk === "\x1b" || chunk === "q") { this.settingsPanel = null; void saveSettings(this.settings); this.status = "Settings saved"; }
    else if (chunk === "\x1b[A") panel.selected = (panel.selected - 1 + settingRows.length) % settingRows.length;
    else if (chunk === "\x1b[B") panel.selected = (panel.selected + 1) % settingRows.length;
    else if ([" ","\r","\n","\x1b[C","\x1b[D","+","-"].includes(chunk)) { const row = settingRows[panel.selected]; if (row.type === "boolean") this.settings[row.key] = !this.settings[row.key]; else { const delta = chunk === "-" || chunk === "\x1b[D" ? -1 : 1; this.settings[row.key] = Math.max(row.min, Math.min(row.max, this.settings[row.key] + delta)); } }
    this.render();
  }

  saveActiveViewport() { if (this.activeTab) this.activeTab.viewport = this.renderer.viewport?.() || { topLine: 0, leftColumn: 0 }; }
  restoreActiveViewport() { this.renderer.setViewport?.(this.activeTab?.viewport); }
  switchTab(delta) { if (this.tabs.length < 2) this.status = "Only one tab is open"; else { this.saveActiveViewport(); this.activeTabIndex = (this.activeTabIndex + delta + this.tabs.length) % this.tabs.length; this.restoreActiveViewport(); this.status = `Tab ${this.activeTabIndex + 1}/${this.tabs.length}: ${this.tabName()}`; } this.render(); }
  switchToTab(index) { if (index < 0 || index >= this.tabs.length) { this.status = `Tab ${index + 1} is not open`; return this.render(); } this.saveActiveViewport(); this.activeTabIndex = index; this.restoreActiveViewport(); this.status = `Tab ${index + 1}/${this.tabs.length}: ${this.tabName()}`; this.render(); }
  reorderTab(delta) { const target = this.activeTabIndex + delta; if (target >= 0 && target < this.tabs.length) { [this.tabs[this.activeTabIndex],this.tabs[target]] = [this.tabs[target],this.tabs[this.activeTabIndex]]; this.activeTabIndex = target; this.status = `Moved tab to position ${target + 1}`; } this.render(); }
  closeTab() { if (this.buffer.dirty && this.pendingCloseIndex !== this.activeTabIndex) { this.pendingCloseIndex = this.activeTabIndex; this.status = "Unsaved tab — Ctrl+W again to discard and close"; return this.render(); } const closing=this.activeTab; closing.aiQueue=[]; closing.aiController?.abort();clearTimeout(closing.diagnosticTimer);closing.diagnosticWorker?.terminate();this.tabs.splice(this.activeTabIndex,1); this.pendingCloseIndex = null; if (!this.tabs.length) return this.close(); this.activeTabIndex = Math.min(this.activeTabIndex,this.tabs.length-1); this.restoreActiveViewport(); this.status = `Closed tab; ${this.tabName()} active`; this.render(); }

  runAI() {
    const request=this.prompt, tab=this.activeTab, cursor=tab.buffer.cursor;
    this.prompt=null;
    tab.aiQueue.push({ id:this.nextAIJobId++, instruction:request.value.trim(), forceFile:request.forceFile, before:tab.buffer.text.slice(Math.max(0,cursor-60),cursor), after:tab.buffer.text.slice(cursor,cursor+60), fallback:cursor });
    tab.aiStatus=`AI job queued (${tab.aiQueue.length})`; this.status=`Queued AI on ${this.tabName(tab)}; keep editing or switch tabs`; this.render(); this.scheduleAI();
  }

  scheduleAI() {
    while (this.activeAIJobs < this.settings.maxParallelAI) {
      const tab=this.tabs.find(item=>!item.aiRunning&&item.aiQueue.length);
      if(!tab) break;
      const job=tab.aiQueue.shift(); tab.aiRunning=true; this.activeAIJobs++; void this.executeAIJob(tab,job);
    }
  }

  async executeAIJob(tab, job) {
    const anchor=locateAnchor(tab.buffer.text,job.before,job.after,job.fallback);
    const source=tab.buffer.text, position=tab.buffer.positionAt(anchor), originalLine=tab.buffer.lines()[position.line]||"";
    const before=source.slice(Math.max(0,anchor-60),anchor), after=source.slice(anchor,anchor+60);
    tab.aiController=new AbortController(); tab.aiStatus=`AI #${job.id} starting…`; this.render();
    try {
      const aiFilePath=tab.filePath || resolve(this.projectRoot, `${tab.displayName || "Untitled"}.txt`);
      const result=await askCodex({instruction:job.instruction,source,filePath:aiFilePath,projectRoot:this.projectRoot,forceFile:job.forceFile,cursor:{offset:anchor,...position},signal:tab.aiController.signal,onStatus:message=>{tab.aiStatus=`AI #${job.id}: ${message}`;this.render();}});
      if(job.forceFile&&tab.buffer.text!==source){tab.aiStatus=`AI #${job.id} skipped: buffer changed during whole-file edit`;}
      else{
        tab.buffer.beginTransaction();
        if(result.mode==="replace_file"){tab.buffer.replaceAll(result.content);const line=tab.buffer.lines().indexOf(originalLine);tab.buffer.cursor=tab.buffer.indexAt(line>=0?line:position.line,position.column);}
        else{const target=locateAnchor(tab.buffer.text,before,after,anchor);tab.buffer.cursor=target;tab.buffer.insert(result.content);}
        tab.buffer.endTransaction();this.learnText(result.content);tab.aiStatus=`AI #${job.id} complete: ${result.summary}`;
      }
    }catch(error){tab.aiStatus=tab.aiController.signal.aborted?`AI #${job.id} cancelled`:`AI #${job.id} failed: ${error.message}`;}
    finally{tab.aiRunning=false;tab.aiController=null;this.activeAIJobs--;if(tab===this.activeTab)this.status=tab.aiStatus;this.render();this.scheduleAI();}
  }

  cancelAI() { const tab=this.activeTab; const queued=tab.aiQueue.length; tab.aiQueue=[]; tab.aiController?.abort(); tab.aiStatus=tab.aiRunning?"Cancelling active AI job…":`Cancelled ${queued} queued AI job${queued===1?"":"s"}`; this.status=tab.aiStatus; this.render(); }

  async save() {
    const tab = this.activeTab;
    if (!tab.filePath) { void this.openSaveBrowser(); return false; }
    try { await mkdir(dirname(tab.filePath),{recursive:true}); tab.ignoreExternalUntil = Date.now()+1500; await writeFile(tab.filePath,tab.buffer.text); tab.buffer.markSaved(); tab.externalChanged=false; tab.mtimeMs=(await stat(tab.filePath)).mtimeMs; this.learnText(tab.buffer.text); void saveSettings(this.settings); this.status="Saved"; this.render(); return true; }
    catch (error) { this.status=`Save failed: ${error.message}`; this.render(); return false; }
  }
  async finishSaveAs(directory,name){
    const target=resolve(directory,name);
    try{const info=await stat(target);if(info.isDirectory()){this.status="That name is an existing directory";return this.render();}this.overwritePanel={target};this.render();}
    catch(error){if(error.code!=="ENOENT"){this.status=`Save check failed: ${error.message}`;return this.render();}this.activeTab.filePath=target;this.activeTab.displayName=null;void this.save();}
  }
  handleOverwritePanel(chunk){
    if(chunk.toLowerCase()==="y"||chunk==="\r"||chunk==="\n"){const target=this.overwritePanel.target;this.overwritePanel=null;this.activeTab.filePath=target;this.activeTab.displayName=null;void this.save();}
    else if(chunk.toLowerCase()==="n"||chunk==="\x1b"){this.overwritePanel=null;this.status="Overwrite cancelled";this.render();}
  }
  async createFolder(request){
    const target=resolve(request.directory,request.value.trim());
    try{await mkdir(target,{recursive:true});this.status=`Created ${target}`;if(request.browserMode==="save")await this.openSaveBrowser(target);else await this.openFileBrowser(target);}
    catch(error){this.status=`Could not create folder: ${error.message}`;this.render();}
  }
  async runProgram() {
    if (!this.filePath) { this.status="Choose a folder and filename before running"; void this.openSaveBrowser(); return; }
    if (this.buffer.dirty && !(await this.save())) return; this.abortController=new AbortController(); this.runPanel={title:`RUN  ${this.filePath}`,output:"",running:true,status:"Starting…",scrollOffset:0,selectionAnchor:null,selectionCursor:null,mouseSelecting:false,notice:""};
    const append=chunk=>{if(this.runPanel){this.runPanel.output=(this.runPanel.output+chunk).slice(-200000);this.render();}}; this.render();
    try { const result=await runSource({filePath:this.filePath,signal:this.abortController.signal,onOutput:append,onStage:stage=>{this.runPanel.status=stage;this.render();}}); this.runPanel.status=result.cancelled?"Stopped":result.compileFailed?`Compilation failed (exit ${result.code})`:`Exited with code ${result.code}`; }
    catch(error){append(`\n${error.message}\n`);this.runPanel.status="Could not run program";} finally{this.runPanel.running=false;this.abortController=null;this.render();}
  }

  async checkExternalChanges() {
    if (!this.settings?.watchFiles || this.closed) return;
    for (const tab of this.tabs) { if (!tab.filePath || Date.now()<tab.ignoreExternalUntil) continue; try { const info=await stat(tab.filePath); if (tab.mtimeMs!==null && info.mtimeMs<=tab.mtimeMs) continue; if(tab.buffer.dirty){tab.externalChanged=true;if(tab===this.activeTab)this.status="File changed on disk; save will overwrite it";}else{const cursor=tab.buffer.cursor;tab.buffer=new TextBuffer(await readFile(tab.filePath,"utf8"));tab.buffer.cursor=Math.min(cursor,tab.buffer.text.length);tab.mtimeMs=info.mtimeMs;if(tab===this.activeTab)this.status="Reloaded external file change";} this.render(); } catch(error){if(error.code!=="ENOENT")this.status=`File watch: ${error.message}`;} }
  }

  tryQuit() { const count=this.tabs.filter(tab=>tab.buffer.dirty).length, warning=`${count} unsaved tab${count===1?"":"s"} — Ctrl+Q again to discard`; if(count&&this.status!==warning){this.status=warning;return this.render();} this.close(); }
  close() { if(this.closed)return; this.closed=true; this.abortController?.abort();clearTimeout(this.recoveryTimer);for(const tab of this.tabs){tab.aiQueue=[];tab.aiController?.abort();clearTimeout(tab.diagnosticTimer);tab.diagnosticWorker?.terminate();} clearInterval(this.watchTimer); void Promise.resolve(this.recoveryWritePromise).finally(()=>clearRecoverySession().catch(()=>{}));void saveSettings(this.settings); this.input.setRawMode?.(false);this.input.pause();this.renderer.reset();this.output.write("\x1b[?1003l\x1b[?1006l\x1b[?2004l\x1b[?1049l");process.off("SIGINT",this.onSignal);process.off("SIGTERM",this.onSignal); }
}
