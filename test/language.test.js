import test from "node:test";
import assert from "node:assert/strict";
import { definitionForWord, languageWords } from "../src/language.js";

test("offers Python completion words in Python and untitled buffers", () => {
  assert.ok(languageWords("example.py").print);
  assert.ok(languageWords("").print);
});

test("finds local function definitions", () => {
  assert.match(definitionForWord("example.py", "greet", "def greet(name):\n    return name\n"), /greet\(name\)/);
});

test("infers Python declaration value types", () => {
  const source='name = "Ada"\ncoordinates = (10, 20)\noptions = {"fast": True}\nitems = [1, 2]\n';
  assert.match(definitionForWord("example.py","name",source),/name: str/);
  assert.match(definitionForWord("example.py","coordinates",source),/coordinates: tuple/);
  assert.match(definitionForWord("example.py","options",source),/options: dict/);
  assert.match(definitionForWord("example.py","items",source),/items: list/);
});
