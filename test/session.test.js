import test from "node:test";
import assert from "node:assert/strict";
import { TextBuffer } from "../src/buffer.js";
import { snapshotSession } from "../src/session.js";

test("snapshots unsaved tabs, cursors, selections, and viewports",()=>{
  const buffer=new TextBuffer("saved");buffer.cursor=5;buffer.insert(" draft");buffer.selectionAnchor=2;
  const session=snapshotSession([{filePath:null,displayName:"Untitled 1",buffer,viewport:{topLine:3,leftColumn:2},mtimeMs:null}],0);
  assert.equal(session.tabs[0].text,"saved draft");assert.equal(session.tabs[0].savedText,"saved");
  assert.equal(session.tabs[0].selectionAnchor,2);assert.deepEqual(session.tabs[0].viewport,{topLine:3,leftColumn:2});
});
