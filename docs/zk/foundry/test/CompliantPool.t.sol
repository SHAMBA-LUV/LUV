// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ZkTest, Actor, MockToken} from "./ZkTest.sol";
import {ZkConstants} from "./fixtures/ZkConstants.sol";
// member #5 withdraws to 0xB0B, relayer 0xFEE1, fee 10 tokens, scope 1; the association set
// is every depositor except the flagged member #3
import {CompliantWithdrawProof} from "./fixtures/CompliantWithdrawProof.sol";
import {PoseidonT3Deployer} from "../src/generated/PoseidonT3.sol";
import {CompliantWithdrawVerifier} from "../src/verifiers/CompliantWithdrawVerifier.sol";
import {CompliantPool, ICompliantWithdrawVerifier} from "../src/CompliantPool.sol";
import {IERC20Pull} from "../src/ShieldedPool.sol";
import {OwnerRoots} from "../src/OwnerRoots.sol";
import {IRootSource} from "../src/interfaces/IRootSource.sol";

contract CompliantPoolTest is ZkTest {
    uint256 constant DENOM = 1_000 ether;
    uint256 constant MAX_FEE = 50 ether;
    uint256 constant FEE = 10 ether; // bound into the proof
    address constant BOB = address(0xB0B);
    address constant RELAYER = address(0xFEE1);

    MockToken token;
    CompliantWithdrawVerifier verifier;
    OwnerRoots asp; // the Association Set Provider publishes accepted association roots
    CompliantPool pool;
    Actor submitter; // whoever lands the transaction — NOT the paid relayer

    function setUp() public {
        token = new MockToken(100 * DENOM);
        verifier = new CompliantWithdrawVerifier();
        asp = new OwnerRoots();
        asp.addRoot(ZkConstants.ASSOCIATION_ROOT);
        pool = _newPool(MAX_FEE);
        uint256[8] memory m = ZkConstants.members();
        for (uint256 i; i < 8; ++i) {
            Actor depositor = new Actor();
            token.transfer(address(depositor), DENOM);
            mustSucceed(depositor, address(token), abi.encodeCall(MockToken.approve, (address(pool), DENOM)));
            mustSucceed(depositor, address(pool), abi.encodeCall(CompliantPool.deposit, (m[i])));
        }
        submitter = new Actor();
    }

    function _newPool(uint256 maxFee) internal returns (CompliantPool) {
        return new CompliantPool(
            IERC20Pull(address(token)),
            DENOM,
            maxFee,
            ICompliantWithdrawVerifier(address(verifier)),
            PoseidonT3Deployer.deploy(),
            IRootSource(address(asp)),
            1
        );
    }

    function _withdraw(uint256 associationRoot, address recipient, address relayer, uint256 fee)
        internal
        pure
        returns (bytes memory)
    {
        (uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c, uint256[7] memory pub) =
            CompliantWithdrawProof.get();
        return abi.encodeCall(CompliantPool.withdraw, (pub[0], associationRoot, pub[2], recipient, relayer, fee, a, b, c));
    }

    function _ok() internal pure returns (bytes memory) {
        return _withdraw(ZkConstants.ASSOCIATION_ROOT, BOB, RELAYER, FEE);
    }

    function test_fixtureIsTheExpectedStatement() public view {
        (,,, uint256[7] memory pub) = CompliantWithdrawProof.get();
        assertEq(pub[0], pool.tree().root()); // the chain rebuilt the deposit tree
        assertEq(pub[1], ZkConstants.ASSOCIATION_ROOT);
        assertEq(pub[3], uint256(uint160(BOB)));
        assertEq(pub[4], uint256(uint160(RELAYER)));
        assertEq(pub[5], FEE);
    }

    /// Private AND compliant: recipient gets denomination − fee, the PROVEN relayer gets the fee,
    /// whoever submitted the transaction gets nothing.
    function test_compliantWithdrawalPaysRecipientAndRelayer() public {
        uint256 g = gasleft();
        mustSucceed(submitter, address(pool), _ok());
        emit log_named_uint("gas: CompliantPool.withdraw (2 Merkle proofs in-circuit, 7 public inputs)", g - gasleft());
        assertEq(token.balanceOf(BOB), DENOM - FEE);
        assertEq(token.balanceOf(RELAYER), FEE);
        assertEq(token.balanceOf(address(submitter)), 0);
        assertEq(token.balanceOf(address(pool)), 7 * DENOM);
    }

    function test_relayerCannotRaiseItsFee() public {
        expectRevert(
            submitter, address(pool), _withdraw(ZkConstants.ASSOCIATION_ROOT, BOB, RELAYER, 2 * FEE), CompliantPool.InvalidProof.selector
        );
    }

    function test_frontRunnerCannotStealTheFee() public {
        expectRevert(
            submitter,
            address(pool),
            _withdraw(ZkConstants.ASSOCIATION_ROOT, BOB, address(submitter), FEE),
            CompliantPool.InvalidProof.selector
        );
    }

    function test_recipientCannotBeRedirected() public {
        expectRevert(
            submitter,
            address(pool),
            _withdraw(ZkConstants.ASSOCIATION_ROOT, address(submitter), RELAYER, FEE),
            CompliantPool.InvalidProof.selector
        );
    }

    /// The ASP withdraws its endorsement of a set (e.g. a member was later flagged):
    /// proofs against that association root stop working.
    function test_revokedAssociationSetIsRejected() public {
        asp.revokeRoot(ZkConstants.ASSOCIATION_ROOT);
        expectRevert(submitter, address(pool), _ok(), CompliantPool.UnknownAssociationRoot.selector);
    }

    /// Naming a different accepted set doesn't help: the proof is about ONE association root.
    function test_proofIsTiedToItsAssociationSet() public {
        asp.addRoot(777);
        expectRevert(submitter, address(pool), _withdraw(777, BOB, RELAYER, FEE), CompliantPool.InvalidProof.selector);
    }

    function test_doubleWithdrawalReverts() public {
        mustSucceed(submitter, address(pool), _ok());
        expectRevert(submitter, address(pool), _ok(), CompliantPool.NullifierUsed.selector);
    }

    function test_feeAboveThePoolCapIsRejected() public {
        CompliantPool stingy = _newPool(5 ether);
        expectRevert(submitter, address(stingy), _ok(), CompliantPool.FeeTooHigh.selector);
    }
}
