# LUVdrip — a million LUV a day, delivered as a flow

**Live substrate:** `substrate/luv-drip.js` (`DVLuvDrip`). Self-boots into any `[data-luvdrip]` mount.

## The rate

One million LUV, spread evenly across one day:

| quantity | value |
|---|---|
| daily | **1,000,000 LUV** |
| per second | **11.574074… LUV/s** ( = 1,000,000 ÷ 86,400 ) |
| cadence | **one LUV every 86.4 ms** — a LUV lands ~11.57 times a second |
| per second, exact (18-dp wei) | **11,574,074,074,074,074,074.074 wei/s** |
| daily cap | 1,000,000 LUV — the drip fills the day and stops |

The flow runs all day long: not a lump sum, but a steady beat that fills to a million over 24 hours
and resets the next day. `DVLuvDrip.perSecond(daily)` returns the rate for any daily amount.

## Two reward modes

Operator-settable per mount (`data-mode`) or per instance (`opts.mode`):

- **`login` — reward from login (presence).** The meter advances **only while the participant is
  signed in and the page is live**. Log out, or hide the tab, and the flow pauses; what was already
  earned is kept. This is the *stay-logged-in-to-keep-receiving* model — presence is the reward.
- **`accrual` — reward from accrual (time).** The meter advances against the wall clock **since the
  last collection**, whether or not the participant was watching. They return and collect the pile.
  Presence is not required; coming back to collect is.

## COLLECT, then REDEEM — two separate actions

The flow is designed to be *felt*: LUV arrives, a LUV at a time, into the logged-in participant's own
meter — the experience of value flowing to you from being here. Two distinct actions turn that flow
into on-chain balance:

1. **COLLECT** — the **logged-in address banks the live flow**. `collect()` moves the accrued drip into
   a `collected` balance keyed to that address and resets the live meter. **Off-chain, free, instant** —
   the participant gathering their own flow. Available only from the logged-in address (the meter is
   keyed to it). `collected` persists across days.
2. **REDEEM** — the banked `collected` balance is **delivered on-chain**. `redeem()` hands it to the
   backend, which mints it in **one batched `distributeReward(user, collected)`** through the
   IncentiveDistributor REDEEM rail (gas), then resets. A per-second on-chain mint is neither gas-sane
   nor necessary.

```
drip flows  →  COLLECT (free, to your address)  →  collected balance  →  REDEEM (one tx)  →  distributeReward(user, collected)
```

`luv-drip.js` is the **meter**, persisting state in the participant's own `localStorage` (per identity,
CSP-safe, nothing phones home). The chain is the source of truth at REDEEM.

## The flow is free — buying is always one tap away

The drip costs nothing; for anyone who wants more now, the meter renders an always-visible
**Uniswap USDC → LUV preset** link (`.drip-buy`) right beside COLLECT/REDEEM, so the emphasized buy
path is never more than one tap from the flow.

## Integration

```html
<!-- a live meter; mode + identity + daily amount are data-attributes -->
<div data-luvdrip data-mode="login" data-identity="0xUSER…" data-daily="1000000"></div>
<script src="substrate/luv-drip.js?v=1"></script>
```

or drive it directly:

```js
var drip = new DVLuvDrip.Drip({ mount:'#drip', mode:'login', identity: user, signedIn:true });
drip.onRedeem = function (owed) {           // wire REDEEM to the on-chain rail
  fetch('/airdrop/redeem', { method:'POST' });   // → distributeReward(user, owed)
};
drip.start();
drip.setSignedIn(false);      // pause the flow on logout (login mode)
drip.collect();               // COLLECT: bank the live flow to the address (free), reset the meter
drip.accrued();               // live drip, still flowing
drip.collected();             // banked balance, awaiting REDEEM
drip.redeem();                // REDEEM: reset collected + fire onRedeem(owed)
```

The COLLECT and REDEEM buttons are rendered by the module (`[data-drip-collect]` / `[data-drip-redeem]`)
and wired automatically; COLLECT works standalone, REDEEM resets the banked balance only when an
`onRedeem` rail is wired. Styling hooks: `.drip-flow(.on)` (the live channel), `.drip-amt`/`.drip-unit`
(the figure), `.drip-bar > span` (fill to today's million), `.drip-meta`/`.drip-mode`,
`.drip-collect` / `.drip-collected` / `.drip-redeem` (the two actions), `.drip-buy` (the Uniswap
USDC → LUV preset). The mount gets `data-drip-full="1"` when the day's million is reached.

## Properties

- **Daily cap** — never more than 1,000,000 LUV/day; resets on the 24-hour roll.
- **Reduced motion** — the value still advances; the visual cadence slows to 1 s.
- **Sovereign state** — accrual persists in the participant's browser, keyed per identity; nothing
  phones home (cypherpunk2048). The chain is the source of truth at collection.
- **thanks a million** — the drip is the acknowledgement, paid a LUV at a time, all day long.
