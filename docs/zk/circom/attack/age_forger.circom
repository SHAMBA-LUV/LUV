pragma circom 2.1.6;

// age_forger.circom — the ATTACKER's copy of age_buggy.circom.
//
// Every signal and every constraint is identical, so it compiles to the SAME R1CS
// (build.sh checks the constraint systems match). Only the `<--` hint differs: the attacker
// assigns isAdult = 1 no matter what. The resulting witness still satisfies every constraint,
// so the honest proving key turns it into a proof the honest verifier accepts.
//
// Lesson: witness-generation code is the PROVER's business. Only constraints protect you.

template AgeCheckBuggy() {
    signal input birthYear;
    signal input currentYear;
    signal input minAge;
    signal input subject;
    signal output isAdult;

    signal age;
    age <== currentYear - birthYear;

    isAdult <-- 1;                          // the lie
    isAdult * (isAdult - 1) === 0;          // still satisfied: 1·0 = 0

    signal subjectSquared;
    subjectSquared <== subject * subject;
}

component main {public [currentYear, minAge, subject]} = AgeCheckBuggy();
