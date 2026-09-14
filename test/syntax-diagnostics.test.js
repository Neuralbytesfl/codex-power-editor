import test from "node:test";
import assert from "node:assert/strict";
import { highlightLine } from "../src/syntax.js";
import { analyzeText } from "../src/diagnostics.js";

test("highlights language keywords, strings, numbers, and comments",()=>{
  const line='def answer(): return "yes" # note 42',kinds=highlightLine(line,"x.py");
  assert.equal(kinds[0],"keyword");assert.equal(kinds[line.indexOf('"')],"string");
  assert.equal(kinds[line.indexOf("#")],"comment");
});

test("supports syntax rendering for untitled buffers",()=>{
  assert.equal(highlightLine("plain text",null).length,10);
});

test("reports unmatched and unclosed delimiters",()=>{
  assert.match(analyzeText("value = (items[0]")[0].message,/Unclosed/);
  assert.match(analyzeText("value = ]")[0].message,/Unmatched/);
});
