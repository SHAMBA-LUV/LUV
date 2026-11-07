pragma circom 2.1.6;

// cube.circom — the guide's running example as a real zk-SNARK circuit.
// Proves knowledge of a private x with  x³ + x + 5 = out,  revealing only `out`.
// Compiles to 2 R1CS constraints (additions are free; each `*` of two signals costs one).
// Language reference: https://docs.circom.io/circom-language/signals/

template Cube() {
    signal input x;      // private input — never leaves the prover
    signal output out;   // public output — part of the statement

    signal x2;
    x2  <== x * x;               // constraint 1:  x · x       = x2
    out <== x2 * x + x + 5;      // constraint 2:  x2 · x      = out − x − 5
}

component main = Cube();
