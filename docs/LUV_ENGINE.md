# The LUV Engine: An Engine from Emotonomics

*Frequency output from heart pulsation at 60 bpm — the pulse as attention's clock*

**Live web publication:** [luv.pythai.net/engine.html](https://luv.pythai.net/engine.html) · standard publication: [github.com/cypherpunk4096/engine](https://github.com/cypherpunk4096/engine)

<p align="center">
  <a href="https://app.uniswap.org/swap?chain=ethereum&amp;inputCurrency=0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48&amp;outputCurrency=0x2711111111683B8708cb9a48cBf36a51315F8254" title="Uniswap preset — USDC → LUV on Ethereum mainnet"><img src="https://luv.pythai.net/gfx/logo.png" alt="SHAMBA LUV — the gold binary heart" width="168" height="168"></a>
</p>
<p align="center">
  <b><a href="https://app.uniswap.org/swap?chain=ethereum&amp;inputCurrency=0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48&amp;outputCurrency=0x2711111111683B8708cb9a48cBf36a51315F8254">🦄 USDC → LUV — the pair is preset, the amount is yours ❤</a></b><br>
  <sub><a href="https://etherscan.io/token/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48">USDC <code>0xA0b8…eB48</code></a> ·
  <a href="https://etherscan.io/address/0x2711111111683B8708cb9a48cBf36a51315F8254#code">LUV <code>0x2711…8254</code> ✅ verified</a> ·
  <a href="https://app.uniswap.org/tokens/ethereum/0x2711111111683B8708cb9a48cBf36a51315F8254">token page</a> ·
  <a href="https://luv.pythai.net/view.html">live chart</a> ·
  set slippage ~8–12% (LUV carries a 5% reflection fee)</sub>
</p>

> Preface. Emotonomics defined the field (see *Emotonomics: An Extension of Economics
> for the Knowledge Economy*, published at
> [emotonomics.html](https://luv.pythai.net/emotonomics.html); the companion markdown
> sources live in [`SHAMBA-LUV/LUV/docs`](https://github.com/SHAMBA-LUV/LUV/tree/main/docs)).
> This document states what LUV builds **with** the field: an engine — not adopted from
> game middleware, not borrowed from a rendering tradition, but derived organ by organ
> from emotonomic axioms. Phase three of the protocol begins with the engine's first
> organ: the pulse. The analytic register here is academic; the protocol speaks elsewhere
> in its own voice (*sharing is caring*).

---

## Abstract

Software engines inherit their architecture from what they were built to move: physics
engines from mechanics, game engines from the render loop, financial engines from the
order book. This paper argues that an economy whose theory of value is grounded in
attention ([Simon 1971](https://gwern.net/doc/design/1971-simon.pdf);
[Goldhaber 1997](https://firstmonday.org/ojs/index.php/fm/article/view/519)) and priced
in emotion requires an engine derived from that theory rather than adapted from any of
these traditions — and that LUV is building one. We state the derivation rule (each
engine organ implements exactly one emotonomic commitment), present the first organ — a
cardiac oscillator emitting a frequency signal at 60 beats per minute, exactly 1 Hz,
phase-locked across every participant by chronos-corrected time — and position the design
in four lineages: Smith's sympathy as the ground of economic order
([Smith 1759](https://www.econlib.org/library/Smith/smMS.html)), entrainment and
collective rhythm as the physical form of social solidarity (Huygens's *espèce de
sympathie* of coupled pendulums,
[1665](https://www.dbnl.org/tekst/huyg003oeuv05_01/huyg003oeuv05_01_0141.php);
[Durkheim 1912](https://gallica.bnf.fr/ark:/12148/bpt6k14149475);
[McNeill 1995](https://www.hup.harvard.edu/books/9780674502307);
[Kuramoto 1984](https://doi.org/10.1007/978-3-642-69689-3)), the theory of the
digitization of value ([Simmel 1900](https://www.deutschestextarchiv.de/book/show/simmel_geld_1900);
[Terranova 2000](https://doi.org/10.1215/01642472-18-2_63-33);
[Arvidsson & Colleoni 2012](https://doi.org/10.1080/01972243.2012.669449)), and the
cypherpunk discipline of consent, custody, and verification
([Hughes 1993](https://www.activism.net/cypherpunk/manifesto.html);
[Nakamoto 2008](https://bitcoin.org/bitcoin.pdf)). We define the engine's verification
doctrine — a claim is *verified* if and only if it carries the green checkmark of
on-chain source verification — and state testable propositions.

---

## I. Why an economy needs an engine of its own

Every prior engine encodes the ontology of its source domain. The game engine's frame
loop encodes the primacy of the image; the matching engine's book encodes the primacy of
the order. An emotonomic economy has a different primitive: the **gesture** — attention
given, registered, and returned as value. The anthropology of the gift already described
this triple movement as the elementary form of social obligation — *donner, recevoir,
rendre* ([Mauss 1925](https://gallica.bnf.fr/ark:/12148/bpt6k93922b)) — and the Canadian
communication tradition already showed that a medium's bias in *time* is a political fact,
not a technical detail ([Innis 1951](https://archive.org/details/biasofcommunicat0000inni)).
No existing engine has a native type for the gesture.

The [DeltaVerse](https://deltaverse.pythai.net/) substrate tradition (the nGn layer)
supplies the *form* LUV inherits: small, zero-dependency substrates, each doing one thing,
each documented, composing through shared signals rather than shared state. What
emotonomics supplies is the *derivation rule*:

> **Derivation rule.** An organ enters the LUV engine only as the implementation of a
> stated emotonomic commitment. Form follows field.

The engine therefore grows the way the field grew — axiom by axiom — and the engine's
documentation is a continuation of the field's literature, not a departure from it.
LUV does not license an engine; LUV creates its own engine **from** emotonomics, and
improves emotonomics from what the engine measures: the field feeds the engine, the
engine's measurements feed the field. This reflexive loop — theory generating
instrument, instrument refining theory — is the ordinary epistemology of the
sciences (the instrument-realist case is made by the Canadian philosopher of science
Ian Hacking, [1983](https://doi.org/10.1017/CBO9780511814563): representing and
intervening are one practice, and instruments earn realism by *doing*), here applied to
political economy in code.

## II. The first organ: the pulse at 60 beats per minute

The engine's first organ is a clock that is also a heart. Sixty beats per minute is
exactly one beat per second — a fundamental frequency of **1 Hz** — and one beat per
chronos second, sixty to the chronos minute. Implementation is two substrates:

- **[heart.js](https://github.com/SHAMBA-LUV/LUV/blob/main/substrate/heart.js)**
  ([live](https://luv.pythai.net/substrate/heart.js)) — the *visual* organ: a
  consent-gated, client-cached pulsating heart (favicon and page), phase =
  chronos-corrected wall clock modulo 1000 ms, the first beat of each minute accented —
  the measure.
- **[luv-pulse.js](https://github.com/SHAMBA-LUV/LUV/blob/main/substrate/luv-pulse.js)**
  ([live](https://luv.pythai.net/substrate/luv-pulse.js)) — the *signal* organ: the same
  beat emitted as a measurable frequency output any consumer can drink — phase, lub-dub
  envelope (S1 at phase .14, S2 at .42), four spectral bands, an energy scalar, and, on
  explicit tap only, an audible lub-dub synthesized in
  [WebAudio](https://www.w3.org/TR/webaudio/). The API is FrequencySource-compatible, so
  every existing DeltaVerse consumer accepts the heart as a source unmodified.

Three properties carry the doctrine:

1. **Attention has a clock.** Emotonomics holds attention to be the source of value;
   a source must be measurable, and measurement requires a time base. The pulse is that
   base: one second, one beat, humanly perceivable, machine-precise. The second is not
   ours to define — it is fixed by the
   [SI](https://www.bipm.org/en/publications/si-brochure) at the caesium transition
   ([BIPM, *le SI*, 9ᵉ éd.](https://www.bipm.org/documents/20126/41483022/SI-Brochure-9.pdf)),
   carried on the wire by [NTP](https://www.rfc-editor.org/rfc/rfc5905) and written in
   [ISO 8601](https://www.iso.org/iso-8601-date-and-time-format.html). Time itself is
   taken as a service ([chronos](https://github.com/cypherpunk2048/chronos) attestation
   via the same-origin market contract), so the beat is *measured*, not merely displayed.
2. **Synchrony is sympathy made physical.** Phase is derived from corrected wall-clock
   time, never from timer accumulation — so every heart on every page, for every
   visitor on earth, beats in the same phase. Smith grounded economic order in
   sympathy, "our fellow-feeling with any passion whatever"
   ([Smith 1759](https://www.econlib.org/library/Smith/smMS.html)); the literature on
   entrainment shows shared rhythm to be the body's oldest mechanism of solidarity —
   Huygens observed coupled pendulums corresponding *par une espèce de sympathie* in
   February [1665](https://www.dbnl.org/tekst/huyg003oeuv05_01/huyg003oeuv05_01_0141.php),
   [Durkheim (1912)](https://gallica.bnf.fr/ark:/12148/bpt6k14149475) located social
   effervescence in collective rhythm, and
   [McNeill (1995)](https://www.hup.harvard.edu/books/9780674502307) traced
   community-making through keeping together in time. The mathematics of that locking is
   Japanese: Yoshiki Kuramoto's model of coupled phase oscillators
   ([Kuramoto 1975](https://doi.org/10.1007/BFb0013365),
   [1984](https://doi.org/10.1007/978-3-642-69689-3); 蔵本由紀,
   [『非線形科学 同期する世界』](https://shinsho.shueisha.co.jp/kikan/0737-g/), 2014)
   shows synchrony emerging from coupling alone, with no conductor — which is precisely
   the property a protocol needs. LUV's pulse takes the limiting case: coupling to a
   shared clock rather than to each other, so the lock is exact rather than emergent.
   The synchronized pulse is this inheritance implemented: one rhythm, held in common,
   owned by no one.
3. **Consent precedes signal.** Nothing is stored and nothing sounds without an
   explicit act: the favicon asks once ("your folder belongs to you"), the audible
   heartbeat starts only on a tap and stops on the next. The beat never phones home.

## III. The standard: cypherpunk2048

The engine is built to the **[cypherpunk2048](https://github.com/cypherpunk2048)**
standard, which the LUV surfaces already observe and every future organ must observe.
Its commitments, in lineage order:

- **Write code** ([Hughes 1993](https://www.activism.net/cypherpunk/manifesto.html) —
  "Cypherpunks write code"; the lineage's opening statement is
  [May 1988](https://www.activism.net/cypherpunk/crypto-anarchy.html)): doctrine ships as
  running, readable, self-hosted source — small substrates, no dependencies, no external
  calls beyond the same-origin contracts the page already trusts.
- **Sovereignty over custody; consent over default**: what lives on the client belongs
  to the client (the heart's frame cache is created only on OK, deletable by its
  owner, never transmitted); what moves value lives behind keys the user holds — your
  keys, your LUV; your browser, your folder.
- **Power-of-two discipline (the 2048)**: quantities that can be exact are exact —
  2048 = 2¹¹ as the graphic standard, 2^n ladders for shading and scale, decimal
  precision carried at full width (18 decimals; one trillion LUV named exactly).
  Approximation is a display decision, never a storage decision.
- **Verification over trust** ([Nakamoto 2008](https://bitcoin.org/bitcoin.pdf);
  [Szabo 1997](https://firstmonday.org/ojs/index.php/fm/article/view/548)): see §IV.

The standard has a reference implementation beyond LUV — the CP2048-OVL-1 credential
and gatekeeper suite at <https://github.com/cypherpunk2048> (see the
[`standards`](https://github.com/cypherpunk2048/standards) and
[`chronos`](https://github.com/cypherpunk2048/chronos) repositories); LUV is a consumer
of the standard, not its owner.

## IV. The verification doctrine: the green checkmark

In every LUV surface the word **verified** is reserved. A claim is *verified* if and
only if it traces to the **green checkmark** — source-code verification on the public
explorer, where the published source is compiled and matched byte-for-byte against the
bytecode deployed on chain. ShambaLuv
([`0x2711…8254`](https://etherscan.io/address/0x2711111111683B8708cb9a48cBf36a51315F8254#code))
carries that checkmark; the footer of every page routes "verified" to it. What this
doctrine excludes is self-attestation: an audit we paid for, a claim we typed, a
screenshot — none of these may be called *verified*. They may be called what they are.
The rule is the cypherpunk inheritance in one sentence: don't trust — verify, and let the
verification be public, mechanical, and repeatable by anyone — a system resting on
"cryptographic proof instead of trust" ([Nakamoto 2008](https://bitcoin.org/bitcoin.pdf)).

## V. Testable propositions

1. **Phase coherence.** Any two clients rendering the pulse simultaneously will differ
   in phase by less than the sum of their chronos-correction errors — measurably, by
   comparing `--luv-pulse` traces; the beat does not drift under timer throttling.
2. **Frequency exactness.** The emitted fundamental is 1.000 Hz by construction
   (phase = corrected clock mod 1000 ms), auditable from the signal API without
   reference to the implementation.
3. **Engine growth tracks the field.** Every future organ admitted to the engine will
   cite the emotonomic commitment it implements (the derivation rule is falsifiable:
   an organ without one is a defect, and its presence refutes the claim that the
   engine derives from the field).
4. **Attention responds to rhythm.** If the synchrony thesis is right, surfaces
   carrying the common pulse should show measurably different attention profiles
   (dwell, return-from-ping latency in blocktime) than the same surfaces with the
   pulse removed — a falsifiable A/B claim, to be run when traffic warrants. The
   dependent variable is not only behavioural: the metacognitive *feeling* that
   accompanies a judgment is itself measurable and predicts whether a reasoner stays
   with an intuition or re-examines it — the Feeling of Rightness of
   [Thompson, Prowse Turner & Pennycook (2011)](https://doi.org/10.1016/j.cogpsych.2011.06.001),
   [Department of Psychology, University of Saskatchewan](https://artsandscience.usask.ca/profile/VThompson).
   An economy that prices emotion must instrument the felt side of judgment, not only
   the clicked side.

## VI. Objections answered

**"An engine from doctrine is just branding."** The derivation rule is doing real
architectural work: it excludes organs (there is no autoplay sound organ, because
consent precedes signal; there is no third-party analytics organ, because attention is
owned by the one who gives it) and it fixes interfaces (the pulse had to be a signal
any DeltaVerse consumer drinks, because the field claims attention-value is *general*,
not app-local).

**"60 bpm is arbitrary."** It is chosen, not arbitrary: 1 Hz is the unique rate that
is simultaneously a resting human heart rate, one beat per SI second (making the
chronos attestation legible), and safely below flash-frequency accessibility limits
([WCAG 2.1 SC 2.3.1, *Three Flashes or Below Threshold*](https://www.w3.org/WAI/WCAG21/Understanding/three-flashes-or-below-threshold.html)).
A doctrine that prices attention must never assault it.

**"Synchrony claims overreach."** The strong sociological claims
([Durkheim 1912](https://gallica.bnf.fr/ark:/12148/bpt6k14149475);
[McNeill 1995](https://www.hup.harvard.edu/books/9780674502307)) concern co-present
bodies; a favicon is weaker medicine, and we label proposition V.4 speculative until
measured. What is *not* speculative is the engineering: the phase lock is real, global,
and verifiable today.

**"One rhythm for everyone assumes one kind of participant."** It does not, and the
engine must not. Sociological work on how a *shared* event is unequally lived — by
gender, by livelihood, by rural and resource position — warns against reading a common
signal as a common experience
([Fletcher & Reed 2022](https://www.routledge.com/Gender-and-the-Social-Dimensions-of-Climate-Change-Rural-and-Resource-Contexts-of-the-Global-North/Fletcher-Reed/p/book/9781032316857),
[Department of Sociology and Social Studies, University of Regina](https://www.uregina.ca/arts/sociology-social-studies/directory/faculty/fletcher-a.html)).
The pulse is common; the *response* to it is a distribution, and proposition V.4 must be
measured as a distribution or not at all.

## VII. The digitization of value: where the engine stands

The engine takes a position in a live argument about what happens to value when it is
digitized.

- **Value as relation, not substance.** Simmel's *Philosophie des Geldes*
  ([1900](https://www.deutschestextarchiv.de/book/show/simmel_geld_1900)) locates value
  in *Wechselwirkung* — reciprocal action between subjects — and money as the purest
  form that relation can take. Emotonomics inherits this directly: the gesture is the
  relation, and LUV is its form. A digital unit does not make value abstract; it makes
  an already-relational thing *countable*.
- **Attention as free labour.** The critical literature holds that networked platforms
  capture value produced by users as an unpaid by-product
  ([Terranova 2000](https://doi.org/10.1215/01642472-18-2_63-33);
  [Arvidsson & Colleoni 2012](https://doi.org/10.1080/01972243.2012.669449)), and that
  the behavioural exhaust of ordinary life has become a proprietary asset class
  ([Zuboff 2019](https://www.publicaffairsbooks.com/titles/shoshana-zuboff/the-age-of-surveillance-capitalism/9781610395694/)).
  This is the objection emotonomics answers structurally rather than rhetorically: if
  attention is the source of value, then the instrument that measures it must be owned
  by the one who gives it. That is why the engine has no third-party analytics organ,
  and why the pulse never phones home.
- **Programmable value.** The digitization thesis becomes engineering with
  [Szabo (1997)](https://firstmonday.org/ojs/index.php/fm/article/view/548), where
  contractual clauses become executable protocol;
  [Nakamoto (2008)](https://bitcoin.org/bitcoin.pdf), where settlement replaces the
  trusted third party; and the general-computation extension of that idea in the
  [Ethereum whitepaper (Buterin 2014)](https://ethereum.org/en/whitepaper/), on which
  LUV is deployed.
- **The institutional counter-position.** Central banks are digitizing the unit of
  account itself. The Bank of Canada's staff analysis of motivations and implications
  ([Engert & Fung 2017](https://www.bankofcanada.ca/2017/11/staff-discussion-paper-2017-16/))
  and the [BIS (2021)](https://www.bis.org/publ/arpdf/ar2021e3.htm) chapter on CBDCs
  describe a digitization of value that preserves the issuer. Emotonomics does not
  dispute their engineering; it disputes their primitive. A CBDC digitizes a *claim on
  an issuer*; the LUV engine digitizes a *gesture between participants*. The two can
  coexist, and their difference is exactly the difference between custody and consent.

The engine's contribution to this argument is not another opinion about it. It is an
instrument: a public, phase-locked, consent-gated measurement surface on which the
competing claims about attention and value can be tested by anyone.

## References

- [Arvidsson, A., & Colleoni, E. 2012. "Value in Informational Capitalism and on the Internet." *The Information Society* 28(3): 135–150.](https://doi.org/10.1080/01972243.2012.669449)
- [Bank for International Settlements. 2021. "CBDCs: An Opportunity for the Monetary System." *Annual Economic Report 2021*, ch. III. Basel: BIS.](https://www.bis.org/publ/arpdf/ar2021e3.htm)
- [Buterin, V. 2014. "Ethereum: A Next-Generation Smart Contract and Decentralized Application Platform."](https://ethereum.org/en/whitepaper/)
- [Durkheim, É. 1912. *Les formes élémentaires de la vie religieuse: le système totémique en Australie*. Paris: Alcan.](https://gallica.bnf.fr/ark:/12148/bpt6k14149475)
- [Engert, W., & Fung, B. S. C. 2017. "Central Bank Digital Currency: Motivations and Implications." Bank of Canada Staff Discussion Paper 2017-16. Ottawa: Bank of Canada.](https://www.bankofcanada.ca/2017/11/staff-discussion-paper-2017-16/)
- [Fletcher, A. J., & Reed, M. G., eds. 2022. *Gender and the Social Dimensions of Climate Change: Rural and Resource Contexts of the Global North*. London: Routledge.](https://www.routledge.com/Gender-and-the-Social-Dimensions-of-Climate-Change-Rural-and-Resource-Contexts-of-the-Global-North/Fletcher-Reed/p/book/9781032316857)
- [Goldhaber, M. H. 1997. "The Attention Economy and the Net." *First Monday* 2(4).](https://firstmonday.org/ojs/index.php/fm/article/view/519)
- [Hacking, I. 1983. *Representing and Intervening: Introductory Topics in the Philosophy of Natural Science*. Cambridge: Cambridge University Press.](https://doi.org/10.1017/CBO9780511814563)
- [Hayek, F. A. 1945. "The Use of Knowledge in Society." *American Economic Review* 35(4): 519–530.](https://www.econlib.org/library/Essays/hykKnw.html) ([JSTOR](https://www.jstor.org/stable/1809376))
- [Hughes, E. 1993. "A Cypherpunk's Manifesto." March 9, 1993.](https://www.activism.net/cypherpunk/manifesto.html)
- [Huygens, C. 1665. Lettre à R. Moray, No. 1338, 27 février 1665. In *Œuvres complètes de Christiaan Huygens*, tome V: *Correspondance 1664–1665*, 246–249. La Haye: Martinus Nijhoff, 1893.](https://www.dbnl.org/tekst/huyg003oeuv05_01/huyg003oeuv05_01_0141.php)
- [Innis, H. A. 1951. *The Bias of Communication*. Toronto: University of Toronto Press.](https://archive.org/details/biasofcommunicat0000inni)
- [Kuramoto, Y. 1975. "Self-Entrainment of a Population of Coupled Non-Linear Oscillators." In *International Symposium on Mathematical Problems in Theoretical Physics*, Lecture Notes in Physics 39, 420–422. Berlin: Springer.](https://doi.org/10.1007/BFb0013365)
- [Kuramoto, Y. 1984. *Chemical Oscillations, Waves, and Turbulence*. Berlin: Springer.](https://doi.org/10.1007/978-3-642-69689-3)
- [蔵本由紀 (Kuramoto, Y.) 2014. 『非線形科学 同期する世界』 東京: 集英社新書.](https://shinsho.shueisha.co.jp/kikan/0737-g/)
- [Mauss, M. 1925. "Essai sur le don: forme et raison de l'échange dans les sociétés archaïques." *L'Année sociologique*, nouvelle série, t. 1 (1923–1924): 30–186.](https://gallica.bnf.fr/ark:/12148/bpt6k93922b)
- [May, T. C. 1988. "The Crypto Anarchist Manifesto."](https://www.activism.net/cypherpunk/crypto-anarchy.html)
- [McNeill, W. H. 1995. *Keeping Together in Time: Dance and Drill in Human History*. Cambridge, MA: Harvard University Press.](https://www.hup.harvard.edu/books/9780674502307)
- [Nakamoto, S. 2008. "Bitcoin: A Peer-to-Peer Electronic Cash System."](https://bitcoin.org/bitcoin.pdf)
- [Simmel, G. 1900. *Philosophie des Geldes*. Leipzig: Duncker & Humblot.](https://www.deutschestextarchiv.de/book/show/simmel_geld_1900)
- [Simon, H. A. 1971. "Designing Organizations for an Information-Rich World." In *Computers, Communications, and the Public Interest*, ed. M. Greenberger, 37–72. Baltimore: Johns Hopkins Press.](https://gwern.net/doc/design/1971-simon.pdf)
- [Smith, A. 1759. *The Theory of Moral Sentiments*. London: A. Millar.](https://www.econlib.org/library/Smith/smMS.html)
- [Smith, A. 1776. *An Inquiry into the Nature and Causes of the Wealth of Nations*. London: W. Strahan and T. Cadell.](https://www.econlib.org/library/Smith/smWN.html)
- [Szabo, N. 1997. "Formalizing and Securing Relationships on Public Networks." *First Monday* 2(9).](https://firstmonday.org/ojs/index.php/fm/article/view/548)
- [Terranova, T. 2000. "Free Labor: Producing Culture for the Digital Economy." *Social Text* 18(2): 33–58.](https://doi.org/10.1215/01642472-18-2_63-33)
- [Thompson, V. A., Prowse Turner, J. A., & Pennycook, G. 2011. "Intuition, Reason, and Metacognition." *Cognitive Psychology* 63(3): 107–140.](https://doi.org/10.1016/j.cogpsych.2011.06.001)
- [Zuboff, S. 2019. *The Age of Surveillance Capitalism*. New York: PublicAffairs.](https://www.publicaffairsbooks.com/titles/shoshana-zuboff/the-age-of-surveillance-capitalism/9781610395694/)

### Normative and standards references

- [BIPM. 2019. *Le Système international d'unités / The International System of Units*, 9ᵉ édition. Sèvres: Bureau international des poids et mesures.](https://www.bipm.org/documents/20126/41483022/SI-Brochure-9.pdf) — the French text is the authoritative one.
- [ISO 8601: Date and time format.](https://www.iso.org/iso-8601-date-and-time-format.html)
- [Mills, D., Martin, J., Burbank, J., & Kasch, W., eds. 2010. "Network Time Protocol Version 4: Protocol and Algorithms Specification." RFC 5905. IETF.](https://www.rfc-editor.org/rfc/rfc5905)
- [W3C. 2018. *Web Content Accessibility Guidelines (WCAG) 2.1*, SC 2.3.1 "Three Flashes or Below Threshold" (Level A).](https://www.w3.org/WAI/WCAG21/Understanding/three-flashes-or-below-threshold.html)
- [W3C. *Web Audio API.*](https://www.w3.org/TR/webaudio/)

## Appendix A — Official-language expressions

Where a source is not English, the engine cites it in its own language; where a term is
fixed by a standards body, the official designation is given verbatim.

| Expression | Language | Source |
| --- | --- | --- |
| « correspondent entre elles par une espèce de sympathie » | French | [Huygens à R. Moray, 27 février 1665, *Œuvres complètes*, t. V, pp. 246–249](https://www.dbnl.org/tekst/huyg003oeuv05_01/huyg003oeuv05_01_0141.php) |
| « effervescence collective » | French | [Durkheim 1912](https://gallica.bnf.fr/ark:/12148/bpt6k14149475) |
| « donner, recevoir, rendre » | French | [Mauss 1925, *Essai sur le don*](https://gallica.bnf.fr/ark:/12148/bpt6k93922b) |
| « La seconde, symbole s, est l'unité de temps du SI. » | French (authoritative SI text) | [BIPM, *Le SI*, 9ᵉ éd., §2.3.1](https://www.bipm.org/documents/20126/41483022/SI-Brochure-9.pdf) |
| *Wechselwirkung* — value as reciprocal action | German | [Simmel 1900, *Philosophie des Geldes*](https://www.deutschestextarchiv.de/book/show/simmel_geld_1900) |
| 同期現象 (*dōki genshō*, synchronization phenomena) | Japanese | [蔵本由紀『非線形科学 同期する世界』, 2014](https://shinsho.shueisha.co.jp/kikan/0737-g/) |
| χρόνος (*chronos*) — measured, sequential time | Greek | the *chronos*-corrected clock of §II |
| "Cypherpunks write code." | English | [Hughes 1993](https://www.activism.net/cypherpunk/manifesto.html) |
| "A specter is haunting the modern world, the specter of crypto anarchy." | English | [May 1988](https://www.activism.net/cypherpunk/crypto-anarchy.html) |
| "cryptographic proof instead of trust" | English | [Nakamoto 2008, §1](https://bitcoin.org/bitcoin.pdf) |
| "a wealth of information creates a poverty of attention" | English | [Simon 1971](https://gwern.net/doc/design/1971-simon.pdf) |
| "our fellow-feeling with any passion whatever" | English | [Smith 1759, I.i.1](https://www.econlib.org/library/Smith/smMS.html) |
| "Three Flashes or Below Threshold (Level A)" | English (normative) | [W3C WCAG 2.1, SC 2.3.1](https://www.w3.org/WAI/WCAG21/Understanding/three-flashes-or-below-threshold.html) |

*Companion papers:* the field definition
([emotonomics.html](https://luv.pythai.net/emotonomics.html)), the measurement paper
([`docs/SENTIMENT.md`](https://github.com/SHAMBA-LUV/LUV/blob/main/docs/SENTIMENT.md) /
[sentiment.html](https://luv.pythai.net/sentiment.html)), the arithmetic paper
([`docs/WEI_OF_LUV.md`](https://github.com/SHAMBA-LUV/LUV/blob/main/docs/WEI_OF_LUV.md) /
[wei.html](https://luv.pythai.net/wei.html)), and this paper's canonical source
([`docs/LUV_ENGINE.md`](https://github.com/SHAMBA-LUV/LUV/blob/main/docs/LUV_ENGINE.md) /
[engine.html](https://luv.pythai.net/engine.html)).
