import { constants } from "node:fs";
import * as fileSystem from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

function sameFile(left, right) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs
  );
}

async function validateSource(source, generatedRoot, fs) {
  const recordedSource = resolve(source);
  const recordedInfo = await fs.lstat(recordedSource);
  if (!recordedInfo.isFile()) {
    throw new Error("recorded artifact is not a regular file");
  }

  const root = await fs.realpath(resolve(generatedRoot));
  const actualSource = await fs.realpath(recordedSource);
  const sourceRelative = relative(root, actualSource);
  if (
    sourceRelative === ".." ||
    sourceRelative.startsWith(`..${sep}`) ||
    isAbsolute(sourceRelative)
  ) {
    throw new Error("recorded artifact is outside CODEX_HOME/generated_images");
  }

  const sourceInfo = await fs.stat(actualSource);
  if (!sourceInfo.isFile()) throw new Error("generated artifact is not a regular file");
  await fs.access(actualSource, constants.R_OK);
  return { source: actualSource, sourceInfo };
}

export async function transferArtifact(
  { source: recordedSource, destination: requestedDestination, generatedRoot },
  fs = fileSystem,
) {
  const { source, sourceInfo } = await validateSource(recordedSource, generatedRoot, fs);
  const destination = resolve(requestedDestination);
  await fs.mkdir(dirname(destination), { recursive: true });

  const sourceHandle = await fs.open(
    source,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  let contents;
  try {
    const openedInfo = await sourceHandle.stat();
    if (!sameFile(openedInfo, sourceInfo)) {
      throw new Error("generated artifact changed before it could be copied");
    }
    contents = await sourceHandle.readFile();
  } finally {
    await sourceHandle.close();
  }

  let destinationHandle;
  let destinationCreated = false;
  try {
    destinationHandle = await fs.open(destination, "wx");
    destinationCreated = true;
    await destinationHandle.writeFile(contents);
    await destinationHandle.sync();
    await destinationHandle.close();
    destinationHandle = undefined;

    const currentInfo = await fs.lstat(source);
    if (!sameFile(currentInfo, sourceInfo)) {
      throw new Error("generated artifact changed before it could be removed");
    }
    await fs.unlink(source);
    return destination;
  } catch (error) {
    const rollbackErrors = [];
    if (destinationHandle) {
      try {
        await destinationHandle.close();
      } catch (closeError) {
        rollbackErrors.push(closeError);
      }
    }
    if (destinationCreated) {
      try {
        await fs.unlink(destination);
      } catch (unlinkError) {
        rollbackErrors.push(unlinkError);
      }
    }
    if (rollbackErrors.length) {
      throw new AggregateError(
        [error, ...rollbackErrors],
        `${error.message}; rollback failed: ${rollbackErrors.map(({ message }) => message).join("; ")}`,
        { cause: error },
      );
    }
    throw error;
  }
}
