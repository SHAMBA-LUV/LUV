# Zero-Knowledge Proofs: an introduction and usage guide

> **What you get:** a working introduction to zero-knowledge proofs (ZKPs). It starts with
> the definitions, builds and attacks real protocols in runnable code, and ends with a
> zk-SNARK verified on-chain in Solidity. Every claim links to source code: the examples in
> [`docs/zk/`](zk/) and the canonical upstream implementations, specs and papers in
> [§13](#13-complete-reference).

```bash
node docs/zk/js/run-all.mjs     # Node ≥ 18, zero dependencies: runs all 7 examples (~15 s)
```

The JavaScript examples use only `BigInt` and `node:crypto`, and they run as-is. The
library [`secp256k1.mjs`](zk/js/secp256k1.mjs) checks its own curve arithmetic against
OpenSSL before the examples run. The SNARK pipeline in §9 needs `circom`, `snarkjs` and
`forge`; the scripts are provided as reference.

> ⚠ **Educational code.** It is correct but not constant-time and not audited. Never use it to
> protect real value. Production libraries are listed in [§13](#13-complete-reference).

---

## Contents

1. [What a zero-knowledge proof is](#1-what-a-zero-knowledge-proof-is)
2. [Vocabulary](#2-vocabulary)
3. [Your first ZK protocol: Schnorr](#3-your-first-zk-protocol-schnorr)
4. [Why it is zero-knowledge: the simulator](#4-why-it-is-zero-knowledge-the-simulator)
5. [Why it is sound: the extractor (and the nonce-reuse attack)](#5-why-it-is-sound-the-extractor)
6. [Going non-interactive: Fiat–Shamir (and the Frozen Heart bug)](#6-going-non-interactive-fiatshamir)
7. [Commitments, hidden amounts and nullifiers](#7-commitments-hidden-amounts-and-nullifiers)
8. [From programs to proofs: R1CS → QAP → zk-SNARK](#8-from-programs-to-proofs-r1cs--qap--zk-snark)
9. [Building a real SNARK: Circom → snarkjs → Solidity → Foundry](#9-building-a-real-snark-circom--snarkjs--solidity--foundry)
10. [Design pattern: a private airdrop claim](#10-design-pattern-a-private-airdrop-claim)
11. [Choosing a proof system](#11-choosing-a-proof-system)
12. [Security checklist](#12-security-checklist)
13. [Complete reference](#13-complete-reference)

---

## 1. What a zero-knowledge proof is

A **zero-knowledge proof** lets a **prover** convince a **verifier** that a statement is true
without revealing anything beyond the fact that it is true.

The statement is usually *"I know a secret **witness** `w` such that `R(x, w)` holds"* for a
public **instance** `x`. Some examples:

| public instance `x` | secret witness `w` | relation `R(x, w)` |
|---|---|---|
| a public key `X` | private key `x` | `X = x·G` |
| a hash `h` | a preimage `m` | `sha256(m) = h` |
| a Merkle root of registered members | a leaf + its Merkle path | the leaf is in the tree |
| a commitment to a balance | the balance and its blinding factor | the balance ≥ 100 |
| a program and its output | the program's private input | running the program gives that output |

Every ZK proof system must satisfy three properties (Goldwasser–Micali–Rackoff, 1985):

- **Completeness:** an honest prover with a valid witness always convinces an honest verifier.
- **Soundness:** a cheating prover without a valid witness convinces the verifier only with
  negligible probability. A *proof of knowledge* is stronger: any prover that succeeds can
  have the witness *extracted* from it, so it must "know" the witness.
- **Zero-knowledge:** the verifier learns nothing else. Formally, a **simulator** that has
  only `x` can produce transcripts that look exactly like real ones. Anything the verifier
  could compute from a real proof, it could have computed without the prover.

**The classic intuition (the "Ali Baba cave").** A ring-shaped cave has a magic door in the
middle. Peggy claims she knows the password. She enters, and Victor then shouts which side she
must come out of. If she knows the password, she can always obey. If she doesn't, she gets it
right only half the time. After 20 rounds a bluffer survives with probability 2⁻²⁰, and Victor
never hears the password. [§3](#3-your-first-zk-protocol-schnorr) turns this story into
working code.

---

## 2. Vocabulary

| term | meaning |
|---|---|
| **statement / instance** | the public claim being proven (e.g. "this public key", "this Merkle root") |
| **witness** | the secret that makes the statement true; it never leaves the prover |
| **Σ-protocol** | a 3-move proof: *commit → challenge → response* (Schnorr is the archetype) |
| **NIZK** | non-interactive zero-knowledge proof: one message, checkable by anyone, any time |
| **Fiat–Shamir** | the transform that turns a Σ-protocol into a NIZK by hashing to get the challenge |
| **commitment** | a sealed envelope: *hiding* (it reveals nothing) and *binding* (it can't be reopened differently) |
| **circuit** | a computation expressed as arithmetic constraints over a finite field |
| **R1CS** | Rank-1 Constraint System: constraints of the form `(A·w) × (B·w) = C·w` |
| **zk-SNARK** | Zero-Knowledge **S**uccinct **N**on-interactive **AR**gument of **K**nowledge: tiny proofs, fast verification |
| **zk-STARK** | **S**calable **T**ransparent ARK: no trusted setup, hash-based, plausibly post-quantum, larger proofs |
| **trusted setup** | a one-time ceremony that produces public parameters. Its secret randomness ("toxic waste") must be destroyed |
| **transparent** | needs no trusted setup |
| **public signals / inputs** | the circuit values the verifier sees (the statement) |
| **nullifier** | a deterministic tag derived from a secret. It stops double-use without revealing who used it |
| **soundness error** | the probability that a cheater is accepted |
| **argument** | a proof that is sound only against computationally bounded provers (most SNARKs are arguments) |

---

## 3. Your first ZK protocol: Schnorr

Source: [`docs/zk/js/01-schnorr-interactive.mjs`](zk/js/01-schnorr-interactive.mjs)

**Statement:** *"I know `x` such that `X = x·G`"* on secp256k1, the curve behind every
Ethereum key. In other words: *I own this public key*, proven without a signature and without
revealing the key.

```
Prover                                Verifier
r ← random,  R = r·G      ── R ──▶
                          ◀── c ──    c ← random
s = r + c·x  (mod N)      ── s ──▶
                                      accept iff  s·G == R + c·X
```

```js
class Prover {
  constructor(x) { this.x = x; }
  commit()   { this.r = randomScalar(); return mul(G, this.r); }   // R = r·G
  respond(c) { return mod(this.r + c * this.x, N); }               // s = r + c·x
}
const verify = (X, R, c, s) => eq(mul(G, s), add(R, mul(X, c)));  // s·G == R + c·X
```

**Completeness** is one line of algebra: `s·G = (r + c·x)·G = r·G + c·(x·G) = R + c·X`.

**Soundness in action.** A cheater can pass only by guessing `c` *before* sending `R`. It
picks `s` at random and sets `R = s·G − c_guess·X`. The example shrinks the challenge to one
bit so you can watch the cheater win about 50% of single rounds and essentially never survive
20 rounds (2⁻²⁰). With a full 256-bit challenge, one round already gives about 2⁻²⁵⁶.

```
✓ completeness: honest prover convinces the verifier
✓ soundness: with a 1-bit challenge the cheater passes 49.5% of single rounds (≈50%)
✓ soundness amplification: cheater survived 20 rounds in 0/100 attempts
```

---

## 4. Why it is zero-knowledge: the simulator

Source: [`docs/zk/js/02-simulator.mjs`](zk/js/02-simulator.mjs)

The simulator never sees `x`. It runs the protocol *backwards*:

```js
function simulatedTranscript(X) {    // needs ONLY the public X
  const c = randomScalar();
  const s = randomScalar();
  return { R: sub(mul(G, s), mul(X, c)), c, s };   // R = s·G − c·X
}
```

In a real transcript, `c` is uniform, `s` is uniform (the random `r` masks `c·x`), and `R` is
determined by `(c, s)`. A simulated transcript has exactly the same distribution. Because
transcripts can be manufactured without the secret, seeing one teaches nothing about the
secret. This is the definition of (honest-verifier) zero-knowledge.

The flip side is that a recorded transcript convinces no third party, because anyone could
have simulated it. The real verifier is convinced only because `R` was fixed *before* it
chose `c`. That ordering is what §6 recovers non-interactively.

---

## 5. Why it is sound: the extractor

Source: [`docs/zk/js/03-extractor.mjs`](zk/js/03-extractor.mjs)

**Special soundness:** two accepting transcripts with the *same* `R` and different challenges
reveal the witness.

```js
// s1 = r + c1·x,  s2 = r + c2·x   ⇒   x = (s1 − s2) / (c1 − c2)
const extracted = mod((s1 - s2) * inv(c1 - c2, N), N);
assert.equal(extracted, x);
```

An extractor that can "rewind" a successful prover therefore obtains `x`, which makes
Schnorr a **proof of knowledge**.

**The same algebra is a real attack.** A prover or signer that ever reuses its nonce `r`
publishes its secret key. That is how the PlayStation 3 ECDSA signing key was recovered
(fail0verflow, 27C3, 2010), and it is why [RFC 6979](https://www.rfc-editor.org/rfc/rfc6979)
derives nonces deterministically. **Use a fresh, uniform nonce for every proof.**

---

## 6. Going non-interactive: Fiat–Shamir

Source: [`docs/zk/js/04-fiat-shamir.mjs`](zk/js/04-fiat-shamir.mjs)

Blockchains can't run a live conversation. The **Fiat–Shamir transform** (1986) replaces the
verifier's coin with a hash of everything the verifier would have seen:

```js
const DOMAIN = 'LUV-ZK-GUIDE/schnorr-nizk/v1';           // domain separation

function prove(x, message = '') {
  const X = mul(G, x), r = randomScalar(), R = mul(G, r);
  const c = hashToScalar(DOMAIN, G, X, R, message);      // ← hash the WHOLE transcript
  return { R, s: mod(r + c * x, N) };
}
function verify(X, { R, s }, message = '') {
  const c = hashToScalar(DOMAIN, G, X, R, message);
  return eq(mul(G, s), add(R, mul(X, c)));
}
```

Binding a `message` turns the proof into a **signature of knowledge**. That is essentially a
Schnorr signature, as standardised for Bitcoin in
[BIP-340](https://github.com/bitcoin/bips/blob/master/bip-0340.mediawiki).

### The Frozen Heart bug: an incomplete transcript hash is forgeable

If the hash omits the statement (`c = H(R)` instead of `c = H(G, X, R, …)`), an attacker
picks `R` and `s` first and then *solves* for a public key it can "prove" ownership of:

```js
const Rf = mul(G, randomScalar()), sf = randomScalar();
const cf = hashToScalar(DOMAIN, Rf);
const Xforged = mul(sub(mul(G, sf), Rf), inv(cf, N));    // X = c⁻¹·(s·G − R)
assert.ok(weakVerify(Xforged, { R: Rf, s: sf }));        // forged!
assert.ok(!verify(Xforged, { R: Rf, s: sf }));           // the strong version rejects it
```

Trail of Bits found this bug in several production proof systems (Girault, Bulletproofs,
PlonK) and disclosed it as
[Frozen Heart (2022)](https://blog.trailofbits.com/2022/04/13/part-1-coordinated-disclosure-of-vulnerabilities-affecting-girault-bulletproofs-and-plonk/).
**Rule:** hash the public parameters, the full statement, every prover message, and a domain
separator.

---

## 7. Commitments, hidden amounts and nullifiers

### 7.1 Pedersen commitments and confidential transfers

Source: [`docs/zk/js/05-pedersen.mjs`](zk/js/05-pedersen.mjs)

`C = v·G + r·H` commits to the value `v` with the random blinding factor `r`. It is
**hiding** (perfectly), **binding** (as long as nobody knows `log_G(H)`) and **additive**:
`C(v₁,r₁) + C(v₂,r₂) = C(v₁+v₂, r₁+r₂)`. `H` is derived by hashing a public seed to a curve
point (`hashToPoint`), so nobody knows its discrete log.

The example proves two things:

1. **Knowledge of an opening:** "I know `(v, r)` behind `C`", proven without revealing them.
2. **A confidential balance:** a hidden input of 500 is split into hidden outputs of 300 and
   200. Because the values cancel, `C_in − C_out1 − C_out2 = (r_in − r₁ − r₂)·H`, so the
   difference is a multiple of `H` only. A Schnorr proof on base `H` proves the transfer
   balances, and no amount is revealed. An inflating transfer (300 + 201) leaves a `G`
   component that nobody can prove, so it is rejected.

```js
const excess = sub(sub(Cin, C1), C2);          // public
const k = mod(rin - r1 - r2, N);               // known only to the sender
assert.ok(verifyBalance(excess, proveBalance(k, excess)));
```

> Production confidential transactions **also need range proofs**. Modulo `N`, `−100` is a
> huge positive number, so `300 + (−100)` "balances" a 200 input and mints money.
> [Bulletproofs](https://eprint.iacr.org/2017/1066) are the standard fix.

### 7.2 Equality of discrete logs (Chaum–Pedersen) and nullifiers

Source: [`docs/zk/js/06-chaum-pedersen.mjs`](zk/js/06-chaum-pedersen.mjs)

This protocol proves *"`X = x·G` and `Y = x·H` for the **same** secret `x`"*. It is the core
of ECVRFs ([RFC 9381](https://www.rfc-editor.org/rfc/rfc9381)), of verifiable decryption and
of **nullifiers**. The nullifier `N = x·H(scope)` is deterministic per scope, so double-use is
visible. It is unlinkable across scopes and provably tied to a registered key.

```js
function prove(x, H) {
  const X = mul(G, x), Y = mul(H, x);
  const r = randomScalar(), A = mul(G, r), B = mul(H, r);     // same nonce on both bases
  const c = hashToScalar('dleq/v1', G, H, X, Y, A, B);
  return { X, Y, proof: { A, B, s: mod(r + c * x, N) } };
}
```

---

## 8. From programs to proofs: R1CS → QAP → zk-SNARK

Source: [`docs/zk/js/07-r1cs-qap.mjs`](zk/js/07-r1cs-qap.mjs)

Hand-built Σ-protocols cover algebraic statements. To prove *arbitrary computation*, a SNARK
compiles the program into polynomial equations. The running example comes from Vitalik
Buterin's
[*QAPs: from Zero to Hero*](https://medium.com/@VitalikButerin/quadratic-arithmetic-programs-from-zero-to-hero-f6d558cea649):
**prove you know `x` with `x³ + x + 5 = 35`.**

**1. Flatten** the program into single operations:

```
sym1 = x · x        y = sym1 · x        sym2 = y + x        out = sym2 + 5
```

**2. Write it as an R1CS.** Choose the witness `w = [1, x, out, sym1, y, sym2] = [1, 3, 35, 9, 27, 30]`.
Each constraint row says `(A·w) × (B·w) = C·w`:

```js
//            w = [ one,  x, out, sym1,  y, sym2 ]
const A = [   [   0,   1,   0,    0,   0,    0 ],   // x    · x    = sym1
              [   0,   0,   0,    1,   0,    0 ],   // sym1 · x    = y
              [   0,   1,   0,    0,   1,    0 ],   // (x+y)· 1    = sym2
              [   5,   0,   0,    0,   0,    1 ] ]; // (sym2+5)·1  = out
```

**3. Turn the R1CS into a QAP.** Interpolate each column into a polynomial over the points
`t = 1…4`. Then *all* constraints hold if and only if `A(t)·B(t) − C(t)` is divisible by
`Z(t) = (t−1)(t−2)(t−3)(t−4)`. The example checks the divisibility exactly. It then checks
the identity at a single random `τ` (the Schwartz–Zippel lemma): a false polynomial identity
survives with probability at most `degree / |F|`, about 2⁻²⁵⁰.

```
✓ R1CS: the witness for x = 3 satisfies all 4 constraints; x = 4 does not
✓ QAP: A(t)·B(t) − C(t) is divisible by Z(t) for the valid witness
✓ Schwartz–Zippel: P(τ) = H(τ)·Z(τ) at a random τ
```

**4. Groth16** ([eprint 2016/260](https://eprint.iacr.org/2016/260)) runs that last check "in
the exponent":

- A **trusted setup** encodes powers of a secret `τ` as elliptic-curve points and then
  destroys `τ`.
- The prover evaluates its polynomials at `τ` without ever learning `τ`. The resulting proof
  is just **3 curve points** (about 256 bytes of calldata).
- The verifier checks one **pairing** equation on BN254. Ethereum exposes this curve as
  precompiles: [EIP-196](https://eips.ethereum.org/EIPS/eip-196) (add, mul) and
  [EIP-197](https://eips.ethereum.org/EIPS/eip-197) (pairing), repriced by
  [EIP-1108](https://eips.ethereum.org/EIPS/eip-1108).
- Random blinding terms make the proof zero-knowledge.

The arithmetic in `07-r1cs-qap.mjs` uses the same BN254 scalar field as Circom and the
precompiles.

---

## 9. Building a real SNARK: Circom → snarkjs → Solidity → Foundry

Files: [`docs/zk/circom/cube.circom`](zk/circom/cube.circom) ·
[`docs/zk/circom/prove.sh`](zk/circom/prove.sh) ·
[`docs/zk/foundry/src/CubeGate.sol`](zk/foundry/src/CubeGate.sol) ·
[`docs/zk/foundry/test/CubeGate.t.sol`](zk/foundry/test/CubeGate.t.sol) ·
[`docs/zk/foundry/encode-proof.mjs`](zk/foundry/encode-proof.mjs)

> These files need [circom](https://docs.circom.io/getting-started/installation/),
> [snarkjs](https://github.com/iden3/snarkjs) and [Foundry](https://github.com/foundry-rs/foundry).
> They are a reference pipeline: they were not executed in the environment that wrote this guide.
> Run `prove.sh` and `forge test` before you rely on them.

### 9.1 The circuit

```circom
pragma circom 2.1.6;

template Cube() {
    signal input x;      // private
    signal output out;   // public

    signal x2;
    x2  <== x * x;               // constraint 1
    out <== x2 * x + x + 5;      // constraint 2 (additions are free)
}
component main = Cube();
```

`<==` both assigns a value *and* adds a constraint. Its cousin `<--` only assigns. Using
`<--` without a matching `===` constraint is the #1 source of under-constrained circuits
(see [§12](#12-security-checklist)).

### 9.2 Setup, prove, verify

`prove.sh` runs the whole pipeline. These are the key commands, each documented in the
[snarkjs README](https://github.com/iden3/snarkjs#guide):

```bash
circom cube.circom --r1cs --wasm --sym -o build                     # compile → 2 constraints
snarkjs powersoftau new bn128 8 pot_0000.ptau                        # phase 1 (universal)
snarkjs powersoftau contribute pot_0000.ptau pot_0001.ptau --name=a -e=<entropy>
snarkjs powersoftau prepare phase2 pot_0001.ptau pot_final.ptau
snarkjs groth16 setup build/cube.r1cs pot_final.ptau cube_0000.zkey  # phase 2 (per circuit)
snarkjs zkey contribute cube_0000.zkey cube_final.zkey --name=b -e=<entropy>
snarkjs zkey export verificationkey cube_final.zkey verification_key.json
echo '{"x":"3"}' > input.json                                        # private input
snarkjs groth16 fullprove input.json build/cube_js/cube.wasm cube_final.zkey proof.json public.json
snarkjs groth16 verify verification_key.json public.json proof.json  # → OK, public = ["35"]
snarkjs zkey export solidityverifier cube_final.zkey Groth16Verifier.sol
```

> ⚠ A ceremony run on your own laptop is for learning only: anyone who knows the entropy can
> forge proofs. In production, start from a public multi-party ceremony
> ([Perpetual Powers of Tau](https://github.com/privacy-ethereum/perpetualpowersoftau))
> and run a real phase 2 with independent contributors.

### 9.3 Verifying on-chain

`snarkjs` generates `Groth16Verifier` from
[this template](https://github.com/iden3/snarkjs/blob/master/templates/verifier_groth16.sol.ejs).
Your contract calls it like this:

```solidity
interface IGroth16Verifier {
    function verifyProof(uint256[2] calldata pA, uint256[2][2] calldata pB,
                         uint256[2] calldata pC, uint256[1] calldata pubSignals)
        external view returns (bool);
}

function enter(uint256[2] calldata a, uint256[2][2] calldata b,
               uint256[2] calldata c, uint256[1] calldata pub) external {
    if (pub[0] != STATEMENT) revert WrongStatement();          // 1. the right statement
    if (!verifier.verifyProof(a, b, c, pub)) revert InvalidProof(); // 2. a valid proof
    entered[msg.sender] = true;
}
```

Gas cost: the verifier makes one pairing call with 4 pairs (45,000 + 4 × 34,000 = 181,000
gas under EIP-1108), plus about 6,150 gas per public input. The total is roughly 200–250k gas.

### 9.4 Foundry tests

[`CubeGate.t.sol`](zk/foundry/test/CubeGate.t.sol) loads the proof that
[`encode-proof.mjs`](zk/foundry/encode-proof.mjs) ABI-encodes. That script swaps the
coordinates of the G2 point, because EIP-197 expects `[x.c1, x.c0]` order. The tests:

| test | proves |
|---|---|
| `test_validProofVerifies` | the snarkjs proof verifies on-chain, and the public signal is 35 |
| `test_gateAdmitsProver` | the consumer contract admits the caller |
| `test_tamperedPublicSignalFails` | the same proof does not verify for statement 36 |
| `test_tamperedProofFails` | a corrupted proof point is rejected |
| `test_wrongStatementRejectedByGate` | the app checks *which* statement was proven |
| `test_replayIsPossible_documentedFlaw` | **the lesson:** the proof isn't bound to `msg.sender`, so anyone can replay it from the mempool |

```bash
cd docs/zk/circom && ./prove.sh
cd ../foundry && forge install foundry-rs/forge-std --no-git && forge test -vv
```

The last test is intentionally a failing *design*. The fix is in §10: put the beneficiary
and a nullifier inside the circuit's public signals.

---

## 10. Design pattern: a private airdrop claim

Today's [`ShambaLuvAirdrop.sol`](../contracts/ShambaLuvAirdrop.sol) is **signature-gated**. A
backend signer issues an EIP-712 voucher `Claim(recipient, amount, nonce, deadline)`. The
contract checks it with `ecrecover` and records `usedNonce[nonce]` and `hasClaimed[recipient]`.
That design is simple and auditable. The trade-off is that the signer and the chain both see
which identity claimed to which wallet.

A ZK version separates *eligibility* from *identity*. It is the pattern that
[Semaphore](https://github.com/semaphore-protocol/semaphore) implements and audits:

```
off-chain registration:  identity secret s  →  commitment  id = Poseidon(s)
                         the operator inserts id into a Merkle tree; its root is published on-chain

claim proof (circuit) proves, without revealing s or which leaf:
   private:  s, Merkle path
   public:   root          — the leaf Poseidon(s) is in the tree with this root
             nullifier     = Poseidon(s, roundId)   — deterministic per identity per round
             recipient     — bound into the proof (fixes the replay of §9.4)
             amount

contract.claim(proof, root, nullifier, recipient, amount):
   require(isKnownRoot[root]);
   require(!nullifierUsed[nullifier]);        // one claim per identity per round
   require(verifier.verifyProof(proof, [root, nullifier, recipient, amount]));
   nullifierUsed[nullifier] = true;
   LUV.transfer(recipient, amount);
```

Why each piece is there:

- **The nullifier is a public signal, never `hash(proof)`.** Groth16 proofs are
  *malleable*: anyone can re-randomise a valid proof into a different-looking valid proof
  for the same statement.
- **`recipient` is a public signal.** A front-runner who copies the proof can only send the
  tokens to the original recipient. It must also be "used" in the circuit (Semaphore squares
  it) so the compiler doesn't optimise it away.
- **The root history** (`isKnownRoot`) lets proofs made against a slightly older root still
  verify after new members join.
- **Poseidon** ([circomlib](https://github.com/iden3/circomlib/blob/master/circuits/poseidon.circom))
  is used instead of keccak because it costs about 240 constraints, versus about 150,000 for
  keccak.

Reference implementation: the
[Semaphore circuit](https://github.com/semaphore-protocol/semaphore/blob/main/packages/circuits/src/semaphore.circom)
and its
[contracts](https://github.com/semaphore-protocol/semaphore/tree/main/packages/contracts).

---

## 11. Choosing a proof system

| system | setup | proof size | on-chain verify | prover | notes / implementations |
|---|---|---|---|---|---|
| **Groth16** | per-circuit trusted setup | ~128–256 B (3 points) | cheapest, ~200–250k gas | fast | the de facto EVM standard · [snarkjs](https://github.com/iden3/snarkjs), [gnark](https://github.com/Consensys/gnark), [arkworks](https://github.com/arkworks-rs/groth16) |
| **PLONK** / variants | universal, updatable setup | ~0.5–1 KB | ~300k gas | fast | one ceremony for all circuits · [eprint 2019/953](https://eprint.iacr.org/2019/953), snarkjs `plonk`/`fflonk`, [Noir/Barretenberg](https://github.com/noir-lang/noir) |
| **Halo2** | none (IPA) or universal (KZG) | ~1–10 KB | KZG variant feasible | medium | custom gates, lookups, recursion · [zcash/halo2](https://github.com/zcash/halo2), [eprint 2019/1021](https://eprint.iacr.org/2019/1021) |
| **STARKs** | **transparent** | ~50–200 KB | expensive directly; usually wrapped in a SNARK | very fast, parallel | hash-based, plausibly post-quantum · [eprint 2018/046](https://eprint.iacr.org/2018/046), [Stwo](https://github.com/starkware-libs/stwo), [Cairo](https://github.com/starkware-libs/cairo) |
| **Bulletproofs** | **transparent** | ~0.7 KB, log-size | linear-time verify, impractical on L1 | slow | range proofs, confidential transactions · [eprint 2017/1066](https://eprint.iacr.org/2017/1066) |
| **zkVMs** | varies (STARK + SNARK wrap) | ~256 B after the Groth16 wrap | ~250–300k gas | heavy | write ordinary Rust, prove its execution · [RISC Zero](https://github.com/risc0/risc0), [SP1](https://github.com/succinctlabs/sp1) |

Rules of thumb:

- For a fixed, small circuit verified on Ethereum, use **Groth16**.
- For many circuits, or if you can't run a per-circuit ceremony, use **PLONK** (or Noir).
- For big computations, use a **STARK or a zkVM**, wrapped in a SNARK for L1.
- For a one-off algebraic statement (key ownership, equal discrete logs, a balance), a
  **Σ-protocol** like those in §3–7 is smaller, faster and needs no setup.

---

## 12. Security checklist

Most real-world ZK failures come from the bug classes below. The
[0xPARC zk-bug-tracker](https://github.com/0xPARC/zk-bug-tracker) catalogues incidents for each.

**Circuits**
- [ ] **Under-constrained signals.** Every `<--` has a matching `===`. Prefer `<==`. Check
      that no witness value is free to vary. Tools:
      [circomspect](https://github.com/trailofbits/circomspect),
      [Picus](https://github.com/Veridise/Picus).
- [ ] **Field overflow and aliasing.** Values wrap modulo the ~254-bit prime. Use explicit
      range checks (circomlib `Num2Bits`, `LessThan`) and reject non-canonical encodings.
- [ ] **Unused public inputs** get optimised out, so bind them with a dummy constraint (as
      Semaphore does).
- [ ] Constrain division-by-zero cases (`IsZero` patterns).

**Protocols**
- [ ] **Fiat–Shamir** hashes the parameters, the full statement, every commitment and a
      domain separator ([§6](#6-going-non-interactive-fiatshamir)).
- [ ] Every proof uses a **fresh, uniform nonce** ([§5](#5-why-it-is-sound-the-extractor)).
- [ ] **Generators** such as `H` have no known discrete-log relation to `G` (hash-to-curve).

**Setup**
- [ ] The trusted setup is a public, multi-party ceremony. You verified the transcript
      (`snarkjs zkey verify`). The toxic waste is not on your laptop.

**On-chain**
- [ ] The contract checks *which statement* was proven (the public signals), not just that
      *a* proof verifies.
- [ ] Proofs are **bound to the beneficiary** (`msg.sender` or `recipient` as a public signal)
      to stop mempool replay and front-running.
- [ ] Double-use is prevented with a **nullifier public signal**. Never use `hash(proof)`,
      because Groth16 proofs are malleable.
- [ ] Public inputs are canonical field elements (`< r`). The snarkjs verifier enforces this.
- [ ] The Merkle root is checked against a known-root history.
- [ ] Gas cost is measured with `forge test --gas-report`.

---

## 13. Complete reference

### 13.1 Source code in this repository

| file | what it shows |
|---|---|
| [`docs/zk/js/secp256k1.mjs`](zk/js/secp256k1.mjs) | dependency-free secp256k1: field and group arithmetic, hash-to-scalar, hash-to-point, an OpenSSL self-test |
| [`docs/zk/js/01-schnorr-interactive.mjs`](zk/js/01-schnorr-interactive.mjs) | interactive Schnorr; completeness; cheater success 2⁻ᵏ |
| [`docs/zk/js/02-simulator.mjs`](zk/js/02-simulator.mjs) | the simulator, i.e. why it's zero-knowledge |
| [`docs/zk/js/03-extractor.mjs`](zk/js/03-extractor.mjs) | special soundness; nonce-reuse key recovery |
| [`docs/zk/js/04-fiat-shamir.mjs`](zk/js/04-fiat-shamir.mjs) | NIZK via Fiat–Shamir; a Frozen Heart forgery |
| [`docs/zk/js/05-pedersen.mjs`](zk/js/05-pedersen.mjs) | Pedersen commitments; proof of opening; confidential balance proof |
| [`docs/zk/js/06-chaum-pedersen.mjs`](zk/js/06-chaum-pedersen.mjs) | DLEQ proof; deterministic, unlinkable nullifiers |
| [`docs/zk/js/07-r1cs-qap.mjs`](zk/js/07-r1cs-qap.mjs) | R1CS → QAP over BN254; the Schwartz–Zippel check |
| [`docs/zk/js/run-all.mjs`](zk/js/run-all.mjs) | runs everything; fails loudly |
| [`docs/zk/circom/cube.circom`](zk/circom/cube.circom) | the example as a Circom circuit (2 constraints) |
| [`docs/zk/circom/prove.sh`](zk/circom/prove.sh) | the full Groth16 pipeline: compile → ceremony → prove → verify → Solidity |
| [`docs/zk/foundry/src/CubeGate.sol`](zk/foundry/src/CubeGate.sol) | on-chain consumer of the verifier (with a documented replay flaw) |
| [`docs/zk/foundry/test/CubeGate.t.sol`](zk/foundry/test/CubeGate.t.sol) | Foundry tests: valid, tampered, wrong statement, replay |
| [`docs/zk/foundry/encode-proof.mjs`](zk/foundry/encode-proof.mjs) | snarkjs JSON → ABI calldata (G2 coordinate swap) |
| [`contracts/ShambaLuvAirdrop.sol`](../contracts/ShambaLuvAirdrop.sol) | the signature-gated airdrop that §10 contrasts with a ZK claim |

### 13.2 Libraries and toolchains (source)

| project | language | role |
|---|---|---|
| [iden3/circom](https://github.com/iden3/circom) · [docs](https://docs.circom.io/) | Rust → DSL | circuit compiler (R1CS + WASM witness generator) |
| [iden3/snarkjs](https://github.com/iden3/snarkjs) | JS | Groth16 / PLONK / FFLONK prover, ceremonies, Solidity verifier export |
| [iden3/circomlib](https://github.com/iden3/circomlib) | Circom | standard gadgets: Poseidon, MiMC, EdDSA, comparators, Merkle/SMT |
| [semaphore-protocol/semaphore](https://github.com/semaphore-protocol/semaphore) | Circom + Solidity | anonymous group membership + nullifiers (the §10 pattern) |
| [noir-lang/noir](https://github.com/noir-lang/noir) · [docs](https://noir-lang.org/docs) | Rust-like DSL | circuit language with a Solidity verifier backend |
| [Consensys/gnark](https://github.com/Consensys/gnark) | Go | fast Groth16 / PLONK, used in production rollups |
| [arkworks-rs/groth16](https://github.com/arkworks-rs/groth16) | Rust | modular SNARK research ecosystem |
| [zcash/halo2](https://github.com/zcash/halo2) | Rust | PLONKish arithmetisation, recursion without a trusted setup |
| [risc0/risc0](https://github.com/risc0/risc0) · [succinctlabs/sp1](https://github.com/succinctlabs/sp1) | Rust | zkVMs: prove the execution of ordinary programs |
| [starkware-libs/stwo](https://github.com/starkware-libs/stwo) · [cairo](https://github.com/starkware-libs/cairo) | Rust / Cairo | STARK prover and STARK-native language |
| [paulmillr/noble-curves](https://github.com/paulmillr/noble-curves) | JS | audited curves (secp256k1, BN254, BLS12-381), the production counterpart to `secp256k1.mjs` |
| [bitcoin-core/secp256k1](https://github.com/bitcoin-core/secp256k1) | C | constant-time reference secp256k1 |
| [foundry-rs/foundry](https://github.com/foundry-rs/foundry) · [forge-std](https://github.com/foundry-rs/forge-std) | Rust / Solidity | test framework used in §9 |
| [trailofbits/circomspect](https://github.com/trailofbits/circomspect) · [Veridise/Picus](https://github.com/Veridise/Picus) | Rust / Racket | static analysis for under-constrained circuits |

### 13.3 Specifications

- [EIP-196](https://eips.ethereum.org/EIPS/eip-196) / [EIP-197](https://eips.ethereum.org/EIPS/eip-197): BN254 add/mul and pairing precompiles
- [EIP-1108](https://eips.ethereum.org/EIPS/eip-1108): their gas repricing (pairing = 45,000 + 34,000·k)
- [EIP-2537](https://eips.ethereum.org/EIPS/eip-2537): BLS12-381 precompiles
- [Solidity ABI specification](https://docs.soliditylang.org/en/latest/abi-spec.html): the encoding `encode-proof.mjs` produces
- [SEC 2 v2](https://www.secg.org/sec2-v2.pdf): secp256k1 parameters
- [BIP-340](https://github.com/bitcoin/bips/blob/master/bip-0340.mediawiki): Schnorr signatures (Fiat–Shamir in practice)
- [RFC 9381](https://www.rfc-editor.org/rfc/rfc9381): verifiable random functions (DLEQ proofs)
- [RFC 6979](https://www.rfc-editor.org/rfc/rfc6979): deterministic nonces
- [Zcash protocol specification](https://zips.z.cash/protocol/protocol.pdf): a complete production ZK payment system

### 13.4 Papers

- Goldwasser, Micali, Rackoff: *The Knowledge Complexity of Interactive Proof Systems* (1985/89), [doi:10.1137/0218012](https://doi.org/10.1137/0218012)
- Fiat, Shamir: *How to Prove Yourself* (1986), [doi:10.1007/3-540-47721-7_12](https://doi.org/10.1007/3-540-47721-7_12)
- Schnorr: *Efficient Signature Generation by Smart Cards* (1991), [doi:10.1007/BF00196725](https://doi.org/10.1007/BF00196725)
- Chaum, Pedersen: *Wallet Databases with Observers* (1992), [doi:10.1007/3-540-48071-4_7](https://doi.org/10.1007/3-540-48071-4_7)
- Parno, Howell, Gentry, Raykova: *Pinocchio* (2013), [eprint 2013/279](https://eprint.iacr.org/2013/279)
- Groth: *On the Size of Pairing-based Non-interactive Arguments* (2016), [eprint 2016/260](https://eprint.iacr.org/2016/260)
- Bünz et al.: *Bulletproofs* (2017), [eprint 2017/1066](https://eprint.iacr.org/2017/1066)
- Ben-Sasson et al.: *Scalable, Transparent, and Post-quantum Secure Computational Integrity* (STARKs, 2018), [eprint 2018/046](https://eprint.iacr.org/2018/046)
- Gabizon, Williamson, Ciobotaru: *PLONK* (2019), [eprint 2019/953](https://eprint.iacr.org/2019/953)
- Bowe, Grigg, Hopwood: *Recursive Proof Composition without a Trusted Setup* (Halo, 2019), [eprint 2019/1021](https://eprint.iacr.org/2019/1021)

### 13.5 Learning resources

- Justin Thaler, [*Proofs, Arguments, and Zero-Knowledge*](https://people.cs.georgetown.edu/jthaler/ProofsArgsAndZK.html): the free graduate textbook
- Vitalik Buterin, [*QAPs: from Zero to Hero*](https://medium.com/@VitalikButerin/quadratic-arithmetic-programs-from-zero-to-hero-f6d558cea649) (the §8 example) and [*Understanding PLONK*](https://vitalik.eth.limo/general/2019/09/22/plonk.html)
- [ZKProof Community Reference](https://zkproof.org/): standardisation effort and reference documents
- [0xPARC zk-bug-tracker](https://github.com/0xPARC/zk-bug-tracker): real vulnerabilities, classified
- Trail of Bits, [*Frozen Heart* disclosure](https://blog.trailofbits.com/2022/04/13/part-1-coordinated-disclosure-of-vulnerabilities-affecting-girault-bulletproofs-and-plonk/)

---

<sub>made with [LUV ❤](https://luv.pythai.net/)</sub>
