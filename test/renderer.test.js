import test from "node:test";
import assert from "node:assert/strict";
import { colorSchemes, formatTabStrip, wrapOutput, Renderer } from "../src/renderer.js";
import { TextBuffer } from "../src/buffer.js";

test("mouse positions do not split an emoji surrogate pair", () => {
  const renderer = new Renderer({ columns: 80, rows: 24 });
  const buffer = new TextBuffer("A😀B");
  assert.equal(renderer.indexAtScreen(7, 2, buffer), 1);
  assert.equal(renderer.indexAtScreen(8, 2, buffer), 3);
});

function tab(name, dirty = false, externalChanged = false) {
  return { filePath: `/tmp/${name}`, buffer: { dirty }, externalChanged };
}

test("tab strip numbers tabs and shows state", () => {
  const strip = formatTabStrip([tab("one.py"), tab("two.py", true, true)], 1, 80);
  assert.equal(strip, " 1:one.py │[2:two.py*!]");
});

test("narrow tab strip always retains the active tab", () => {
  const tabs = Array.from({ length: 8 }, (_, i) => tab(`module-${i + 1}.js`));
  const strip = formatTabStrip(tabs, 6, 34);
  assert.match(strip, /\[7:module-7\.js\]/);
  assert.ok(strip.length <= 34);
});

test("untitled tabs have a useful label", () => {
  const strip = formatTabStrip([{ filePath: null, displayName: "Untitled 1", buffer: { dirty: true } }], 0, 80);
  assert.equal(strip, "[1:Untitled 1*]");
});

test("run output wraps long lines without losing text", () => {
  const output = "abcdefghij\nshort";
  const lines = wrapOutput(output, 4);
  assert.deepEqual(lines, ["abcd", "efgh", "ij", "shor", "t"]);
  assert.equal(lines.join(""), output.replace("\n", ""));
});

test("provides distinct complete color schemes", () => {
  assert.equal(colorSchemes.length,5);
  assert.equal(new Set(colorSchemes.map(scheme=>scheme.editorBg)).size,5);
  for(const scheme of colorSchemes)assert.equal(typeof scheme.editorFg,"number");
});
