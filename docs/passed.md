# SHAMBA LUV — Test Suite: Every Passing Test ✅

**174 / 174 tests passing — 0 failing — across 17 suites.**

Generated from `forge test` (Foundry, solc 0.8.24, evmVersion cancun, optimizer runs 200) against
the in-house contract suite in `~/DeltaVerse/shambaluv/`. Every ✅ below is a test that **passed**.
This is the **curated, committed** suite: the 158 original unit tests plus the **16 adversarial
scenario tests** added during the 2026-08 full security audit. (Exploratory audit probe contracts
run in scratchpad — findings are held under OVERLORD access; this file documents the green suite.)

> The green suite is a statement about **behaviour that is asserted and holds**, not a clean bill of
> health. Several audit findings concern paths the suite does **not** yet cover (e.g. the merkle-proof
> verify loop, the locker reflection-credit path). Those are tracked as new tests in the audit report.

## Summary by suite

| # | Suite | Passing | Source |
|---|-------|---------|--------|
| 1 | `ShambaLuvTest` | ✅ 14/14 | `test/ShambaLuv.t.sol` |
| 2 | `ShambaLuvScenarioTest` *(new)* | ✅ 6/6 | `test/ShambaLuvScenario.t.sol` |
| 3 | `IncentiveDistributorTest` | ✅ 34/34 | `test/IncentiveDistributor.t.sol` |
| 4 | `IncentiveDistributorScenarioTest` *(new)* | ✅ 6/6 | `test/IncentiveDistributorScenario.t.sol` |
| 5 | `LUVLockerTest` | ✅ 27/27 | `test/LUVLocker.t.sol` |
| 6 | `LUVLockerScenarioTest` *(new)* | ✅ 4/4 | `test/LUVLockerScenario.t.sol` |
| 7 | `LuvBatchGestureTest` | ✅ 12/12 | `test/LuvBatchGesture.t.sol` |
| 8 | `LuvBusGasTest` | ✅ 2/2 | `test/LuvBusGas.t.sol` |
| 9 | `LuvLauncherTest` | ✅ 8/8 | `test/LuvLauncher.t.sol` |
| 10 | `LuvAccountTest` | ✅ 16/16 | `test/LuvAccount.t.sol` |
| 11 | `LuvPaymasterTest` | ✅ 8/8 | `test/LuvAccount.t.sol` |
| 12 | `LuvIncentiveIntegrationTest` | ✅ 3/3 | `test/LuvIncentiveIntegration.t.sol` |
| 13 | `ShambaLuvAirdropTest` | ✅ 8/8 | `test/ShambaLuvAirdrop.t.sol` |
| 14 | `MerkleDropTest` | ✅ 4/4 | `test/MerkleDrop.t.sol` |
| 15 | `SimpleDropTest` | ✅ 8/8 | `test/SimpleDrop.t.sol` |
| 16 | `RewardTokenTest` | ✅ 10/10 | `test/RewardToken.t.sol` |
| 17 | `TwoStepOwnershipTest` | ✅ 4/4 | `test/TwoStepOwnership.t.sol` |

---

## 1. `ShambaLuvTest` — ✅ 14/14

The live LUV token (`0x2711…8254`): genesis supply, reflection accounting, the 3:1:1 fee split, the
wallet-to-wallet fee-free path, maxTx, and the batched fee flush.

- ✅ **PASSED** `testMetadataAndGenesis()`
- ✅ **PASSED** `testPayoutThresholdDefault()`
- ✅ **PASSED** `testWalletToWalletFeeFree()`
- ✅ **PASSED** `testFeeOnSell()`
- ✅ **PASSED** `testFeesLowerOnly()`
- ✅ **PASSED** `testMaxTxFix()`
- ✅ **PASSED** `testPayoutTrippedByThreshold()`
- ✅ **PASSED** `testReflectionBatchedNotContinuous()`
- ✅ **PASSED** `testRenounce()`
- ✅ **PASSED** `testSetPayoutThreshold()`
- ✅ **PASSED** `testUnifiedPayoutAllThree()`
- ✅ **PASSED** `testUpdateRouterCrossChain()`
- ✅ **PASSED** `test_includeInReflection_no_phantom_balance()`
- ✅ **PASSED** `test_lowerFees_zero_swap_does_not_brick()`

