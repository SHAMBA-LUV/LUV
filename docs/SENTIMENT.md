# Measured Feeling: Market Sentiment, Its Instruments, and the Emotonomic Turn

**A treatise on the measurement of collective emotion in markets, with an application to on-chain emotonomic systems**

*SHAMBA LUV research series — companion to EMOTONOMICS.md and LUVPAPER.md*

**Live web publication:** https://luv.pythai.net/sentiment.html · companion field paper: https://luv.pythai.net/emotonomics.html · live measurement stack: https://luv.pythai.net/view.html · standard publication: https://github.com/cypherpunk4096/sentiment · the in-house Bitcoin rainbow: https://luv.pythai.net/rainbow.html

---

## Abstract

Market sentiment has migrated, over ninety years, from a rhetorical residual — Keynes's "animal spirits" — to a measured state variable with a mature instrument stack: surveys, derivatives-implied fear gauges, composite indices, and computational text analysis. This paper reviews that migration in three movements and extends it in a fourth. First, we reconstruct the theoretical quarrel that made sentiment measurable at all: the efficient-markets tradition that defined sentiment as noise destined for elimination, and the noise-trader and behavioral traditions that showed the noise is priced, persistent, and systematic. Second, we survey the modern measurement toolkit — from the Michigan surveys and the closed-end fund discount through the VIX, the Baker–Wurgler index, media- and search-based measures, and the practitioner Fear & Greed composites in equities and crypto — evaluating each instrument by what it actually observes. Third, we state the emotonomic turn: where the received literature treats sentiment as a distortion *of* value, an emotonomic system treats measured feeling as a constituent *of* value, and therefore requires instruments native to that claim. We formalize the gesture-based measures proposed by the emotonomics program (gesture velocity, resonance depth, emotional reciprocity), specify a composite sentiment instrument for an on-chain emotional economy, derive testable propositions, and answer the strongest objections, including Goodhart drift, reflexivity, and thin-market pathology. Fourth, we read the program against the long human record — the anthropology of the gift, the sociology of collective emotion, and the psychology of the bond, across cultures and timelines — showing that communities have always kept emotional ledgers, and we close on a horizon: the knowledge economy, where the ledger of feeling meets the ledger of understanding.

---

## I. The Problem: A Variable Everyone Prices and No One Owns

Every practitioner believes markets have moods; the discipline spent half a century deciding whether that belief was respectable. The difficulty was never whether investors feel — it was whether feeling is *measurable before the fact* and *priced after it*. A variable that cannot be observed independently of the prices it is invoked to explain is not an explanation; it is a name for the residual. The history of sentiment research is the history of escaping that circularity: finding observables — survey answers, fund discounts, option premia, word frequencies, search queries, now on-chain acts — that proxy the collective emotional state *without* being mere restatements of the price.

The stakes of the escape are doctrinal. If sentiment is measurable and predictive, then the strict form of market efficiency fails not at the margins but at the mechanism: prices would embed a component that is neither fundamental news nor rational risk premium, and that component would be forecastable from psychological data. This is precisely what the modern measurement literature claims to have found (Baker and Wurgler 2006; Tetlock 2007; Da, Engelberg, and Gao 2015). The instruments came first as curiosities and became, cumulatively, an argument.

This paper has a second purpose beyond review. The emotonomics program (EMOTONOMICS.md) advances a stronger thesis than behavioral finance ever did: not that emotion *distorts* value, but that in a designed economic system emotion can be the *primary unit* of value — "attention is capital, gestures are currency, impact is profit." If that thesis is taken seriously, the sentiment-measurement toolkit changes role: it stops being a diagnostic of mispricing and becomes the system's national accounts. Section IV asks what instruments such a system requires, and builds them from the received literature rather than from slogans.

**Definitions.** Throughout, *sentiment* denotes the aggregate, time-varying disposition of market participants toward risk-bearing in an asset or asset class, insofar as that disposition is not reducible to changes in objective fundamentals. An *instrument* is any procedure producing a time series intended to proxy sentiment. An instrument is *direct* if it elicits stated beliefs (surveys), *revealed* if it infers disposition from costly behavior (flows, option purchases, on-chain transfers), and *expressive* if it infers disposition from communicative behavior (news text, social posts, search queries). This trichotomy — stated, revealed, expressed — organizes Section III.

---

## II. The Quarrel That Made Sentiment Measurable

### II.1 The classical inheritance

The word itself is older than the discipline. Adam Smith's first book was a *Theory of Moral Sentiments* (1759), and its central mechanism — sympathy, the fellow-feeling by which we internalize the judgments of an imagined impartial spectator — is recognizably a theory of socially transmitted evaluation. The crowd-pathology literature of the nineteenth century supplied the negative pole: Mackay's *Extraordinary Popular Delusions and the Madness of Crowds* (1841) fixed the genre of the mania narrative, and Kindleberger's *Manias, Panics, and Crashes* (1978) later gave it an analytic skeleton (displacement, credit expansion, euphoria, distress, revulsion) that reads today as a stage theory of sentiment.

The canonical modern source is Keynes. Chapter 12 of the *General Theory* (1936) makes two distinct claims that the later literature often merges. The first is motivational: long-term expectation cannot be grounded in calculation alone, so enterprise depends on "animal spirits — a spontaneous urge to action rather than inaction." The second is structural: under separation of ownership and trading, professional investors are driven to anticipate "what average opinion expects the average opinion to be" — the beauty-contest recursion — so that valuation becomes a convention sustained by confidence and vulnerable to it. Note what Keynes did *not* supply: any instrument. Animal spirits entered the discipline as an unmeasured residual, which is why the subsequent efficiency counterattack could dismiss them as a name for ignorance. The rehabilitation of the concept as a *measured* macro variable is recent (Akerlof and Shiller 2009).

### II.2 The efficiency tradition, steelmanned

