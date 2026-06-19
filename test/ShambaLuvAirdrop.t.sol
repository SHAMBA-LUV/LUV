// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { TwTest } from "./TwTest.sol";
import { ShambaLuv } from "../contracts/ShambaLuv.sol";
import { ShambaLuvAirdrop } from "../contracts/ShambaLuvAirdrop.sol";

/**
 * Verifies the signature-gated "digital gesture" airdrop:
 *  - only a backend-`signer`-signed EIP-712 voucher releases LUV,
 *  - 1 trillion LUV per signup, exact (the airdrop contract is fee-exempt in LUV),
 *  - one claim per nonce AND per wallet,
 *  - the whole campaign is hard-capped at 1% of supply (1 Quadrillion = 1000 trillion).
 */
contract ShambaLuvAirdropTest is TwTest {
    ShambaLuv luv;
    ShambaLuvAirdrop drop;
    uint256 constant SIGNER_PK = 0xA11CE;
    address signer;
    address constant TEAM = address(0x7EA1);
    address constant LIQ = address(0x4140);
    address constant USER = address(0xCAFE);

    uint256 constant TRILLION = 1_000_000_000_000 * 1e18; // 1 trillion LUV
    uint256 constant CAP = 1_000_000_000_000_000 * 1e18; // 1 Quadrillion = 1% of supply

    function setUp() public {
        signer = vm.addr(SIGNER_PK);
        luv = new ShambaLuv(TEAM, LIQ, address(0), address(0)); // deployer holds 1e35, fee-exempt
        drop = new ShambaLuvAirdrop(address(luv), signer);
        // CRITICAL: the airdrop contract must be fee-exempt so recipients get the FULL trillion
        luv.setFeeExemption(address(drop), true);
        luv.transfer(address(drop), CAP); // fund the campaign with exactly 1% of supply
    }

    function _voucher(address recipient, uint256 amount, uint256 nonce, uint256 deadline)
        internal
        returns (bytes memory sig)
    {
        bytes32 digest = drop.claimDigest(recipient, amount, nonce, deadline);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(SIGNER_PK, digest);
        sig = abi.encodePacked(r, s, v);
    }

    function test_default_is_one_trillion_and_cap_is_one_percent() public view {
        assertEq(drop.claimAmount(), TRILLION);
        assertEq(drop.AIRDROP_CAP(), CAP);
        assertEq(luv.balanceOf(address(drop)), CAP);
        assertEq(drop.remainingClaims(), 1000); // 1 quad / 1 trillion = 1000 gestures
    }

    function test_signed_voucher_pays_full_trillion() public {
        uint256 deadline = 9_999_999_999;
        bytes memory sig = _voucher(USER, TRILLION, 1, deadline);
        drop.claim(USER, TRILLION, 1, deadline, sig);
        assertEq(luv.balanceOf(USER), TRILLION); // exact — airdrop is fee-exempt
        assertEq(drop.totalClaimed(), TRILLION);
        assertEq(drop.claimCount(), 1);
        assertTrue(drop.hasClaimed(USER));
        assertTrue(drop.usedNonce(1));
    }

    function test_nonce_replay_reverts() public {
        uint256 d = 9_999_999_999;
        bytes memory sig = _voucher(USER, TRILLION, 1, d);
        drop.claim(USER, TRILLION, 1, d, sig);
        vm.expectRevert(); // NonceUsed
        drop.claim(USER, TRILLION, 1, d, sig);
    }

    function test_second_wallet_claim_blocked_by_hasClaimed() public {
        uint256 d = 9_999_999_999;
        drop.claim(USER, TRILLION, 1, d, _voucher(USER, TRILLION, 1, d));
        bytes memory sig2 = _voucher(USER, TRILLION, 2, d); // precompute BEFORE expectRevert
        vm.expectRevert(); // AlreadyClaimed (same recipient, fresh nonce)
        drop.claim(USER, TRILLION, 2, d, sig2);
    }

    function test_unsigned_or_wrong_signer_reverts() public {
        uint256 d = 9_999_999_999;
        bytes32 digest = drop.claimDigest(USER, TRILLION, 1, d);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0xBEEF, digest); // wrong key
        vm.expectRevert(); // BadSignature
        drop.claim(USER, TRILLION, 1, d, abi.encodePacked(r, s, v));
    }

    function test_expired_voucher_reverts() public {
        vm.warp(1000);
        bytes memory sig = _voucher(USER, TRILLION, 1, 500); // deadline in the past
        vm.expectRevert(); // Expired
        drop.claim(USER, TRILLION, 1, 500, sig);
    }

    function test_campaign_capped_at_one_percent() public {
        uint256 d = 9_999_999_999;
        // a single voucher for the whole cap (1 quad) succeeds
        drop.claim(USER, CAP, 1, d, _voucher(USER, CAP, 1, d));
        assertEq(drop.totalClaimed(), CAP);
        // any further claim exceeds 1% of supply → CapReached
        bytes memory sig2 = _voucher(address(0xD00D), TRILLION, 2, d); // precompute BEFORE expectRevert
        vm.expectRevert();
        drop.claim(address(0xD00D), TRILLION, 2, d, sig2);
    }
}
