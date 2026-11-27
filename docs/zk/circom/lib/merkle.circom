pragma circom 2.1.6;

// lib/merkle.circom — Poseidon Merkle-root gadget shared by membership.circom and
// compliant_withdraw.circom. No `component main` here, so it can be included.

include "circomlib/circuits/poseidon.circom";

// Recompute a Merkle root from a leaf and its authentication path.
// pathIndices[i] = 0 → the current node is the LEFT child at level i, 1 → RIGHT child.
template MerkleRoot(depth) {
    signal input leaf;
    signal input pathElements[depth];
    signal input pathIndices[depth];
    signal output root;

    signal level[depth + 1];
    signal d[depth];
    component h[depth];
    level[0] <== leaf;

    for (var i = 0; i < depth; i++) {
        // pathIndices[i] must be a bit — without this an attacker could use any field element
        pathIndices[i] * (1 - pathIndices[i]) === 0;

        // branch-free swap with ONE multiplication:
        //   d = s·(sibling − node);  left = node + d;  right = sibling − d
        d[i] <== pathIndices[i] * (pathElements[i] - level[i]);

        h[i] = Poseidon(2);
        h[i].inputs[0] <== level[i] + d[i];
        h[i].inputs[1] <== pathElements[i] - d[i];
        level[i + 1] <== h[i].out;
    }
    root <== level[depth];
}
