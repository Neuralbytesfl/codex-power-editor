import test from "node:test";
import assert from "node:assert/strict";
import { EditorApp, locateAnchor, parseSearchPattern } from "../src/app.js";

test("parses contains, exact-word, and regex searches", () => {
  assert.deepEqual(parseSearchPattern("render"), { source: "render", flags: "gi", mode: "contains" });
  assert.deepEqual(parseSearchPattern("=render"), { source: "\\brender\\b", flags: "gi", mode: "word" });
  assert.deepEqual(parseSearchPattern("/ren.der/i"), { source: "ren.der", flags: "ig", mode: "regex" });
});

test("relocates an AI cursor anchor after unrelated edits", () => {
  const before = "const answer = ";
  const after = ";";
  const changed = "// added elsewhere\nconst answer = ;";
  assert.equal(locateAnchor(changed, before, after, 15), changed.indexOf(";") );
});

test("keeps finished run output open until Escape", () => {
  const app = Object.create(EditorApp.prototype);
  app.runPanel = { running: false, scrollOffset: 0 };
  app.status = "";
  app.output = { rows: 24 };
  app.render = () => {};

  for (const key of ["x", "q", " ", "\r", "\x11", "\x03"]) {
    app.handleRunPanel(key);
    assert.ok(app.runPanel, `run output closed for ${JSON.stringify(key)}`);
  }

  app.handleRunPanel("\x1b");
  assert.equal(app.runPanel, null);
  assert.equal(app.status, "Returned from program");
});

test("auto-scrolls output while extending a mouse selection at an edge", () => {
  const app = Object.create(EditorApp.prototype);
  app.output = { columns: 40, rows: 8 };
  app.runPanel = {
    output: Array.from({ length: 20 }, (_, index) => `output line ${index}`).join("\n"),
    scrollOffset: 5,
    selectionAnchor: 10,
    selectionCursor: 10,
    mouseSelecting: true
  };
  app.render = () => {};

  app.handleRunMouse(["", "32", "8", "8", "M"]);
  assert.equal(app.runPanel.scrollOffset, 4);
  assert.equal(app.runPanel.selectionAnchor, 10);
  assert.ok(app.runPanel.selectionCursor > app.runPanel.selectionAnchor);

  app.handleRunMouse(["", "32", "8", "1", "M"]);
  assert.equal(app.runPanel.scrollOffset, 5);
  assert.equal(app.runPanel.selectionAnchor, 10);
});
