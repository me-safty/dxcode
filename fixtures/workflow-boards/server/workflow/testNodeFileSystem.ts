// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as PlatformError from "effect/PlatformError";

const platformError = (method: string, pathOrDescriptor: string | number, cause: unknown) =>
  PlatformError.systemError({
    _tag: "Unknown",
    module: "testNodeFileSystem",
    method,
    pathOrDescriptor,
    cause,
  });

const nodeEffect = <A>(
  method: string,
  pathOrDescriptor: string | number,
  evaluate: () => Promise<A>,
) =>
  Effect.tryPromise({
    try: evaluate,
    catch: (cause) => platformError(method, pathOrDescriptor, cause),
  });

const makeTempDirectory = (options?: {
  readonly directory?: string | undefined;
  readonly prefix?: string | undefined;
}) => {
  const parent = options?.directory ?? NodeOS.tmpdir();
  const prefix = options?.prefix ?? "tmp-";
  return nodeEffect("makeTempDirectory", parent, () =>
    NodeFSP.mkdtemp(NodePath.join(parent, prefix)),
  );
};

const unsupported = (method: string) =>
  Effect.die(new Error(`test FileSystem method not implemented: ${method}`)) as never;

const nodeFileSystem: Partial<FileSystem.FileSystem> = {
  access: (path) => nodeEffect("access", path, () => NodeFSP.access(path)),
  copy: (fromPath, toPath, options) =>
    nodeEffect("copy", fromPath, () =>
      NodeFSP.cp(fromPath, toPath, {
        recursive: true,
        force: options?.overwrite ?? false,
        preserveTimestamps: options?.preserveTimestamps ?? false,
      }),
    ),
  copyFile: (fromPath, toPath) =>
    nodeEffect("copyFile", fromPath, () => NodeFSP.copyFile(fromPath, toPath)),
  chmod: (path, mode) => nodeEffect("chmod", path, () => NodeFSP.chmod(path, mode)),
  chown: (path, uid, gid) => nodeEffect("chown", path, () => NodeFSP.chown(path, uid, gid)),
  exists: (path) =>
    nodeEffect("access", path, () => NodeFSP.access(path)).pipe(
      Effect.as(true),
      Effect.orElseSucceed(() => false),
    ),
  link: (fromPath, toPath) => nodeEffect("link", fromPath, () => NodeFSP.link(fromPath, toPath)),
  makeDirectory: (path, options) =>
    nodeEffect("makeDirectory", path, () =>
      NodeFSP.mkdir(path, {
        recursive: options?.recursive ?? false,
        mode: options?.mode,
      }).then(() => undefined),
    ),
  makeTempDirectory,
  makeTempDirectoryScoped: (options) =>
    Effect.acquireRelease(makeTempDirectory(options), (path) =>
      nodeEffect("remove", path, () => NodeFSP.rm(path, { recursive: true, force: true })).pipe(
        Effect.ignore,
      ),
    ),
  makeTempFile: (options) =>
    Effect.gen(function* () {
      const dir = yield* makeTempDirectory({
        ...(options?.directory === undefined ? {} : { directory: options.directory }),
        prefix: options?.prefix ?? "tmp-file-",
      });
      const file = NodePath.join(dir, `file${options?.suffix ?? ""}`);
      yield* nodeEffect("writeFile", file, () => NodeFSP.writeFile(file, new Uint8Array()));
      return file;
    }),
  makeTempFileScoped: (options) =>
    Effect.acquireRelease(
      Effect.gen(function* () {
        const dir = yield* makeTempDirectory({
          ...(options?.directory === undefined ? {} : { directory: options.directory }),
          prefix: options?.prefix ?? "tmp-file-",
        });
        const file = NodePath.join(dir, `file${options?.suffix ?? ""}`);
        yield* nodeEffect("writeFile", file, () => NodeFSP.writeFile(file, new Uint8Array()));
        return file;
      }),
      (path) =>
        nodeEffect("remove", path, () => NodeFSP.rm(path, { force: true })).pipe(Effect.ignore),
    ),
  open: () => unsupported("open"),
  readDirectory: (path, options) =>
    nodeEffect("readDirectory", path, () =>
      NodeFSP.readdir(path, { recursive: options?.recursive ?? false }).then((entries) =>
        entries.map(String),
      ),
    ),
  readFile: (path) =>
    nodeEffect("readFile", path, () =>
      NodeFSP.readFile(path).then((buffer) => new Uint8Array(buffer)),
    ),
  readFileString: (path, encoding = "utf-8") =>
    nodeEffect("readFileString", path, () => NodeFSP.readFile(path, encoding as BufferEncoding)),
  readLink: (path) => nodeEffect("readLink", path, () => NodeFSP.readlink(path)),
  realPath: (path) => nodeEffect("realPath", path, () => NodeFSP.realpath(path)),
  remove: (path, options) =>
    nodeEffect("remove", path, () =>
      NodeFSP.rm(path, {
        recursive: options?.recursive ?? false,
        force: options?.force ?? false,
      }),
    ),
  rename: (oldPath, newPath) =>
    nodeEffect("rename", oldPath, () => NodeFSP.rename(oldPath, newPath)),
  sink: () => unsupported("sink"),
  stat: () => unsupported("stat"),
  stream: () => unsupported("stream"),
  truncate: (path, length) =>
    nodeEffect("truncate", path, () =>
      NodeFSP.truncate(path, length === undefined ? undefined : Number(length)),
    ),
  symlink: (fromPath, toPath) =>
    nodeEffect("symlink", fromPath, () => NodeFSP.symlink(fromPath, toPath)),
  utimes: (path, atime, mtime) =>
    nodeEffect("utimes", path, () => NodeFSP.utimes(path, atime, mtime)),
  watch: () => unsupported("watch"),
  writeFile: (path, data) =>
    nodeEffect("writeFile", path, async () => {
      await NodeFSP.mkdir(NodePath.dirname(path), { recursive: true });
      await NodeFSP.writeFile(path, data);
    }),
  writeFileString: (path, data) =>
    nodeEffect("writeFileString", path, async () => {
      await NodeFSP.mkdir(NodePath.dirname(path), { recursive: true });
      await NodeFSP.writeFile(path, data, "utf-8");
    }),
};

export const TestNodeFileSystemLive = Layer.succeed(
  FileSystem.FileSystem,
  nodeFileSystem as FileSystem.FileSystem,
);
