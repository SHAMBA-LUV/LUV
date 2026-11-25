#!/usr/bin/env node
// collateral keeper — finds unsafe GoldVault urns and liquidates them.
//
//   node keeper.mjs                 dry run: discover, evaluate, simulate, print the plan
//   node keeper.mjs --execute       send transactions
//   node keeper.mjs --once          one pass then exit (default: loop every INTERVAL seconds)
//
// Env:
//   RPC_URL         JSON-RPC endpoint (required)
//   VAULT           GoldVault address (required)
//   PRIVATE_KEY     signer for --execute (never needed for a dry run)
//   FLASH_KEEPER    FlashKeeper address owned by the signer (enables capital-free liquidation)
//   ROUTER          DEX router the FlashKeeper sells seized pegs on
//   ROUTE           how to build the swap: "stablepool" (GoldStablePool — set ROUTER to the
//                   bXAU/<peg> pool), "mockswap" (local tests), or a path to a module whose
//                   default export is
//                     async ({ provider, gem, bxau, router, gemOut, bxauNeeded }) => ({ data, gemIn })
//   FROM_BLOCK      first block to scan for positions (default 0; set to the vault's deploy block)
//   INTERVAL        seconds between passes (default 30)
//   MIN_PROFIT      minimum peg profit per flash job, in peg units (default 0 = any profit)
//   BUFFER_BPS      extra bXAU buffer on top of the owed amount, covers fees accruing between the
//                   read and the inclusion of the tx (default 10 = 0.10%)
//
// Strategy per unsafe urn: if the signer holds enough bXAU, liquidate directly; otherwise, if a
// FlashKeeper and a route are configured, flash-mint, liquidate and sell; otherwise report it.
// Every transaction is simulated (eth_call) first and skipped if the simulation reverts.
import { ethers, ABI, WAD, b32, fmt, divUp, env, isMain, getLogs, sleep, headBlock } from './lib.mjs';

/** Mirror of GoldVault.liquidate's maths, to predict wad and gemOut for a full liquidation. */
export function predict({ tab, ink, price, chop, scale }) {
  let wad = tab;
  let seize = (wad * chop) / price;
  if (seize >= ink) {
    seize = ink;
    const value = (seize * price) / WAD;
    wad = value >= tab ? tab : divUp(value * WAD, chop);
  }
  const gemOut = seize / scale;
  return { wad, gemOut, badDebt: wad < tab && seize === ink };
}

/** Built-in route for MockSwap (local tests): sell(gem, gemIn) at a fixed bxauPerGem. */
async function mockswapRoute({ provider, gem, router, bxauNeeded }) {
  const swap = new ethers.Contract(
    router,
    ['function bxauPerGem() view returns (uint256)', 'function sell(address,uint256) returns (uint256)'],
    provider,
  );
  const p = await swap.bxauPerGem();
  const gemIn = divUp(bxauNeeded * WAD, p);
  return { data: swap.interface.encodeFunctionData('sell', [gem, gemIn]), gemIn };
}

export async function loadRoute(spec) {
  if (!spec) return null;
  if (spec === 'mockswap') return mockswapRoute;
  if (spec === 'stablepool') return (await import('./routes/stablepool.mjs')).default;
  const mod = await import(new URL(spec, `file://${process.cwd()}/`).href);
  return mod.default;
}

export function createState(fromBlock = 0) {
  return { from: fromBlock, urns: new Set() };
}

/**
 * One pass. Returns a list of { ilk, urn, owed, mode, status, tx? } — mode is
 * 'direct' | 'flash' | 'none'; status is 'planned' | 'sent' | 'skipped: …'.
 */
