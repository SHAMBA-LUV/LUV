// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPoseidonT3} from "./generated/PoseidonT3.sol";
import {ZkGroup} from "./ZkGroup.sol";
import {IERC20Pull} from "./ShieldedPool.sol";

/// Verifier generated from circom/transaction.circom. Public signals:
/// [root, publicAmount, extDataHash, inputNullifier0, inputNullifier1, outputCommitment0, outputCommitment1]
interface ITransactionVerifier {
    function verifyProof(
        uint256[2] calldata pA,
        uint256[2][2] calldata pB,
        uint256[2] calldata pC,
        uint256[7] calldata pubSignals
    ) external view returns (bool);
}

/// @title VariablePool — private balances with HIDDEN AMOUNTS: deposit, transfer, withdraw.
///
/// Every action is one `transact` with a 2-in / 2-out join-split proof (transaction.circom):
///   • deposit   extAmount > 0  — tokens come in from msg.sender, hidden notes come out
///   • transfer  extAmount = 0  — notes are spent and new ones created; NOTHING is revealed:
///                                not the sender, the receiver, nor the amount
///   • withdraw  extAmount < 0  — tokens go to `recipient`, a `fee` to `relayer`, change stays hidden
/// Conservation is enforced in-circuit: Σ in + publicAmount = Σ out, with every amount
/// range-checked to 120 bits (LUV's whole 1.11e35-wei supply fits) so the field can't wrap.
///
/// External data (recipient, relayer, fee, extAmount) is bound by ONE public input,
/// extDataHash = keccak256(abi.encode(extData)) mod r: the contract recomputes it, so a relayer
/// can change none of it, and adding fields later costs no circuit change.
///
/// To pay someone you need only their public key (pubKey = Poseidon(privKey)). The receiver
/// must also learn the note's amount and blinding to spend it — production systems encrypt
/// them to the receiver in an event; here that hand-off is left to the application.
///
/// Both output commitments are inserted as siblings with ZkGroup.joinPair (10 Poseidon hashes,
/// not 20), so the tree costs half what two separate joins would.
///
/// ⚠ TEACHING CONTRACT: dev-ceremony verifier, depth-10 tree (512 transactions), no compliance
///   layer (see CompliantPool). Reference design: Tornado Nova. Get legal review before use.
contract VariablePool {
    error UnknownRoot();
    error DuplicateNullifier();
    error NullifierUsed();
    error InvalidExtData();
    error InvalidPublicAmount();
    error AmountTooLarge();
    error InvalidProof();
    error ZeroAddress();
    error TransferFailed();

    event NewCommitment(uint256 indexed commitment, uint256 index);
    event NewNullifier(uint256 indexed nullifier);

    struct ExtData {
        address recipient;
        int256 extAmount;
        address relayer;
        uint256 fee;
    }

    struct Proof {
        uint256[2] a;
        uint256[2][2] b;
        uint256[2] c;
        uint256 root;
        uint256 publicAmount;
        uint256 extDataHash;
        uint256[2] inputNullifiers;
        uint256[2] outputCommitments;
    }

    uint256 internal constant FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
    uint256 public constant MAX_AMOUNT = 2 ** 120; // = Num2Bits(120) in transaction.circom

    IERC20Pull public immutable token;
    ITransactionVerifier public immutable verifier;
    ZkGroup public immutable tree;

    mapping(uint256 => bool) public nullifierUsed;

    constructor(IERC20Pull token_, ITransactionVerifier verifier_, IPoseidonT3 hasher) {
        token = token_;
        verifier = verifier_;
        tree = new ZkGroup(hasher, address(this));
    }

    /// extAmount − fee as a field element; negative values wrap to FIELD − |x|, as in the circuit.
    function publicAmountOf(int256 extAmount, uint256 fee) public pure returns (uint256) {
        if (fee >= MAX_AMOUNT || extAmount >= int256(MAX_AMOUNT) || extAmount <= -int256(MAX_AMOUNT)) {
            revert AmountTooLarge();
        }
        int256 pa = extAmount - int256(fee);
        return pa >= 0 ? uint256(pa) : FIELD - uint256(-pa);
    }

    function extDataHashOf(ExtData calldata ext) public pure returns (uint256) {
        return uint256(keccak256(abi.encode(ext))) % FIELD;
    }

    function transact(Proof calldata p, ExtData calldata ext) external {
        if (!tree.isKnownRoot(p.root)) revert UnknownRoot();
        if (p.inputNullifiers[0] == p.inputNullifiers[1]) revert DuplicateNullifier();
        if (nullifierUsed[p.inputNullifiers[0]] || nullifierUsed[p.inputNullifiers[1]]) revert NullifierUsed();
        if (extDataHashOf(ext) != p.extDataHash) revert InvalidExtData();
        if (publicAmountOf(ext.extAmount, ext.fee) != p.publicAmount) revert InvalidPublicAmount();

        uint256[7] memory pub = [
            p.root,
            p.publicAmount,
            p.extDataHash,
            p.inputNullifiers[0],
            p.inputNullifiers[1],
            p.outputCommitments[0],
            p.outputCommitments[1]
        ];
        if (!verifier.verifyProof(p.a, p.b, p.c, pub)) revert InvalidProof();

        for (uint256 i; i < 2; ++i) {
            nullifierUsed[p.inputNullifiers[i]] = true;
            emit NewNullifier(p.inputNullifiers[i]);
        }
        uint256 index = tree.joinPair(p.outputCommitments[0], p.outputCommitments[1]); // one pass, 10 hashes
        emit NewCommitment(p.outputCommitments[0], index);
        emit NewCommitment(p.outputCommitments[1], index + 1);

        if (ext.extAmount > 0) {
            // deposit: whoever submits pays. (Copying someone's deposit proof just gifts them notes.)
            if (!token.transferFrom(msg.sender, address(this), uint256(ext.extAmount))) revert TransferFailed();
        } else if (ext.extAmount < 0) {
            if (ext.recipient == address(0)) revert ZeroAddress();
            if (!token.transfer(ext.recipient, uint256(-ext.extAmount))) revert TransferFailed();
        }
        if (ext.fee > 0 && !token.transfer(ext.relayer, ext.fee)) revert TransferFailed();
    }
}
