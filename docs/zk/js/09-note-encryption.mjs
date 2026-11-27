// 09-note-encryption.mjs — how a private payment reaches its receiver.
//
// A join-split note (§10.9 of the guide) is (amount, pubKey, blinding); only a hash of it is
// on-chain. To spend it, the receiver must learn amount and blinding. The sender encrypts them to
// the receiver's X25519 encryption key; the pool emits the ciphertext; the receiver's wallet tries
// every ciphertext and keeps the ones that decrypt (then re-checks them against the commitment).
//
// This example uses only node:crypto — it is the same module the SDK and evm/e2e.mjs use.
// Run: node docs/zk/js/09-note-encryption.mjs

import assert from 'node:assert/strict';
import { createEncryptionKey, encryptNote, decryptNote } from './sdk/note-crypto.mjs';

const bob = createEncryptionKey();     // Bob publishes bob.publicKey (32 bytes)
const eve = createEncryptionKey();     // an eavesdropper scanning the same events

const note = { amount: 70n * 10n ** 18n, blinding: 0x1234567890abcdefn };
const ct = encryptNote(note, bob.publicKey);
assert.equal((ct.length - 2) / 2, 124);
console.log('✓ note encrypted to Bob: 124 bytes (ephemeral key ‖ nonce ‖ ciphertext ‖ tag)');

assert.deepEqual(decryptNote(ct, bob.privateKey), note);
console.log('✓ Bob decrypts amount and blinding');

assert.equal(decryptNote(ct, eve.privateKey), null);
console.log('✓ Eve, scanning the same chain, learns nothing (authentication fails)');

const tampered = ct.slice(0, -2) + (ct.endsWith('00') ? '01' : '00');
assert.equal(decryptNote(tampered, bob.privateKey), null);
console.log('✓ a modified ciphertext is rejected, not silently mis-decrypted');

const again = encryptNote(note, bob.publicKey);
assert.notEqual(again, ct);
assert.notEqual(again.slice(0, 66), ct.slice(0, 66));
console.log('✓ two payments of the same note to Bob look unrelated (fresh ephemeral key each time)');
console.log('  (the pool binds ciphertexts into extDataHash, so a relayer cannot replace them)');
