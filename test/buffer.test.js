import test from "node:test";
import assert from "node:assert/strict";
import { TextBuffer } from "../src/buffer.js";

test("inserts at the cursor and undoes", () => {
  const buffer = new TextBuffer("hello world");
  buffer.cursor = 6;
  buffer.insert("bright ");
  assert.equal(buffer.text, "hello bright world");
  assert.equal(buffer.cursor, 13);
  assert.equal(buffer.undo(), true);
  assert.equal(buffer.text, "hello world");
  assert.equal(buffer.cursor, 6);
});

test("redoes an undone edit and clears redo after a new edit", () => {
  const buffer=new TextBuffer("a");buffer.cursor=1;buffer.insert("b");buffer.undo();
  assert.equal(buffer.redo(),true);assert.equal(buffer.text,"ab");
  buffer.undo();buffer.insert("c");assert.equal(buffer.redo(),false);assert.equal(buffer.text,"ac");
});

test("tracks the saved content across undo and redo",()=>{
  const buffer=new TextBuffer("a");buffer.cursor=1;buffer.insert("b");buffer.markSaved();buffer.insert("c");
  buffer.undo();assert.equal(buffer.text,"ab");assert.equal(buffer.dirty,false);
  buffer.undo();assert.equal(buffer.text,"a");assert.equal(buffer.dirty,true);
  buffer.redo();assert.equal(buffer.text,"ab");assert.equal(buffer.dirty,false);
});

test("updates a warm line cache incrementally for a single-line edit",()=>{
  const buffer=new TextBuffer("one\ntwo\nthree");const lines=buffer.lines();buffer.cursor=5;buffer.insert("X");
  assert.equal(buffer.lines(),lines);assert.deepEqual(buffer.lines(),["one","tXwo","three"]);assert.equal(buffer.indexAt(2,0),9);
});

test("reuses line data and finds positions through cached offsets", () => {
  const buffer=new TextBuffer("one\ntwo\nthree");
  assert.equal(buffer.lines(),buffer.lines());
  assert.deepEqual(buffer.positionAt(9),{line:2,column:1});
  buffer.cursor=buffer.text.length;buffer.insert("!");
  assert.equal(buffer.lines().at(-1),"three!");
});

test("moves vertically while preserving the desired column", () => {
  const buffer = new TextBuffer("abcdef\nx\n123456");
  buffer.cursor = 5;
  buffer.moveVertical(1);
  assert.deepEqual(buffer.position(), { line: 1, column: 1 });
  buffer.moveVertical(1);
  assert.deepEqual(buffer.position(), { line: 2, column: 5 });
});

test("groups streamed AI insertion into one undo operation", () => {
  const buffer = new TextBuffer("const answer = ;");
  buffer.cursor = 15;
  buffer.beginTransaction();
  buffer.insert("4");
  buffer.insert("2");
  buffer.endTransaction();
  assert.equal(buffer.text, "const answer = 42;");
  buffer.undo();
  assert.equal(buffer.text, "const answer = ;");
});

test("rolls back a cancelled AI insertion", () => {
  const buffer = new TextBuffer("before after");
  buffer.cursor = 7;
  buffer.beginTransaction();
  buffer.insert("partial ");
  buffer.rollbackTransaction();
  assert.equal(buffer.text, "before after");
  assert.equal(buffer.cursor, 7);
});

test("deletes the current line and restores it with undo", () => {
  const buffer = new TextBuffer("first\nsecond\nthird");
  buffer.cursor = 8;
  buffer.deleteLine();
  assert.equal(buffer.text, "first\nthird");
  assert.deepEqual(buffer.position(), { line: 1, column: 0 });
  buffer.undo();
  assert.equal(buffer.text, "first\nsecond\nthird");
});

test("clears the entire file and restores it with undo", () => {
  const buffer = new TextBuffer("keep me");
  buffer.clear();
  assert.equal(buffer.text, "");
  buffer.undo();
  assert.equal(buffer.text, "keep me");
});

test("supports fast, word, and absolute navigation", () => {
  const buffer = new TextBuffer(Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join("\n"));
  buffer.goToLine(20);
  assert.equal(buffer.position().line, 19);
  buffer.moveVertical(-10);
  assert.equal(buffer.position().line, 9);
  buffer.moveFileEnd();
  assert.equal(buffer.cursor, buffer.text.length);
  buffer.moveWordLeft();
  assert.ok(buffer.position().column < buffer.lines().at(-1).length);
  buffer.moveFileStart();
  assert.equal(buffer.cursor, 0);
  buffer.moveWordRight();
  assert.equal(buffer.text.slice(0, buffer.cursor), "line");
});

test("selects, replaces, and undoes text", () => {
  const buffer = new TextBuffer("hello world");
  buffer.cursor = 6;
  buffer.startSelection();
  buffer.moveFileEnd();
  assert.equal(buffer.selectedText(), "world");
  buffer.insert("Codex");
  assert.equal(buffer.text, "hello Codex");
  assert.equal(buffer.hasSelection(), false);
  buffer.undo();
  assert.equal(buffer.text, "hello world");
});

test("cut-style selection deletion is one undoable edit", () => {
  const buffer = new TextBuffer("alpha beta gamma");
  buffer.cursor = 6;
  buffer.startSelection();
  buffer.cursor = 10;
  assert.equal(buffer.selectedText(), "beta");
  buffer.deleteSelection();
  assert.equal(buffer.text, "alpha  gamma");
  buffer.undo();
  assert.equal(buffer.text, "alpha beta gamma");
});

test("select all covers the complete buffer", () => {
  const buffer = new TextBuffer("one\ntwo");
  buffer.selectAll();
  assert.equal(buffer.selectedText(), "one\ntwo");
});

test("auto-indents after a Python block opener", () => {
  const buffer = new TextBuffer("def greet():");
  buffer.cursor = buffer.text.length;
  buffer.newlineWithIndent(4);
  assert.equal(buffer.text, "def greet():\n    ");
  assert.deepEqual(buffer.position(), { line: 1, column: 4 });
});

test("auto-indent preserves existing indentation", () => {
  const buffer = new TextBuffer("    if ready:");
  buffer.cursor = buffer.text.length;
  buffer.newlineWithIndent(2);
  assert.equal(buffer.text, "    if ready:\n      ");
});

test("repeated Enter stays in one column after deleting a multiline selection", () => {
  const buffer = new TextBuffer("    one\n    two\n        tail");
  buffer.selectionAnchor = 4;
  buffer.cursor = 20;
  buffer.deleteSelection();
  assert.deepEqual(buffer.position(), { line: 0, column: 4 });

  for (let press = 0; press < 3; press++) {
    buffer.newlineWithIndent(4);
    assert.equal(buffer.position().column, 4);
  }
});

test("finds the current identifier prefix for completion", () => {
  const buffer = new TextBuffer("result = fibon");
  buffer.cursor = buffer.text.length;
  assert.equal(buffer.currentWordPrefix(), "fibon");
});

test("indents and outdents a multiline selection", () => {
  const buffer = new TextBuffer("one\ntwo\nthree");
  buffer.selectionAnchor = 0;
  buffer.cursor = 7;
  buffer.indentLines(2);
  assert.equal(buffer.text, "  one\n  two\nthree");
  assert.equal(buffer.selectedText(), "  one\n  two");
  buffer.outdentLines(2);
  assert.equal(buffer.text, "one\ntwo\nthree");
});
