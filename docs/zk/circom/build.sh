#!/usr/bin/env bash
# build.sh — the full Groth16 pipeline for every circuit in this folder:
#   compile → trusted setup (phase 1 + 2) → witnesses → proofs → off-chain verify
#   → Solidity verifiers (../foundry/src/verifiers) + proof fixtures (../foundry/test/fixtures)
#
# Run from docs/zk:  npm install && npm run build
# Tools come from docs/zk/node_modules (circom2 = the circom compiler built to WASM, snarkjs,
# circomlib, circomlibjs); a native `circom` on PATH is used if present (faster).
# Every snarkjs command is documented at https://github.com/iden3/snarkjs#guide
#
# ⚠ DEV CEREMONY — the entropy below is generated and discarded on THIS machine, and the
#   committed verifiers come from such a run. Fine for tests; NEVER deploy them. For
#   production, start phase 2 from a public ceremony (e.g. Perpetual Powers of Tau,
#   https://github.com/privacy-ethereum/perpetualpowersoftau) and run a multi-party phase 2.
set -euo pipefail
cd "$(dirname "$0")"

ZK=..
NM="$ZK/node_modules"
[ -d "$NM/circomlib" ] || { echo "run 'npm install' in docs/zk first"; exit 1; }
if command -v circom >/dev/null; then CIRCOM=(circom); else CIRCOM=(node "$NM/circom2/cli.js"); fi
SNARKJS=(node "$NM/snarkjs/build/cli.cjs")
snarkjs() { "${SNARKJS[@]}" "$@"; }
entropy() { head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'; }

B=build
SRC=../foundry/src/verifiers
FIX=../foundry/test/fixtures
mkdir -p "$B" "$SRC" "$FIX"
# the WASM circom can only read under the current directory's ancestors, so give it a local
# copy of the circomlib circuits to include from
mkdir -p "$B/lib/circomlib" && cp -R "$NM/circomlib/circuits" "$B/lib/circomlib/"

echo "── phase 1: universal powers of tau, 2^13 = 8192 constraints max (shared by all circuits)"
if [ ! -f "$B/pot13_final.ptau" ]; then
  snarkjs powersoftau new bn128 13 "$B/pot13_0000.ptau"
  snarkjs powersoftau contribute "$B/pot13_0000.ptau" "$B/pot13_0001.ptau" --name="dev-1" -e="$(entropy)"
  snarkjs powersoftau prepare phase2 "$B/pot13_0001.ptau" "$B/pot13_final.ptau"
fi

# setup <circuit> <VerifierContractName>
setup() {
  local c=$1 vname=$2
  echo "── $c: compile"
  "${CIRCOM[@]}" "$c.circom" --r1cs --wasm --sym -l "$B/lib" -o "$B"
  snarkjs r1cs info "$B/$c.r1cs"
  echo "── $c: phase 2 (circuit-specific keys)"
  snarkjs groth16 setup "$B/$c.r1cs" "$B/pot13_final.ptau" "$B/${c}_0000.zkey"
  snarkjs zkey contribute "$B/${c}_0000.zkey" "$B/${c}_final.zkey" --name="dev-2" -e="$(entropy)"
  snarkjs zkey verify "$B/$c.r1cs" "$B/pot13_final.ptau" "$B/${c}_final.zkey"
  snarkjs zkey export verificationkey "$B/${c}_final.zkey" "$B/${c}_vkey.json"
  snarkjs zkey export solidityverifier "$B/${c}_final.zkey" "$SRC/$vname.sol"
  # every generated verifier is called Groth16Verifier — give each a unique name
  sed -i.bak "s/contract Groth16Verifier/contract $vname/" "$SRC/$vname.sol" && rm -f "$SRC/$vname.sol.bak"
  { echo "// ⚠ GENERATED FROM A DEV CEREMONY (docs/zk/circom/build.sh) — FOR TESTS ONLY, NEVER DEPLOY."
    echo "// Whoever knew the setup entropy could forge proofs. See docs/ZERO_KNOWLEDGE_PROOFS.md §9.2."
    cat "$SRC/$vname.sol"; } > "$SRC/$vname.sol.tmp" && mv "$SRC/$vname.sol.tmp" "$SRC/$vname.sol"
}

# prove <circuit> <inputName> <FixtureLibraryName>
prove() {
  local c=$1 in=$2 lib=$3
  echo "── $c: prove $in"
  snarkjs groth16 fullprove "$B/$in.input.json" "$B/${c}_js/$c.wasm" "$B/${c}_final.zkey" "$B/$in.proof.json" "$B/$in.public.json"
  snarkjs groth16 verify "$B/${c}_vkey.json" "$B/$in.public.json" "$B/$in.proof.json"
  node gen-fixture.mjs "$lib" "$B/$in.proof.json" "$B/$in.public.json" > "$FIX/$lib.sol"
}

# 1. the running example: x³ + x + 5 = 35
setup cube CubeVerifier
echo '{ "x": "3" }' > "$B/cube.input.json"
prove cube cube CubeProof

# 2. anonymous membership + nullifier (airdrop + voting)
setup membership MembershipVerifier
node make-inputs.mjs "$B"
prove membership airdropA AirdropProofA
prove membership airdropB AirdropProofB
prove membership vote VoteProof

echo "done → verifiers in $SRC, fixtures in $FIX. Next: npm run test:evm  (or: cd foundry && forge test)"
