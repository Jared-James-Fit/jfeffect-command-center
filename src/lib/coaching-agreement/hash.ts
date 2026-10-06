/**
 * SHA-256 that works in the browser (WebCrypto, HTTPS) and in Node 20+.
 *
 * The signing flow hashes the agreement text it is actually *displaying* and sends
 * that with the signature. The server compares it to its own current hash, so a
 * phone running a stale cached copy of the app can never sign wording it didn't see.
 */
export async function sha256HexAsync(value: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("Secure signing isn't available in this browser.");
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
