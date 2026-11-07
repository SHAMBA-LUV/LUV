#!/usr/bin/env bash
# prove.sh — the full Groth16 pipeline for cube.circom:
#   compile → trusted setup (phase 1 + 2) → witness → proof → verify → Solidity verifier.
#
# Prerequisites:
#   circom 2.x  — https://docs.circom.io/getting-started/installation/
#   snarkjs     — npm i -g snarkjs   (or this script falls back to npx)
#   node ≥ 18
#
# Every command is documented in the snarkjs README:
#   https://github.com/iden3/snarkjs#guide
#
# ⚠ The local "powers of tau" below is for LEARNING ONLY. Whoever knows the setup entropy
#   can forge proofs. In production, start phase 2 from a public multi-party ceremony file
#   (e.g. the Hermez/Polygon ptau files listed in the snarkjs README) and run a real phase-2
#   ceremony with independent contributors.
set -euo pipefail
cd "$(dirname "$0")"

command -v snarkjs >/dev/null || snarkjs() { npx --yes snarkjs@0.7.6 "$@"; }

B=build
mkdir -p "$B"

echo "── 1. compile the circuit to R1CS + a WASM witness generator"
circom cube.circom --r1cs --wasm --sym -o "$B"
snarkjs r1cs info "$B/cube.r1cs"           # expect: # of Constraints: 2

echo "── 2a. phase 1: universal powers of tau (2^8 = 256 constraints max)"
snarkjs powersoftau new bn128 8 "$B/pot8_0000.ptau"
snarkjs powersoftau contribute "$B/pot8_0000.ptau" "$B/pot8_0001.ptau" --name="demo-1" -e="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
snarkjs powersoftau prepare phase2 "$B/pot8_0001.ptau" "$B/pot8_final.ptau"

echo "── 2b. phase 2: circuit-specific proving/verifying keys"
snarkjs groth16 setup "$B/cube.r1cs" "$B/pot8_final.ptau" "$B/cube_0000.zkey"
snarkjs zkey contribute "$B/cube_0000.zkey" "$B/cube_final.zkey" --name="demo-2" -e="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
snarkjs zkey verify "$B/cube.r1cs" "$B/pot8_final.ptau" "$B/cube_final.zkey"
snarkjs zkey export verificationkey "$B/cube_final.zkey" "$B/verification_key.json"

echo "── 3. witness + proof   (the private input x = 3 stays on this machine)"
echo '{ "x": "3" }' > "$B/input.json"
snarkjs groth16 fullprove "$B/input.json" "$B/cube_js/cube.wasm" "$B/cube_final.zkey" "$B/proof.json" "$B/public.json"
echo "public signals: $(cat "$B/public.json")"   # expect: ["35"]

echo "── 4. verify off-chain"
snarkjs groth16 verify "$B/verification_key.json" "$B/public.json" "$B/proof.json"

echo "── 5. export the on-chain verifier + ABI-encoded calldata for the Foundry tests"
mkdir -p ../foundry/proof
snarkjs zkey export solidityverifier "$B/cube_final.zkey" ../foundry/src/Groth16Verifier.sol
node ../foundry/encode-proof.mjs "$B/proof.json" "$B/public.json" > ../foundry/proof/calldata.hex
snarkjs zkey export soliditycalldata "$B/public.json" "$B/proof.json"   # human-readable copy

echo "done → cd ../foundry && forge test -vv"
