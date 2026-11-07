#!/usr/bin/env bash
# build.sh — the full pipeline for every circuit in this folder:
#   compile → trusted setup (phase 1 + 2) → witnesses → proofs → off-chain verify
#   → Solidity verifiers (../foundry/src/verifiers) + proof fixtures (../foundry/test/fixtures)
#   + the under-constrained ATTACK, a must-fail credential, and Groth16/PLONK/FFLONK side by side.
#
# Run from docs/zk:  npm install && npm run build        (~4–6 min, mostly the 2^14 ceremony)
# Tools come from docs/zk/node_modules (circom2 = the circom compiler built to WASM, snarkjs,
# circomlib, circomlibjs); a native `circom` on PATH is used if present (faster).
# Every snarkjs command is documented at https://github.com/iden3/snarkjs#guide
#
# ⚠ DEV CEREMONY — the entropy below is generated and discarded on THIS machine, and the
#   committed verifiers come from such a run. Fine for tests; NEVER deploy them. For
#   production, start from a public ceremony (e.g. Perpetual Powers of Tau,
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
GEN=../foundry/src/generated
FIX=../foundry/test/fixtures
PTAU="$B/pot14_final.ptau"
mkdir -p "$B" "$SRC" "$GEN" "$FIX"
# the WASM circom can only read under the current directory's ancestors, so give it a local
# copy of the circomlib circuits to include from
mkdir -p "$B/lib/circomlib" && cp -R "$NM/circomlib/circuits" "$B/lib/circomlib/"

echo "── phase 1: universal powers of tau, 2^14 = 16384 constraints max (shared by all circuits)"
if [ ! -f "$PTAU" ]; then
  snarkjs powersoftau new bn128 14 "$B/pot14_0000.ptau"
  snarkjs powersoftau contribute "$B/pot14_0000.ptau" "$B/pot14_0001.ptau" --name="dev-1" -e="$(entropy)"
  snarkjs powersoftau prepare phase2 "$B/pot14_0001.ptau" "$PTAU"
fi

# prepend the do-not-deploy banner to a generated verifier
stamp() {
  { echo "// ⚠ GENERATED FROM A DEV CEREMONY (docs/zk/circom/build.sh) — FOR TESTS ONLY, NEVER DEPLOY."
    echo "// Whoever knew the setup entropy could forge proofs. See docs/ZERO_KNOWLEDGE_PROOFS.md §9.2."
    cat "$1"; } > "$1.tmp" && mv "$1.tmp" "$1"
}
# rename the generated contract (every snarkjs verifier has the same default name)
rename() { sed -i.bak "s/contract $2 /contract $3 /" "$1" && rm -f "$1.bak"; }

compile() { "${CIRCOM[@]}" "$1" --r1cs --wasm --sym -l "$B/lib" -o "$2"; }

# setup <circuit> <VerifierContractName>   — Groth16: universal ptau + circuit-specific phase 2
setup() {
  local c=$1 vname=$2
  echo "── $c: compile"
  compile "$c.circom" "$B"
  snarkjs r1cs info "$B/$c.r1cs"
  echo "── $c: phase 2 (circuit-specific keys)"
  snarkjs groth16 setup "$B/$c.r1cs" "$PTAU" "$B/${c}_0000.zkey"
  snarkjs zkey contribute "$B/${c}_0000.zkey" "$B/${c}_final.zkey" --name="dev-2" -e="$(entropy)"
  snarkjs zkey verify "$B/$c.r1cs" "$PTAU" "$B/${c}_final.zkey"
  snarkjs zkey export verificationkey "$B/${c}_final.zkey" "$B/${c}_vkey.json"
  snarkjs zkey export solidityverifier "$B/${c}_final.zkey" "$SRC/$vname.sol"
  rename "$SRC/$vname.sol" Groth16Verifier "$vname"
  stamp "$SRC/$vname.sol"
}

# prove <circuit> <inputName> <FixtureLibraryName> [wasm]   — wasm overrides the witness generator
prove() {
  local c=$1 in=$2 lib=$3 wasm=${4:-$B/${1}_js/$1.wasm}
  echo "── $c: prove $in"
  snarkjs groth16 fullprove "$B/$in.input.json" "$wasm" "$B/${c}_final.zkey" "$B/$in.proof.json" "$B/$in.public.json"
  snarkjs groth16 verify "$B/${c}_vkey.json" "$B/$in.public.json" "$B/$in.proof.json"
  node gen-fixture.mjs "$lib" "$B/$in.proof.json" "$B/$in.public.json" > "$FIX/$lib.sol"
}

