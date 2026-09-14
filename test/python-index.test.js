import test from "node:test";
import assert from "node:assert/strict";
import { pythonImportAliases, pythonMemberSuggestions } from "../src/python-index.js";

test("maps Python imports and aliases to prebuilt member suggestions",()=>{
  assert.deepEqual(pythonImportAliases("import os\nimport json as js\n"),{os:"os",js:"json"});
  const suggestions=pythonMemberSuggestions("import os\n","os","pa",{});
  assert.ok(suggestions.some(item=>item.word==="os.path"));
  assert.ok(suggestions.length<=5);
});

test("uses a locally rebuilt Python module index",()=>{
  const suggestions=pythonMemberSuggestions("import custom\n","custom","do",{custom:["done","download"]});
  assert.deepEqual(suggestions.map(item=>item.word),["custom.done","custom.download"]);
});
