/**
 * RSA key management for JWT signing.
 * Lazily generates a key pair on first use and caches it module-level.
 */
import type { CryptoKey } from "jose";
import * as jose from "jose";

let privateKey: CryptoKey | undefined;
let jwkData: jose.JWK | undefined;

const kid = "workos-emulator-key-1";

async function ensureKeys(): Promise<void> {
  if (privateKey) return;
  const { privateKey: priv, publicKey: pub } = await jose.generateKeyPair("RS256", {
    extractable: true,
  });
  privateKey = priv;
  jwkData = await jose.exportJWK(pub);
  jwkData.kid = kid;
  jwkData.use = "sig";
  jwkData.alg = "RS256";
}

export async function getJWKS(): Promise<{ keys: jose.JWK[] }> {
  await ensureKeys();
  return { keys: [jwkData!] };
}

export async function signJWT(
  payload: Record<string, unknown>,
  options: { issuer: string; expiresIn?: string },
): Promise<string> {
  await ensureKeys();
  return new jose.SignJWT(payload)
    .setProtectedHeader({ alg: "RS256", kid })
    .setIssuedAt()
    .setIssuer(options.issuer)
    .setExpirationTime(options.expiresIn ?? "1h")
    .sign(privateKey!);
}
