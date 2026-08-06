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

## Delivery — meter, not per-second mint

`luv-drip.js` is the **meter**: it computes, displays, and persists (in the participant's own
`localStorage`, keyed per identity) what is owed. On-chain delivery is **one batched
`distributeReward(user, total)`** through the IncentiveDistributor **REDEEM** rail when the
participant collects — a per-second on-chain mint would be neither gas-sane nor necessary. Client-side
the counter flows continuously; on-chain it settles in one transaction at the moment of collection.

```
drip.collect()  →  owed LUV (meter resets)  →  backend POST /airdrop/redeem  →  distributeReward(user, owed)
```

## Integration

```html
<!-- a live meter; mode + identity + daily amount are data-attributes -->
<div data-luvdrip data-mode="login" data-identity="0xUSER…" data-daily="1000000"></div>
<script src="substrate/luv-drip.js?v=1"></script>
```

or drive it directly:

```js
var drip = new DVLuvDrip.Drip({ mount:'#drip', mode:'login', identity: user, signedIn:true }).start();
drip.setSignedIn(false);   // pause the flow on logout (login mode)
var owed = drip.collect(); // hand the pile to the REDEEM rail, reset the meter
```

Minimal styling hooks the module renders: `.drip-amt` / `.drip-unit` (the live figure),
`.drip-bar > span` (fill to today's million), `.drip-meta` / `.drip-mode` (rate + mode line). The
mount gets `data-drip-full="1"` when the day's million is reached.

## Properties

- **Daily cap** — never more than 1,000,000 LUV/day; resets on the 24-hour roll.
- **Reduced motion** — the value still advances; the visual cadence slows to 1 s.
- **Sovereign state** — accrual persists in the participant's browser, keyed per identity; nothing
  phones home (cypherpunk2048). The chain is the source of truth at collection.
- **thanks a million** — the drip is the acknowledgement, paid a LUV at a time, all day long.
