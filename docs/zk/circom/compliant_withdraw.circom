pragma circom 2.1.6;

// compliant_withdraw.circom — a shielded-pool withdrawal with a COMPLIANCE proof and a
// relayer fee (the Privacy Pools idea: https://github.com/0xbow-io/privacy-pools-core).
//
// The withdrawer proves, without revealing which deposit is theirs:
//   1. their commitment Poseidon(secret) is in the pool's DEPOSIT tree        (they deposited)
//   2. the SAME commitment is in an ASSOCIATION tree                          (their deposit is
//      in a set an Association Set Provider has vetted — e.g. "not from a known hack")
//   3. nullifierHash = Poseidon(secret, scope)                                (no double-spend)
//   4. recipient, relayer and fee are bound into the proof                    (a relayer can
//      neither redirect the funds nor raise its own fee)
//
// A depositor the ASP has flagged is simply absent from the association tree: there is no
// witness for step 2, so no proof exists (build.sh checks this). Honest users dissociate
// from illicit funds without revealing anything else — privacy and compliance together.

include "circomlib/circuits/poseidon.circom";
include "lib/merkle.circom";

template CompliantWithdraw(depth) {
    // ── public signals, in this order ──
    signal input depositRoot;
    signal input associationRoot;
    signal input nullifierHash;
    signal input recipient;
    signal input relayer;
    signal input fee;
    signal input scope;

    // ── private witness ──
    signal input secret;
    signal input depositPathElements[depth];
    signal input depositPathIndices[depth];
    signal input associationPathElements[depth];
    signal input associationPathIndices[depth];

    component commitment = Poseidon(1);
    commitment.inputs[0] <== secret;

    // 1. in the deposit tree
    component dep = MerkleRoot(depth);
    dep.leaf <== commitment.out;
    // 2. the same leaf in the association tree (usually at a different index)
    component assoc = MerkleRoot(depth);
    assoc.leaf <== commitment.out;
    for (var i = 0; i < depth; i++) {
        dep.pathElements[i] <== depositPathElements[i];
        dep.pathIndices[i] <== depositPathIndices[i];
        assoc.pathElements[i] <== associationPathElements[i];
        assoc.pathIndices[i] <== associationPathIndices[i];
    }
    depositRoot === dep.root;
    associationRoot === assoc.root;

    // 3. scoped nullifier
    component nullifier = Poseidon(2);
    nullifier.inputs[0] <== secret;
    nullifier.inputs[1] <== scope;
    nullifierHash === nullifier.out;

    // 4. bind the payout terms (unused public inputs would be optimised away)
    signal recipientSquared;
    signal relayerSquared;
    signal feeSquared;
    recipientSquared <== recipient * recipient;
    relayerSquared <== relayer * relayer;
    feeSquared <== fee * fee;
}

component main {public [depositRoot, associationRoot, nullifierHash, recipient, relayer, fee, scope]} = CompliantWithdraw(10);
