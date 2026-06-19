#!/usr/bin/env node
/*
 * deploy-and-test-anvil.mjs — deploy LUV + ShambaLuvAirdrop to a live anvil and TEST HARD.
 *
 * Exercises the actual deployed bytecode via vendored ethers (the same lib the backend uses):
 *   - token genesis invariants
 *   - the WALLET-TO-WALLET gesture (treasury EOA → user EOA = 0 fee, full trillion) — the prod path
 *   - fee IS taken when a contract is the counterparty (proves why wallet-to-wallet is primary)
 *   - max-tx cap, unified processFees() (reflection batch; swap no-ops gracefully w/o a router)
 *   - the signature-gated airdrop: fee-charged without fee-exemption (~950B), exact 1T with exemption,
 *     replay/wrong-sig/cap reverts, and EIP-712 produced offline byte-matches the contract
 *
 *   anvil & node shambaluv/deploy/deploy-and-test-anvil.mjs
 */
import { readFileSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const SL = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = resolve(SL, '..');
const require = createRequire(import.meta.url);
const ethers = require(join(ROOT, 'vendor', 'ethers.umd.min.js'));

const RPC = process.env.RPC || 'http://127.0.0.1:8545';
// anvil deterministic keys
const K = [
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', // 0 deployer/owner
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d', // 1 team
  '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a', // 2 liquidity
  '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6', // 3 voucher signer
  '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a', // 4 treasury (gesture EOA)
  '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba', // 5 trader
];

const SUPPLY = 10n ** 35n;
const TRILLION = 10n ** 30n; // 1 trillion LUV (1e12 * 1e18)
const CAP = 10n ** 33n; // 1 Quadrillion = 1% of supply
const MAXTX = SUPPLY / 100n; // 1%

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${extra ? '  — ' + extra : ''}`); }
}
async function reverts(name, p) {
  try {
    const tx = await p; // may reject at estimateGas…
    if (tx && tx.wait) await tx.wait(); // …or on the receipt (on-chain revert)
    check(name + ' (reverts)', false, 'did NOT revert');
  } catch { check(name + ' (reverts)', true); }
}
const fresh = () => ethers.Wallet.createRandom().address;

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC);
  const net = await provider.getNetwork().catch(() => null);
  if (!net) { console.error('anvil not reachable at ' + RPC + ' — run: anvil'); process.exit(1); }
  const chainId = Number(net.chainId);
  const base = K.map((k) => new ethers.Wallet(k, provider));
  const A = await Promise.all(base.map((x) => x.getAddress()));
  // wrap senders in NonceManager so rapid sequential txs from one EOA don't collide.
  const nm = (x) => (ethers.NonceManager ? new ethers.NonceManager(x) : x);
  const deployer = nm(base[0]);
  const treasury = nm(base[4]);
  const trader = nm(base[5]);
  const signer = base[3]; // signs EIP-712 vouchers only (no txs)
  const team = base[1], liquidity = base[2]; // referenced for addresses only

  const luvArt = JSON.parse(readFileSync(join(SL, 'artifacts', 'ShambaLuv.json'), 'utf8'));
  const dropArt = JSON.parse(readFileSync(join(SL, 'artifacts', 'ShambaLuvAirdrop.json'), 'utf8'));

  console.log(`\n❤️ SHAMBA LUV — deploy + hard test · anvil chain ${chainId}\n`);

  // ── deploy ──
  const luv = await (await new ethers.ContractFactory(luvArt.abi, luvArt.bytecode.object, deployer)
    .deploy(A[1], A[2], ethers.ZeroAddress, ethers.ZeroAddress)).waitForDeployment();
  const luvAddr = await luv.getAddress();
  const drop = await (await new ethers.ContractFactory(dropArt.abi, dropArt.bytecode.object, deployer)
    .deploy(luvAddr, A[3])).waitForDeployment();
  const dropAddr = await drop.getAddress();
  console.log(`deployed: LUV ${luvAddr} · Airdrop ${dropAddr} · signer ${A[3]}\n`);

  // ════════ 1. token genesis ════════
  console.log('1. token genesis');
  check('name SHAMBA', (await luv.name()) === 'SHAMBA');
  check('symbol LUV', (await luv.symbol()) === 'LUV');
  check('decimals 18', Number(await luv.decimals()) === 18);
  check('totalSupply 1e35', (await luv.totalSupply()) === SUPPLY);
  check('deployer holds full supply', (await luv.balanceOf(A[0])) === SUPPLY);
  check('payoutThreshold 10 trillion', (await luv.payoutThreshold()) === 10n * TRILLION);

  // ════════ 2. WALLET-TO-WALLET gesture (the prod path): 0 fee ════════
  console.log('\n2. wallet-to-wallet gesture (EOA → EOA = 0 fee, full trillion)');
  // fund treasury (deployer is fee-exempt → treasury gets full)
  await (await luv.connect(deployer).transfer(A[4], 100n * TRILLION)).wait();
  check('treasury funded whole (deployer exempt)', (await luv.balanceOf(A[4])) === 100n * TRILLION);
  const feesBefore = await luv.accumulatedFees();
  const userG = fresh(); // pure recipient EOA (no gas needed)
  // treasury (NON-exempt EOA) → fresh user EOA: wallet-to-wallet, must be 0 fee
  await (await luv.connect(treasury).transfer(userG, TRILLION)).wait();
  check('GESTURE: user got EXACTLY 1 trillion (0 fee)', (await luv.balanceOf(userG)) === TRILLION);
  check('treasury debited exactly 1 trillion', (await luv.balanceOf(A[4])) === 99n * TRILLION);
  check('no fee accrued on wallet-to-wallet', (await luv.accumulatedFees()) === feesBefore);

  // ════════ 3. fee IS taken when a contract is the counterparty ════════
  console.log('\n3. fee taken on contract-counterparty transfer (why w2w is primary)');
  await (await luv.connect(deployer).transfer(A[5], 10n * TRILLION)).wait(); // fund trader (exempt sender)
  const dropBalBefore = await luv.balanceOf(dropAddr);
  // trader (non-exempt EOA) → airdrop CONTRACT: charged the 5% fee
  await (await luv.connect(trader).transfer(dropAddr, TRILLION)).wait();
  const gained = (await luv.balanceOf(dropAddr)) - dropBalBefore;
  check('contract recipient got 95% (5% fee)', gained === (TRILLION * 95n) / 100n, gained.toString());
  check('accumulatedFees == 5%', (await luv.accumulatedFees()) === (TRILLION * 5n) / 100n);
  check('pendingReflection == 3%', (await luv.pendingReflection()) === (TRILLION * 3n) / 100n);

  // ════════ 4. max-tx cap ════════
  console.log('\n4. max-transfer cap (1% of supply)');
  check('maxTxAmount == 1% supply', (await luv.getConfig())[3] === MAXTX);
  // staticCall: simulate (no tx, no nonce) — the maxTx check fires before the balance check.
  await reverts('non-exempt transfer > 1%', luv.connect(trader).transfer.staticCall(fresh(), MAXTX + 1n));

  // ════════ 5. unified processFees(): reflection batches; swap no-ops w/o a router ════════
  console.log('\n5. unified processFees() (reflection batch + graceful swap no-op)');
  const reflBefore = await luv.totalReflectionsDistributed();
  await (await luv.connect(deployer).processFees()).wait(); // permissionless; must not revert (no router)
  check('reflections distributed (batch applied)', (await luv.totalReflectionsDistributed()) > reflBefore);
  check('pendingReflection reset to 0', (await luv.pendingReflection()) === 0n);

  // ════════ 6. airdrop pull path — FEE-CHARGED without fee-exemption (~950B) ════════
  console.log('\n6. airdrop claim WITHOUT fee-exemption (contract→EOA, fee charged)');
  await (await luv.connect(deployer).transfer(dropAddr, 10n * TRILLION)).wait(); // fund airdrop (exempt sender → full)
  const domain = { name: 'ShambaLuvAirdrop', version: '1', chainId, verifyingContract: dropAddr };
  const types = { Claim: [
    { name: 'recipient', type: 'address' }, { name: 'amount', type: 'uint256' },
    { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' },
  ] };
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
  async function voucher(recipient, amount, nonce) {
    const sig = await signer.signTypedData(domain, types, { recipient, amount, nonce, deadline });
    // prove offline EIP-712 byte-matches the contract digest
    const onchain = await drop.claimDigest(recipient, amount, nonce, deadline);
    const offline = ethers.TypedDataEncoder.hash(domain, types, { recipient, amount, nonce, deadline });
    check(`EIP-712 digest matches contract (nonce ${nonce})`, onchain === offline);
    return sig;
  }
  const rFee = fresh();
  await (await drop.connect(deployer).claim(rFee, TRILLION, 1n, deadline, await voucher(rFee, TRILLION, 1n))).wait();
  check('non-exempt claim recipient got 95% (5% fee taken) (~950B)', (await luv.balanceOf(rFee)) === (TRILLION * 95n) / 100n);

  // ════════ 7. airdrop claim WITH fee-exemption — exact 1 trillion ════════
  console.log('\n7. airdrop claim WITH fee-exemption (exact full trillion)');
  await (await luv.connect(deployer).setFeeExemption(dropAddr, true)).wait();
  const rFull = fresh();
  await (await drop.connect(deployer).claim(rFull, TRILLION, 2n, deadline, await voucher(rFull, TRILLION, 2n))).wait();
  check('fee-exempt claim recipient got EXACTLY 1 trillion', (await luv.balanceOf(rFull)) === TRILLION);
  check('drop.claimCount == 2', (await drop.claimCount()) === 2n);

  // ════════ 8. airdrop guards: replay, wrong signer, double-wallet ════════
  console.log('\n8. airdrop guards');
  // staticCall (no tx, no nonce consumed) — just verify the revert.
  const s2 = await voucher(rFull, TRILLION, 2n);
  await reverts('nonce replay', drop.claim.staticCall(rFull, TRILLION, 2n, deadline, s2));
  const s3 = await voucher(rFull, TRILLION, 3n);
  await reverts('same wallet second claim', drop.claim.staticCall(rFull, TRILLION, 3n, deadline, s3));
  const rBad = fresh();
  const badSig = await trader.signTypedData(domain, types, { recipient: rBad, amount: TRILLION, nonce: 4n, deadline });
  await reverts('wrong signer rejected', drop.claim.staticCall(rBad, TRILLION, 4n, deadline, badSig));

  // ════════ 9. campaign cap = 1% of supply ════════
  console.log('\n9. campaign cap (1% of supply = 1 Quadrillion)');
  const drop2 = await (await new ethers.ContractFactory(dropArt.abi, dropArt.bytecode.object, deployer)
    .deploy(luvAddr, A[3])).waitForDeployment();
  const drop2Addr = await drop2.getAddress();
  await (await luv.connect(deployer).setFeeExemption(drop2Addr, true)).wait();
  await (await luv.connect(deployer).transfer(drop2Addr, CAP)).wait();
  const d2 = { name: 'ShambaLuvAirdrop', version: '1', chainId, verifyingContract: drop2Addr };
  const rCap = fresh();
  const capSig = await signer.signTypedData(d2, types, { recipient: rCap, amount: CAP, nonce: 1n, deadline });
  await (await drop2.connect(deployer).claim(rCap, CAP, 1n, deadline, capSig)).wait();
  check('claim of full 1% cap succeeds', (await luv.balanceOf(rCap)) === CAP);
  const rOver = fresh();
  const overSig = await signer.signTypedData(d2, types, { recipient: rOver, amount: TRILLION, nonce: 2n, deadline });
  await reverts('claim beyond 1% cap → CapReached', drop2.claim.staticCall(rOver, TRILLION, 2n, deadline, overSig));

  console.log(`\n${'═'.repeat(48)}\n  RESULT: ${pass} passed · ${fail} failed\n${'═'.repeat(48)}\n`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error('HARD TEST ERROR:', e.message || e); process.exit(1); });
