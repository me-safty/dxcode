async function computeHmacHex(body: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function constantTimeCompare(left: string, right: string): boolean {
  if (left.length !== right.length) {
    return false;
  }
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

export async function hasValidLinearSignature(input: {
  readonly body: string;
  readonly request: Request;
  readonly secret: string;
}): Promise<boolean> {
  const signature = input.request.headers.get("linear-signature")?.trim();
  if (!signature) {
    return false;
  }
  const expected = await computeHmacHex(input.body, input.secret);
  return constantTimeCompare(expected, signature);
}
