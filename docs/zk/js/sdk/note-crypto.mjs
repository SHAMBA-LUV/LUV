// note-crypto.mjs — encrypt a join-split note to its receiver, so the receiver can find and
// spend it using only what is on-chain. Zero dependencies: X25519 + HKDF-SHA256 +
// ChaCha20-Poly1305 from node:crypto.
//
// Why it is needed: a note is (amount, pubKey, blinding) but only Poseidon(...) of it goes
// on-chain. The receiver knows pubKey (it's theirs) but cannot spend the note without amount and
// blinding. The sender therefore encrypts (amount, blinding) to the receiver's ENCRYPTION key and
// the pool emits the ciphertext next to the commitment. VariablePool binds the ciphertexts into
// extDataHash, so a relayer cannot swap them and make a payment undiscoverable.
//
// Ciphertext layout (124 bytes):  ephemeralPub(32) ‖ nonce(12) ‖ ChaCha20-Poly1305(amount ‖ blinding)(64) ‖ tag(16)
// Each note uses a fresh ephemeral key, so two payments to the same person are unlinkable.
//
// EDUCATIONAL: production wallets use audited schemes (e.g. Tornado Nova uses
// x25519-xsalsa20-poly1305 via eth-sig-util; Zcash Sapling uses its own note encryption) and
// derive the encryption key from the spending key so one backup restores both.

import { generateKeyPairSync, createPublicKey, createPrivateKey, diffieHellman, hkdfSync, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

const INFO = Buffer.from('LUV-ZK-GUIDE/note-encryption/v1');
const b64u = (buf) => Buffer.from(buf).toString('base64url');
const word = (v) => Buffer.from(BigInt(v).toString(16).padStart(64, '0'), 'hex');

/** A fresh X25519 key pair; `publicKey` (32 bytes, hex) is what senders encrypt to. */
export function createEncryptionKey() {
  const { publicKey, privateKey } = generateKeyPairSync('x25519');
  return {
    publicKey: '0x' + Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url').toString('hex'),
    privateKey, // a KeyObject; never leaves the wallet
  };
}

const pubFromHex = (hex) => createPublicKey({ key: { kty: 'OKP', crv: 'X25519', x: b64u(Buffer.from(hex.replace(/^0x/, ''), 'hex')) }, format: 'jwk' });

function keyFor(shared, ephPub) {
  return Buffer.from(hkdfSync('sha256', shared, ephPub, INFO, 32));
}

/** Encrypt (amount, blinding) to `encryptionPublicKey`. Returns 0x-hex (124 bytes). */
export function encryptNote({ amount, blinding }, encryptionPublicKey) {
  const eph = generateKeyPairSync('x25519');
  const ephPub = Buffer.from(eph.publicKey.export({ format: 'jwk' }).x, 'base64url');
  const shared = diffieHellman({ privateKey: eph.privateKey, publicKey: pubFromHex(encryptionPublicKey) });
  const nonce = randomBytes(12);
  const c = createCipheriv('chacha20-poly1305', keyFor(shared, ephPub), nonce, { authTagLength: 16 });
  c.setAAD(INFO);
  const ct = Buffer.concat([c.update(Buffer.concat([word(amount), word(blinding)])), c.final()]);
  return '0x' + Buffer.concat([ephPub, nonce, ct, c.getAuthTag()]).toString('hex');
}

/** Try to decrypt with `encryptionPrivateKey`. Returns { amount, blinding } or null (not ours / tampered). */
export function decryptNote(ciphertextHex, encryptionPrivateKey) {
  const buf = Buffer.from(ciphertextHex.replace(/^0x/, ''), 'hex');
  if (buf.length !== 32 + 12 + 64 + 16) return null;
  const ephPub = buf.subarray(0, 32), nonce = buf.subarray(32, 44), ct = buf.subarray(44, 108), tag = buf.subarray(108);
  try {
    const priv = encryptionPrivateKey instanceof Object && encryptionPrivateKey.type === 'private'
      ? encryptionPrivateKey : createPrivateKey(encryptionPrivateKey);
    const shared = diffieHellman({ privateKey: priv, publicKey: pubFromHex(ephPub.toString('hex')) });
    const d = createDecipheriv('chacha20-poly1305', keyFor(shared, ephPub), nonce, { authTagLength: 16 });
    d.setAAD(INFO);
    d.setAuthTag(tag);
    const pt = Buffer.concat([d.update(ct), d.final()]);
    return { amount: BigInt('0x' + pt.subarray(0, 32).toString('hex')), blinding: BigInt('0x' + pt.subarray(32).toString('hex')) };
  } catch {
    return null; // wrong key or modified ciphertext: the Poly1305 tag does not verify
  }
}
