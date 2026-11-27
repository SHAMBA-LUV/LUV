pragma circom 2.1.6;

// transaction.circom — a 2-in / 2-out JOIN-SPLIT over hidden amounts (the core of Zcash
// Sapling, Railgun and Tornado Nova, simplified for teaching).
//
// A NOTE is (amount, pubKey, blinding). On-chain only its commitment appears:
//     commitment = Poseidon(amount, pubKey, blinding)        pubKey = Poseidon(privKey)
// To SPEND a note you prove you know privKey; its one-time tag is
//     nullifier  = Poseidon(commitment, privKey)
// so only the owner can spend, and only once. To PAY someone you only need their pubKey.
//
// One proof covers deposit, private transfer and withdrawal:
//     Σ inAmount + publicAmount == Σ outAmount              (mod p, but see the range checks)
// publicAmount = extAmount − fee  (positive: deposit; negative ≡ p − |x|: withdrawal + fee)
//
// Soundness of the balance equation over a field: every amount is range-checked to 120 bits,
// and the contract bounds |extAmount| and fee below 2^120. All sums stay far below p ≈ 2^254,
// so "equal mod p" means "equal as integers" — no wrap-around mint. Without the range checks
// an output of amount p − 10 (i.e. "−10") would let you create 10 tokens from nothing;
// build.sh proves that attempt fails.
//
// Dummy inputs (amount 0) skip the Merkle check, so a deposit needs no existing notes.
// Reference design: https://github.com/tornadocash/tornado-nova (circuits/transaction.circom)

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/bitify.circom";
include "circomlib/circuits/comparators.circom";
include "lib/merkle.circom";

template Transaction(levels, nIns, nOuts) {
    // ── public signals, in this order ──
    signal input root;
    signal input publicAmount;
    signal input extDataHash;                 // binds recipient / relayer / fee / extAmount
    signal input inputNullifier[nIns];
    signal input outputCommitment[nOuts];

    // ── private witness ──
    signal input inAmount[nIns];
    signal input inPrivKey[nIns];
    signal input inBlinding[nIns];
    signal input inPathIndices[nIns][levels];
    signal input inPathElements[nIns][levels];
    signal input outAmount[nOuts];
    signal input outPubKey[nOuts];
    signal input outBlinding[nOuts];

    component inKey[nIns];
    component inCommit[nIns];
    component inNullifier[nIns];
    component inTree[nIns];
    component inRange[nIns];
    component inIsDummy[nIns];
    signal inRootDiff[nIns];
    var sumIns = 0;

    for (var i = 0; i < nIns; i++) {
        inKey[i] = Poseidon(1);
        inKey[i].inputs[0] <== inPrivKey[i];

        inCommit[i] = Poseidon(3);
        inCommit[i].inputs[0] <== inAmount[i];
        inCommit[i].inputs[1] <== inKey[i].out;
        inCommit[i].inputs[2] <== inBlinding[i];

        inNullifier[i] = Poseidon(2);
        inNullifier[i].inputs[0] <== inCommit[i].out;
        inNullifier[i].inputs[1] <== inPrivKey[i];
        inNullifier[i].out === inputNullifier[i];

        inTree[i] = MerkleRoot(levels);
        inTree[i].leaf <== inCommit[i].out;
        for (var j = 0; j < levels; j++) {
            inTree[i].pathIndices[j] <== inPathIndices[i][j];
            inTree[i].pathElements[j] <== inPathElements[i][j];
        }
        // the note must be in the tree — unless it is a zero-value dummy
        inRootDiff[i] <== inTree[i].root - root;
        inRootDiff[i] * inAmount[i] === 0;

        inRange[i] = Num2Bits(120);
        inRange[i].in <== inAmount[i];

        sumIns += inAmount[i];
    }

    component outCommit[nOuts];
    component outRange[nOuts];
    var sumOuts = 0;
    for (var i = 0; i < nOuts; i++) {
        outCommit[i] = Poseidon(3);
        outCommit[i].inputs[0] <== outAmount[i];
        outCommit[i].inputs[1] <== outPubKey[i];
        outCommit[i].inputs[2] <== outBlinding[i];
        outCommit[i].out === outputCommitment[i];

        outRange[i] = Num2Bits(120);          // no "negative" outputs
        outRange[i].in <== outAmount[i];

        sumOuts += outAmount[i];
    }

    // the two inputs must be different notes (else one note could be counted twice)
    component same = IsEqual();
    same.in[0] <== inputNullifier[0];
    same.in[1] <== inputNullifier[1];
    same.out === 0;

    // conservation of value
    sumIns + publicAmount === sumOuts;

    // bind extDataHash (an otherwise-unused public input could be optimised away)
    signal extDataSquared;
    extDataSquared <== extDataHash * extDataHash;
}

component main {public [root, publicAmount, extDataHash, inputNullifier, outputCommitment]} = Transaction(10, 2, 2);
