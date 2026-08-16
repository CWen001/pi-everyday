import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { transferArtifact } from "../skills/codex-image-gen/scripts/artifact-custody.mjs";

async function fixture() {
  const temporaryRoot = await fs.mkdtemp(join(tmpdir(), "artifact-custody-"));
  const root = await fs.realpath(temporaryRoot);
  const generatedRoot = join(root, "generated_images");
  const source = join(generatedRoot, "thread", "image.png");
  const destination = join(root, "workspace", "image.png");
  await fs.mkdir(join(generatedRoot, "thread"), { recursive: true });
  await fs.writeFile(source, "generated-image");
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
          if (property === method && !failed) {
            return async () => {
              failed = true;
              throw new Error(message);
            };
          }
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    },
  };
}

async function assertSourceOnly(source, destination) {
  assert.equal(await fs.readFile(source, "utf8"), "generated-image");
  await assert.rejects(fs.lstat(destination), { code: "ENOENT" });
}

test("transferArtifact validates provenance and commits an exclusive destination", async () => {
  const { root, generatedRoot, source, destination } = await fixture();
  const order = [];
  const operations = {
    ...fs,
    async open(path, flags, ...args) {
      const handle = await fs.open(path, flags, ...args);
      if (path !== destination) return handle;
      return new Proxy(handle, {
        get(target, property) {
          if (property === "sync" || property === "close") {
            return async (...callArgs) => {
              order.push(property);
              return target[property](...callArgs);
            };
          }
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    },
    async unlink(path) {
      if (path === source) order.push("remove-source");
      return fs.unlink(path);
    },
  };

  assert.equal(
    await transferArtifact({ source, destination, generatedRoot }, operations),
    destination,
  );
  assert.equal(await fs.readFile(destination, "utf8"), "generated-image");
  await assert.rejects(fs.lstat(source), { code: "ENOENT" });
  assert.deepEqual(order, ["sync", "close", "remove-source"]);

  const outside = join(root, "outside.png");
  await fs.writeFile(outside, "keep");
  await assert.rejects(
    transferArtifact({ source: outside, destination: join(root, "bad.png"), generatedRoot }),
    /outside .*generated_images/i,
  );
  assert.equal(await fs.readFile(outside, "utf8"), "keep");

  const secondSource = join(generatedRoot, "thread", "second.png");
  await fs.writeFile(secondSource, "second");
  await assert.rejects(
    transferArtifact({ source: secondSource, destination, generatedRoot }),
    /EEXIST|already exists/i,
  );
  assert.equal(await fs.readFile(destination, "utf8"), "generated-image");
  assert.equal(await fs.readFile(secondSource, "utf8"), "second");
});

test("a destination write failure rolls back and preserves the source", async () => {
  const { generatedRoot, source, destination } = await fixture();
  await assert.rejects(
    transferArtifact(
      { source, destination, generatedRoot },
      destinationHandleFailure(destination, "writeFile", "write failed"),
    ),
    /write failed/,
  );
  await assertSourceOnly(source, destination);
});

test("a destination close failure rolls back and preserves the source", async () => {
  const { generatedRoot, source, destination } = await fixture();
  await assert.rejects(
    transferArtifact(
      { source, destination, generatedRoot },
      destinationHandleFailure(destination, "close", "close failed"),
    ),
    /close failed/,
  );
  await assertSourceOnly(source, destination);
});

test("a source-removal failure rolls back and preserves the source", async () => {
  const { generatedRoot, source, destination } = await fixture();
  await assert.rejects(
    transferArtifact(
      { source, destination, generatedRoot },
      {
        ...fs,
        async unlink(path) {
          if (path === source) throw new Error("source removal failed");
          return fs.unlink(path);
        },
      },
    ),
    /source removal failed/,
  );
  await assertSourceOnly(source, destination);
});

test("a rollback failure is reported without hiding the original failure", async () => {
  const { generatedRoot, source, destination } = await fixture();
  await assert.rejects(
    transferArtifact(
      { source, destination, generatedRoot },
      {
        ...destinationHandleFailure(destination, "writeFile", "write failed"),
        async unlink(path) {
          if (path === destination) throw new Error("rollback removal failed");
          return fs.unlink(path);
        },
      },
    ),
    (error) => {
      assert.match(error.message, /write failed/);
      assert.match(error.message, /rollback failed/);
      assert.match(error.message, /rollback removal failed/);
      return true;
    },
  );
  assert.equal(await fs.readFile(source, "utf8"), "generated-image");
  assert.equal(await fs.readFile(destination, "utf8"), "");
});
