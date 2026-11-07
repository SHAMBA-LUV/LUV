pragma circom 2.1.6;

// age_buggy.circom — ⚠ DELIBERATELY VULNERABLE. Do not copy.
//
// Intended statement: "my private birthYear makes me at least minAge in currentYear".
// The bug is the most common one in real circuits: an output computed with `<--`
// (assignment WITHOUT a constraint). The developer "constrained" it with a boolean check,
// which only proves isAdult ∈ {0, 1} — not that it was computed correctly.
//
// circom/attack/age_forger.circom has the IDENTICAL constraint system but sets isAdult = 1
// unconditionally. Because constraints are all a verifier ever checks, its witnesses produce
// proofs that THIS circuit's verifier accepts: a 10-year-old proves isAdult = 1.
// build.sh runs the attack; foundry/test/UnderConstrained.t.sol shows it succeeding on-chain.
// The fix is circom/credential.circom (range-checked comparison, signed attribute).

template AgeCheckBuggy() {
    signal input birthYear;      // private
    signal input currentYear;    // public
    signal input minAge;         // public
    signal input subject;        // public — binds the proof to an address
    signal output isAdult;       // public

    signal age;
    age <== currentYear - birthYear;

    isAdult <-- (age >= minAge) ? 1 : 0;   // ✗ computed, NOT constrained
    isAdult * (isAdult - 1) === 0;          // ✗ only says "isAdult is a bit"

    signal subjectSquared;                  // bind subject (see membership.circom)
    subjectSquared <== subject * subject;
}

component main {public [currentYear, minAge, subject]} = AgeCheckBuggy();
