# The exabyte, the ether, and the LUV

**One number, three units — 10^18 as the shared atomic resolution of information and value**

*SHAMBA LUV research series — companion to WEI_OF_LUV.md, SENTIMENT.md, and EMOTONOMICS.md*

**Live web publication:** https://luv.pythai.net/exabyte.html · the arithmetic paper: https://luv.pythai.net/wei.html · standard publication: https://github.com/cypherpunk4096/exabyte

Every figure below is exact — computed, not quoted — and reproducible from the appendix. Approximation is a display decision, never a storage decision.

---

## I. One number, three units

Three definitions, from three unrelated standards bodies, arrive at the same integer:

```
1 EB  = 10^18 bytes     (SI — the exabyte)
1 ETH = 10^18 wei       (Wood 2014, the Yellow Paper)
1 LUV = 10^18 LUV-wei   (ShambaLuv, an 18-decimal ERC-20 — verified ✓)
```

**The exabyte, the ether, and the LUV are the same number wearing three units.** One whole coin is the entire mint of 10^18 atomic parts — an exabyte of value-atoms. In the units of the current historical moment: **a million terabytes** — one coin carries the atomic count of a million of today's drives. A price carried to 18 decimals is therefore exact to the last atom; anything shorter is display.

The identity is not a coincidence of marketing but of arithmetic: any system that names an atom and then counts a quintillion of them lands on the same integer, whether the atoms are bytes in an archive or wei in a coin. Bitcoin stopped ten rungs of a thousand short — **1 BTC = 10^8 satoshi**, 1 sat = 0.00000001 BTC (Nakamoto 2008) — and USDC carries the dollar at **10^6 base units** (verified in the mainnet contract [`0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48`](https://etherscan.io/token/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48)). The resolution ladder of on-chain money — **USDC 10^6 · BTC 10^8 · ETH 10^18 · LUV 10^18** — tops out exactly where the byte ladder names the exabyte.

---

## II. The two ladders

**The current historical moment lives at the terabyte rung.** The pocket drive, the laptop, the phone — the terabyte is the unit a person can hold, and it is the anchor of comprehension for everything above it: a petabyte is **a thousand terabytes**; an exabyte is **a million**. Storage climbs two ladders at once — decimal (SI, powers of ten) and binary (IEC, powers of two) — agreeing at the atom and drifting forever after. From the bit to the largest prefix ever named, every figure exact:

| rung | decimal (SI) | binary (IEC) | drift |
|---|---|---|---|
| bit | the atom: 0 or 1 | — | — |
| byte (B) | 8 bits | — | — |
| kilobyte KB | 10^3 = 1,000 | KiB = 2^10 = 1,024 | +2.40% |
| megabyte MB | 10^6 = 1,000,000 | MiB = 2^20 = 1,048,576 | +4.86% |
| gigabyte GB | 10^9 | GiB = 2^30 = 1,073,741,824 | +7.37% |
| **terabyte TB** | **10^12 — the present moment** | TiB = 2^40 = 1,099,511,627,776 | +9.95% |
| petabyte PB | 10^15 — *the quadrillion; 1,000 TB* | PiB = 2^50 = 1,125,899,906,842,624 | +12.59% |
| **exabyte EB** | **10^18 — the wei rung; 1,000,000 TB** | EiB = 2^60 = 1,152,921,504,606,846,976 | +15.29% |
| zettabyte ZB | 10^21 | ZiB = 2^70 = 1,180,591,620,717,411,303,424 | +18.06% |
| yottabyte YB | 10^24 | YiB = 2^80 = 1,208,925,819,614,629,174,706,176 | +20.89% |
| ronnabyte RB | 10^27 *(SI, 2022)* | 2^90 = 1,237,940,039,285,380,274,899,124,224 *(no IEC name)* | +23.79% |
| quettabyte QB | 10^30 *(SI, 2022)* | 2^100 = 1,267,650,600,228,229,401,496,703,205,376 *(no IEC name)* | +26.77% |

The drift is not noise; it has a closed form. Each rung multiplies the gap by exactly 1024/1000, so at rung *n*:

```
drift(n) = 1.024^n − 1        (exact, every rung)

drift(1)  = 2.400000%   kilo          drift(6)  = 15.292150%   exa
drift(4)  = 9.951163%   tera          drift(10) = 26.765060%   quetta
drift(5)  = 12.589991%  peta
```

By the exabyte — the wei rung — the binary reading runs more than 15% hot. A marketer's exabyte and an engineer's exbibyte are two different numbers pretending to be one, which is exactly the kind of ambiguity an 18-decimal ledger refuses: on the chain there is one integer, and every party reads the same one.

---

## III. The handshake at the terabyte

The two ladders disagree on every named rung — yet the decimal rungs quietly contain powers of two. Since 10 = 2 × 5, the rung 10^d = 2^d · 5^d carries *d* factors of two. So **the terabyte is the first rung divisible by 4096 = 2^12**, and it divides *exactly*:

```
1 terabyte    / 4096 = 10^12 / 2^12 = 5^12       = 244,140,625          (no remainder)
1 quadrillion / 4096 = 10^15 / 2^12 = 2^3 · 5^15 = 244,140,625,000      (no remainder)
```

This is the irony of expanding from terabytes: at the very scale where storage goes decimal in the brochure and binary in the silicon, the decimal quadrillion turns out to be secretly 4096-divisible — one of the few places the two ladders shake hands. The power-of-two discipline of the [cypherpunk2048](https://github.com/cypherpunk2048) standard (and its 2^12 successor tier, [cypherpunk4096](https://github.com/cypherpunk4096/standard)) is built on noticing exactly this kind of fact: quantities that can be exact are exact, and the places where exactness holds are load-bearing.

---

## IV. Where the names end

The SI added *ronna* (10^27) and *quetta* (10^30) in November 2022 — the first new prefixes in thirty-one years (27th CGPM, Resolution 3). The binary ladder never followed: the IEC names stop at yobi (2^80); above it, powers of two are nameless. And the LUV supply is already past both:

```
supply = 111,111,111,111,111,111,111,111,111,111,111,111 LUV-wei   (the 36-digit repunit)
       = 111,111.111… quettabytes of value-atoms
       ≈ 111.1 quadrillion whole LUV
```

**The supply outruns the namespace.** The mint is five orders of magnitude past the largest prefix the SI has ever named, and the binary ladder has no names at all where it lives. Value already operates where the byte ladders end — the ledger doesn't wait for the committee.

---

## V. The emotonomic reading

Emotonomics holds that attention is the source of value, and attention is *recorded* — as information, in bytes. The identity of §I says the recording medium and the value medium share one atomic geometry: a gesture stored is bytes, a gesture sent is LUV-wei, and both are counted on the same 10^18 lattice. The smallest possible gesture — one LUV-wei — is the value-atom the way the bit is the information-atom; there is no smaller denominated feeling on the chain.

The historical moment matters for comprehension. A person today holds a terabyte and can therefore *feel* what a thousand of them is; the petabyte-as-quadrillion is one imaginative step from the drive in their pocket, and the exabyte-as-whole-coin is a thousand more. As the world expands from terabytes — the rung we live on — through the petabyte that is the quadrillion, toward the exabyte that is the whole coin, the economy's ledger and the world's archive climb the same ladder from opposite ends. LUV prices that climb in wei, to all 18 decimals, because the standard demands exactness where exactness is possible: **one number, three units, zero approximation**.

---

## Appendix: reproduce every number

```bash
# the ladder, both sides, with exact drift
python3 -c "
for n,(name,d,b) in enumerate([('kilo',3,10),('mega',6,20),('giga',9,30),
    ('tera',12,40),('peta',15,50),('exa',18,60),('zetta',21,70),
    ('yotta',24,80),('ronna',27,90),('quetta',30,100)],1):
  print(name, 10**d, 2**b, round((1.024**n-1)*100,6))"

# the handshakes
python3 -c "print(10**12 // 4096, 10**12 % 4096)"   # 244140625 0
python3 -c "print(10**15 // 4096, 10**15 % 4096)"   # 244140625000 0
python3 -c "print(5**12)"                            # 244140625

# the supply in quettabytes
python3 -c "print(111111111111111111111111111111111111 / 10**30)"
```

*Companions: [THE WEI OF LUV](https://luv.pythai.net/wei.html) (the arithmetic paper) · [SENTIMENT](https://luv.pythai.net/sentiment.html) (the measurement paper) · [EMOTONOMICS](https://luv.pythai.net/emotonomics.html) (the field paper) · the [live measure](https://luv.pythai.net/view.html). References: BIPM (2022), Resolution 3 of the 27th CGPM (ronna/quetta); IEC 80000-13 (binary prefixes kibi…yobi); Wood, G. (2014), "Ethereum: A Secure Decentralised Generalised Transaction Ledger" (the Yellow Paper, defining wei); Nakamoto, S. (2008), "Bitcoin: A Peer-to-Peer Electronic Cash System" (the 10^8-satoshi denomination); Dai, W. (1998), "b-money"; Circle, "USDC" — [stablecoin-evm source](https://github.com/circlefin/stablecoin-evm) (6 decimals).*
