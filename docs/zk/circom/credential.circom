pragma circom 2.1.6;

// credential.circom — a private, issuer-signed credential with a range proof:
// "an issuer I trust signed my birth year, the signature is bound to my address, and that
//  birth year makes me at least minAge" — revealing neither the birth year nor the signature.
//
// It fixes BOTH flaws of age_buggy.circom:
//   1. the attribute is no longer self-asserted: an EdDSA signature (Baby Jubjub + Poseidon)
//      by the issuer over Poseidon(birthYear, subject) is verified IN the circuit;
//   2. the comparison is fully constrained: age is range-checked to 8 bits (no field
//      wrap-around) before a constrained GreaterEqThan, and the result is forced to 1.
//
// Same shape as real-world identity schemes (ZKPassport, Anon Aadhaar, ZK Email): an
// authority signs data once; holders prove predicates about it many times, privately.
// Gadgets: https://github.com/iden3/circomlib/blob/master/circuits/eddsaposeidon.circom
//          https://github.com/iden3/circomlib/blob/master/circuits/comparators.circom

include "circomlib/circuits/eddsaposeidon.circom";
include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/bitify.circom";
include "circomlib/circuits/poseidon.circom";

template Credential() {
    // ── public: the issuer, the policy, the beneficiary ──
    signal input issuerAx;
    signal input issuerAy;
    signal input currentYear;
    signal input minAge;
    signal input subject;

    // ── private: the attribute and the issuer's signature on it ──
    signal input birthYear;
    signal input sigR8x;
    signal input sigR8y;
    signal input sigS;

    // 1. the issuer signed (birthYear, subject) — the credential can't be moved to another address
    component msg = Poseidon(2);
    msg.inputs[0] <== birthYear;
    msg.inputs[1] <== subject;

    component sig = EdDSAPoseidonVerifier();
    sig.enabled <== 1;
    sig.Ax <== issuerAx;
    sig.Ay <== issuerAy;
    sig.R8x <== sigR8x;
    sig.R8y <== sigR8y;
    sig.S <== sigS;
    sig.M <== msg.out;

    // 2. range checks: without them, currentYear − birthYear could wrap around the field
    //    (a "negative" age is a ~254-bit number) and fool the comparator
    signal age;
    age <== currentYear - birthYear;
    component ageBits = Num2Bits(8);       // 0 ≤ age < 256
    ageBits.in <== age;
    component minBits = Num2Bits(8);       // 0 ≤ minAge < 256
    minBits.in <== minAge;

    // 3. a constrained comparison, and the statement REQUIRES the result
    component adult = GreaterEqThan(8);
    adult.in[0] <== age;
    adult.in[1] <== minAge;
    adult.out === 1;
}

component main {public [issuerAx, issuerAy, currentYear, minAge, subject]} = Credential();