The efficient-markets school deserves its strongest statement, because the measurement literature exists to answer it. The argument is not that investors are rational; it is that markets are disciplined. Friedman (1953) supplied the selection mechanism: traders who misprice lose money to those who do not, so destabilizing speculation self-liquidates. Fama (1970) supplied the definitional apparatus — weak, semi-strong, and strong form efficiency — and an empirical program in which prices "fully reflect" available information. On this view sentiment may exist as psychology but cannot persist as pricing: any emotional displacement of price from value is an arbitrage opportunity, and arbitrage is the immune system.

The steelman matters because it makes a testable claim about *instruments*: any purported sentiment measure should have no forecasting power for returns beyond risk. The school's later concession was partial and disciplined — even Black (1986), in his presidential address "Noise," accepted that noise trading is pervasive and indeed *constitutive* of liquidity ("noise makes trading in financial markets possible"), while retaining the faith that price wanders within a factor-of-two band around value. The efficiency tradition, in other words, predicted that the sentiment-measurement program would find nothing. That prediction failed in a specific and instructive way.

### II.3 The noise-trader and limits-of-arbitrage answer

The theoretical answer arrived as a model, not a manifesto. De Long, Shleifer, Summers, and Waldmann (1990) formalized an economy in which noise traders with stochastic, correlated misperceptions trade against rational arbitrageurs with finite horizons. The result overturns Friedman's selection argument: because noise-trader sentiment is itself a source of risk ("noise trader risk"), arbitrageurs bearing it demand compensation, mispricing persists, and — the deepest cut — noise traders can earn *higher* expected returns than their rational counterparts by loading on the very risk they create. Sentiment is no longer an error awaiting correction; it is a priced factor.

Shleifer and Vishny (1997) completed the argument institutionally: real-world arbitrage is delegated, capital-constrained, and evaluated on short horizons, so it is weakest precisely when mispricing is widest — performance-based fund flows force liquidation into deepening dislocation. Behavioral micro-foundations were supplied in parallel: prospect theory's loss-averse value function and probability weighting (Kahneman and Tversky 1979) explained *why* misperception is systematic rather than idiosyncratic, and Barberis, Shleifer, and Vishny (1998) modeled investor sentiment as a regime-switching belief process generating both underreaction and overreaction. Shiller's excess-volatility finding (1981) — price variance far exceeding the variance of subsequent dividend realizations — had already shown there was something to explain; *Irrational Exuberance* (2000) named the ambient state.

The dialectical outcome is precise: efficiency theory demanded that sentiment be unmeasurable or unpriced; noise-trader theory predicted it would be measurable, persistent, and priced, with its strongest effects in assets that are hard to value and hard to arbitrage. That conditional — *sentiment bites hardest where valuation is most subjective and arbitrage most limited* — is the single most confirmed regularity in the measurement literature (Baker and Wurgler 2006), and it should be kept in view throughout what follows, because a young, thinly-traded, reflexively-narrated crypto asset is the limiting case of both conditions.

---

## III. The Instrument Stack: How Feeling Is Measured

We organize the toolkit by what each instrument observes — stated, revealed, or expressed disposition — and close with the composites that fuse them.

### III.1 Stated sentiment: surveys

The oldest instruments simply ask. George Katona's program at Michigan, begun in the 1940s and systematized in his *Psychological Economics* (1975), established that consumer confidence could be elicited, indexed, and used as a leading indicator; the University of Michigan Surveys of Consumers remain the canonical macro-sentiment series. In markets proper, the American Association of Individual Investors (AAII) has polled its members weekly since 1987 (bullish / bearish / neutral on six-month equity prospects), and Investors Intelligence has classified newsletter writers as bulls or bears since the 1960s — a series whose enduring use is *contrarian*: extreme stated bullishness historically precedes weak returns, an observation consistent with the noise-trader model in which surveyed enthusiasm proxies the sentiment factor near its peak.

Survey instruments have a clean epistemology (they measure beliefs directly) and two known pathologies: stated beliefs are cheap (no position backs the answer), and panels are unrepresentative. Their persistence in the stack owes to the first property — they are the only instruments that observe *expectation* rather than its consequences.

### III.2 Revealed sentiment: prices of fear and flows of hope

The second family infers disposition from costly action.

**The closed-end fund discount.** Zweig (1973) proposed, and Lee, Shleifer, and Thaler (1991) canonized, the discount of closed-end fund prices to their net asset values as an index of individual-investor sentiment: the same assets, wrapped for retail, price differently as retail mood swings — and the discount comoves across funds and with small-stock returns, exactly as a systematic sentiment factor requires.

**Derivatives-implied fear.** The CBOE Volatility Index (VIX), constructed from S&P index option premia, measures the market price of near-term expected volatility. Whaley (2000) christened it "the investor fear gauge," and the name captured the epistemics: because equity index puts are the canonical insurance instrument, their implied volatility embeds the *price* participants will pay to shed downside — fear made numerical, in dollars, continuously. The put–call volume ratio serves the same logic more coarsely. These are the purest revealed-preference sentiment instruments in existence: no one buys portfolio insurance rhetorically.

**Flows, issuance, and liquidity.** Baker and Stein (2004) read unusual market liquidity itself as a sentiment index (overconfident investors trade more, and their presence lowers the price impact of trades); equity issuance timing — firms selling shares when sentiment is rich — supplies a corporate-side revelation of the same state.

### III.3 Expressed sentiment: the computational turn

The third family, dominant since the mid-2000s, mines communicative exhaust.

Antweiler and Frank (2004), studying millions of internet stock-message-board posts, gave the field its founding result and its founding caution: message activity predicts volatility, while return predictability, though statistically present, is economically small — talk is not *just* noise, but neither is it a money pump. Tetlock (2007) moved to mass media, showing that pessimistic word counts in a daily *Wall Street Journal* column predict downward pressure on prices followed by reversion — the signature of sentiment rather than information. Loughran and McDonald (2011) supplied the essential instrumentation lesson: general-purpose sentiment dictionaries misclassify finance text wholesale (in 10-K filings, words like "liability" or "cost" are operational, not negative), so domain-specific lexica are a validity requirement, not a refinement.