## 2. `ShambaLuvScenarioTest` — ✅ 6/6  *(added by the audit)*

Adversarial + invariant scenarios: value conservation under market churn, exclude/include round-trips,
fee-flush survival when the pair ETH sink reverts, the maxTx boundary, the fixed-fee cap, and a
wallet-to-wallet exactness fuzz.

- ✅ **PASSED** `test_conservation_under_market_churn()`
- ✅ **PASSED** `test_exclude_include_roundtrip_no_mint()`
- ✅ **PASSED** `test_processFees_survives_locked_pair()`
- ✅ **PASSED** `test_maxTx_boundary()`
- ✅ **PASSED** `test_total_fee_capped_at_5pct()`
- ✅ **PASSED** `testFuzz_walletToWallet_exact(uint96)` *(256 fuzz runs)*

## 3. `IncentiveDistributorTest` — ✅ 34/34

The live rewards distributor (`0x607E…f806`): seeded actions, EIP-712 vouchers, actionId dedup,
daily-limit and cooldown enforcement, batch distribution, pause, and access control.

- ✅ **PASSED** `test_seeded_actions()`
- ✅ **PASSED** `test_seeded_tweet_daily_limit_of_ten()`
- ✅ **PASSED** `test_getAction_unknown_reverts()`
- ✅ **PASSED** `test_distribute_happy_path()`
- ✅ **PASSED** `test_distribute_dedup_reverts()`
- ✅ **PASSED** `test_distribute_unknown_action_reverts()`
- ✅ **PASSED** `test_inactive_action_reverts()`
- ✅ **PASSED** `test_daily_limit()`
- ✅ **PASSED** `test_cooldown()`
- ✅ **PASSED** `test_welcome_one_time()`
- ✅ **PASSED** `test_batch_skips_ineligible()`
- ✅ **PASSED** `test_batch_length_mismatch_reverts()`
- ✅ **PASSED** `test_batch_too_large_reverts()`
- ✅ **PASSED** `test_claim_with_signature()`
- ✅ **PASSED** `test_claimDigest_matches_manual_eip712()`
- ✅ **PASSED** `test_claim_expired_reverts()`
- ✅ **PASSED** `test_claim_wrong_signer_reverts()`
- ✅ **PASSED** `test_setSigner_rotates_key()`
- ✅ **PASSED** `test_legacy_distributeReward()`
- ✅ **PASSED** `test_legacy_distributeReward_inactive_reverts()`
- ✅ **PASSED** `test_legacy_distributeReward_zero_amount_reverts()`
- ✅ **PASSED** `test_legacy_distributeWelcome_once()`
- ✅ **PASSED** `test_maxRewardPerTx_caps_distributeReward()`
- ✅ **PASSED** `test_maxRewardPerTx_default_caps_a_fresh_deploy()`
- ✅ **PASSED** `test_maxRewardPerTx_default_is_set()`
- ✅ **PASSED** `test_multi_token_action()`
- ✅ **PASSED** `test_only_distributor_can_pay()`
- ✅ **PASSED** `test_owner_only_config()`
- ✅ **PASSED** `test_pause_blocks_all_payout_paths()`
- ✅ **PASSED** `test_setActionActive_unknown_reverts()`
- ✅ **PASSED** `test_distributor_revocation()`
- ✅ **PASSED** `test_fund_and_withdraw()`
- ✅ **PASSED** `test_getAllActions()`
- ✅ **PASSED** `test_getUserStats_and_contract_stats()`

## 4. `IncentiveDistributorScenarioTest` — ✅ 6/6  *(added by the audit)*

Adversarial voucher scenarios: cross-action-type replay, deadline expiry, wrong-signer, signer
rotation, and a proof that the pending **phase-3 tweet retune (50B / 3-per-day / 1h cooldown)**
enforces exactly 3 claims per day with the cooldown between them.

