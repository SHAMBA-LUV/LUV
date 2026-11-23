#!/usr/bin/env bash
# package.sh — build "complete zk.zip": every git-tracked file of the ZK project, with a
# zip-root README, then unpack it in a fresh temp dir and run the full test suite there,
# so a broken archive is never shipped.
#
# Usage (from docs/zk):  npm run package                 → ./dist/complete zk.zip
#                        bash scripts/package.sh <out.zip>
set -euo pipefail
ZK="$(cd "$(dirname "$0")/.." && pwd)"
REPO="$(git -C "$ZK" rev-parse --show-toplevel)"
OUT="${1:-$ZK/dist/complete zk.zip}"
mkdir -p "$(dirname "$OUT")"
OUT="$(cd "$(dirname "$OUT")" && pwd)/$(basename "$OUT")"

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

# 1. stage: tracked files of the guide, the ZK project, and the contract the guide contrasts with
cd "$REPO"
git ls-files docs/ZERO_KNOWLEDGE_PROOFS.md docs/zk contracts/ShambaLuvAirdrop.sol \
  | grep -v '^docs/zk/dist/' \
  | while read -r f; do mkdir -p "$STAGE/pkg/$(dirname "$f")"; cp "$f" "$STAGE/pkg/$f"; done
cp "$ZK/dist-README.md" "$STAGE/pkg/README.md"           # zip-root README

# 2. zip
rm -f "$OUT"
(cd "$STAGE/pkg" && zip -qr "$OUT" .)
echo "packed $(unzip -l "$OUT" | tail -1 | awk '{print $2}') files → $OUT"

# 3. self-test from a clean unpack (re-uses this checkout's node_modules)
mkdir "$STAGE/check" && (cd "$STAGE/check" && unzip -q "$OUT")
ln -s "$(cd "$ZK/node_modules" && pwd -P)" "$STAGE/check/docs/zk/node_modules"
(cd "$STAGE/check/docs/zk" && npm test --silent) | grep -E "examples passed|passed, "
echo "✓ archive verified"