Two extensions define the modern frontier. Bollen, Mao, and Zeng (2011) claimed that Twitter mood dimensions (notably a "calmness" factor) improve directional forecasts of the Dow — the paper that licensed a decade of social-media sentiment engineering. Da, Engelberg, and Gao (2015) built FEARS — Financial and Economic Attitudes Revealed by Search — from the frequency of household Google queries such as "recession" and "bankruptcy," showing that search-revealed anxiety predicts short-horizon return reversals, volatility, and fund flows. Search data occupy a privileged epistemic position: queries are *private* expressive acts, free of the performative distortion that infects public posting. Garcia (2013), analyzing a century of New York Times financial text, added the state-dependence result: the return-predictive content of sentiment concentrates in recessions — feeling matters most when times are bad. The transformer era has industrialized the pipeline — FinBERT (Araci 2019) fine-tunes pre-trained language models on financial text, and Lopez-Lira and Tang (2023) report that general-purpose large language models score headline sentiment with economically meaningful predictive content — but the Loughran–McDonald lesson still governs: validity lives in the domain fit, not the model size.

### III.4 The composite instruments: Fear & Greed

Practitioners fused the families into dashboards, and the fusions became the most-consulted sentiment instruments in the world.

**The CNN Fear & Greed Index** (CNN Business, ongoing) compresses seven revealed-preference components into a 0–100 dial — from extreme fear to extreme greed. Its inputs are instructive precisely because no survey appears among them: equity momentum against a moving-average benchmark; the breadth of new 52-week highs versus lows; advancing-versus-declining volume; the put–call ratio; junk-bond demand measured as the spread of high-yield over investment-grade debt; the VIX against its own recent history; and safe-haven demand measured as the relative performance of stocks versus Treasuries. Each is a price or flow — fear and greed inferred entirely from what capital *does*. Methodologically the index is a normalization-and-average heuristic, not an estimated factor model; its value is communicative. It converts the Keynesian confidence state into a single public number, and in doing so becomes part of the state it measures — a reflexivity we return to in Section VII.

**The Crypto Fear & Greed Index** (Alternative.me, ongoing) transplants the design to Bitcoin-centric markets, blending realized volatility against recent baselines, market momentum and volume, social-media activity rates, Bitcoin's dominance share of total crypto capitalization, and search-trend data into the same 0–100 scale. The transplant quietly concedes the expressive turn: where CNN's equity dial uses only market internals, the crypto dial reserves substantial weight for social and search signals — an acknowledgment that in a retail-dominated, narrative-driven, 24/7 market, the conversation *is* a market internal. The crypto index's canonical use is contrarian ("extreme fear" as accumulation signal), which is the Investors Intelligence logic reborn on-chain.

The composites teach three design lessons for any new sentiment instrument: (i) diversify across stated/revealed/expressed families, because each fails differently; (ii) normalize each component against its own history, because sentiment is a *state relative to baseline*, not a level; (iii) publish a single legible number, because an instrument that participants can see becomes a coordination device — for better and for worse.

---

## IV. The Emotonomic Turn: From Distortion to Denomination

### IV.1 The inversion stated

Everything above shares one premise: there exists a fundamental value, and sentiment is a deviation from it — measurable, priced, exploitable, but parasitic on a value defined elsewhere. The emotonomics program (EMOTONOMICS.md) inverts the premise. In an emotonomic system, the emotional transaction is not the noise around the signal; it is the signal. Value is *constituted* by attention, gestures, and impact — "the wealth of a community is measured by engagement velocity, not idle balances." This is a normative-design claim, not a positive-empirical one, and we flag it as such: it does not assert that existing markets price feeling correctly, but that a system can be *built* whose unit of account is a recorded act of feeling.

The claim has a respectable lineage it should own explicitly. It radicalizes Keynes's convention theory (if valuation is a confidence convention anyway, engineer the convention deliberately and benevolently); it operationalizes Smith's sympathy (the impartial spectator becomes a public ledger of gestures); and it accepts the noise-trader result at full strength (sentiment is priced and persistent) while refusing the pejorative — in De Long et al.'s economy the noise traders are the pathology, whereas in an emotonomic economy the "noise" — the human warmth in the channel — is the payload.

**Definitions (from the emotonomics program, formalized).** A *gesture* g is an on-chain transfer carrying emotional intent from sender to receiver, logged with timestamp and optional context (the *Proof of Gesture* ledger). An *attention event* is a verified engagement act (view, share, post, interaction) bound to an identity. *Impact* is the downstream engagement causally attributable to a gesture. The SHAMBA LUV implementation gives these teeth: a fixed 111-quadrillion supply; a 3% reflection fee that redistributes every trade to all holders (a structural *reward for holding* — "LUV grows when you hold LUV"); an IncentiveDistributor contract paying denominated rewards for verified attention acts; and standardized gesture denominations (10⁹ LUV — "some LUV," the standard gesture; 10¹¹ — "a lot of LUV"; 10¹² — one trillion, "a million millions," the *measure of value*).

### IV.2 Native instruments

An economy denominated in feeling requires sentiment instruments in the *national-accounts* role, and the emotonomics program proposes five, which we formalize here (all are *proposed* instruments; none has yet a validated series):

**Gesture Velocity Index (GVI).** Let G(t) be the count of qualifying gestures in window t and H(t) the count of active holders. GVI(t) = G(t)/H(t): gestures per holder per period — the circulation rate of feeling, the emotonomic analogue of monetary velocity. Where classical velocity rises in panics (money fleeing), gesture velocity rises in *warmth*; its sign convention is inverted, which is the whole point.