- ✅ **PASSED** `test_voucher_bound_to_actionType()`
- ✅ **PASSED** `test_expired_deadline_rejected()`
- ✅ **PASSED** `test_wrong_signer_rejected()`
- ✅ **PASSED** `test_signer_rotation_invalidates_old_vouchers()`
- ✅ **PASSED** `test_phase3_tweet_retune_limits()`
- ✅ **PASSED** `test_cooldown_enforced()`

## 5. `LUVLockerTest` — ✅ 27/27

The live locker vault (`0xe07A…B898`): deposits, staking-index interest, lock windows, extend-only
locks, the generic asset (LP) timelock, surplus-only rescue, and the read-only reentrancy guard.

- ✅ **PASSED** `test_deposit()`
- ✅ **PASSED** `test_deposit_zero_reverts()`
- ✅ **PASSED** `test_new_deposit_resets_lock()`
- ✅ **PASSED** `test_withdraw_blocked_by_time_and_block_locks()`
- ✅ **PASSED** `test_withdraw_more_than_principal_reverts()`
- ✅ **PASSED** `test_interest_claimable_by_default()`
- ✅ **PASSED** `test_interest_mode_compounds_into_principal()`
- ✅ **PASSED** `test_interest_split_pro_rata()`
- ✅ **PASSED** `test_switch_back_to_claimable_only_affects_future_interest()`
- ✅ **PASSED** `test_harvest_without_rewards_reverts()`
- ✅ **PASSED** `test_auto_payout_fires_on_deposit_touch()`
- ✅ **PASSED** `test_auto_payout_via_poke()`
- ✅ **PASSED** `test_extendLock_owner_pushes_unlock_later()`
- ✅ **PASSED** `test_extendLock_cannot_shorten()`
- ✅ **PASSED** `test_extendLock_only_owner_or_self()`
- ✅ **PASSED** `test_extendLock_self_allowed()`
- ✅ **PASSED** `test_extendLock_respects_max()`
- ✅ **PASSED** `test_setLockDuration_affects_future_deposits_only()`
- ✅ **PASSED** `test_setLockDuration_only_owner_and_capped()`
- ✅ **PASSED** `test_asset_timelock_erc20()`
- ✅ **PASSED** `test_asset_timelock_luv_does_not_disturb_interest()`
- ✅ **PASSED** `test_asset_lock_param_validation()`
- ✅ **PASSED** `test_lockAsset_fee_on_transfer_credits_received()`
- ✅ **PASSED** `test_rescue_only_owner()`
- ✅ **PASSED** `test_rescue_sweeps_only_unaccounted_surplus()`
- ✅ **PASSED** `test_rescue_luv_always_reverts_reflection_pool_reserved()`
- ✅ **PASSED** `test_view_readonly_reentrancy_guarded()`

## 6. `LUVLockerScenarioTest` — ✅ 4/4  *(added by the audit)*