echo "── inputs, group + issuer constants, Poseidon contract"
node make-inputs.mjs "$B" "$FIX"
node gen-poseidon.mjs > "$GEN/PoseidonT3.sol"

# 1. the running example: x³ + x + 5 = 35
setup cube CubeVerifier
echo '{ "x": "3" }' > "$B/cube.input.json"
prove cube cube CubeProof

# 1b. the same circuit under PLONK and FFLONK — universal setup only (no phase 2), for the gas table
for sys in plonk fflonk; do
  echo "── cube: $sys"
  snarkjs $sys setup "$B/cube.r1cs" "$PTAU" "$B/cube_$sys.zkey" > /dev/null
  snarkjs $sys fullprove "$B/cube.input.json" "$B/cube_js/cube.wasm" "$B/cube_$sys.zkey" "$B/cube_$sys.proof.json" "$B/cube_$sys.public.json" > /dev/null
  snarkjs zkey export verificationkey "$B/cube_$sys.zkey" "$B/cube_${sys}_vkey.json" > /dev/null
  snarkjs $sys verify "$B/cube_${sys}_vkey.json" "$B/cube_$sys.public.json" "$B/cube_$sys.proof.json"
  snarkjs zkey export solidityverifier "$B/cube_$sys.zkey" "$SRC/Cube${sys^}Verifier.sol" > /dev/null
  snarkjs zkey export soliditycalldata "$B/cube_$sys.public.json" "$B/cube_$sys.proof.json" > "$B/cube_$sys.calldata.txt"
done
rename "$SRC/CubePlonkVerifier.sol" PlonkVerifier CubePlonkVerifier && stamp "$SRC/CubePlonkVerifier.sol"
rename "$SRC/CubeFflonkVerifier.sol" FflonkVerifier CubeFflonkVerifier && stamp "$SRC/CubeFflonkVerifier.sol"
node gen-fixture-calldata.mjs CubePlonkProof uint256 "$B/cube_plonk.calldata.txt" > "$FIX/CubePlonkProof.sol"
node gen-fixture-calldata.mjs CubeFflonkProof bytes32 "$B/cube_fflonk.calldata.txt" > "$FIX/CubeFflonkProof.sol"

# 2. anonymous membership + nullifier (airdrop + voting)
setup membership MembershipVerifier
prove membership airdropA AirdropProofA
prove membership airdropB AirdropProofB
prove membership vote VoteProof

# 3. the under-constrained ATTACK on age_buggy.circom
setup age_buggy AgeBuggyVerifier
prove age_buggy ageMinor AgeHonestProof            # honest witness: isAdult = 0
echo "── attack: compile the forger's witness generator"
mkdir -p "$B/forger" && compile attack/age_forger.circom "$B/forger"
cmp "$B/age_buggy.r1cs" "$B/forger/age_forger.r1cs" \
  && echo "   identical constraint systems: the honest proving key accepts the forger's witnesses"
cp "$B/ageMinor.input.json" "$B/ageForged.input.json"
prove age_buggy ageForged AgeForgedProof "$B/forger/age_forger_js/age_forger.wasm"
echo "   ⚠ ATTACK SUCCEEDED (expected): a 10-year-old's proof of isAdult = $(node -p "require('./$B/ageForged.public.json')[0]")"

# 4. the fix: issuer-signed credential + range-checked comparison
setup credential CredentialVerifier
prove credential credAdult CredentialProof
echo "── credential: a minor must NOT be able to prove"
if snarkjs groth16 fullprove "$B/credMinor.input.json" "$B/credential_js/credential.wasm" "$B/credential_final.zkey" "$B/credMinor.proof.json" "$B/credMinor.public.json" > /dev/null 2>&1; then
  echo "   ✗ BUG: a minor produced a credential proof"; exit 1
fi
echo "   ✓ witness generation fails (adult.out === 1 is unsatisfiable) — no proof exists"

echo "done → verifiers in $SRC, fixtures in $FIX. Next: npm run test:evm  (or: cd foundry && forge test)"
