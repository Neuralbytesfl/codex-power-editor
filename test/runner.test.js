import test from "node:test";
import assert from "node:assert/strict";
import { planForFile } from "../src/runner.js";

test("selects Python without a compile step", () => {
  const plan = planForFile("/tmp/hello.py", "/tmp/program");
  assert.equal(plan.language, "Python");
  assert.equal(plan.compile, null);
  assert.deepEqual(plan.run, { command: "python3", args: ["/tmp/hello.py"] });
});

test("selects gcc for C", () => {
  const plan = planForFile("/tmp/hello.c", "/tmp/program");
  assert.equal(plan.language, "C");
  assert.equal(plan.compile.command, "gcc");
  assert.equal(plan.run.command, "/tmp/program");
});

test("selects g++ for common C++ extensions", () => {
  for (const extension of ["cc", "cpp", "cxx"]) {
    const plan = planForFile(`/tmp/hello.${extension}`, "/tmp/program");
    assert.equal(plan.language, "C++");
    assert.equal(plan.compile.command, "g++");
    assert.ok(plan.compile.args.includes("-std=c++17"));
  }
});

test("rejects unsupported file types", () => {
  assert.equal(planForFile("/tmp/readme.md"), null);
});

test("runs JavaScript, shell, Ruby, and Rust", () => {
  assert.equal(planForFile("/tmp/app.js").run.command,"node");
  assert.equal(planForFile("/tmp/tool.sh").run.command,"bash");
  assert.equal(planForFile("/tmp/tool.rb").run.command,"ruby");
  assert.equal(planForFile("/tmp/main.rs","/tmp/program").compile.command,"rustc");
});
