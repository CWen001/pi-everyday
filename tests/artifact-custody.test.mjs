import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { transferArtifact } from "../skills/codex-image-gen/scripts/artifact-custody.mjs";
import { imageBytes } from "./fixtures/image.mjs";

async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "artifact-custody-")));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const generatedRoot = join(root, "generated_images");
  const source = join(generatedRoot, "thread", "image.png");
  const destination = join(root, "workspace", "image.png");
  await fs.mkdir(join(generatedRoot, "thread"), { recursive: true });
  await fs.writeFile(source, imageBytes);
  return { root, generatedRoot, source, destination };
}

function destinationHandleFailure(destination, method, message) {
  return {
    ...fs,
    async open(path, flags, ...args) {
      const handle = await fs.open(path, flags, ...args);
      if (path !== destination) return handle;
      let failed = false;
      return new Proxy(handle, {
        get(target, property) {
          if (property === method && !failed) return async () => {
            failed = true;
            throw new Error(message);
          };
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    },
  };
}

test("Artifact Custody copies an exclusive destination and preserves the original", async (t) => {
  const { root, generatedRoot, source, destination } = await fixture(t);
  assert.equal(await transferArtifact({ source, destination, generatedRoot }, {
    ...fs,
    async unlink() { throw new Error("successful custody must not delete anything"); },
  }), destination);
  assert.deepEqual(await fs.readFile(source), imageBytes);
  assert.deepEqual(await fs.readFile(destination), imageBytes);
  await assert.rejects(transferArtifact({ source, destination, generatedRoot }), /EEXIST/);
  assert.deepEqual(await fs.readFile(destination), imageBytes);
  const outside = join(root, "outside.png");
  await fs.writeFile(outside, imageBytes);
  await assert.rejects(transferArtifact({ source: outside, destination, generatedRoot }), /outside/);
});

for (const method of ["writeFile", "sync", "close"]) {
  test(`a destination ${method} failure preserves source and removes partial output`, async (t) => {
    const args = await fixture(t);
    await assert.rejects(transferArtifact(args,
      destinationHandleFailure(args.destination, method, `${method} failed`)), /failed/);
    assert.deepEqual(await fs.readFile(args.source), imageBytes);
    await assert.rejects(fs.lstat(args.destination), { code: "ENOENT" });
  });
}

test("rollback failures retain the original error", async (t) => {
  const args = await fixture(t);
  await assert.rejects(transferArtifact(args, {
    ...destinationHandleFailure(args.destination, "writeFile", "write failed"),
    async unlink() { throw new Error("rollback removal failed"); },
  }), /write failed.*rollback failed.*rollback removal failed/);
  assert.deepEqual(await fs.readFile(args.source), imageBytes);
});

test("another session's image cannot be delivered as this Image Run", async (t) => {
  const args = await fixture(t);
  await assert.rejects(transferArtifact({ ...args, threadId: "different-thread" }), /different Image Run/);
  await assert.rejects(fs.lstat(args.destination), { code: "ENOENT" });
});

test("inline images decode and malformed base64 never reaches a destination", async (t) => {
  const args = await fixture(t);
  const data = imageBytes.toString("base64");
  await transferArtifact({ destination: args.destination, data });
  assert.deepEqual(await fs.readFile(args.destination), imageBytes);
  for (const bad of ["invalid", "!!!!", data.slice(0, -5)]) {
    await assert.rejects(transferArtifact({ destination: args.destination + ".bad", data: bad }), /image/);
  }
});

test("non-images and truncated images are rejected before delivery", async (t) => {
  const args = await fixture(t);
  for (const contents of [Buffer.from("not an image"), imageBytes.subarray(0, 45)]) {
    await fs.writeFile(args.source, contents);
    await assert.rejects(transferArtifact(args), /decode|image/i);
    await assert.rejects(fs.lstat(args.destination), { code: "ENOENT" });
    assert.deepEqual(await fs.readFile(args.source), contents);
  }
});