**Community Resonance Depth (CRD).** For each seed gesture, the ledger permits reconstruction of the response cascade (reciprocal gestures, shares, downstream gestures among the receiver's counterparties). CRD is the mean cascade depth per seed gesture — a measure of how far feeling propagates, formally kin to reproduction numbers in diffusion models and to the cascade metrics of the social-media sentiment literature (Section III.3).

**Emotional ROI (eROI).** For identity i, eROI(i) = gestures received / gestures given over a window; the distribution of eROI across the network measures reciprocity health. A well-functioning emotonomic economy exhibits eROI concentrated near 1 with fat receiving-tails for public contributors — generosity capitalized as standing.

**sentiment.shift.** The level instruments above locate sentiment; *sentiment.shift* orients it: the first difference of the indicator vector over block-denominated time. The native clock is blocktime — block height rather than wall time, since the ledger's own tempo is the only clock every participant verifiably shares — normalized by average blocktime so shift magnitudes remain comparable across variations in network cadence. The instrument includes a responsiveness component, the *return-from-ping interval*: the number of blocks elapsed between an outreach event (a gesture, a drop, a call to the community) and the first returned gesture — measuring not how much the community appreciates but how quickly it answers when addressed. Level locates, shift orients, ping-return bounds attention latency; all three are enacted, block-stamped quantities, none a forecast.

**The LUVchart: price as a sentiment indicator.** The fifth instrument is the oldest one, relabeled honestly: the continuously-plotted price of SHAMBA LUV — the LUVchart — read *as revealed sentiment*. Section II established the theoretical warrant: in the noise-trader framework, price movements in an asset whose fundamentals are deliberately fixed (supply immutable at genesis, no mint, no burn schedule, no earnings) are dominated by the sentiment factor, and Baker and Stein (2004) supply the companion result that market liquidity itself indicates sentiment. LUV instantiates the limiting case: with fundamentals held constant by construction, the LUVchart approaches a *pure* sentiment series — every candle is the community's aggregate feeling about the gesture economy, priced. The chart is block-stamped at source, which makes it natively compatible with sentiment.shift: its first difference in normalized blocktime is the market-side shift reading.

To these ledger-native measures the live system adds market-side instruments already deployed on the SHAMBA LUV measurement stack (luv.pythai.net/view.html): the *single-line measure* (one trillion LUV priced continuously in USDC), interval percent-change fields duplicating the practitioner standard (5M/1H/6H/24H), and the *X multiplier* — price and liquidity expressed as multiples of the genesis seed, which was deliberately placed at the round point 10⁻¹⁷ ETH per LUV so that every subsequent multiplier is a direct read. The X multiplier deserves theoretical note: by fixing an arbitrary but *public and permanent* baseline, it converts price into a self-normalizing sentiment series — design lesson (ii) of Section III.4 implemented at genesis.

### IV.3 A LUV Fear & Greed composite (proposed)

Following the composite design lessons, we specify a seven-component LUV sentiment dial, each component normalized against its trailing distribution and averaged to a 0–100 scale from *fear* (hoarding, silence, exit) to — the emotonomic relabeling matters — *LUV* (gesture, voice, entry):

1. **Momentum** — price versus its trailing mean (revealed; CNN component transplanted).
2. **24-hour change** — the live percent-change field (revealed).
3. **Liquidity multiplier trend** — growth of the pool's ETH leg from X (revealed; deepening liquidity is capital's confidence).
4. **Gesture velocity** — GVI against baseline (ledger-native revealed).
5. **Attention rate** — verified share/task submissions per period through the IncentiveDistributor rail (expressive, but *costly* — each act is identity-bound and reviewed, which mitigates the cheap-talk pathology of Section III.1).
6. **Holder growth and retention** — net new holders and the fraction not reducing balances (revealed; the "hold LUV" signal that the reflection mechanism structurally rewards).
7. **Reciprocity health** — median eROI drift (ledger-native).

Components 1–3 are implementable today from the existing minute-sampled market mirror; 4–7 await the Phase-3 attention rail. We label the composite *proposed*: its weights are undetermined, and Section VII explains why they should be estimated against outcomes rather than asserted.

---

## V. The Expressions of LUV: The Gift, the Ritual, and the Bond Across Cultures

The instruments of Section IV measure feeling in one ledger; this section asks what, in the long human record, they are instruments *of*. If emotonomics claims that recorded feeling constitutes value, the claim should be recognizable to the disciplines that have studied denominated feeling longest — anthropology (the gift), sociology (the ritual), psychology (the bond). We take each at its strongest, across cultures and timelines, and find the same result three times: **communities have always kept emotional ledgers; what is new is only the substrate.**

### V.1 The anthropological ledger: the gift as total social fact

Mauss's *Essai sur le don* (Mauss 1925) established that the gift is never free: it binds giver and receiver in a triple obligation — to give, to receive, to reciprocate — and the Maori *hau*, the spirit of the thing given, names the force that compels the return. A gift, in Mauss's reading, is an *entry in a social ledger*: the community remembers what was given, by whom, and what is owed. Malinowski's Trobriand ethnography (Malinowski 1922) supplied the canonical case: in the kula ring, armshells and necklaces circulate in opposite directions around an archipelago, and a valuable's worth *is* its circulation history — the named partners it has passed between, the renown it has gathered. Value as recorded provenance of relation, not use: the kula is a proof-of-gesture chain executed in canoes. The potlatch of the Pacific Northwest, which Mauss set beside it, denominates status by the magnitude of giving — wealth demonstrated, and rank settled, by expenditure toward the community. Gesture velocity is a potlatch statistic.

The later synthesis sharpened the accounting. Sahlins graded reciprocity by social distance — generalized reciprocity among kin, where accounts are kept loosely and settled never; balanced reciprocity among neighbors; negative reciprocity at the edge of the social world (Sahlins 1972). Bohannan showed that the Tiv ran *separate spheres* of exchange — subsistence, prestige, rights-in-persons — with conversion between spheres morally charged (Bohannan 1955): cultures do not merely use money, they *earmark* it. Polanyi's larger thesis holds that reciprocity and redistribution, not market exchange, organized most economies in history, and that markets are *embedded* in social relation (Polanyi 1944) — the 3% reflection, which redistributes every trade to all holders inside the transfer function itself, is redistribution re-embedded in the market's own plumbing. Graeber's history reads money itself as quantified obligation riding on a substrate of everyday mutual aid (Graeber 2011). And the stone money of Yap supplies the precedent for the substrate claim: the great rai discs rarely moved — ownership changed by communal agreement and communal memory, famously surviving even for a stone lost at sea (Furness 1910; Friedman 1991). Money was a distributed ledger of social consensus long before it was metal; the blockchain is Yap at planetary scale.

**The anthropological reading.** A gesture of LUV is a digitized *hau*: a transfer that carries obligation-free warmth but ledger-permanent memory. The chain remembers what the village remembered — who gave, to whom, and how the giving traveled.

