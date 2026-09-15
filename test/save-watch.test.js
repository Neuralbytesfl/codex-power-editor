import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EditorApp } from "../src/app.js";
import { TextBuffer } from "../src/buffer.js";
import { defaultSettings } from "../src/settings.js";

let configDirectory;
const previousConfig = process.env.XDG_CONFIG_HOME;
before(async () => {
  configDirectory = await mkdtemp(join(tmpdir(), "cpx-test-config-"));
  process.env.XDG_CONFIG_HOME = configDirectory;
});
after(async () => {
  if (previousConfig === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = previousConfig;
  await rm(configDirectory, { recursive: true, force: true });
});

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

async function editor(t, fileIO = {}) {
  const directory = await mkdtemp(join(tmpdir(), "cpx-test-save-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const app = new EditorApp([], { output: { columns: 80, rows: 24, write() {} }, fileIO });
  app.settings = { ...structuredClone(defaultSettings), knowledgeIndex: false };
  app.render = () => {};
  app.newUntitled(false);
  app.activeTab.filePath = join(directory, "example.txt");
  app.activeTab.buffer = new TextBuffer("original");
  app.buffer.moveFileEnd();
  await writeFile(app.filePath, "original");
  return app;
}

test("edits made during a save remain dirty and survive savepoint undo/redo", async t => {
  const started = deferred(), release = deferred();
  const app = await editor(t, {
    async writeFile(path, text) { started.resolve(); await release.promise; await writeFile(path, text); }
  });
  app.buffer.insert(" saved");
  const saving = app.save();
  await started.promise;
  app.buffer.insert(" later");
  release.resolve();
  assert.equal(await saving, true);
  assert.equal(await readFile(app.filePath, "utf8"), "original saved");
  assert.equal(app.buffer.text, "original saved later");
  assert.equal(app.buffer.dirty, true);
  assert.match(app.status, /newer edits remain unsaved/);
  app.buffer.undo();
  assert.equal(app.buffer.dirty, false);
  app.buffer.redo();
  assert.equal(app.buffer.dirty, true);
});

test("overlapping saves write their snapshots in request order", async t => {
  const started = [deferred(), deferred()], release = [deferred(), deferred()];
  let calls = 0;
  const app = await editor(t, {
    async writeFile(path, text) {
      const index = calls++;
      started[index].resolve();
      await release[index].promise;
      await writeFile(path, text);
    }
  });
  app.buffer.insert(" first");
  const first = app.save();
  await started[0].promise;
  app.buffer.insert(" second");
  const second = app.save();
  await Promise.resolve();
  assert.equal(calls, 1);
  release[0].resolve();
  assert.equal(await first, true);
  await started[1].promise;
  assert.equal(app.buffer.dirty, true);
  release[1].resolve();
  assert.equal(await second, true);
  assert.equal(await readFile(app.filePath, "utf8"), "original first second");
  assert.equal(app.buffer.dirty, false);
  assert.equal(app.activeTab.savePromise, null);
});

test("a failed write retains unsaved state and allows a subsequent save", async t => {
  let fail = true;
  const app = await editor(t, {
    async writeFile(path, text) {
      if (fail) throw new Error("disk unavailable");
      await writeFile(path, text);
    }
  });
  app.buffer.insert(" changed");
  assert.equal(await app.save(), false);
  assert.equal(app.buffer.dirty, true);
  assert.equal(app.buffer.savedText, "original");
  assert.equal(await readFile(app.filePath, "utf8"), "original");
  assert.match(app.status, /Save failed: disk unavailable/);
  fail = false;
  assert.equal(await app.save(), true);
  assert.equal(app.buffer.dirty, false);
});

test("switching tabs during a save still saves the original tab", async t => {
  const started = deferred(), release = deferred();
  const app = await editor(t, {
    async writeFile(path, text) { started.resolve(); await release.promise; await writeFile(path, text); }
  });
  app.buffer.insert(" changed");
  const originalTab = app.activeTab, saving = app.save();
  await started.promise;
  app.newUntitled(false);
  app.buffer.insert("another file");
  release.resolve();
  assert.equal(await saving, true);
  assert.equal(await readFile(originalTab.filePath, "utf8"), "original changed");
  assert.equal(originalTab.buffer.dirty, false);
  assert.equal(app.buffer.text, "another file");
  assert.equal(app.buffer.dirty, true);
});

test("file watching skips a tab with a pending save", async t => {
  const started = deferred(), release = deferred();
  let reads = 0;
  const app = await editor(t, {
    async writeFile(path, text) { started.resolve(); await release.promise; await writeFile(path, text); },
    async readFile(path, encoding) { reads++; return readFile(path, encoding); }
  });
  const saving = app.save();
  await started.promise;
  await app.checkExternalChanges();
  assert.equal(reads, 0);
  release.resolve();
  await saving;
});

test("typing during an external reload preserves local edits", async t => {
  const started = deferred(), release = deferred();
  const app = await editor(t, {
    async stat() { return { mtimeMs: 2 }; },
    async readFile() { started.resolve(); await release.promise; return "external edit"; }
  });
  app.activeTab.mtimeMs = 1;
  const originalBuffer = app.buffer, checking = app.checkExternalChanges();
  await started.promise;
  app.buffer.insert(" local edit");
  release.resolve();
  await checking;
  assert.equal(app.buffer, originalBuffer);
  assert.equal(app.buffer.text, "original local edit");
  assert.equal(app.buffer.dirty, true);
  assert.equal(app.activeTab.externalChanged, true);
});

test("clean buffers still reload external edits", async t => {
  const app = await editor(t, {
    async stat() { return { mtimeMs: 2 }; },
    async readFile() { return "external edit"; }
  });
  app.activeTab.mtimeMs = 1;
  await app.checkExternalChanges();
  assert.equal(app.buffer.text, "external edit");
  assert.equal(app.buffer.dirty, false);
  assert.equal(app.activeTab.mtimeMs, 2);
});

test("a reload already in flight cannot replace a newly saved buffer", async t => {
  const started = deferred(), release = deferred();
  const app = await editor(t, {
    async stat() { return { mtimeMs: 2 }; },
    async readFile() { started.resolve(); await release.promise; return "stale disk content"; }
  });
  app.activeTab.mtimeMs = 1;
  const checking = app.checkExternalChanges();
  await started.promise;
  app.buffer.insert(" saved edit");
  assert.equal(await app.save(), true);
  release.resolve();
  await checking;
  assert.equal(app.buffer.text, "original saved edit");
  assert.equal(app.buffer.dirty, false);
});
