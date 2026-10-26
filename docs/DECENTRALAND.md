# Decentraland — research brief for LUV immersive (phase 5)

**Status:** research only. Nothing here is built or deployed. **Source:** the
[decentraland GitHub org](https://github.com/decentraland) (529 public repos) and the official
[`decentraland/sdk-skills`](https://github.com/decentraland/sdk-skills) docs, read 2026-10-26.
**Why:** the [roadmap](../roadmap.html) puts phase 5, *LUV immersive*, inside DeltaVerse spatial
worlds. DeltaVerse isn't publicly wired yet. Decentraland is an existing, open-source world on
Ethereum that LUV could use now without a new contract.

## TL;DR

1. **LUV works in Decentraland today with no contract changes.** A scene can read any player's
   LUV balance and ask the player to sign a `transfer` of LUV, using Decentraland's
   ERC-20 helpers (`dcl-crypto-toolkit` → `crypto.currency.*`) or `eth-connect`. The player's
   Decentraland identity is their Ethereum address.
2. **The likely first home is a World at `bankon.eth`, not LAND.** Decentraland
   *Worlds* can be published to any **ENS name** that the deploying wallet owns. `bankon.eth`
   resolves to the treasury `0x10f7…d169` (checked on-chain via Blockscout). Owning the name, not
   only resolving it, is what Decentraland checks. An ENS-name World gets a fixed **36 MB**
   budget. It needs no LAND and no MANA.
3. **A gesture in-world is EOA→EOA, so it pays 0 fee.** This holds only while both sides are plain
   EOAs (see the [caveat](#caveat-the-fee-rule-meets-smart-wallets) below).

## The org at a glance (what matters for LUV)

| repo | what it is | relevance |
|---|---|---|
| [`sdk-skills`](https://github.com/decentraland/sdk-skills) | 33 official agent skills for SDK7 scene work (`npx skills add decentraland/sdk-skills --all`) | **primary build reference**: `create-scene`, `nft-blockchain`, `deploy-worlds`, `scene-runtime`, `build-ui`, `authoritative-server` |
| [`js-sdk-toolchain`](https://github.com/decentraland/js-sdk-toolchain) | `@dcl/sdk` + `@dcl/sdk-commands` (build, preview, deploy) | the scene SDK itself |
| [`sdk7-test-scenes`](https://github.com/decentraland/sdk7-test-scenes) | engine-team scenes for every API | working examples, e.g. `66,6-signed-fetch` and `80,-4-restricted-actions` |
| [`unity-explorer`](https://github.com/decentraland/unity-explorer) | the Decentraland 2.0 desktop client (C#) | what players run |
| [`catalyst`](https://github.com/decentraland/catalyst) | content servers that hold deployed scenes | where a scene lands |
| [`marketplace`](https://github.com/decentraland/marketplace) · [`builder`](https://github.com/decentraland/builder) | NFT marketplace (wearables, emotes, LAND, NAMEs) · scene, collection and Worlds builder | later: LUV-branded wearables or emotes |
| [`decentraland-crypto-fetch`](https://github.com/decentraland/decentraland-crypto-fetch) | `fetch` signed with a Decentraland identity | backend side of `signedFetch` |
| [`architecture`](https://github.com/decentraland/architecture) · [`protocol`](https://github.com/decentraland/protocol) | server diagrams · ADRs and the protocol | ADR-44 (signed fetch) for the backend verifier |

**MANA:** `0x0F5D2fB29fb7d3CFeE444a200298f468908cC942` (Ethereum mainnet, verified, via
Blockscout). LUV does **not** need MANA. MANA only matters if LUV pairs with it or buys LAND or a NAME.

## How LUV plugs in, layer by layer

### 1. Read: show the player's LUV

- `getPlayer()` (`@dcl/sdk/src/players`) returns `userId`, which is the player's Ethereum address.
  **Check `isGuest` first.** Guests have no wallet.
- `crypto.currency.balance('0x2711111111683B8708cb9a48cBf36a51315F8254', userId)` returns the
  LUV balance. Keep it **BigInt wei**, the same rule `card.js` follows. A float drops whole-LUV
  digits above about 9 quadrillion.
- A plain `fetch` to `https://luv.pythai.net/luv.live.json` returns phase, status and addresses, so
  the scene doesn't hard-code them. Declare `"USE_FETCH"` in `scene.json` `requiredPermissions`.

### 2. Write: the gesture as something you *make*

- `crypto.currency.send(LUV, to, amount)`, or `eth-connect` `ContractFactory` with the LUV ABI,
  brings up the player's wallet to sign. The player pays mainnet gas. Wrap the call in
  `executeTask(async () => …)` and handle rejection and out-of-gas errors.
- **maxTx:** sends above `maxTxAmount` (1% of supply, `ShambaLuv.sol:242`) revert
  `MaxTxExceeded()`. A tip UI never gets close to that, but the UI should cap it anyway.
- **Testing:** Decentraland's docs point to Sepolia. LUV isn't on Sepolia, so either deploy a test
  LUV there or run the scene in preview against a forked anvil (the
  [`deploy/`](../deploy) harness already forks mainnet).

### 3. Identity: one player, one proof

- `signedFetch` (`~system/SignedFetch`) adds **ADR-44 signed identity headers** to any request.
  A backend verifies them to learn which address made the call, with no extra wallet prompt.
- This fits the self-hosted [`auth/`](../auth/README.md) backend. A Decentraland session could
  be one more verified identity next to the social logins. The airdrop is **closed**, so this
  would serve future earndrops, drips, or access gating. It would not reopen the 1T gesture.

### 4. Place: where the scene lives

| target | needs | budget | fit |
|---|---|---|---|
| **World at `bankon.eth`** | the deploying wallet owns the ENS name (or an ACL grant on it) | 36 MB, fixed | **recommended first**: no new purchases, and the name is already LUV's |
| World at `<name>.dcl.eth` | a Decentraland NAME (an NFT bought with MANA) | 100 MB per NAME, +100 MB per LAND, +100 MB per 2,000 MANA | if 36 MB is too small |
| Genesis City LAND | LAND parcels | per parcel | later: presence on the shared map |

Deploying to a World needs `"worldConfiguration": { "name": "bankon.eth" }` in `scene.json`, then
`npx @dcl/sdk-commands deploy --target-content https://worlds-content-server.decentraland.org`,
signed by the name owner. Players reach it at `https://decentraland.org/jump?realm=bankon.eth`.
Worlds are listed on Places automatically (`placesConfig.optOut` turns that off). The
`tags: ["crypto", "social"]` tags fit.

**Signing caveat:** the name owner signs the deployment. For `bankon.eth` that's the treasury key.
The cleaner path is to grant a separate deployer address through the World's **ACL**, so the
treasury key never signs scene uploads.

## Caveat: the fee rule meets smart wallets

`ShambaLuv._transfer` treats a transfer as fee-free wallet-to-wallet only when **both** addresses
have no code (`from.code.length == 0 && to.code.length == 0`, `ShambaLuv.sol:259`). In Decentraland
that means:

- A player using a **plain EOA** (MetaMask, or the social-login wallets most Decentraland users
  have) sends LUV at **0 fee**.
- A player using a **smart-contract wallet**, which includes LUV's own `LuvAccountFactory`
  accounts and **EIP-7702-delegated EOAs** (these have code), is charged the **5%**
  unless one side is `setFeeExemption`-ed.
- A **scene-owned contract**, such as a tip jar or a gesture booth, is a contract counterparty and
  is charged the same 5%. If phase 5 adds one, it should be fee- and maxTx-exempted the same way
  the LUVbus is ([`docs/MULTISEND.md`](MULTISEND.md)), as an owner action recorded in
  [SECURITY.md](../SECURITY.md).

## Suggested sequence (if this goes ahead)

1. **Confirm the ENS registrant** of `bankon.eth`: is it the treasury, or a separate owner or
   wrapper? Then set a World ACL deployer.
2. **Scaffold** an SDK7 scene in a new `dcl/` folder (`create-scene` skill, `@dcl/sdk`). Scope: a
   LUV balance panel (React-ECS UI) and a "send a gesture" interaction to another player in the scene.
3. **Test** in preview (`npx @dcl/sdk-commands start --bevy-web`) against a forked anvil. Use the
   `deploy/` harness style for the contract checks.
4. **Publish** to `bankon.eth` with Places opted out at first. Turn listing on once the scene
   has been reviewed.
5. **Later:** LUV wearables or emotes through the Builder, a LAND presence, and a backend that
   verifies ADR-44 identity in `auth/`.

## Not covered here

- Decentraland governance (the DAO and its Polygon voting) and MANA economics.
- Any LUV↔MANA liquidity. That would be a new pool and a separate decision.
- DeltaVerse itself. Decentraland is a way to ship phase 5 sooner, not a replacement for DeltaVerse.

---

<sub>made with [LUV ❤](https://luv.pythai.net/)</sub>
