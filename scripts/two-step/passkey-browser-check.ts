/**
 * Passkeys against a real browser: Chromium's virtual authenticator (an
 * internal authenticator with user verification, like Face ID) makes a
 * passkey and signs in with it through the app's own browser code
 * (webauthn-browser.ts), and the server's verifier (webauthn.ts) checks both
 * answers. Writes what the browser sent to src/test/fixtures/passkey-chromium.json
 * so the unit tests check a real browser's bytes without a browser.
 *
 *   npx tsx scripts/two-step/passkey-browser-check.ts
 */
import { createServer } from "node:http";
import { writeFileSync } from "node:fs";
import { build } from "esbuild";
import path from "node:path";
import {
  creationOptions,
  newChallenge,
  requestOptions,
  verifyAssertion,
  verifyRegistration,
} from "../../src/lib/webauthn";

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// Playwright is installed with the browser, outside the app's dependencies.
const { chromium } = createRequire(import.meta.url)("playwright");
const here = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const root = path.resolve(here, "../..");
  const bundle = await build({
    stdin: {
      contents: `import { createPasskey, getPasskey } from "@/lib/webauthn-browser"; (window as any).jf = { createPasskey, getPasskey };`,
      resolveDir: root,
      loader: "ts",
    },
    bundle: true,
    write: false,
    format: "iife",
    alias: { "@": path.join(root, "src") },
  });
  const js = bundle.outputFiles[0].text;
  const server = createServer((req, res) => {
    if (req.url === "/b.js") {
      res.writeHead(200, { "content-type": "text/javascript" });
      res.end(js);
      return;
    }
    res.writeHead(200, { "content-type": "text/html" });
    res.end(`<!doctype html><html><body><script src="/b.js"></script></body></html>`);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as any).port;
  const origin = `http://localhost:${port}`;

  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(`${origin}/`);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
    },
  });

  const rpId = "localhost";
  const regChallenge = newChallenge();
  const opts = creationOptions({
    challenge: regChallenge,
    rpId,
    userId: "00000000-0000-0000-0000-00000000000a",
    email: "owner@example.com",
    name: "Owner",
    exclude: [],
  });
  const registration = await page.evaluate((o: any) => (window as any).jf.createPasskey(o), opts);
  const saved = await verifyRegistration({
    credential: registration,
    challenge: regChallenge,
    rpId,
  });
  console.log(
    "registration ok:",
    saved.alg,
    saved.credentialId.slice(0, 12) + "…",
    "counter",
    saved.signCount,
    "transports",
    saved.transports,
  );

  const signChallenge = newChallenge();
  const ropts = requestOptions({
    challenge: signChallenge,
    rpId,
    allow: [{ id: saved.credentialId, transports: saved.transports }],
  });
  const assertion = await page.evaluate((o: any) => (window as any).jf.getPasskey(o), ropts);
  const used = await verifyAssertion({
    credential: assertion,
    challenge: signChallenge,
    rpId,
    jwk: saved.jwk,
    alg: saved.alg,
    storedSignCount: saved.signCount,
  });
  console.log("sign-in ok: counter", used.signCount);

  // A second sign-in moves the counter on and still checks out.
  const c2 = newChallenge();
  const a2 = await page.evaluate(
    (o: any) => (window as any).jf.getPasskey(o),
    requestOptions({ challenge: c2, rpId, allow: [{ id: saved.credentialId }] }),
  );
  const used2 = await verifyAssertion({
    credential: a2,
    challenge: c2,
    rpId,
    jwk: saved.jwk,
    alg: saved.alg,
    storedSignCount: used.signCount,
  });
  console.log("second sign-in ok: counter", used2.signCount);

  writeFileSync(
    path.join(root, "src/test/fixtures/passkey-chromium.json"),
    JSON.stringify(
      {
        rpId,
        origin,
        registration: { challenge: regChallenge, credential: registration },
        assertion: { challenge: signChallenge, credential: assertion },
      },
      null,
      2,
    ) + "\n",
  );
  await browser.close();
  server.close();
  console.log("passkey browser check: passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
