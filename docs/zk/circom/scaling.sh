#!/usr/bin/env bash
# scaling.sh — how circuit size grows with the Merkle depth (= the group capacity, 2^depth).
# Compiles membership, compliant_withdraw and transaction (2-in/2-out) at several depths and prints the
# R1CS constraint counts as a Markdown table. Compile only: no ceremony, nothing committed.
#
# Run from docs/zk:  npm run scaling
set -euo pipefail
cd "$(dirname "$0")"
NM=../node_modules
[ -d "$NM/circomlib" ] || { echo "run 'npm install' in docs/zk first"; exit 1; }
if command -v circom >/dev/null; then CIRCOM=(circom); else CIRCOM=(node "$NM/circom2/cli.js"); fi
SNARKJS=(node "$NM/snarkjs/build/cli.cjs")

S=build/scale
mkdir -p "$S/lib/circomlib" && cp -R "$NM/circomlib/circuits" "$S/lib/circomlib/" && cp -R lib "$S/"
count() { "${SNARKJS[@]}" r1cs info "$1" | sed -n 's/.*# of Constraints: \([0-9]*\).*/\1/p'; }
commas() { echo "$1" | sed -e ':a' -e 's/\([0-9]\)\([0-9]\{3\}\)\($\|,\)/\1,\2\3/' -e 'ta'; }
ptau() { local n=$1 p=0; while [ $((1 << p)) -lt "$n" ]; do p=$((p + 1)); done; echo "$p"; }

echo "| depth | capacity | membership | compliant_withdraw | transaction (2-in/2-out) | ptau power for the largest |"
echo "|---:|---:|---:|---:|---:|---:|"
for d in 10 16 20 24 32; do
  for c in membership compliant_withdraw transaction; do
    sed -E "s/(Membership|CompliantWithdraw)\(10\);/\1($d);/; s/Transaction\(10, 2, 2\);/Transaction($d, 2, 2);/" "$c.circom" > "$S/${c}_$d.circom"
    "${CIRCOM[@]}" "$S/${c}_$d.circom" --r1cs -l "$S/lib" -l "$S" -o "$S" > /dev/null
  done
  m=$(count "$S/membership_$d.r1cs"); cw=$(count "$S/compliant_withdraw_$d.r1cs"); tx=$(count "$S/transaction_$d.r1cs")
  big=$(( cw > tx ? cw : tx ))
  printf "| %s | %s | %s | %s | %s | 2^%s |\n" "$d" "$(commas $((1 << d)))" "$(commas "$m")" "$(commas "$cw")" "$(commas "$tx")" "$(ptau "$big")"
done
