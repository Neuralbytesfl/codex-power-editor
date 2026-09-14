export class TextBuffer {
  constructor(text = "") {
    this.text = text.replace(/\r\n/g, "\n");
    this.savedText = this.text;
    this.cursor = 0;
    this.preferredColumn = null;
    this.selectionAnchor = null;
    this.history = [];
    this.future = [];
    this.transaction = null;
    this.dirty = false;
    this._cacheText = null;
    this._linesCache = null;
    this._startsCache = null;
  }

  snapshot() {
    return { text: this.text, cursor: this.cursor, selectionAnchor: this.selectionAnchor };
  }

  restore(snapshot) {
    this.text = snapshot.text;
    this.cursor = Math.min(snapshot.cursor, this.text.length);
    this.dirty = this.text !== this.savedText;
    this.selectionAnchor = snapshot.selectionAnchor ?? null;
    this.preferredColumn = null;
    this.invalidateCache();
  }

  invalidateCache() { this._cacheText=null;this._linesCache=null;this._startsCache=null; }
  trimHistory(collection=this.history) { const limit=Math.max(2,Math.min(200,Math.floor(32_000_000/Math.max(1,this.text.length))));while(collection.length>limit)collection.shift(); }
  markSaved() { this.savedText=this.text;this.dirty=false; }

  replaceTextRange(start,end,value) {
    const old=this.text,cacheValid=this._cacheText===old&&this._linesCache&&this._startsCache;
    const removed=old.slice(start,end),next=old.slice(0,start)+value+old.slice(end);this.text=next;
    if(cacheValid&&!removed.includes("\n")&&!value.includes("\n")){
      let low=0,high=this._startsCache.length-1;while(low<=high){const middle=(low+high)>>1;if(this._startsCache[middle]<=start)low=middle+1;else high=middle-1;}
      const line=Math.max(0,high),column=start-this._startsCache[line],delta=value.length-removed.length;
      this._linesCache[line]=this._linesCache[line].slice(0,column)+value+this._linesCache[line].slice(column+removed.length);
      for(let index=line+1;index<this._startsCache.length;index++)this._startsCache[index]+=delta;
      this._cacheText=next;
    }else this.invalidateCache();
    this.dirty=this.text!==this.savedText;
  }

  remember() {
    if (this.transaction) return;
    this.history.push(this.snapshot());
    this.trimHistory();
    this.future=[];
  }

  beginTransaction() {
    if (!this.transaction) this.transaction = this.snapshot();
  }

  endTransaction() {
    if (!this.transaction) return;
    if (this.transaction.text !== this.text) {
      this.history.push(this.transaction);
      this.trimHistory();
      this.future=[];
    }
    this.transaction = null;
  }

  rollbackTransaction() {
    if (!this.transaction) return;
    const snapshot = this.transaction;
    this.transaction = null;
    this.restore(snapshot);
  }

  insert(value) {
    if (!value) return;
    this.remember();
    const range=this.selectionRange(),start=range?.start??this.cursor,end=range?.end??this.cursor;
    this.replaceTextRange(start,end,value);this.cursor=start+value.length;
    this.preferredColumn = null;
    this.selectionAnchor = null;
  }

  replaceAll(value) {
    this.remember();
    this.text = value.replace(/\r\n/g, "\n");
    this.invalidateCache();
    this.cursor = Math.min(this.cursor, this.text.length);
    this.dirty = this.text !== this.savedText;
    this.preferredColumn = null;
    this.selectionAnchor = null;
  }

  backspace() {
    if (this.hasSelection()) {
      this.remember();
      this.deleteSelection(false);
      return;
    }
    if (this.cursor === 0) return;
    this.remember();
    const width = this.text.codePointAt(this.cursor - 1) > 0xffff ? 2 : 1;
    this.replaceTextRange(this.cursor-width,this.cursor,"");
    this.cursor -= width;
    this.selectionAnchor = null;
    this.preferredColumn = null;
  }

  deleteForward() {
    if (this.hasSelection()) {
      this.remember();
      this.deleteSelection(false);
      return;
    }
    if (this.cursor >= this.text.length) return;
    this.remember();
    const width = this.text.codePointAt(this.cursor) > 0xffff ? 2 : 1;
    this.replaceTextRange(this.cursor,this.cursor+width,"");
  }

  deleteLine() {
    if (this.text.length === 0) return;
    this.remember();
    const beforeBreak = this.text.lastIndexOf("\n", Math.max(0, this.cursor - 1));
    let start = beforeBreak + 1;
    let end = this.text.indexOf("\n", this.cursor);
    if (end >= 0) {
      end += 1;
    } else if (start > 0) {
      start -= 1;
      end = this.text.length;
    } else {
      end = this.text.length;
    }
    this.text = this.text.slice(0, start) + this.text.slice(end);
    this.invalidateCache();
    this.cursor = Math.min(start, this.text.length);
    this.dirty = this.text !== this.savedText;
    this.preferredColumn = null;
    this.selectionAnchor = null;
  }

  clear() {
    if (!this.text) return;
    this.remember();
    this.text = "";
    this.invalidateCache();
    this.cursor = 0;
    this.dirty = this.text !== this.savedText;
    this.preferredColumn = null;
    this.selectionAnchor = null;
  }

  hasSelection() {
    return this.selectionAnchor !== null && this.selectionAnchor !== this.cursor;
  }

  selectionRange() {
    if (!this.hasSelection()) return null;
    return {
      start: Math.min(this.selectionAnchor, this.cursor),
      end: Math.max(this.selectionAnchor, this.cursor)
    };
  }

  selectedText() {
    const range = this.selectionRange();
    return range ? this.text.slice(range.start, range.end) : "";
  }

  startSelection() {
    if (this.selectionAnchor === null) this.selectionAnchor = this.cursor;
  }

  clearSelection() {
    this.selectionAnchor = null;
  }

  selectAll() {
    this.selectionAnchor = 0;
    this.cursor = this.text.length;
    this.preferredColumn = null;
  }

  deleteSelection(remember = true) {
    const range = this.selectionRange();
    if (!range) return false;
    if (remember) this.remember();
    this.replaceTextRange(range.start,range.end,"");
    this.cursor = range.start;
    this.selectionAnchor = null;
    this.preferredColumn = null;
    return true;
  }

  undo() {
    const previous = this.history.pop();
    if (!previous) return false;
    this.future.push(this.snapshot());
    this.trimHistory(this.future);
    this.restore(previous);
    return true;
  }

  redo() {
    const next=this.future.pop();
    if(!next)return false;
    this.history.push(this.snapshot());
    this.trimHistory();
    this.restore(next);return true;
  }

  lines() {
    if(this._cacheText===this.text&&this._linesCache)return this._linesCache;
    this._cacheText=this.text;this._linesCache=this.text.split("\n");this._startsCache=new Array(this._linesCache.length);
    let offset=0;for(let index=0;index<this._linesCache.length;index++){this._startsCache[index]=offset;offset+=this._linesCache[index].length+1;}
    return this._linesCache;
  }

  position() {
    return this.positionAt(this.cursor);
  }

  indexAt(line, column) {
    const lines = this.lines();
    const targetLine = Math.max(0, Math.min(line, lines.length - 1));
    return this._startsCache[targetLine] + Math.min(column, lines[targetLine].length);
  }

  moveLeft() {
    if (this.cursor > 0) this.cursor--;
    this.preferredColumn = null;
  }

  moveRight() {
    if (this.cursor < this.text.length) this.cursor++;
    this.preferredColumn = null;
  }

  moveVertical(delta) {
    const { line, column } = this.position();
    if (this.preferredColumn === null) this.preferredColumn = column;
    this.cursor = this.indexAt(line + delta, this.preferredColumn);
  }

  moveHome() {
    const { line } = this.position();
    this.cursor = this.indexAt(line, 0);
    this.preferredColumn = null;
  }

  moveEnd() {
    const { line } = this.position();
    this.cursor = this.indexAt(line, Number.MAX_SAFE_INTEGER);
    this.preferredColumn = null;
  }

  moveFileStart() {
    this.cursor = 0;
    this.preferredColumn = null;
  }

  moveFileEnd() {
    this.cursor = this.text.length;
    this.preferredColumn = null;
  }

  moveWordLeft() {
    if (this.cursor === 0) return;
    const before = this.text.slice(0, this.cursor);
    const match = before.match(/\s*[^\sA-Za-z0-9_]*[A-Za-z0-9_]+\s*$/);
    this.cursor = match ? this.cursor - match[0].length : Math.max(0, this.cursor - 1);
    this.preferredColumn = null;
  }

  moveWordRight() {
    if (this.cursor >= this.text.length) return;
    const after = this.text.slice(this.cursor);
    const match = after.match(/^\s*[^\sA-Za-z0-9_]*[A-Za-z0-9_]+/);
    this.cursor = match ? this.cursor + match[0].length : Math.min(this.text.length, this.cursor + 1);
    this.preferredColumn = null;
  }

  goToLine(lineNumber) {
    const line = Math.max(0, Math.floor(lineNumber) - 1);
    this.cursor = this.indexAt(line, 0);
    this.preferredColumn = null;
  }

  newlineWithIndent(tabSize = 4) {
    const { line } = this.position();
    const beforeCursorText = this.text.slice(this.indexAt(line, 0), this.cursor);
    const leading = beforeCursorText.match(/^[ \t]*/)?.[0] || "";
    const beforeCursor = beforeCursorText.trimEnd();
    const opensBlock = /[:{[(]$/.test(beforeCursor);
    this.insert(`\n${leading}${opensBlock ? " ".repeat(tabSize) : ""}`);
  }

  currentWordPrefix() {
    return this.text.slice(0, this.cursor).match(/[A-Za-z_][A-Za-z0-9_]*$/)?.[0] || "";
  }

  indentLines(tabSize = 4) {
    const range = this.selectionRange();
    const originalCursor = this.cursor;
    const originalAnchor = this.selectionAnchor;
    const cursorPos = this.positionAt(this.cursor);
    const anchorPos = range ? this.positionAt(this.selectionAnchor) : null;
    const startLine = range ? this.positionAt(range.start).line : cursorPos.line;
    const endLine = range ? this.positionAt(Math.max(range.start, range.end - 1)).line : cursorPos.line;
    this.remember();
    const lines = this.lines();
    const indent = " ".repeat(tabSize);
    for (let line = startLine; line <= endLine; line++) lines[line] = indent + lines[line];
    this.text = lines.join("\n");
    this.invalidateCache();
    const adjustedColumn = (position, originalIndex) => {
      if (position.line < startLine || position.line > endLine) return position.column;
      if (range && originalIndex === range.start && position.column === 0) return 0;
      return position.column + tabSize;
    };
    this.cursor = this.indexAt(cursorPos.line, adjustedColumn(cursorPos, originalCursor));
    if (anchorPos) this.selectionAnchor = this.indexAt(anchorPos.line, adjustedColumn(anchorPos, originalAnchor));
    this.dirty = this.text !== this.savedText;
  }

  outdentLines(tabSize = 4) {
    const range = this.selectionRange();
    const cursorPos = this.positionAt(this.cursor);
    const anchorPos = range ? this.positionAt(this.selectionAnchor) : null;
    const startLine = range ? this.positionAt(range.start).line : cursorPos.line;
    const endLine = range ? this.positionAt(Math.max(range.start, range.end - 1)).line : cursorPos.line;
    const lines = this.lines();
    const removed = new Map();
    for (let line = startLine; line <= endLine; line++) {
      const match = lines[line].match(/^\t|^ +/)?.[0] || "";
      const count = match.startsWith("\t") ? 1 : Math.min(tabSize, match.length);
      removed.set(line, count);
      lines[line] = lines[line].slice(count);
    }
    if (![...removed.values()].some(Boolean)) return;
    this.remember();
    this.text = lines.join("\n");
    this.invalidateCache();
    this.cursor = this.indexAt(cursorPos.line, Math.max(0, cursorPos.column - (removed.get(cursorPos.line) || 0)));
    if (anchorPos) this.selectionAnchor = this.indexAt(anchorPos.line, Math.max(0, anchorPos.column - (removed.get(anchorPos.line) || 0)));
    this.dirty = this.text !== this.savedText;
  }

  positionAt(index) {
    const target=Math.max(0,Math.min(index,this.text.length));this.lines();
    let low=0,high=this._startsCache.length-1;
    while(low<=high){const middle=(low+high)>>1;if(this._startsCache[middle]<=target)low=middle+1;else high=middle-1;}
    const line=Math.max(0,high);return {line,column:target-this._startsCache[line]};
  }
}
