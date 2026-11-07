pragma circom 2.1.6;

// membership.circom — anonymous group membership with a scoped nullifier and a bound message.
//
// One circuit, many applications (the Semaphore pattern):
//   • ZkAirdrop.sol — message = recipient address, scope = airdrop round
//   • ZkVote.sol    — message = vote option,      scope = proposal id
//
// The prover shows, without revealing WHICH member they are:
//   1. they know `secret` whose identity commitment Poseidon(secret) is a leaf of the
//      Merkle tree with public root `root`;
//   2. nullifierHash = Poseidon(secret, scope)  — one action per member per scope,
//      unlinkable across scopes;
//   3. the proof commits to `message`, so a front-runner cannot swap it.
//
// Reference implementation of the same idea (audited, production):
//   https://github.com/semaphore-protocol/semaphore/blob/main/packages/circuits/src/semaphore.circom
// Poseidon: https://github.com/iden3/circomlib/blob/master/circuits/poseidon.circom

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

template Membership(depth) {
    // ── public signals (the statement), in this order in public.json ──
    signal input root;
    signal input nullifierHash;
    signal input message;
    signal input scope;

    // ── private witness ──
    signal input secret;
    signal input pathElements[depth];
    signal input pathIndices[depth];

    // 1. membership
    component commitment = Poseidon(1);
    commitment.inputs[0] <== secret;

    component tree = MerkleRoot(depth);
    tree.leaf <== commitment.out;
    for (var i = 0; i < depth; i++) {
        tree.pathElements[i] <== pathElements[i];
        tree.pathIndices[i] <== pathIndices[i];
    }
    root === tree.root;

    // 2. scoped nullifier
    component nullifier = Poseidon(2);
    nullifier.inputs[0] <== secret;
    nullifier.inputs[1] <== scope;
    nullifierHash === nullifier.out;

    // 3. bind the message: an unused public input could be optimised away, so square it
    //    (the same trick Semaphore uses). Now a proof is valid for exactly one message.
    signal messageSquared;
    messageSquared <== message * message;
}

// depth 10 = 1,024 members — small so the demo ceremony is fast. Production: 20–32.
component main {public [root, nullifierHash, message, scope]} = Membership(10);
