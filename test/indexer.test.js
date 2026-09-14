import test from "node:test";
import assert from "node:assert/strict";
import { extractKnowledge, mergeKnowledge } from "../src/indexer.js";

test("extracts completion words and reusable code phrases", () => {
  const result=extractKnowledge("import os\nconsole.log(value)\ndef greet(name):\n    print(name)\n");
  assert.ok(result.words.console);
  assert.ok(result.phrases["console.log("]);
  assert.ok(result.phrases["def greet(name):"]);
});

test("merges knowledge into persistent settings", () => {
  const settings={learnedWords:{},learnedPhrases:{}};
  mergeKnowledge(settings,{words:{hello:2},phrases:{"hello_world(":1}});
  assert.equal(settings.learnedWords.hello,2);
  assert.equal(settings.learnedPhrases["hello_world("],1);
});

test("keeps the live index large but bounded and case-insensitive", () => {
  const settings={learnedWords:{},learnedPhrases:{}};
  const words=Object.fromEntries(Array.from({length:5100},(_,index)=>[`word_${index}`,index+1]));
  words.WORD_5099=2;
  const phrases=Object.fromEntries(Array.from({length:2100},(_,index)=>[`call_${index}(`,index+1]));
  mergeKnowledge(settings,{words,phrases});
  assert.equal(Object.keys(settings.learnedWords).length,5000);
  assert.equal(Object.keys(settings.learnedPhrases).length,2000);
  assert.equal(Object.keys(settings.learnedWords).filter(word=>word.toLowerCase()==="word_5099").length,1);
});