Adversarial staking-index scenarios. **`test_KNOWN_first_depositor_inflation_bricks_deposits` is an
executable proof of audit finding L1/H-1** (a 1-wei first deposit + donation inflates the reward index
and bricks later deposits) — the test asserts the revert. `test_seed_first_defuses_inflation` proves
the mitigation: a large first deposit (the OVERLORD's seed) keeps the index small.

- ✅ **PASSED** `test_KNOWN_first_depositor_inflation_bricks_deposits()` — *proves the DoS vector*
- ✅ **PASSED** `test_seed_first_defuses_inflation()` — *proves the seed-first mitigation*
- ✅ **PASSED** `test_reward_pool_solvency_tail_withdrawer()`
- ✅ **PASSED** `test_donation_not_withdrawable_as_principal()`

## 7. `LuvBatchGestureTest` — ✅ 12/12

The luvbus batch gesture sender (`0xc734…B4dD`): batched delivery, per-recipient dedup, campaign cap,
operator authorization, and pause.

- ✅ **PASSED** `test_batch_delivers_full_trillion_zero_fee()`
- ✅ **PASSED** `test_treasury_is_not_fee_exempt_yet_transfer_is_whole()`
- ✅ **PASSED** `test_batch_size_and_empty_guards()`
- ✅ **PASSED** `test_campaign_cap_enforced()`
- ✅ **PASSED** `test_cross_batch_dedup()`
- ✅ **PASSED** `test_deliverable_gestures_view()`
- ✅ **PASSED** `test_duplicates_and_zero_are_skipped_not_reverted()`
- ✅ **PASSED** `test_insufficient_allowance_reverts_whole_batch()`
- ✅ **PASSED** `test_only_operator_or_owner()`
- ✅ **PASSED** `test_owner_rotation_and_operator_rotation()`
- ✅ **PASSED** `test_paused_blocks()`
- ✅ **PASSED** `test_remaining_gestures()`

## 8. `LuvBusGasTest` — ✅ 2/2

Gas-scaling of the batch sender — proves 250 riders fit within a block.

- ✅ **PASSED** `test_luvbus_250_fits_block()`
- ✅ **PASSED** `test_luvbus_gas_scaling()`

## 9. `LuvLauncherTest` — ✅ 8/8

The deterministic CREATE3 launcher (`0xBAAc…7523`): address-independent-of-constructor-args,
per-deployer salt namespacing, redeploy protection, and full-supply-to-treasury genesis.

- ✅ **PASSED** `test_launcher_address_matches_prediction_before_deploy()`
- ✅ **PASSED** `test_addresses_independent_of_ctor_args()`
- ✅ **PASSED** `test_salt_is_namespaced_per_deployer()`
- ✅ **PASSED** `test_token_address_is_f_of_launcher_nonce1()`
- ✅ **PASSED** `test_genesis_lands_whole_in_treasury()`
- ✅ **PASSED** `test_redeploy_same_salt_reverts()`
- ✅ **PASSED** `test_treasury_can_wire_platform_post_handover()`
- ✅ **PASSED** `test_zero_treasury_reverts()`

## 10. `LuvAccountTest` — ✅ 16/16

The ERC-4337 smart account: signature validation, EntryPoint gating, one-time initialization, execute
/ executeBatch, and the upgrade guard.

- ✅ **PASSED** `test_counterfactual_address_matches_deployment()`
- ✅ **PASSED** `test_createAccount_is_idempotent()`
- ✅ **PASSED** `test_initialize_only_once()`
- ✅ **PASSED** `test_validateUserOp_owner_signature_ok()`
- ✅ **PASSED** `test_validateUserOp_wrong_signer_returns_1()`
- ✅ **PASSED** `test_validateUserOp_only_entrypoint()`
- ✅ **PASSED** `test_validateUserOp_prefunds_entrypoint()`
- ✅ **PASSED** `test_isValidSignature()`
- ✅ **PASSED** `test_execute_by_owner_and_entrypoint()`
- ✅ **PASSED** `test_execute_gating()`
- ✅ **PASSED** `test_execute_bubbles_CallFailed()`
- ✅ **PASSED** `test_executeBatch()`
- ✅ **PASSED** `test_executeBatch_length_mismatch()`
- ✅ **PASSED** `test_setOwner_gating()`
- ✅ **PASSED** `test_upgradeTo_gating_and_effect()`
- ✅ **PASSED** `test_deposit_helpers()`

## 11. `LuvPaymasterTest` — ✅ 8/8

The ERC-4337 paymaster: strict `paymasterAndData` binding, gas-limit bounds, EntryPoint gating, and
signer control.

- ✅ **PASSED** `test_validatePaymasterUserOp_ok_with_time_bounds()`
- ✅ **PASSED** `test_validatePaymasterUserOp_binding_is_strict()`
- ✅ **PASSED** `test_validatePaymasterUserOp_wrong_signer_sets_fail_bit()`
- ✅ **PASSED** `test_bad_paymasterAndData_length_reverts()`
- ✅ **PASSED** `test_paymaster_gas_limits_are_bound()`
- ✅ **PASSED** `test_only_entrypoint_validates()`
- ✅ **PASSED** `test_setVerifyingSigner_gating()`
- ✅ **PASSED** `test_deposit_and_owner_gated_withdraw()`

## 12. `LuvIncentiveIntegrationTest` — ✅ 3/3

End-to-end: the token and distributor together — gestures earn LUV through the real contracts, with
and without the distributor's fee exemption.

- ✅ **PASSED** `test_full_tweet_reward_when_distributor_is_fee_exempt()`
- ✅ **PASSED** `test_reward_loses_5pct_when_not_exempt()`
- ✅ **PASSED** `test_welcome_full_when_exempt()`

## 13. `ShambaLuvAirdropTest` — ✅ 8/8

The airdrop claim contract (`0xdf2C…DEf3`): voucher claims, the 1-trillion default, the 1%-of-supply
cap, nonce replay protection, and two-step ownership.

- ✅ **PASSED** `test_signed_voucher_pays_full_trillion()`
- ✅ **PASSED** `test_default_is_one_trillion_and_cap_is_one_percent()`
- ✅ **PASSED** `test_campaign_capped_at_one_percent()`
- ✅ **PASSED** `test_unsigned_or_wrong_signer_reverts()`
- ✅ **PASSED** `test_expired_voucher_reverts()`
- ✅ **PASSED** `test_nonce_replay_reverts()`
- ✅ **PASSED** `test_second_wallet_claim_blocked_by_hasClaimed()`
- ✅ **PASSED** `test_two_step_ownership()`

## 14. `MerkleDropTest` — ✅ 4/4

Merkle campaign distribution (not deployed): campaign lifecycle, reuse rejection, budget floor.
*(Audit note: branch coverage here is low; tracked under OVERLORD access.)*

- ✅ **PASSED** `test_CreateCampaign()`
- ✅ **PASSED** `test_createCampaign_rejects_reuse()`
- ✅ **PASSED** `test_updateCampaign_budget_floor()`
- ✅ **PASSED** `test_batchClaim_reverts_on_failed_transfer()`

## 15. `SimpleDropTest` — ✅ 8/8

Simple single-round merkle drop (not deployed): claim, proof validation, root/amount updates, owner
withdraw.

- ✅ **PASSED** `test_InitialState()`
- ✅ **PASSED** `test_Claim_SingleLeafRoot()`
- ✅ **PASSED** `test_Claim_InvalidProof_Reverts()`
- ✅ **PASSED** `test_UpdateMerkleRoot()`
- ✅ **PASSED** `test_UpdateMerkleRoot_NotOwner_Reverts()`
- ✅ **PASSED** `test_UpdateRewardAmount()`
- ✅ **PASSED** `test_WithdrawUnclaimedTokens()`
- ✅ **PASSED** `test_WithdrawUnclaimedTokens_NotOwner_Reverts()`

## 16. `RewardTokenTest` — ✅ 10/10

The test/demo ERC-20 used as a stand-in reward token (not part of the live deployment): metadata,
supply, mint/burn access control, transfer and allowance semantics.

- ✅ **PASSED** `test_Metadata()`
- ✅ **PASSED** `test_InitialSupply()`
- ✅ **PASSED** `test_Mint()`
- ✅ **PASSED** `test_Mint_NotOwner_Reverts()`
- ✅ **PASSED** `test_Burn()`
- ✅ **PASSED** `test_Burn_NotOwner_Reverts()`
- ✅ **PASSED** `test_Transfer_To_Zero_Reverts()`
- ✅ **PASSED** `test_Transfer_InsufficientBalance_Reverts()`
- ✅ **PASSED** `test_TransferFrom_With_Allowance()`
- ✅ **PASSED** `test_TransferFrom_InsufficientAllowance_Reverts()`

## 17. `TwoStepOwnershipTest` — ✅ 4/4

The two-step ownership transfer/accept pattern on the `Owned` base — the safe handover used across the
suite.

- ✅ **PASSED** `test_transferOwnership_isTwoStep()`
- ✅ **PASSED** `test_onlyPending_canAccept()`
- ✅ **PASSED** `test_cancel_pending()`
- ✅ **PASSED** `test_ownerCanChangeWallets()`

---

*Reproduce:* `cd ~/DeltaVerse/shambaluv && forge test`  ·  *Generated 2026-08-05 during the full
security audit. Findings and the new-test backlog are held under OVERLORD access.*
