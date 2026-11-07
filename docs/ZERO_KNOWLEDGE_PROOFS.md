# Zero-Knowledge Proofs: an introduction and usage guide

> **What you get:** a working introduction to zero-knowledge proofs (ZKPs). It starts with
> the definitions, builds and attacks real protocols in runnable code, and ends with a
> zk-SNARKs verified on-chain in Solidity: an anonymous airdrop, anonymous voting and a
> setup-free key registry, all proven and tested. Every claim links to source code: the examples in
> [`docs/zk/`](zk/) and the canonical upstream implementations, specs and papers in
> [§13](#13-complete-reference).

```bash
node docs/zk/js/run-all.mjs                 # Node ≥ 18, zero dependencies: 8 protocol examples (~16 s)
cd docs/zk && npm install && npm test       # + compile all .sol and run 50 tests on a real EVM
```

The JavaScript examples use only `BigInt` and `node:crypto`. The library
[`secp256k1.mjs`](zk/js/secp256k1.mjs) checks its own curve arithmetic against OpenSSL
before the examples run. The Solidity side (§9–10) has a full Circom → snarkjs → Solidity
pipeline and a zero-dependency Foundry project whose tests also run on a plain EVM, so you
don't need Foundry installed to check them.

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
10. [Advanced use cases: anonymous airdrop, on-chain group, voting, key registry, private credentials](#10-advanced-use-cases)
11. [Choosing a proof system](#11-choosing-a-proof-system)
12. [Security checklist, including a live under-constrained circuit attack](#12-security-checklist)
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

Files: [`circom/cube.circom`](zk/circom/cube.circom) ·
[`circom/build.sh`](zk/circom/build.sh) ·
[`circom/gen-fixture.mjs`](zk/circom/gen-fixture.mjs) ·
[`foundry/src/CubeGate.sol`](zk/foundry/src/CubeGate.sol) ·
[`foundry/src/verifiers/CubeVerifier.sol`](zk/foundry/src/verifiers/CubeVerifier.sol) ·
[`foundry/test/CubeGate.t.sol`](zk/foundry/test/CubeGate.t.sol)

Everything in §9 and §10 is **executed end to end**:

```bash
cd docs/zk && npm install   # circom (WASM build), snarkjs, circomlib, solc, ethereumjs
npm run build               # 5 circuits → dev ceremony → proofs → verifiers + fixtures + attack (~5 min)
npm run test:evm            # compile all .sol with solc 0.8.24 and run every test on a real EVM
cd foundry && forge test    # the same tests under Foundry: zero dependencies, zero cheatcodes
```

`npm run build` is optional because the generated verifiers and proof fixtures are
committed. `npm run test:evm` runs the Foundry test contracts on
[ethereumjs](https://github.com/ethereumjs/ethereumjs-monorepo). That EVM implements the
BN254 precompiles, so the Groth16 pairing check runs exactly as on mainnet. The runner is
[`evm/run-tests.mjs`](zk/evm/run-tests.mjs), a forge-style runner of about 150 lines.

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

[`build.sh`](zk/circom/build.sh) runs the pipeline for every circuit. These are the key
commands, each documented in the [snarkjs README](https://github.com/iden3/snarkjs#guide):

```bash
circom cube.circom --r1cs --wasm --sym -o build                       # compile → 2 constraints
snarkjs powersoftau new bn128 13 pot13_0000.ptau                       # phase 1 (universal)
snarkjs powersoftau contribute pot13_0000.ptau pot13_0001.ptau --name=a -e=<entropy>
snarkjs powersoftau prepare phase2 pot13_0001.ptau pot13_final.ptau
snarkjs groth16 setup build/cube.r1cs pot13_final.ptau cube_0000.zkey  # phase 2 (per circuit)
snarkjs zkey contribute cube_0000.zkey cube_final.zkey --name=b -e=<entropy>
snarkjs zkey verify build/cube.r1cs pot13_final.ptau cube_final.zkey
snarkjs zkey export verificationkey cube_final.zkey cube_vkey.json
echo '{"x":"3"}' > cube.input.json                                     # private input
snarkjs groth16 fullprove cube.input.json build/cube_js/cube.wasm cube_final.zkey proof.json public.json
snarkjs groth16 verify cube_vkey.json public.json proof.json           # → OK!  public = ["35"]
snarkjs zkey export solidityverifier cube_final.zkey CubeVerifier.sol
node gen-fixture.mjs CubeProof proof.json public.json > CubeProof.sol  # proof → Solidity fixture
```

> ⚠ **The committed verifiers come from a DEV ceremony** whose entropy was generated on one
> machine. That is fine for tests, but **never deploy them**: anyone who knew that entropy
> could forge proofs. In production, start from a public multi-party ceremony
> ([Perpetual Powers of Tau](https://github.com/privacy-ethereum/perpetualpowersoftau)) and
> run a phase 2 with independent contributors.

### 9.3 Verifying on-chain

`snarkjs` generates the verifier from
[this template](https://github.com/iden3/snarkjs/blob/master/templates/verifier_groth16.sol.ejs).
`build.sh` renames each one (`CubeVerifier`, `MembershipVerifier`) so several can live in
one project. A consumer contract checks **the statement first, then the proof**:

```solidity
function enter(uint256[2] calldata a, uint256[2][2] calldata b,
               uint256[2] calldata c, uint256[1] calldata pub) external {
    if (pub[0] != STATEMENT) revert WrongStatement();               // 1. the right statement
    if (!verifier.verifyProof(a, b, c, pub)) revert InvalidProof(); // 2. a valid proof
    entered[msg.sender] = true;
}
```

**Measured gas** (`npm run test:evm`): `verifyProof` with 1 public input costs **~200k**.
That is one pairing call with 4 pairs (45,000 + 4 × 34,000 = 181,000 under EIP-1108) plus
about 6,150 per public input and the calldata.

### 9.4 Tests

The proof travels into Solidity as a **generated fixture library**
([`gen-fixture.mjs`](zk/circom/gen-fixture.mjs) →
[`test/fixtures/CubeProof.sol`](zk/foundry/test/fixtures/CubeProof.sol)). It swaps the G2
coordinates because EIP-197 expects `[x.c1, x.c0]`. The tests extend
[`ZkTest.sol`](zk/foundry/test/ZkTest.sol), a cheatcode-free base. Different callers are
`Actor` contracts, and expected reverts are low-level calls plus a selector check. That is
why the same files run under `forge test` and under the plain-EVM runner.

| test | proves |
|---|---|
| `test_validProofVerifies` | the snarkjs proof verifies on-chain, and the public signal is 35 |
| `test_gateAdmitsProver` | the consumer contract admits the caller |
| `test_tamperedPublicSignalFails` | the same proof does not verify for statement 36 |
| `test_tamperedProofFails` | a corrupted proof point is rejected (and burns the forwarded gas, see §12) |
| `test_wrongStatementRejectedByGate` | the app checks *which* statement was proven |
| `test_replayIsPossible_documentedFlaw` | **the lesson:** the proof isn't bound to `msg.sender`, so anyone can replay it from the mempool |

The last test is intentionally a failing *design*. §10 fixes it twice: once by binding the
recipient into a SNARK's public signals (`ZkAirdrop`), and once by hashing `msg.sender`
into a Σ-protocol challenge (`KeyRegistry`).

---

## 10. Advanced use cases

Five production patterns are implemented, proven and tested in [`docs/zk/foundry/`](zk/foundry/):

| contract | ZK technique | trusted setup | what it gives you |
|---|---|---|---|
| [`ZkAirdrop.sol`](zk/foundry/src/ZkAirdrop.sol) | Groth16 · Merkle membership · nullifier | yes (circuit) | anonymous one-per-member claims that can't be front-run |
| [`ZkGroup.sol`](zk/foundry/src/ZkGroup.sol) | on-chain incremental **Poseidon** Merkle tree | none | the chain, not an operator, computes the group root |
| [`ZkVote.sol`](zk/foundry/src/ZkVote.sol) | the **same** circuit, a different scope | reuses the above | anonymous one-member-one-vote polls |
| [`KeyRegistry.sol`](zk/foundry/src/KeyRegistry.sol) + [`BN254.sol`](zk/foundry/src/BN254.sol) | Σ-protocol (Schnorr) on the BN254 precompiles | **none** | proof of key possession, bound to the sender (stops rogue keys) |
| [`CredentialGate.sol`](zk/foundry/src/CredentialGate.sol) | **EdDSA verified in-circuit** + range proof | yes (circuit) | "an issuer says I'm ≥ 18", with no birth date revealed |

Plus a deliberately broken one, [`AgeGate.sol`](zk/foundry/src/AgeGate.sol), whose circuit is
attacked in [§12.1](#121-anatomy-of-an-under-constrained-circuit-attack).

Measured results from `npm run test:evm`:

```
test/ZkAirdrop.t.sol:ZkAirdropTest              9 passed   (claim incl. proof + token transfer ≈ 280k gas)
test/ZkGroup.t.sol:ZkGroupTest                  8 passed   (join ≈ 380k gas; on-chain root == proof root)
test/ZkVote.t.sol:ZkVoteTest                    6 passed   (vote incl. proof + tally ≈ 275k gas)
test/KeyRegistry.t.sol:KeyRegistryTest          7 passed   (register from an EOA ≈ 93k gas)
test/Credential.t.sol:CredentialTest            6 passed   (Groth16 verify, 5 public inputs ≈ 225k gas)
test/UnderConstrained.t.sol:UnderConstrainedTest 2 passed  (⚠ the forged proof IS accepted — §12.1)
test/ProofSystems.t.sol:ProofSystemsTest        4 passed   (Groth16 198k · PLONK 271k · FFLONK 193k)
test/CubeGate.t.sol:CubeGateTest                6 passed
interop: JS prover → KeyRegistry                2 passed
50 passed, 0 failed
```

### 10.1 One circuit, many applications: `membership.circom`

Source: [`circom/membership.circom`](zk/circom/membership.circom) (6,143 constraints at depth 10) ·
inputs: [`circom/make-inputs.mjs`](zk/circom/make-inputs.mjs)

The circuit proves the following without revealing *which* member is acting. It is the
pattern [Semaphore](https://github.com/semaphore-protocol/semaphore/blob/main/packages/circuits/src/semaphore.circom)
productised.

```
public:   root, nullifierHash, message, scope
private:  secret, Merkle path

  Poseidon(secret) is a leaf of the tree with root `root`      — membership
  nullifierHash == Poseidon(secret, scope)                     — one action per member per scope
  message is bound (message² is constrained)                   — can't be swapped by a relayer
```

The Merkle step uses a branch-free swap that costs one multiplication per level, and it
forces each path index to be a bit. Without the bit check, an attacker could pass any field
element and compute a different root:

```circom
pathIndices[i] * (1 - pathIndices[i]) === 0;                // must be 0 or 1
d[i] <== pathIndices[i] * (pathElements[i] - level[i]);     // d = s·(sibling − node)
h[i].inputs[0] <== level[i] + d[i];                         // left
h[i].inputs[1] <== pathElements[i] - d[i];                  // right
```

`make-inputs.mjs` builds a real Poseidon tree of 8 members (with
[circomlibjs](https://github.com/iden3/circomlibjs)). It writes three witnesses: member #5
claiming to `0xB0B`, member #2 claiming to `0xCAFE`, and member #5 voting "yes" on
proposal 7.

### 10.2 Anonymous airdrop: `ZkAirdrop.sol`

Source: [`foundry/src/ZkAirdrop.sol`](zk/foundry/src/ZkAirdrop.sol) ·
tests: [`foundry/test/ZkAirdrop.t.sol`](zk/foundry/test/ZkAirdrop.t.sol)

Today's [`ShambaLuvAirdrop.sol`](../contracts/ShambaLuvAirdrop.sol) is **signature-gated**: a
backend signer issues an EIP-712 voucher per social identity. That is simple and auditable,
but the signer can link every identity to its wallet. `ZkAirdrop` separates *eligibility*
from *identity*:

```solidity
function claim(uint256 root, uint256 nullifierHash, address recipient,
               uint256[2] calldata a, uint256[2][2] calldata b, uint256[2] calldata c) external {
    if (recipient == address(0)) revert ZeroAddress();
    if (!roots.isKnownRoot(root)) revert UnknownRoot();   // OwnerRoots or ZkGroup
    if (nullifierUsed[nullifierHash]) revert NullifierUsed();

    // the CONTRACT assembles the statement — scope comes from its own state, never the caller
    uint256[4] memory pub = [root, nullifierHash, uint256(uint160(recipient)), scope];
    if (!verifier.verifyProof(a, b, c, pub)) revert InvalidProof();

    nullifierUsed[nullifierHash] = true;              // effects before the token call
    if (!token.transfer(recipient, amount)) revert TransferFailed();
}
```

| test | property |
|---|---|
| `test_claimPaysBoundRecipient` | a **relayer** submits the proof (gasless for the member), and the tokens go to the bound recipient, not the relayer |
| `test_twoMembersBothClaim` | different members have different nullifiers |
| `test_doubleClaimReverts` | the same member can't claim twice (`NullifierUsed`) |
| `test_frontRunnerCannotRedirect` | a front-runner who swaps in their own address gets `InvalidProof` |
| `test_otherRoundRejectsProof` | a round-1 proof is useless in round 2 (scope is a public signal) |
| `test_unknownRootReverts` · `test_onlyOwnerManagesRoots` · `test_zeroRecipientReverts` | root management and input validation |

Design notes:

- **The nullifier is a public signal, never `hash(proof)`.** Groth16 proofs are
  *malleable*: anyone can re-randomise a valid proof into a different-looking valid proof
  for the same statement.
- **The root source is pluggable** (`IRootSource`).
  [`OwnerRoots`](zk/foundry/src/OwnerRoots.sol) means an operator publishes roots computed
  off-chain. [`ZkGroup`](zk/foundry/src/ZkGroup.sol) means the tree lives on-chain
  ([§10.3](#103-the-group-on-chain-zkgroupsol)). Both keep a root history, so proofs made
  against an older root stay valid after new members join.
- **Poseidon** costs about 240 constraints per hash in-circuit, versus about 150,000 for
  keccak. That is why ZK trees use it.
- **Bind `scope` to the deployment** in production, for example
  `keccak256(chainid, address(this), round) mod r`. Otherwise one group could claim once on
  each chain where the contract is deployed.

### 10.3 The group on-chain: `ZkGroup.sol`

Source: [`foundry/src/ZkGroup.sol`](zk/foundry/src/ZkGroup.sol) ·
hasher: [`foundry/src/generated/PoseidonT3.sol`](zk/foundry/src/generated/PoseidonT3.sol) ·
tests: [`foundry/test/ZkGroup.t.sol`](zk/foundry/test/ZkGroup.t.sol)

With `OwnerRoots`, members must trust the operator not to insert fake members. `ZkGroup`
removes that trust: the contract **is** the tree. Members publish only `Poseidon(secret)`, and
every `join` recomputes the root on-chain. It uses incremental insertion (as in Tornado Cash
and Semaphore), which stores only the right-most frontier node per level:

```solidity
uint256 node = commitment;
for (uint256 level; level < DEPTH; ++level) {
    if (i & 1 == 0) { frontier[level] = node; node = _hash(node, zeros[level]); } // left child
    else            { node = _hash(frontier[level], node); }                      // right child
    i >>= 1;
}
roots[next] = node;   // ring buffer of the last 32 roots
```

The hash must be **bit-identical to the circuit's**, or no proof would ever verify.
[`gen-poseidon.mjs`](zk/circom/gen-poseidon.mjs) emits circomlibjs's Poseidon contract as
bytecode. The tests check it against the circomlibjs test vector
(`Poseidon(1, 2) = 0x115c…189a`). They then join the 8 members from `make-inputs.mjs` and
assert **on-chain root == off-chain root == the root inside the Groth16 proofs**. Finally a
real claim verifies against the root the chain computed. A join costs **≈ 380k gas**
(10 Poseidon hashes plus storage).

**Admission** is the design decision:
- `registrar = address(0)` makes the group open. Anyone can join, so beware Sybils.
- With a registrar, only it adds members. For example, a backend that checks a social login
  **once**, like the LUV gesture backend in [`auth/`](../auth/), then forgets which
  commitment belongs to whom. From then on the registrar knows **who joined**, but never
  **who claims or votes**. That is the privacy upgrade over today's voucher airdrop.

### 10.4 Anonymous voting: `ZkVote.sol`

Source: [`foundry/src/ZkVote.sol`](zk/foundry/src/ZkVote.sol) ·
tests: [`foundry/test/ZkVote.t.sol`](zk/foundry/test/ZkVote.t.sol)

`ZkVote` uses the **same circuit and the same verifier contract**, with `scope = proposalId`
and `message = option`. Each proposal snapshots its group root at creation.

```solidity
uint256[4] memory pub = [p.groupRoot, nullifierHash, option, id];
if (!verifier.verifyProof(a, b, c, pub)) revert InvalidProof();
nullifierUsed[nullifierHash] = true;
tally[id][option] += 1;
```

The tests show that a relayer **can't flip a vote** (the option is bound), a member **can't
vote twice**, and the same member's **airdrop proof can't be replayed as a vote**. The
airdrop and vote nullifiers are different and unlinkable, because the nullifier is
`Poseidon(secret, scope)` with a different scope.

> Limits: this gives anonymity, not *receipt-freeness*. A voter could reveal their secret
> to prove how they voted, which enables bribery. [MACI](https://github.com/privacy-ethereum/maci)
> (now archived) adds a coordinator and key changes to defeat that.

### 10.5 Proof of possession without a trusted setup: `KeyRegistry.sol`

Source: [`foundry/src/KeyRegistry.sol`](zk/foundry/src/KeyRegistry.sol) ·
[`foundry/src/BN254.sol`](zk/foundry/src/BN254.sol) ·
off-chain prover: [`js/08-schnorr-bn254.mjs`](zk/js/08-schnorr-bn254.mjs) ·
tests: [`foundry/test/KeyRegistry.t.sol`](zk/foundry/test/KeyRegistry.t.sol)

Not every on-chain ZK proof needs a circuit. The Schnorr proof from §3–6 runs directly on the
`ecAdd` / `ecMul` precompiles (about 19k gas of curve operations), with no ceremony:

```solidity
function challenge(address account, BN254.G1 memory X, BN254.G1 memory R) public view returns (uint256) {
    return uint256(sha256(abi.encodePacked(DOMAIN, block.chainid, address(this), account, X.x, X.y, R.x, R.y)))
        % BN254.N;
}

function register(BN254.G1 calldata X, BN254.G1 calldata R, uint256 s) external {
    // validate EVERY input: on-curve, not infinity, canonical scalar
    if (!Xm.isOnCurve() || !Rm.isOnCurve()) revert NotOnCurve();
    if (s >= BN254.N) revert ScalarOutOfRange();
    ...
    uint256 c = challenge(msg.sender, Xm, Rm);
    if (!BN254.generator().mul(s).eq(Rm.add(Xm.mul(c)))) revert InvalidProof();   // s·G == R + c·X
}
```

Hashing `msg.sender`, `chainid` and the contract address into the challenge makes each proof
single-purpose. The JS ↔ Solidity interop step in `run-tests.mjs` shows this: a front-runner
replaying the JS-generated proof from another EOA gets `InvalidProof`, while Alice's
transaction succeeds (about 93k gas). Leaving `X` out of the hash would reintroduce Frozen
Heart (§6).

Where proof of possession matters:
- **BLS / aggregate signatures:** it blocks the rogue-key attack, where `X' = Y − ΣX_honest`
  would let an attacker forge aggregates.
- **Stealth-address and encryption-key registries:** nobody can register a key they don't
  control.
- **Account-bound ZK identities:** it binds an off-chain proving key to an Ethereum account.

The test file runs the prover *inside Solidity* with the same precompiles, so it needs no
fixtures.

### 10.6 Private credentials: `credential.circom` + `CredentialGate.sol`

Source: [`circom/credential.circom`](zk/circom/credential.circom) (8,635 constraints) ·
[`foundry/src/CredentialGate.sol`](zk/foundry/src/CredentialGate.sol) ·
tests: [`foundry/test/Credential.t.sol`](zk/foundry/test/Credential.t.sol)

This is the shape of real-world identity proofs (ZKPassport, Anon Aadhaar, ZK Email). An
**issuer** signs data once, and the **holder** proves predicates about it many times,
privately. Here the issuer signs `Poseidon(birthYear, subject)` with EdDSA on Baby Jubjub, the
curve that lives *inside* BN254's scalar field, so signature checks are cheap in-circuit. The
holder proves *"my issuer-signed birth year makes me ≥ 18"*:

```circom
component sig = EdDSAPoseidonVerifier();      // 1. the issuer really signed (birthYear, subject)
sig.enabled <== 1;  sig.M <== Poseidon(birthYear, subject);  ...

age <== currentYear - birthYear;
Num2Bits(8)(age);                              // 2. range check: 0 ≤ age < 256 (no field wrap)
Num2Bits(8)(minAge);
component adult = GreaterEqThan(8);            // 3. constrained comparison…
adult.out === 1;                               //    …and the statement REQUIRES it
```

What the tests and `build.sh` show:

- An adult's proof verifies, and the public signals are only the issuer key, the policy
  (2026, ≥ 18) and the subject. **The birth year appears nowhere.**
- The credential is **bound to the subject** because `subject` is signed. Moving it to
  another address gives `InvalidProof`.
- A gate that trusts a **different issuer** rejects it, and so does a **stricter policy**
  (≥ 40).
- A **minor cannot produce a proof at all**: witness generation fails at `adult.out === 1`,
  and `build.sh` asserts this. Compare §12.1, where the broken circuit lets a minor through.
- Groth16 verification with 5 public inputs costs **≈ 225k gas**. The EdDSA check costs
  nothing extra on-chain, because it lives inside the proof.

### 10.7 More advanced patterns (with reference implementations)

These are beyond the scope of runnable code here, but each builds on the pieces above.

| pattern | idea | builds on | reference |
|---|---|---|---|
| **Validity rollups** | prove that a batch of transactions moved state root A → B; L1 verifies one proof | §8 (circuits), §9 (on-chain verify) | [SP1](https://github.com/succinctlabs/sp1), [RISC Zero](https://github.com/risc0/risc0) |
| **ZK coprocessors** | prove a computation over historical chain data (e.g. "this address held ≥ X LUV at block N") and consume the result in a contract | membership proofs (storage tries) | [Axiom](https://github.com/axiom-crypto/axiom-eth) (archived), [Brevis](https://github.com/brevis-network/brevis-sdk) |
| **ZK light clients / bridges** | prove another chain's consensus in a SNARK, so bridges trust math instead of a multisig. Relevant to LUV's multichain doctrine | zkVMs + Groth16 wrap | [SP1 Helios](https://github.com/succinctlabs/sp1-helios) |
| **Proof of reserves / solvency** | commit to all balances in a Merkle-sum tree and prove each user's inclusion plus total liabilities ≤ assets, without publishing balances | §7 commitments, §10.1 Merkle proofs, range checks | [Summa](https://github.com/summa-dev/summa-solvency) |
| **Private payments with compliance** | shielded pools where withdrawers prove membership in an *association set* that excludes illicit deposits | §10.1 membership + nullifiers | [Privacy Pools](https://github.com/0xbow-io/privacy-pools-core), [Zcash spec](https://zips.z.cash/protocol/protocol.pdf) |
| **Credentials from the real world** | prove facts about a passport, national ID, email (DKIM) or TLS session without revealing it ("over 18", "works at X") | signature verification in-circuit | [ZK Email](https://github.com/zkemail/zk-email-verify), [Anon Aadhaar](https://github.com/anon-aadhaar/anon-aadhaar), [ZKPassport](https://github.com/zkpassport) |
| **zkML** | prove a model produced an output (or that a hidden model meets a benchmark) | arithmetised neural nets, lookups | [EZKL](https://github.com/zkonduit/ezkl) |
| **Recursion / aggregation** | verify proofs inside proofs: many claims settle as one ~200k-gas verification | Halo / PLONK recursion, Groth16 wrap | [Halo2](https://github.com/zcash/halo2), [eprint 2019/1021](https://eprint.iacr.org/2019/1021) |
| **Public-input compression** | pass one public input `sha256(all inputs) mod r` and recompute it in the contract, so verifier cost stays flat as inputs grow | §9.3 gas model | the standard rollup trick (both the circuit and the contract hash the inputs) |

---

## 11. Choosing a proof system

| system | setup | proof size | on-chain verify | prover | notes / implementations |
|---|---|---|---|---|---|
| **Groth16** | per-circuit trusted setup | ~128–256 B (3 points) | ~200k gas (198k measured, §11) | fast | the de facto EVM standard · [snarkjs](https://github.com/iden3/snarkjs), [gnark](https://github.com/Consensys/gnark), [arkworks](https://github.com/arkworks-rs/groth16) |
| **PLONK** / FFLONK | universal, updatable setup | ~0.5–1 KB | ~270k gas measured (FFLONK: ~193k) | fast | one ceremony for all circuits · [eprint 2019/953](https://eprint.iacr.org/2019/953), snarkjs `plonk`/`fflonk`, [Noir/Barretenberg](https://github.com/noir-lang/noir) |
| **Halo2** | none (IPA) or universal (KZG) | ~1–10 KB | KZG variant feasible | medium | custom gates, lookups, recursion · [zcash/halo2](https://github.com/zcash/halo2), [eprint 2019/1021](https://eprint.iacr.org/2019/1021) |
| **STARKs** | **transparent** | ~50–200 KB | expensive directly; usually wrapped in a SNARK | very fast, parallel | hash-based, plausibly post-quantum · [eprint 2018/046](https://eprint.iacr.org/2018/046), [Stwo](https://github.com/starkware-libs/stwo), [Cairo](https://github.com/starkware-libs/cairo) |
| **Bulletproofs** | **transparent** | ~0.7 KB, log-size | linear-time verify, impractical on L1 | slow | range proofs, confidential transactions · [eprint 2017/1066](https://eprint.iacr.org/2017/1066) |
| **zkVMs** | varies (STARK + SNARK wrap) | ~256 B after the Groth16 wrap | ~250–300k gas | heavy | write ordinary Rust, prove its execution · [RISC Zero](https://github.com/risc0/risc0), [SP1](https://github.com/succinctlabs/sp1) |

**Measured on the same circuit** ([`ProofSystems.t.sol`](zk/foundry/test/ProofSystems.t.sol):
`cube.circom` proven three ways by `build.sh` and verified on the same EVM with
`gasleft()` around the call):

| system | setup needed | proof calldata | `verifyProof` gas |
|---|---|---|---|
| Groth16 | universal ptau **+ per-circuit phase 2** | 8 words (256 B) | **198,346** |
| PLONK | universal ptau only | 24 words (768 B) | **270,744** |
| FFLONK | universal ptau only | 24 words (768 B) | **192,936** |

This is one circuit with one public input. Groth16 adds about 6k gas per extra public input
(an `ecMul` and an `ecAdd`). PLONK-family verifiers also grow with public inputs, so measure
your own circuit, then decide. The bigger difference is the **setup**: PLONK and FFLONK need
no circuit-specific ceremony, so changing the circuit doesn't mean re-running phase 2.

Rules of thumb:

- For a fixed, small circuit verified on Ethereum, use **Groth16**.
- For many circuits, or if you can't run a per-circuit ceremony, use **PLONK** (or Noir).
- For big computations, use a **STARK or a zkVM**, wrapped in a SNARK for L1.
- For a one-off algebraic statement (key ownership, equal discrete logs, a balance), a
  **Σ-protocol** like those in §3–7 is smaller, faster and needs no setup.

---

## 12. Security checklist

### 12.1 Anatomy of an under-constrained circuit attack

Files: [`circom/age_buggy.circom`](zk/circom/age_buggy.circom) ·
[`circom/attack/age_forger.circom`](zk/circom/attack/age_forger.circom) ·
[`foundry/src/AgeGate.sol`](zk/foundry/src/AgeGate.sol) ·
[`foundry/test/UnderConstrained.t.sol`](zk/foundry/test/UnderConstrained.t.sol)

This is the most common real-world circuit bug, reproduced end to end. The developer
computes an output with `<--` and "constrains" it with a check that only proves it's a bit:

```circom
isAdult <-- (age >= minAge) ? 1 : 0;   // ✗ computed, NOT constrained
isAdult * (isAdult - 1) === 0;          // ✗ only says "isAdult is 0 or 1"
```

The attacker copies the circuit and changes the hint to `isAdult <-- 1;`. **The constraint
system is byte-identical**: `build.sh` runs `cmp` on the two `.r1cs` files. So the honest
proving key turns the attacker's witness into a valid proof:

```
── age_buggy: prove ageMinor            → isAdult = 0     (honest witness, age 10)
── attack: compile the forger's witness generator
   identical constraint systems: the honest proving key accepts the forger's witnesses
── age_buggy: prove ageForged           → snarkJS: OK!
   ⚠ ATTACK SUCCEEDED (expected): a 10-year-old's proof of isAdult = 1
```

On-chain, `test_attack_forgedProofIsAccepted` passes: the 10-year-old is
`verifiedAdult`. **`AgeGate.sol` has no bug.** It assembles the statement itself, demands
`isAdult == 1` and binds the subject. A contract audit cannot find a circuit bug.

Witness-generation code belongs to the **prover**, and only constraints protect you.
`credential.circom` (§10.6) fixes it with a constrained `GreaterEqThan`, range checks
against field wrap-around, `adult.out === 1`, and an issuer signature, so the attribute isn't
self-asserted either. Static analysers such as
[circomspect](https://github.com/trailofbits/circomspect) flag `<--` assignments that have no
matching constraint.

### 12.2 Checklist

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
- [ ] Never trust a value only because the *honest* witness generator computes it correctly.
      An attacker runs their own witness generator ([§12.1](#121-anatomy-of-an-under-constrained-circuit-attack)).
- [ ] Self-asserted private inputs (a birth year, a balance) prove nothing. They must be signed
      by an issuer, committed on-chain, or derived from something that is.

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
- [ ] The Merkle root is checked against a known-root history, and whoever computes it is
      trusted or replaced by an on-chain tree (`ZkGroup`).
- [ ] Any hash computed both in-circuit and in Solidity (Poseidon) is the **same
      instantiation**, checked against a shared test vector.
- [ ] The **contract assembles the statement** from its own state (scope, proposal root).
      Never take values the contract already knows from the caller.
- [ ] `scope` / domain is bound to `chainid` and `address(this)`, so proofs can't be replayed
      on another deployment.
- [ ] Σ-protocol verifiers check that **every point is on the curve and not infinity**, and
      that scalars are canonical (`< N`). `KeyRegistry` tests each case.
- [ ] Expect a malformed proof point to make the precompile fail, which **consumes all the gas
      forwarded to it**. `test_tamperedProofFails` shows a tampered proof burning the call's
      gas instead of reverting cheaply. Relayers should simulate before they submit.
- [ ] Gas cost is measured (`forge test --gas-report`, or the per-test gas in `npm run test:evm`).

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
| [`docs/zk/js/bn254.mjs`](zk/js/bn254.mjs) | dependency-free BN254 G1 arithmetic plus Solidity-compatible encoding |
| [`docs/zk/js/08-schnorr-bn254.mjs`](zk/js/08-schnorr-bn254.mjs) | off-chain prover for `KeyRegistry`; the challenge matches the contract byte for byte |
| [`docs/zk/js/run-all.mjs`](zk/js/run-all.mjs) | runs every JS example; fails loudly |
| [`docs/zk/README.md`](zk/README.md) | quick start and folder map |
| [`docs/zk/package.json`](zk/package.json) | `npm run examples` · `npm run build` · `npm run test:evm` · `npm test` |
| **circuits** | |
| [`docs/zk/circom/cube.circom`](zk/circom/cube.circom) | the running example as a circuit (2 constraints) |
| [`docs/zk/circom/membership.circom`](zk/circom/membership.circom) | Merkle membership + scoped nullifier + bound message (6,143 constraints, depth 10) |
| [`docs/zk/circom/credential.circom`](zk/circom/credential.circom) | EdDSA-signed attribute + range-checked comparison (8,635 constraints) |
| [`docs/zk/circom/age_buggy.circom`](zk/circom/age_buggy.circom) · [`attack/age_forger.circom`](zk/circom/attack/age_forger.circom) | ⚠ the under-constrained circuit and the attacker's identical-constraint forger |
| [`docs/zk/circom/make-inputs.mjs`](zk/circom/make-inputs.mjs) | builds the Poseidon member tree, signs credentials, writes witnesses + `ZkConstants.sol` |
| [`docs/zk/circom/build.sh`](zk/circom/build.sh) | full pipeline: compile → dev ceremony → prove → verify → verifiers + fixtures, the attack, a must-fail credential, PLONK/FFLONK |
| [`docs/zk/circom/gen-fixture.mjs`](zk/circom/gen-fixture.mjs) · [`gen-fixture-calldata.mjs`](zk/circom/gen-fixture-calldata.mjs) | snarkjs proofs (Groth16 / PLONK / FFLONK) → Solidity fixture libraries |
| [`docs/zk/circom/gen-poseidon.mjs`](zk/circom/gen-poseidon.mjs) | circomlibjs Poseidon contract → `src/generated/PoseidonT3.sol` |
| **contracts** (`docs/zk/foundry/src`) | |
| [`CubeGate.sol`](zk/foundry/src/CubeGate.sol) | minimal verifier consumer, with a documented replay flaw |
| [`ZkAirdrop.sol`](zk/foundry/src/ZkAirdrop.sol) | anonymous, relayable, front-run-proof one-per-member claims |
| [`ZkGroup.sol`](zk/foundry/src/ZkGroup.sol) · [`OwnerRoots.sol`](zk/foundry/src/OwnerRoots.sol) · [`interfaces/IRootSource.sol`](zk/foundry/src/interfaces/IRootSource.sol) | the two root sources: on-chain Poseidon tree vs operator-published roots |
| [`CredentialGate.sol`](zk/foundry/src/CredentialGate.sol) | private issuer-backed attribute check (age ≥ 18) |
| [`AgeGate.sol`](zk/foundry/src/AgeGate.sol) | ⚠ a correct contract on a broken circuit, the §12.1 victim |
| [`generated/PoseidonT3.sol`](zk/foundry/src/generated/PoseidonT3.sol) | Poseidon(2) bytecode + deployer, bit-identical to the circuit's hash |
| [`ZkVote.sol`](zk/foundry/src/ZkVote.sol) | anonymous voting on the same circuit and verifier |
| [`KeyRegistry.sol`](zk/foundry/src/KeyRegistry.sol) | Schnorr proof-of-possession verified with precompiles, no trusted setup |
| [`BN254.sol`](zk/foundry/src/BN254.sol) | G1 add/mul/on-curve library over the EIP-196 precompiles |
| [`interfaces/IMembershipVerifier.sol`](zk/foundry/src/interfaces/IMembershipVerifier.sol) | the 4-public-signal verifier interface |
| [`verifiers/`](zk/foundry/src/verifiers/) | snarkjs-generated verifiers: Groth16 (Cube, Membership, Credential, AgeBuggy) + PLONK and FFLONK (Cube). **Dev ceremony, never deploy** |
| **tests** (`docs/zk/foundry/test`) | |
| [`ZkTest.sol`](zk/foundry/test/ZkTest.sol) | cheatcode-free test base: `Actor`, `expectRevert`, `MockToken` |
| [`CubeGate.t.sol`](zk/foundry/test/CubeGate.t.sol) · [`ZkAirdrop.t.sol`](zk/foundry/test/ZkAirdrop.t.sol) · [`ZkGroup.t.sol`](zk/foundry/test/ZkGroup.t.sol) · [`ZkVote.t.sol`](zk/foundry/test/ZkVote.t.sol) · [`KeyRegistry.t.sol`](zk/foundry/test/KeyRegistry.t.sol) · [`Credential.t.sol`](zk/foundry/test/Credential.t.sol) · [`UnderConstrained.t.sol`](zk/foundry/test/UnderConstrained.t.sol) · [`ProofSystems.t.sol`](zk/foundry/test/ProofSystems.t.sol) | valid proofs, tampering, replay, front-running, double use, scope separation, on-chain/off-chain root equality, the forged-proof attack, credential binding, and a three-system gas comparison |
| [`fixtures/`](zk/foundry/test/fixtures/) | generated real proofs (Groth16, PLONK, FFLONK) and `ZkConstants.sol` (group members, issuer key) |
| [`docs/zk/evm/run-tests.mjs`](zk/evm/run-tests.mjs) | forge-style runner on ethereumjs, plus a JS ↔ Solidity interop check |
| [`contracts/ShambaLuvAirdrop.sol`](../contracts/ShambaLuvAirdrop.sol) | the signature-gated airdrop that §10.2 contrasts with `ZkAirdrop` |

### 13.2 Libraries and toolchains (source)

| project | language | role |
|---|---|---|
| [iden3/circom](https://github.com/iden3/circom) · [docs](https://docs.circom.io/) | Rust → DSL | circuit compiler (R1CS + WASM witness generator) |
| [iden3/snarkjs](https://github.com/iden3/snarkjs) | JS | Groth16 / PLONK / FFLONK prover, ceremonies, Solidity verifier export |
| [iden3/circomlib](https://github.com/iden3/circomlib) | Circom | standard gadgets: Poseidon, MiMC, EdDSA, comparators, Merkle/SMT |
| [semaphore-protocol/semaphore](https://github.com/semaphore-protocol/semaphore) | Circom + Solidity | anonymous group membership + nullifiers (the production version of §10.1) |
| [iden3/circomlibjs](https://github.com/iden3/circomlibjs) | JS | Poseidon and other circuit-friendly hashes off-chain (used by `make-inputs.mjs`) |
| [ethereumjs/ethereumjs-monorepo](https://github.com/ethereumjs/ethereumjs-monorepo) | TS | the EVM that `run-tests.mjs` executes on (BN254 precompiles included) |
| [noir-lang/noir](https://github.com/noir-lang/noir) · [docs](https://noir-lang.org/docs) | Rust-like DSL | circuit language with a Solidity verifier backend |
| [Consensys/gnark](https://github.com/Consensys/gnark) | Go | fast Groth16 / PLONK, used in production rollups |
| [arkworks-rs/groth16](https://github.com/arkworks-rs/groth16) | Rust | modular SNARK research ecosystem |
| [zcash/halo2](https://github.com/zcash/halo2) | Rust | PLONKish arithmetisation, recursion without a trusted setup |
| [risc0/risc0](https://github.com/risc0/risc0) · [succinctlabs/sp1](https://github.com/succinctlabs/sp1) | Rust | zkVMs: prove the execution of ordinary programs |
| [starkware-libs/stwo](https://github.com/starkware-libs/stwo) · [cairo](https://github.com/starkware-libs/cairo) | Rust / Cairo | STARK prover and STARK-native language |
| [paulmillr/noble-curves](https://github.com/paulmillr/noble-curves) | JS | audited curves (secp256k1, BN254, BLS12-381), the production counterpart to `secp256k1.mjs` |
| [bitcoin-core/secp256k1](https://github.com/bitcoin-core/secp256k1) | C | constant-time reference secp256k1 |
| [foundry-rs/foundry](https://github.com/foundry-rs/foundry) | Rust | test framework for `docs/zk/foundry` (no forge-std needed) |
| [trailofbits/circomspect](https://github.com/trailofbits/circomspect) · [Veridise/Picus](https://github.com/Veridise/Picus) | Rust / Racket | static analysis for under-constrained circuits |

### 13.3 Specifications

- [EIP-196](https://eips.ethereum.org/EIPS/eip-196) / [EIP-197](https://eips.ethereum.org/EIPS/eip-197): BN254 add/mul and pairing precompiles
- [EIP-1108](https://eips.ethereum.org/EIPS/eip-1108): their gas repricing (pairing = 45,000 + 34,000·k)
- [EIP-2537](https://eips.ethereum.org/EIPS/eip-2537): BLS12-381 precompiles
- [Solidity ABI specification](https://docs.soliditylang.org/en/latest/abi-spec.html): the static-array encoding of `verifyProof` arguments
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
