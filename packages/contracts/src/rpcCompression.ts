/**
 * Serialization-layer gzip compression for the T3 Code WebSocket RPC.
 *
 * Wraps (does not fork) effect's `json` `RpcSerialization` in a symmetric codec
 * that emits a **binary** WS frame = `1 prefix byte + body`:
 *   - `0x00` = RAW  (utf8 JSON, uncompressed)  — used below the size threshold
 *   - `0x01` = GZIP (gzip of utf8 JSON)         — used at/above the threshold
 *   - `0x02` reserved for a future zstd/msgpack swap
 *
 * Both ends run identical code so the wire format stays symmetric. Framing is
 * left to the transport (`includesFraming: false`, mirroring `json`) because WS
 * preserves message boundaries and each `encode`/`decode` is one-message-per-
 * frame. `decode` normalizes `string | Uint8Array | ArrayBuffer` because React
 * Native delivers binary WS frames as `ArrayBuffer`.
 *
 * The actual (de)compression primitive is injected via {@link RpcCompressionCodec}
 * so `@t3tools/contracts` stays platform-agnostic: the server provides a
 * `node:zlib` codec, the mobile client a `pako` codec.
 */
import * as Context from "effect/Context";
import * as Layer from "effect/Layer";
import { type Parser, RpcSerialization } from "effect/unstable/rpc/RpcSerialization";

/**
 * A synchronous, symmetric gzip primitive plus the byte threshold above which
 * compression is applied. `compressSync` must gzip its input and
 * `decompressSync` must be its exact inverse.
 */
export interface CompressionCodec {
  readonly compressSync: (b: Uint8Array) => Uint8Array;
  readonly decompressSync: (b: Uint8Array) => Uint8Array;
  readonly threshold: number;
}

/**
 * Context reference holding the platform-specific {@link CompressionCodec},
 * or `null` when the platform provides none. Defaulting to `null` means only
 * platforms that opt into the compressed transport need to provide it —
 * `yield* RpcCompressionCodec` never fails, and a client without a codec
 * simply keeps using the plain JSON transport.
 */
export class RpcCompressionCodec extends Context.Reference<CompressionCodec | null>(
  "@t3tools/contracts/rpcCompression/RpcCompressionCodec",
  { defaultValue: () => null },
) {}

/**
 * Content type for the compressed-JSON wire format. Distinct from
 * `application/json` so a mismatched peer is not silently interpreted.
 */
export const COMPRESSED_JSON_CONTENT_TYPE = "application/x-t3-cjson";

/** Prefix byte marking a RAW (uncompressed utf8 JSON) frame body. */
export const CJSON_PREFIX_RAW = 0x00;
/** Prefix byte marking a GZIP (gzipped utf8 JSON) frame body. */
export const CJSON_PREFIX_GZIP = 0x01;

/**
 * Builds an `RpcSerialization` service value that gzips whole-message JSON
 * payloads above `codec.threshold`, mirroring the shape of `json` so it can be
 * dropped in wherever `json`/`layerJson` is used on a framed (WS) transport.
 */
export const makeCompressedJsonSerialization = (
  codec: CompressionCodec,
): RpcSerialization["Service"] =>
  RpcSerialization.of({
    contentType: COMPRESSED_JSON_CONTENT_TYPE,
    includesFraming: false,
    makeUnsafe: (): Parser => {
      const enc = new TextEncoder();
      const dec = new TextDecoder();
      return {
        encode: (response) => {
          const json: string | undefined = JSON.stringify(response);
          if (json === undefined) return undefined;
          const utf8 = enc.encode(json);
          if (utf8.length < codec.threshold) {
            const out = new Uint8Array(utf8.length + 1);
            out[0] = CJSON_PREFIX_RAW;
            out.set(utf8, 1);
            return out;
          }
          const gz = codec.compressSync(utf8);
          const out = new Uint8Array(gz.length + 1);
          out[0] = CJSON_PREFIX_GZIP;
          out.set(gz, 1);
          return out;
        },
        decode: (data) => {
          if (typeof data === "string") {
            const parsed = JSON.parse(data);
            return Array.isArray(parsed) ? parsed : [parsed];
          }
          // React Native delivers binary frames as ArrayBuffer; normalize it.
          const bytes = data instanceof Uint8Array ? data : new Uint8Array(data as ArrayBuffer);
          const body = bytes.subarray(1);
          const json =
            bytes[0] === CJSON_PREFIX_GZIP
              ? dec.decode(codec.decompressSync(body))
              : dec.decode(body);
          const parsed = JSON.parse(json);
          return Array.isArray(parsed) ? parsed : [parsed];
        },
      };
    },
  });

/**
 * `RpcSerialization` layer for the compressed-JSON format, mirroring
 * `RpcSerialization.layerJson`. Both ends must provide the same-shaped codec.
 */
export const layerCompressedJson = (codec: CompressionCodec): Layer.Layer<RpcSerialization> =>
  Layer.succeed(RpcSerialization)(makeCompressedJsonSerialization(codec));