export async function runOnce(cfg, state) {
  const { provider, signer, execute } = cfg;
  const log = cfg.log ?? console.log;
  const vault = new ethers.Contract(cfg.vault, ABI.vault, signer ?? provider);
  const head = await headBlock(provider);

  // 1. discover urns from Lock events (every urn with collateral has at least one)
  if (state.from <= head) {
    const topic = vault.interface.getEvent('Lock').topicHash;
    for (const l of await getLogs(provider, { address: cfg.vault, topics: [topic] }, state.from, head)) {
      const ev = vault.interface.parseLog(l);
      state.urns.add(`${ev.args.ilk}|${ev.args.usr}`);
    }
    state.from = head + 1;
  }
  if ((await vault.live()) !== 1n) {
    log('vault is caged — nothing to liquidate');
    return [];
  }

  const bxau = new ethers.Contract(await vault.bxau(), ABI.bxau, signer ?? provider);
  const spotter = new ethers.Contract(await vault.spotter(), ABI.spotter, provider);
  const me = signer ? await signer.getAddress() : null;
  const actions = [];

  for (const key of state.urns) {
    const [ilk, urn] = key.split('|');
    const { art, ink } = await vault.urns(ilk, urn);
    if (art === 0n || (await vault.isSafe(ilk, urn))) continue;

    const [price, ok] = await spotter.peek(ilk);
    const name = b32(ilk);
    if (!ok) {
      log(`[${name}] ${urn} unsafe but oracle is down — cannot liquidate`);
      actions.push({ ilk: name, urn, mode: 'none', status: 'skipped: oracle down' });
      continue;
    }
    const i = await vault.ilks(ilk);
    const owed = await vault.owed(ilk, urn);
    const tab = owed + (owed * BigInt(cfg.bufferBps ?? 10)) / 10000n; // fees accrue until inclusion
    const p = predict({ tab: owed, ink, price, chop: i.chop, scale: i.scale });
    const gemDec = Number(18n - BigInt(i.scale.toString().length - 1));
    log(
      `[${name}] UNSAFE ${urn}: owes ${fmt(owed)} oz, ink ${fmt(ink)}, price ${fmt(price)} oz/token → ` +
        `burn ~${fmt(p.wad)} bXAU for ~${fmt(p.gemOut, gemDec)} ${p.badDebt ? '(insolvent: bad debt)' : ''}`,
    );

    const action = { ilk: name, urn, owed, wad: p.wad, gemOut: p.gemOut, mode: 'none', status: 'skipped: no capital' };
    actions.push(action);

    // 2a. direct: we already hold bXAU
    const bal = me ? await bxau.balanceOf(me) : 0n;
    if (me && bal >= tab) {
      action.mode = 'direct';
      try {
        if ((await bxau.allowance(me, cfg.vault)) < tab) {
          if (execute) await (await bxau.approve(cfg.vault, ethers.MaxUint256)).wait();
          else {
            action.status = 'planned (needs bXAU approval first)';
            continue;
          }
        }
        await vault.liquidate.staticCall(ilk, urn, tab);
        if (!execute) {
          action.status = 'planned';
          continue;
        }
        const tx = await vault.liquidate(ilk, urn, tab);
        await tx.wait();
        action.status = 'sent';
        action.tx = tx.hash;
        log(`  liquidated directly: ${tx.hash}`);
      } catch (e) {
        action.status = `skipped: ${e.shortMessage ?? e.message}`;
      }
      continue;
    }

    // 2b. flash: FlashKeeper + route
    if (cfg.flashKeeper && cfg.route && cfg.router) {
      action.mode = 'flash';
      try {
        const need = p.wad + (p.wad * BigInt(cfg.bufferBps ?? 10)) / 10000n;
        const { data, gemIn } = await cfg.route({
          provider, gem: i.gem, bxau: bxau.target, router: cfg.router, gemOut: p.gemOut, bxauNeeded: need,
        });
        const profit = p.gemOut - gemIn;
        if (profit <= 0n || profit < BigInt(cfg.minProfit ?? 0)) {
          action.status = `skipped: unprofitable (gemOut ${fmt(p.gemOut, gemDec)}, cost ${fmt(gemIn, gemDec)})`;
          log(`  ${action.status}`);
          continue;
        }
        const keeper = new ethers.Contract(cfg.flashKeeper, ABI.keeper, signer ?? provider);
        const job = { ilk, urn, amount: tab, router: cfg.router, swapData: data, minProfit: BigInt(cfg.minProfit ?? 0) };
        await keeper.run.staticCall(job, me ? { from: me } : {});
        action.profit = profit;
        if (!execute) {
          action.status = 'planned';
          log(`  flash job simulates OK, est. profit ${fmt(profit, gemDec)}`);
          continue;
        }
        const tx = await keeper.run(job);
        await tx.wait();
        action.status = 'sent';
        action.tx = tx.hash;
        log(`  flash-liquidated: ${tx.hash} (est. profit ${fmt(profit, gemDec)})`);
      } catch (e) {
        action.status = `skipped: ${e.shortMessage ?? e.message}`;
        log(`  ${action.status}`);
      }
      continue;
    }
    log('  no bXAU and no FlashKeeper/route configured — reporting only');
  }
  return actions;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const execute = args.has('--execute');
  const once = args.has('--once');
  const provider = new ethers.JsonRpcProvider(env('RPC_URL'));
  const pk = process.env.PRIVATE_KEY;
  if (execute && !pk) throw new Error('--execute needs PRIVATE_KEY');
  const signer = pk ? new ethers.Wallet(pk, provider) : null;
  const cfg = {
    provider,
    signer,
    execute,
    vault: env('VAULT'),
    flashKeeper: process.env.FLASH_KEEPER || null,
    router: process.env.ROUTER || null,
    route: await loadRoute(process.env.ROUTE),
    minProfit: env('MIN_PROFIT', '0'),
    bufferBps: Number(env('BUFFER_BPS', '10')),
  };
  const state = createState(Number(env('FROM_BLOCK', '0')));
  console.log(`keeper ${execute ? 'EXECUTING' : 'dry-run'} on vault ${cfg.vault}`);
  for (;;) {
    try {
      const acts = await runOnce(cfg, state);
      console.log(`pass done: ${state.urns.size} urns tracked, ${acts.length} unsafe`);
    } catch (e) {
      console.error(`pass failed: ${e.shortMessage ?? e.message}`);
    }
    if (once) break;
    await sleep(Number(env('INTERVAL', '30')) * 1000);
  }
}

if (isMain(import.meta.url)) main().catch((e) => { console.error(e); process.exit(1); });
