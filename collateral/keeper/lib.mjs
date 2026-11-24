// Shared helpers for the collateral keeper + monitor (ethers v6).
import { ethers } from 'ethers';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export { ethers };
export const WAD = 10n ** 18n;
export const RAY = 10n ** 27n;

export const ABI = {
  vault: [
    'function bxau() view returns (address)',
    'function spotter() view returns (address)',
    'function live() view returns (uint256)',
    'function debt() view returns (uint256)',
    'function sin() view returns (uint256)',
    'function surplus() view returns (uint256)',
    'function Line() view returns (uint256)',
    'function ilkCount() view returns (uint256)',
    'function ilkList(uint256) view returns (bytes32)',
    'function ilks(bytes32) view returns (address gem, uint256 scale, uint256 Art, uint256 rate, uint256 rho, uint256 duty, uint256 mat, uint256 chop, uint256 line, uint256 dust, uint256 floor)',
    'function urns(bytes32, address) view returns (uint256 ink, uint256 art)',
    'function owed(bytes32, address) view returns (uint256)',
    'function isSafe(bytes32, address) view returns (bool)',
    'function rateNow(bytes32) view returns (uint256)',
    'function lastPrice(bytes32) view returns (uint256)',
    'function wards(address) view returns (uint256)',
    'function lock(bytes32, uint256)',
    'function draw(bytes32, uint256)',
    'function liquidate(bytes32 ilk, address usr, uint256 maxWad) returns (uint256 wad, uint256 gemOut)',
    'function poke(bytes32) returns (uint256)',
    'function init(bytes32 ilk, address gem)',
    'function file(bytes32 ilk, bytes32 what, uint256 data)',
    'function fileLine(uint256 wad)',
    'function fileSpotter(address s)',
    'function flap(address to, uint256 wad)',
    'function cage()',
    'function sweep(bytes32 ilk, address to)',
    'function rely(address usr)',
    'function deny(address usr)',
    'event Lock(bytes32 indexed ilk, address indexed usr, uint256 amount)',
    'event Draw(bytes32 indexed ilk, address indexed usr, uint256 wad)',
    'event Liquidate(bytes32 indexed ilk, address indexed usr, address indexed keeper, uint256 wad, uint256 gemOut, uint256 badDebt)',
    'event File(bytes32 indexed ilk, bytes32 indexed what, uint256 data)',
    'event FileGlobal(bytes32 indexed what, uint256 data)',
    'event FileSpotter(address spotter)',
    'event Flap(address indexed to, uint256 wad)',
    'event Cage()',
    'event Rely(address indexed usr)',
    'event Deny(address indexed usr)',
  ],
  bxau: [
    'function totalSupply() view returns (uint256)',
    'function balanceOf(address) view returns (uint256)',
    'function allowance(address, address) view returns (uint256)',
    'function approve(address, uint256) returns (bool)',
    'function transfer(address, uint256) returns (bool)',
    'function wards(address) view returns (uint256)',
    'event Rely(address indexed usr)',
    'event Deny(address indexed usr)',
  ],
  spotter: [
    'function peek(bytes32) view returns (uint256 price, bool ok)',
    'function owner() view returns (address)',
    'function fileSrc(bytes32 ilk, address feed, uint32 maxAge, uint256 par)',
    'function fileXau(address feed, uint32 maxAge)',
    'function transferOwnership(address to)',
    'event FileSrc(bytes32 indexed ilk, address feed, uint32 maxAge, uint256 par)',
    'event FileXau(address feed, uint32 maxAge)',
    'event OwnershipTransferred(address indexed from, address indexed to)',
  ],
  timelock: [
    'function admin() view returns (address)',
    'function delay() view returns (uint256)',
    'function schedule(address target, uint256 value, bytes data, uint256 eta) returns (bytes32)',
    'function execute(address target, uint256 value, bytes data, uint256 eta) payable returns (bytes)',
    'function cancel(address target, uint256 value, bytes data, uint256 eta)',
    'function setDelay(uint256 delay)',
    'function setAdmin(address admin)',
    'event Schedule(bytes32 indexed id, address indexed target, uint256 value, bytes data, uint256 eta)',
    'event Cancel(bytes32 indexed id)',
    'event Execute(bytes32 indexed id, address indexed target, uint256 value, bytes data, uint256 eta)',
    'event SetAdmin(address admin)',
    'event SetDelay(uint256 delay)',
  ],
  guardian: [
    'function owner() view returns (address)',
    'function fire()',
    'function transferOwnership(address to)',
    'event Fired(address indexed by)',
  ],
  flash: [
    'function max() view returns (uint256)',
    'function owner() view returns (address)',
    'function setMax(uint256 max)',
    'function transferOwnership(address to)',
    'event SetMax(uint256 max)',
    'event OwnershipTransferred(address indexed from, address indexed to)',
  ],
  keeper: [
    'function owner() view returns (address)',
    'function run((bytes32 ilk, address urn, uint256 amount, address router, bytes swapData, uint256 minProfit) job)',
    'function sweep(address token, address to, uint256 amount)',
    'event Liquidated(bytes32 indexed ilk, address indexed urn, uint256 wad, uint256 gemOut, uint256 profit)',
  ],
  erc20: [
    'function balanceOf(address) view returns (uint256)',
    'function decimals() view returns (uint8)',
    'function approve(address, uint256) returns (bool)',
  ],
};

/** bytes32 → "PAXG-A" when printable, hex otherwise. */
export function b32(x) {
  try {
    const s = ethers.decodeBytes32String(x);
    return /^[\x20-\x7e]+$/.test(s) ? s : x;
  } catch {
    return x;
  }
}

export const ilkId = (s) => ethers.encodeBytes32String(s);
export const fmt = (v, dec = 18) => ethers.formatUnits(v, dec);
export const divUp = (a, b) => (a === 0n ? 0n : (a - 1n) / b + 1n);

export function env(name, def) {
  const v = process.env[name];
  if (v === undefined || v === '') {
    if (def === undefined) throw new Error(`missing env ${name}`);
    return def;
  }
  return v;
}

/** True when this module is the script node was started with. */
export function isMain(metaUrl) {
  return !!process.argv[1] && resolve(process.argv[1]) === fileURLToPath(metaUrl);
}

/** eth_getLogs over a block range, in chunks (public RPCs cap the range). */
export async function getLogs(provider, filter, from, to, step = 5000) {
  const out = [];
  for (let a = from; a <= to; a += step) {
    const b = Math.min(to, a + step - 1);
    out.push(...(await provider.getLogs({ ...filter, fromBlock: a, toBlock: b })));
  }
  return out;
}

/** POST a JSON alert; failures are logged, never thrown (alerts must not crash the loop). */
export async function webhook(url, payload) {
  if (!url) return;
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload, (_, v) => (typeof v === 'bigint' ? v.toString() : v)),
    });
    if (!r.ok) console.error(`webhook ${r.status}`);
  } catch (e) {
    console.error(`webhook failed: ${e.message}`);
  }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Latest block straight from the node (ethers caches getBlockNumber briefly). */
export async function headBlock(provider) {
  return Number(await provider.send('eth_blockNumber', []));
}