### V.2 The sociological ledger: effervescence, ritual, and earmarked money

Durkheim located the sacred in *collective effervescence* — the emotional energy generated when a group assembles, which consecrates whatever symbol it touches (Durkheim 1912). Community Resonance Depth is effervescence with a cascade tree: the propagation of a seed gesture through reciprocal gestures is precisely the assembly's energy made traceable. Simmel, in *The Philosophy of Money*, defined money as a claim upon society — pure relation reified into a token (Simmel 1900); an emotonomic token makes the relation legible where conventional money anonymizes it. Collins's interaction-ritual theory is the strongest modern statement: *emotional energy is the common currency of social life*, sought across chains of encounters, and successful rituals charge symbols with sentiment (Collins 2004). Emotonomics takes Collins at his word and removes the metaphor: the currency of feeling is given a denomination, a settlement layer, and a market price.

The critical tradition must be faced rather than skipped. Hochschild documented what the commercialization of feeling does to feeling — emotional labor estranges the worker from her own affect (Hochschild 1983) — and Illouz traced the making of "emotional capitalism," in which intimacy adopts the language of exchange (Illouz 2007). This is the Goodhart objection in sociological dress, and the emotonomic answer must respect its force: the gesture differs from managed emotional labor in that no employer commands it — it is voluntary, peer-directed, and transparent in mechanism — but a system that *pays* for feeling walks the line Hochschild drew, and Section VII returns to it. Zelizer, finally, showed that people refuse money's fungibility in practice — earmarking gift money, blood money, pin money; keeping domestic monies in labeled jars (Zelizer 1994). The LUV denominations — the standard gesture, "a lot of LUV," the trillion as *a million millions* — are Zelizer's jars designed in: a currency that arrives pre-earmarked for feeling.

### V.3 The psychological ledger: the bond, reciprocity, and broaden-and-build

Attachment theory established that the bond is a primary need, not a derivative of provisioning (Bowlby 1969); Sternberg's triangular theory decomposes love into intimacy, passion, and commitment (Sternberg 1986) — and it is worth noting that commitment, the deliberate, time-extended component, is the one a reflection token structurally rewards: holding is commitment with a yield. Fredrickson's broaden-and-build research shows positive emotions widening thought-action repertoires and compounding into durable social resources (Fredrickson 2001), and her later account defines love itself as *micro-moments of positivity resonance* — small, frequent, reciprocal (Fredrickson 2013). That is the psychological case for denominating warmth in small frequent gestures rather than grand transfers: the standard gesture is a micro-moment with a block number.

Reciprocity, the hinge of every instrument in Section IV, has its own convergent literature: a universal moral norm (Gouldner 1960), an evolved strategy (Trivers 1971), an *enforced* equilibrium — humans pay their own resources to punish non-reciprocators (Fehr & Gächter 2002) — and, in Nowak's synthesis, a mechanism (indirect reciprocity) that scales only where reputation exists: cooperation at scale needs gossip, and gossip needs a record (Nowak 2006). Dunbar's account of language as social grooming at scale completes the arc (Dunbar 1996). The eROI distribution is that record made native: reciprocity health published as a statistic rather than carried in the village's working memory.

### V.4 The lexicon: LUV across cultures and timelines

Languages denominate love more finely than English ever has. Greek divided it four ways — agape, philia, eros, storge (Lewis 1960). The Buddhist mettā tradition treats loving-kindness as a *practice* — feeling deliberately cultivated, which is to say mintable. The Confucian ren 仁, the master virtue of the *Analects*, exists only between persons — the character itself is "person" beside "two." Chinese renqing keeps the explicit social accounting of favor and obligation that everyone honors and no one calls accounting; Japanese amae names the sweetness of permitted dependence (Doi 1971), while giri and on grade obligation so precisely that Benedict's informants called giri "hardest to bear" (Benedict 1946). Southern Africa's ubuntu — *a person is a person through other persons* (Tutu 1999) — states the emotonomic axiom in a single phrase: the unit of value is the relation. Across every case and every century the pattern repeats: **cultures that take feeling seriously give it denominations, registers, and settlement rules.** The LUV ladder — 1 LUV exact and fee-free between persons, the standard gesture, the trillion as a million millions — is a designed lexicon in this lineage: not the first vocabulary of denominated feeling, only the first with 18-decimal settlement.

### V.5 The knowledge-economy horizon (a hint)

One movement remains, and we state it only as a horizon, labeled speculative. The arc that made feeling measurable ran earlier, and further, for *knowledge*: Hayek made dispersed knowledge the central economic problem (Hayek 1945); Machlup counted the knowledge industries (Machlup 1962); Drucker named the knowledge worker (Drucker 1969); Bell the post-industrial society (Bell 1973); and Marx's *Grundrisse* foresaw production organized by the "general intellect" (Marx 1857–58). Emotonomics prices recorded attention; a knowledge economy prices recorded understanding — and the two ledgers want to meet, with gestures flowing to the agents, human and machine, whose knowledge earns them. That meeting is being engineered in an adjacent program — the knowledge-economy documents at https://mindx.pythai.net/docs — and deserves a treatise of its own. Here it is a hint, not a result.

---

## VI. Testable Propositions

The emotonomic framework earns scientific standing only if it risks falsification. We state five propositions, ordered from established-literature replications to native claims:

**P1 (Sentiment susceptibility).** As a hard-to-value, limits-to-arbitrage asset, LUV's price series will show sentiment-factor loadings at the extreme of the Baker–Wurgler conditional: return reversals following expressed-sentiment spikes, strongest at short horizons. (Replication of Tetlock 2007 / Da et al. 2015 dynamics in-protocol.)

**P2 (Gesture velocity leads price).** If gestures constitute value rather than merely celebrating it, GVI should *lead* market-side measures (price, liquidity growth) rather than lag them; Granger-style precedence tests on the Proof of Gesture ledger against the minute-sampled price series are directly computable.

**P3 (Reflection retention).** Holders' effective yield from the 3% reflection stream should predict retention (non-selling) beyond price momentum — the structural "hold to earn" incentive should be separable from bandwagon holding.

