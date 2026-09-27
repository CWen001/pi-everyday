import { constants } from "node:fs";
import { PhotonImage } from "@silvia-odwyer/photon-node";
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

async function validateSource(source, generatedRoot, threadId, fs) {
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

  if (threadId && sourceRelative.split(sep)[0] !== threadId) {
    throw new Error("recorded artifact belongs to a different Image Run");
  }
  const sourceInfo = await fs.stat(actualSource);
  if (!sourceInfo.isFile()) throw new Error("generated artifact is not a regular file");
  await fs.access(actualSource, constants.R_OK);
  return { source: actualSource, sourceInfo };
}

export async function transferArtifact(
  { source: recordedSource, data, destination: requestedDestination, generatedRoot, threadId },
  fs = fileSystem,
) {
  let source, sourceInfo, contents;
  if (recordedSource) {
    ({ source, sourceInfo } = await validateSource(recordedSource, generatedRoot, threadId, fs));
    const handle = await fs.open(source, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      if (!sameFile(await handle.stat(), sourceInfo)) {
        throw new Error("generated artifact changed before it could be copied");
      }
      contents = await handle.readFile();
    } finally {
      await handle.close();
    }
  } else {
    if (typeof data !== "string" || !data || data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) {
      throw new Error("invalid inline image data");
    }
    contents = Buffer.from(data, "base64");
  }
  let image;
  try {
    image = PhotonImage.new_from_byteslice(contents);
    if (!image.get_width() || !image.get_height()) throw new Error("empty image");
  } catch {
    throw new Error("generated image could not be decoded");
  } finally {
    image?.free();
  }
  const destination = resolve(requestedDestination);

  let destinationHandle;
  let destinationCreated = false;
  try {
    await fs.mkdir(dirname(destination), { recursive: true });
    destinationHandle = await fs.open(destination, "wx");
    destinationCreated = true;
    await destinationHandle.writeFile(contents);
    await destinationHandle.sync();
    await destinationHandle.close();
    destinationHandle = undefined;

    if (source && !sameFile(await fs.lstat(source), sourceInfo)) {
      throw new Error("generated artifact changed while being copied");
    }
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
      error = new AggregateError(
        [error, ...rollbackErrors],
        `${error.message}; rollback failed: ${rollbackErrors.map(({ message }) => message).join("; ")}`,
        { cause: error },
      );
    }
    if (source) {
      try {
        if (sameFile(await fs.lstat(source), sourceInfo)) error.validSource = source;
      } catch { /* The original is no longer available; do not advertise it as valid. */ }
    }
    throw error;
  }
}
