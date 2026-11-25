// Keeper route for GoldStablePool: sell the seized peg for bXAU with an exact-input exchange
// sized by the pool's own getDx (inverse quote), plus a slippage buffer.
//
//   ROUTER=<GoldStablePool address> ROUTE=stablepool node keeper.mjs …
//   ROUTE_SLIPPAGE_BPS  extra input on top of getDx, covers PAXG's transfer fee and pool moves
//                       between quote and inclusion (default 10 = 0.10%)
//
// The exchange's minDy is the full bXAU amount the FlashKeeper must repay, so a bad fill reverts
// the whole liquidation instead of losing money.
import { ethers } from '../lib.mjs';

const ABI = [
  'function coins(uint256) view returns (address)',
  'function getDx(uint256 i, uint256 j, uint256 dy) view returns (uint256)',
  'function exchange(uint256 i, uint256 j, uint256 dx, uint256 minDy) returns (uint256)',
];

export default async function stablePoolRoute({ provider, gem, bxau, router, bxauNeeded }) {
  const pool = new ethers.Contract(router, ABI, provider);
  const c0 = (await pool.coins(0)).toLowerCase();
  const c1 = (await pool.coins(1)).toLowerCase();
  const g = gem.toLowerCase();
  const b = bxau.toLowerCase();
  let gi;
  if (c0 === g && c1 === b) gi = 0;
  else if (c1 === g && c0 === b) gi = 1;
  else throw new Error(`pool ${router} does not pair ${gem} with bXAU`);
  const bi = 1 - gi;
  const slip = BigInt(process.env.ROUTE_SLIPPAGE_BPS ?? '10');
  const dx = await pool.getDx(gi, bi, bxauNeeded);
  const gemIn = dx + (dx * slip) / 10000n + 1n;
  return { data: pool.interface.encodeFunctionData('exchange', [gi, bi, gemIn, bxauNeeded]), gemIn };
}