**P4 (Contrarian dial).** Extreme readings of the LUV composite should exhibit the same contrarian asymmetry documented for the crypto Fear & Greed index: fear extremes preceding above-median forward returns more reliably than greed extremes precede below-median ones (Garcia's 2013 state-dependence transplanted: sentiment information concentrates in the fear tail).

**P5 (Reciprocity stability).** Networks with eROI distributions concentrated near unity will exhibit lower participant churn than reward-equivalent networks with skewed reciprocity — the claim that *measured mutuality*, not payout size, is the retention variable. This is the distinctively emotonomic prediction; the incentive-design literature does not make it.

---

## VII. Objections Answered

**Goodhart drift.** The gravest objection: any measure adopted as a target ceases to be a good measure (Goodhart 1975; Strathern's 1997 formulation — "when a measure becomes a target, it ceases to be a good measure" — is the canonical phrasing). An economy that *pays* for attention acts invites their simulation; sentiment instruments built on paid acts risk measuring the payment, not the feeling. The answer is architectural, not rhetorical: the SHAMBA LUV attention rail is identity-bound (social-gated, Sybil-resistant by construction), human-reviewed before payout, on-chain deduplicated per act, and denominated in fixed amounts — friction deliberately retained so that the marginal fabricated gesture costs more than it yields. This mitigates but does not dissolve the objection; the honest position is that ledger-native components (4–7) must be continuously re-validated against components (1–3) that cannot be farmed, and weights re-estimated when divergence appears.

**Reflexivity.** Soros (1987) argued that market participants' biased perceptions alter the fundamentals those perceptions concern, in self-reinforcing loops. A published sentiment dial participates in the loop it measures — CNN's dial plausibly *coordinates* the fear it reports. The emotonomic response is to accept reflexivity as the design substrate rather than a contamination: a system whose value is constituted by collective feeling is *deliberately* reflexive, and the ethical burden shifts to transparency of mechanism (open source, on-chain verifiability, published methodology) so the loop is legible to those inside it.

**Thin-market pathology.** A young pool can print spectacular sentiment numbers on trivial flow — the live system itself recorded a >600% daily move on a handful of buys against a fractional-ETH pool. Raw price-derived components are therefore untrustworthy precisely when the asset is young, which is when enthusiasm peaks. This is why the proposed composite carries liquidity depth as a first-class component and why the X multiplier reports price and liquidity *separately*: a price multiple unaccompanied by a liquidity multiple is flagged by construction as fragile. The measurement stack, to its credit, already displays both.

**The category objection.** A skeptic may grant every measurement and deny the inversion: perhaps attention and gestures are measurable, but calling them "value" is definitional fiat. We concede the positive/normative line: emotonomics is a design program, and its value claim is performative — true if, and insofar as, a community sustains the convention. But this is exactly Keynes's account of *all* valuation under uncertainty; the emotonomic system differs from the equity market not in resting on convention but in saying so on the label.

---

## VIII. Conclusion

Sentiment research began as an insult ("animal spirits"), matured into a factor, and industrialized into an instrument stack: surveys that ask, derivatives that price fear in dollars, texts and searches that betray mood at scale, and composites — Fear & Greed foremost — that compress the state of collective feeling into one public number. The emotonomic turn takes the final step the literature prepared but never took: if feeling is measurable, persistent, and priced, a system may be built that denominates value in it deliberately. The instruments proposed here — gesture velocity, resonance depth, reciprocity health, and a seven-component LUV composite anchored by a genesis-fixed baseline — are that step's engineering documents. Their scientific fate rests on Propositions P1–P5, and the program should want it that way: a measure of feeling that fears no measurement of itself.

---

## References

- Akerlof, George A., and Robert J. Shiller. 2009. *Animal Spirits: How Human Psychology Drives the Economy, and Why It Matters for Global Capitalism*. Princeton: Princeton University Press. https://en.wikipedia.org/wiki/Animal_Spirits_(book)
- Alternative.me. Ongoing. "Crypto Fear & Greed Index." Published methodology: volatility, market momentum/volume, social media, Bitcoin dominance, and search-trend components. https://alternative.me/crypto/fear-and-greed-index/
- Antweiler, Werner, and Murray Z. Frank. 2004. "Is All That Talk Just Noise? The Information Content of Internet Stock Message Boards." *Journal of Finance* 59(3): 1259–1294. https://doi.org/10.1111/j.1540-6261.2004.00662.x
- Araci, Dogu. 2019. "FinBERT: Financial Sentiment Analysis with Pre-trained Language Models." arXiv:1908.10063. https://arxiv.org/abs/1908.10063
- Baker, Malcolm, and Jeremy C. Stein. 2004. "Market Liquidity as a Sentiment Indicator." *Journal of Financial Markets* 7(3): 271–299. https://doi.org/10.1016/j.finmar.2003.11.005
- Baker, Malcolm, and Jeffrey Wurgler. 2006. "Investor Sentiment and the Cross-Section of Stock Returns." *Journal of Finance* 61(4): 1645–1680. https://doi.org/10.1111/j.1540-6261.2006.00885.x
- Baker, Malcolm, and Jeffrey Wurgler. 2007. "Investor Sentiment in the Stock Market." *Journal of Economic Perspectives* 21(2): 129–152. https://doi.org/10.1257/jep.21.2.129
- Barberis, Nicholas, Andrei Shleifer, and Robert Vishny. 1998. "A Model of Investor Sentiment." *Journal of Financial Economics* 49(3): 307–343. https://doi.org/10.1016/S0304-405X(98)00027-0
- Bell, Daniel. 1973. *The Coming of Post-Industrial Society*. New York: Basic Books. https://scholar.google.com/scholar?q=The%20Coming%20of%20Post-Industrial%20Society
- Benedict, Ruth. 1946. *The Chrysanthemum and the Sword*. Boston: Houghton Mifflin. https://en.wikipedia.org/wiki/The_Chrysanthemum_and_the_Sword
- Black, Fischer. 1986. "Noise." *Journal of Finance* 41(3): 529–543. https://doi.org/10.1111/j.1540-6261.1986.tb04513.x
- Bohannan, Paul. 1955. "Some Principles of Exchange and Investment among the Tiv." *American Anthropologist* 57(1): 60–70. https://doi.org/10.1525/aa.1955.57.1.02a00080
- Bollen, Johan, Huina Mao, and Xiaojun Zeng. 2011. "Twitter Mood Predicts the Stock Market." *Journal of Computational Science* 2(1): 1–8. https://doi.org/10.1016/j.jocs.2010.12.007
- Bowlby, John. 1969. *Attachment and Loss, Vol. 1: Attachment*. New York: Basic Books. https://scholar.google.com/scholar?q=Attachment%20and%20Loss%20Bowlby
- CNN Business. Ongoing. "Fear & Greed Index." Published methodology: market momentum, stock price strength, stock price breadth, put/call ratio, junk bond demand, market volatility (VIX), safe-haven demand. https://www.cnn.com/markets/fear-and-greed
- Collins, Randall. 2004. *Interaction Ritual Chains*. Princeton: Princeton University Press. https://scholar.google.com/scholar?q=Interaction%20Ritual%20Chains%20Collins
- Da, Zhi, Joseph Engelberg, and Pengjie Gao. 2015. "The Sum of All FEARS: Investor Sentiment and Asset Prices." *Review of Financial Studies* 28(1): 1–32. https://doi.org/10.1093/rfs/hhu072
- De Long, J. Bradford, Andrei Shleifer, Lawrence H. Summers, and Robert J. Waldmann. 1990. "Noise Trader Risk in Financial Markets." *Journal of Political Economy* 98(4): 703–738. https://doi.org/10.1086/261703
- Doi, Takeo. 1971. *The Anatomy of Dependence*. Tokyo: Kodansha International (English translation 1973). https://en.wikipedia.org/wiki/The_Anatomy_of_Dependence
- Drucker, Peter F. 1969. *The Age of Discontinuity*. New York: Harper & Row. https://scholar.google.com/scholar?q=The%20Age%20of%20Discontinuity%20Drucker
- Dunbar, Robin I. M. 1996. *Grooming, Gossip, and the Evolution of Language*. Cambridge, MA: Harvard University Press. https://en.wikipedia.org/wiki/Grooming,_Gossip_and_the_Evolution_of_Language
- Durkheim, Émile. 1912. *The Elementary Forms of Religious Life*. Paris: F. Alcan. https://en.wikipedia.org/wiki/The_Elementary_Forms_of_the_Religious_Life
- Fama, Eugene F. 1970. "Efficient Capital Markets: A Review of Theory and Empirical Work." *Journal of Finance* 25(2): 383–417. https://doi.org/10.2307/2325486
- Fehr, Ernst, and Simon Gächter. 2002. "Altruistic Punishment in Humans." *Nature* 415: 137–140. https://doi.org/10.1038/415137a
- Fredrickson, Barbara L. 2001. "The Role of Positive Emotions in Positive Psychology: The Broaden-and-Build Theory of Positive Emotions." *American Psychologist* 56(3): 218–226. https://doi.org/10.1037/0003-066X.56.3.218
- Fredrickson, Barbara L. 2013. *Love 2.0: How Our Supreme Emotion Affects Everything We Feel, Think, Do, and Become*. New York: Hudson Street Press. https://scholar.google.com/scholar?q=Love%202.0%20Fredrickson
- Friedman, Milton. 1953. "The Case for Flexible Exchange Rates." In *Essays in Positive Economics*. Chicago: University of Chicago Press. https://en.wikipedia.org/wiki/Essays_in_Positive_Economics
- Friedman, Milton. 1991. "The Island of Stone Money." Hoover Institution Working Papers in Economics E-91-3. https://scholar.google.com/scholar?q=The%20Island%20of%20Stone%20Money%20Friedman%201991
- Furness, William Henry. 1910. *The Island of Stone Money: Uap of the Carolines*. Philadelphia: J. B. Lippincott. https://scholar.google.com/scholar?q=The%20Island%20of%20Stone%20Money%20Furness%201910
- Garcia, Diego. 2013. "Sentiment during Recessions." *Journal of Finance* 68(3): 1267–1300. https://doi.org/10.1111/jofi.12027
- Goodhart, Charles A. E. 1975. "Problems of Monetary Management: The U.K. Experience." In *Papers in Monetary Economics*, vol. I. Sydney: Reserve Bank of Australia. https://en.wikipedia.org/wiki/Goodhart%27s_law
- Gouldner, Alvin W. 1960. "The Norm of Reciprocity: A Preliminary Statement." *American Sociological Review* 25(2): 161–178. https://doi.org/10.2307/2092623
- Graeber, David. 2011. *Debt: The First 5,000 Years*. New York: Melville House. https://en.wikipedia.org/wiki/Debt:_The_First_5000_Years
- Hayek, Friedrich A. 1945. "The Use of Knowledge in Society." *American Economic Review* 35(4): 519–530. https://en.wikipedia.org/wiki/The_Use_of_Knowledge_in_Society
- Hochschild, Arlie Russell. 1983. *The Managed Heart: Commercialization of Human Feeling*. Berkeley: University of California Press. https://en.wikipedia.org/wiki/The_Managed_Heart
- Illouz, Eva. 2007. *Cold Intimacies: The Making of Emotional Capitalism*. Cambridge: Polity. https://scholar.google.com/scholar?q=Cold%20Intimacies%20Illouz%20emotional%20capitalism
- Kahneman, Daniel, and Amos Tversky. 1979. "Prospect Theory: An Analysis of Decision under Risk." *Econometrica* 47(2): 263–291. https://doi.org/10.2307/1914185
- Katona, George. 1975. *Psychological Economics*. New York: Elsevier. https://scholar.google.com/scholar?q=Psychological%20Economics%20Katona%201975
- Keynes, John Maynard. 1936. *The General Theory of Employment, Interest and Money*. London: Macmillan. (Ch. 12, "The State of Long-Term Expectation.") https://en.wikipedia.org/wiki/The_General_Theory_of_Employment,_Interest_and_Money
- Kindleberger, Charles P. 1978. *Manias, Panics, and Crashes: A History of Financial Crises*. New York: Basic Books. https://scholar.google.com/scholar?q=Manias+Panics+and+Crashes+Kindleberger
- Lee, Charles M. C., Andrei Shleifer, and Richard H. Thaler. 1991. "Investor Sentiment and the Closed-End Fund Puzzle." *Journal of Finance* 46(1): 75–109. https://doi.org/10.1111/j.1540-6261.1991.tb03746.x
- Lewis, C. S. 1960. *The Four Loves*. London: Geoffrey Bles. https://en.wikipedia.org/wiki/The_Four_Loves
- Lopez-Lira, Alejandro, and Yuehua Tang. 2023. "Can ChatGPT Forecast Stock Price Movements? Return Predictability and Large Language Models." arXiv:2304.07619. https://arxiv.org/abs/2304.07619
- Loughran, Tim, and Bill McDonald. 2011. "When Is a Liability Not a Liability? Textual Analysis, Dictionaries, and 10-Ks." *Journal of Finance* 66(1): 35–65. https://doi.org/10.1111/j.1540-6261.2010.01625.x
- Machlup, Fritz. 1962. *The Production and Distribution of Knowledge in the United States*. Princeton: Princeton University Press. https://scholar.google.com/scholar?q=The%20Production%20and%20Distribution%20of%20Knowledge%20in%20the%20United%20States%20Machlup
- Mackay, Charles. 1841. *Extraordinary Popular Delusions and the Madness of Crowds*. London: Richard Bentley. https://en.wikipedia.org/wiki/Extraordinary_Popular_Delusions_and_the_Madness_of_Crowds
- Malinowski, Bronisław. 1922. *Argonauts of the Western Pacific*. London: Routledge & Kegan Paul. https://en.wikipedia.org/wiki/Argonauts_of_the_Western_Pacific
- Marx, Karl. 1857–58. *Grundrisse* (the "Fragment on Machines"; English translation, Penguin, 1973). https://www.marxists.org/archive/marx/works/1857/grundrisse/
- Mauss, Marcel. 1925. *Essai sur le don* ("The Gift"). *L'Année Sociologique*. https://en.wikipedia.org/wiki/The_Gift_(essay)
- Nowak, Martin A. 2006. "Five Rules for the Evolution of Cooperation." *Science* 314(5805): 1560–1563. https://doi.org/10.1126/science.1133755
- Polanyi, Karl. 1944. *The Great Transformation*. New York: Farrar & Rinehart. https://en.wikipedia.org/wiki/The_Great_Transformation_(book)
- Sahlins, Marshall. 1972. *Stone Age Economics*. Chicago: Aldine-Atherton. https://scholar.google.com/scholar?q=Stone%20Age%20Economics%20Sahlins
- Shiller, Robert J. 1981. "Do Stock Prices Move Too Much to Be Justified by Subsequent Changes in Dividends?" *American Economic Review* 71(3): 421–436. https://scholar.google.com/scholar?q=Do%20Stock%20Prices%20Move%20Too%20Much%20to%20Be%20Justified%20by%20Subsequent%20Changes%20in%20Dividends
- Shiller, Robert J. 2000. *Irrational Exuberance*. Princeton: Princeton University Press. https://en.wikipedia.org/wiki/Irrational_Exuberance_(book)
- Shleifer, Andrei, and Robert W. Vishny. 1997. "The Limits of Arbitrage." *Journal of Finance* 52(1): 35–55. https://doi.org/10.1111/j.1540-6261.1997.tb03807.x
- Simmel, Georg. 1900. *The Philosophy of Money* (*Philosophie des Geldes*). Leipzig: Duncker & Humblot. https://en.wikipedia.org/wiki/The_Philosophy_of_Money
- Smith, Adam. 1759. *The Theory of Moral Sentiments*. London: A. Millar. https://en.wikipedia.org/wiki/The_Theory_of_Moral_Sentiments
- Soros, George. 1987. *The Alchemy of Finance: Reading the Mind of the Market*. New York: Simon & Schuster. https://en.wikipedia.org/wiki/The_Alchemy_of_Finance
- Sternberg, Robert J. 1986. "A Triangular Theory of Love." *Psychological Review* 93(2): 119–135. https://doi.org/10.1037/0033-295X.93.2.119
- Strathern, Marilyn. 1997. "'Improving Ratings': Audit in the British University System." *European Review* 5(3): 305–321. https://scholar.google.com/scholar?q=Improving%20Ratings%20audit%20British%20university%20system%20Strathern
- Tetlock, Paul C. 2007. "Giving Content to Investor Sentiment: The Role of Media in the Stock Market." *Journal of Finance* 62(3): 1139–1168. https://doi.org/10.1111/j.1540-6261.2007.01232.x
- Trivers, Robert L. 1971. "The Evolution of Reciprocal Altruism." *Quarterly Review of Biology* 46(1): 35–57. https://doi.org/10.1086/406755
- Tutu, Desmond. 1999. *No Future Without Forgiveness*. New York: Doubleday. https://scholar.google.com/scholar?q=No%20Future%20Without%20Forgiveness%20Tutu
- Whaley, Robert E. 2000. "The Investor Fear Gauge." *Journal of Portfolio Management* 26(3): 12–17. https://doi.org/10.3905/jpm.2000.319728
- Zelizer, Viviana A. 1994. *The Social Meaning of Money*. New York: Basic Books. https://scholar.google.com/scholar?q=The%20Social%20Meaning%20of%20Money%20Zelizer
- Zweig, Martin E. 1973. "An Investor Expectations Stock Price Predictive Model Using Closed-End Fund Premiums." *Journal of Finance* 28(1): 67–78. https://scholar.google.com/scholar?q=Zweig%20investor%20expectations%20closed-end%20fund%20premiums%201973

*Internal sources: EMOTONOMICS.md (the emotonomics whitepaper), LUVPAPER.md, LUV_LIVE_PROOF.md (the mainnet deployment record), and the live measurement stack at luv.pythai.net/view.html.*
