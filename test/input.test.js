import test from "node:test";
import assert from "node:assert/strict";
import { InputDecoder } from "../src/input.js";
import { EditorApp } from "../src/app.js";
import { defaultSettings } from "../src/settings.js";

function editor(t) {
  const app = new EditorApp([], { output: { columns: 80, rows: 24, write() {} } });
  app.settings = { ...structuredClone(defaultSettings), suggestions: false };
  app.render = () => {};
  app.newUntitled(false);
  t.after(() => clearTimeout(app.escapeTimer));
  return app;
}

test("preserves a paste at every possible chunk boundary", () => {
  const value = "alpha\r\nbeta😀\tend", input = `\x1b[200~${value}\x1b[201~`;
  for (let split = 1; split < input.length; split++) {
    const decoder = new InputDecoder();
    const events = [...decoder.push(input.slice(0, split)), ...decoder.push(input.slice(split))];
    assert.deepEqual(events, [{ type: "paste", value }], `split at ${split}`);
  }
});

test("decodes paste delimiters delivered one character at a time", () => {
  const decoder = new InputDecoder();
  const events = [..."\x1b[200~one\ntwo\x1b[201~"].flatMap(character => decoder.push(character));
  assert.deepEqual(events, [{ type: "paste", value: "one\ntwo" }]);
});

test("keeps large pasted chunks and a partial closing marker intact", () => {
  const decoder = new InputDecoder(), part = "row 😀\n".repeat(5000);
  assert.deepEqual(decoder.push(`\x1b[200~${part}\x1b[20`), []);
  assert.deepEqual(decoder.push("1~"), [{ type: "paste", value: part }]);
});

test("decodes combined and fragmented key, mouse, and paste events", () => {
  const decoder = new InputDecoder();
  assert.deepEqual(decoder.push("\x1b[1;"), []);
  assert.deepEqual(decoder.push("5D\x1bOQ\x1b[<32;8;2M\x1b[200~ok\x1b[201~\x13"), [
    { type: "key", value: "\x1b[1;5D" },
    { type: "key", value: "\x1bOQ" },
    { type: "key", value: "\x1b[<32;8;2M" },
    { type: "paste", value: "ok" },
    { type: "key", value: "\x13" }
  ]);
});

test("distinguishes standalone Escape from an unfinished key sequence", () => {
  const decoder = new InputDecoder();
  assert.deepEqual(decoder.push("\x1b"), []);
  assert.equal(decoder.awaitingEscape, true);
  assert.deepEqual(decoder.flushEscape(), [{ type: "key", value: "\x1b" }]);
  decoder.push("\x1b[");
  assert.deepEqual(decoder.flushEscape(), []);
  assert.deepEqual(decoder.push("D"), [{ type: "key", value: "\x1b[D" }]);
});

test("a fragmented paste replaces a selection and undoes in one step", t => {
  const app = editor(t);
  app.buffer.insert("original");
  app.buffer.selectAll();
  app.handleInput("\x1b[20");
  app.handleInput("0~alpha\r\n");
  app.handleInput("beta\x1b[201");
  app.handleInput("~");
  assert.equal(app.buffer.text, "alpha\nbeta");
  app.handleInput("\x1a");
  assert.equal(app.buffer.text, "original");
});

test("handles multiple keypresses received in the same data event", t => {
  const app = editor(t);
  app.handleInput("one\x1b[D\x1b[DX");
  assert.equal(app.buffer.text, "oXne");
  app.handleInput("\x01\x7f");
  assert.equal(app.buffer.text, "");
});

test("pasting into a prompt adds text without submitting it", t => {
  const app = editor(t);
  app.openPrompt("search");
  app.handleInput("\x1b[200~first\r\nsecond\x1b[201~");
  assert.equal(app.prompt.value, "first second");
  assert.equal(app.buffer.text, "");
  assert.equal(app.lastSearch, null);
});

test("pasted text does not accept an overwrite dialog", t => {
  const app = editor(t);
  app.overwritePanel = { target: "example.txt" };
  app.handleInput("\x1b[200~y\r\x1b[201~");
  assert.deepEqual(app.overwritePanel, { target: "example.txt" });
});

test("backspace removes a complete emoji from a prompt", t => {
  const app = editor(t);
  app.openPrompt("search", "value");
  app.handleInput("😀\x7f");
  assert.equal(app.prompt.value, "value");
});

test("standalone Escape still closes a prompt after the decoding timeout", async t => {
  const app = editor(t);
  app.openPrompt("search");
  app.handleInput("\x1b");
  await new Promise(resolve => setTimeout(resolve, 80));
  assert.equal(app.prompt, null);
});
