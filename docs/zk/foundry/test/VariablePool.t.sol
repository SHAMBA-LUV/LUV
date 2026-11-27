// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ZkTest, Actor, MockToken} from "./ZkTest.sol";
import {ZkConstants} from "./fixtures/ZkConstants.sol";
import {TxDepositProof} from "./fixtures/TxDepositProof.sol"; // tx1: Alice deposits 100 → notes 60 + 40
import {TxTransferProof} from "./fixtures/TxTransferProof.sol"; // tx2: Alice → Bob 70, change 30
import {TxWithdrawProof} from "./fixtures/TxWithdrawProof.sol"; // tx3: Bob withdraws 40 + fee 5, keeps 25
import {PoseidonT3Deployer} from "../src/generated/PoseidonT3.sol";
import {TransactionVerifier} from "../src/verifiers/TransactionVerifier.sol";
import {VariablePool, ITransactionVerifier} from "../src/VariablePool.sol";
import {IERC20Pull} from "../src/ShieldedPool.sol";

/// The join-split story from circom/make-inputs.mjs, replayed on-chain in order.
contract VariablePoolTest is ZkTest {
    uint256 constant E18 = 1 ether;

    MockToken token;
    VariablePool pool;
    Actor alice; // pays for the deposit
    Actor relayer; // submits the private transfer and the withdrawal

    function setUp() public {
        token = new MockToken(1_000 * E18);
        pool = new VariablePool(
            IERC20Pull(address(token)), ITransactionVerifier(address(new TransactionVerifier())), PoseidonT3Deployer.deploy()
        );
        alice = new Actor();
        relayer = new Actor();
        token.transfer(address(alice), 100 * E18);
        mustSucceed(alice, address(token), abi.encodeCall(MockToken.approve, (address(pool), 100 * E18)));
    }

    function _proof(uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c, uint256[7] memory pub)
        internal
        pure
        returns (VariablePool.Proof memory p)
    {
        p.a = a;
        p.b = b;
        p.c = c;
        p.root = pub[0];
        p.publicAmount = pub[1];
        p.extDataHash = pub[2];
        p.inputNullifiers = [pub[3], pub[4]];
        p.outputCommitments = [pub[5], pub[6]];
    }

    function _ext1() internal pure returns (VariablePool.ExtData memory) {
        return VariablePool.ExtData(address(0), int256(100 * E18), address(0), 0);
    }

    function _ext2() internal pure returns (VariablePool.ExtData memory) {
        return VariablePool.ExtData(address(0), 0, address(0), 0);
    }

    function _ext3() internal pure returns (VariablePool.ExtData memory) {
        return VariablePool.ExtData(ZkConstants.TX_RECIPIENT, -int256(40 * E18), ZkConstants.TX_RELAYER, 5 * E18);
    }

    function _tx1() internal pure returns (bytes memory) {
        (uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c, uint256[7] memory pub) = TxDepositProof.get();
        return abi.encodeCall(VariablePool.transact, (_proof(a, b, c, pub), _ext1()));
    }

    function _tx2() internal pure returns (bytes memory) {
        (uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c, uint256[7] memory pub) = TxTransferProof.get();
        return abi.encodeCall(VariablePool.transact, (_proof(a, b, c, pub), _ext2()));
    }

    function _tx3(VariablePool.ExtData memory ext) internal pure returns (bytes memory) {
        (uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c, uint256[7] memory pub) = TxWithdrawProof.get();
        return abi.encodeCall(VariablePool.transact, (_proof(a, b, c, pub), ext));
    }

    // ── the story ────────────────────────────────────────────────────────────

    function test_depositCreatesHiddenNotes() public {
        uint256 g = gasleft();
        mustSucceed(alice, address(pool), _tx1());
        emit log_named_uint("gas: VariablePool deposit (join-split proof + pair insert + transferFrom)", g - gasleft());
        assertEq(token.balanceOf(address(pool)), 100 * E18);
        assertEq(pool.tree().nextIndex(), 2); // two commitments; the 60/40 split is invisible
    }

    /// The private transfer reveals nothing: publicAmount 0, empty external data.
    function test_privateTransferRevealsNoAmount() public {
        mustSucceed(alice, address(pool), _tx1());
        (,,, uint256[7] memory pub) = TxTransferProof.get();
        assertEq(pub[1], 0);
        uint256 g = gasleft();
        mustSucceed(relayer, address(pool), _tx2());
        emit log_named_uint("gas: VariablePool private transfer (nothing revealed)", g - gasleft());
        assertEq(token.balanceOf(address(pool)), 100 * E18); // no tokens moved; ownership did
        assertEq(pool.tree().nextIndex(), 4);
    }

    /// Bob withdraws 40 to 0xB0B, the relayer earns 5; 55 stays in the pool = Alice's 30 + Bob's 25,
    /// though nobody watching the chain can tell how it is split, or whose it is.
    function test_withdrawalWithRelayerFee() public {
        mustSucceed(alice, address(pool), _tx1());
        mustSucceed(relayer, address(pool), _tx2());
        uint256 g = gasleft();
        mustSucceed(relayer, address(pool), _tx3(_ext3()));
        emit log_named_uint("gas: VariablePool withdrawal + relayer fee", g - gasleft());
        assertEq(token.balanceOf(address(ZkConstants.TX_RECIPIENT)), 40 * E18);
        assertEq(token.balanceOf(address(ZkConstants.TX_RELAYER)), 5 * E18);
        assertEq(token.balanceOf(address(relayer)), 0);
        assertEq(token.balanceOf(address(pool)), 55 * E18);
    }

    function test_publicAmountEncodesWithdrawalAsFieldNegative() public view {
        (,,, uint256[7] memory pub) = TxWithdrawProof.get();
        assertEq(pub[1], pool.publicAmountOf(-int256(40 * E18), 5 * E18)); // = FIELD − 45e18
        assertEq(pub[2], pool.extDataHashOf(_ext3()));
    }

    // ── attacks ──────────────────────────────────────────────────────────────

    function test_doubleSpendReverts() public {
        mustSucceed(alice, address(pool), _tx1());
        mustSucceed(relayer, address(pool), _tx2());
        expectRevert(relayer, address(pool), _tx2(), VariablePool.NullifierUsed.selector);
    }

    function test_relayerCannotRedirectWithdrawal() public {
        mustSucceed(alice, address(pool), _tx1());
        mustSucceed(relayer, address(pool), _tx2());
        VariablePool.ExtData memory ext = _ext3();
        ext.recipient = address(relayer);
        expectRevert(relayer, address(pool), _tx3(ext), VariablePool.InvalidExtData.selector);
    }

    function test_relayerCannotRaiseFee() public {
        mustSucceed(alice, address(pool), _tx1());
        mustSucceed(relayer, address(pool), _tx2());
        VariablePool.ExtData memory ext = _ext3();
        ext.fee = 6 * E18;
        expectRevert(relayer, address(pool), _tx3(ext), VariablePool.InvalidExtData.selector);
    }

    /// Lying about publicAmount (e.g. claiming a smaller withdrawal) is caught before the proof.
    function test_publicAmountMustMatchExtData() public {
        mustSucceed(alice, address(pool), _tx1());
        mustSucceed(relayer, address(pool), _tx2());
        (uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c, uint256[7] memory pub) = TxWithdrawProof.get();
        VariablePool.Proof memory p = _proof(a, b, c, pub);
        p.publicAmount = 0;
        expectRevert(relayer, address(pool), abi.encodeCall(VariablePool.transact, (p, _ext3())), VariablePool.InvalidPublicAmount.selector);
    }

    function test_spendBeforeNotesExistReverts() public {
        expectRevert(relayer, address(pool), _tx2(), VariablePool.UnknownRoot.selector); // tx1 never happened
    }

    function test_depositMustBePaidFor() public {
        (bool ok,) = relayer.exec(address(pool), _tx1()); // relayer has no tokens / allowance
        assertFalse(ok);
        assertEq(pool.tree().nextIndex(), 0);
    }

    function test_amountsAboveRangeRejected() public {
        expectRevert(relayer, address(pool), abi.encodeCall(VariablePool.publicAmountOf, (int256(2 ** 120), 0)), VariablePool.AmountTooLarge.selector);
        expectRevert(relayer, address(pool), abi.encodeCall(VariablePool.publicAmountOf, (0, 2 ** 120)), VariablePool.AmountTooLarge.selector);
    }
}
