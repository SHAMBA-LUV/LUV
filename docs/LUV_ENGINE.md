# The LUV Engine: An Engine from Emotonomics

*Frequency output from heart pulsation at 60 bpm — the pulse as attention's clock*

**Live web publication:** https://luv.pythai.net/engine.html

> Preface. Emotonomics defined the field (see *Emotonomics: An Extension of Economics
> for the Knowledge Economy*, this repository, `docs/EMOTONOMICS.md` and the field paper).
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
attention (Simon 1971; Goldhaber 1997) and priced in emotion requires an engine derived
from that theory rather than adapted from any of these traditions — and that LUV is
building one. We state the derivation rule (each engine organ implements exactly one
emotonomic commitment), present the first organ — a cardiac oscillator emitting a
frequency signal at 60 beats per minute, exactly 1 Hz, phase-locked across every
participant by chronos-corrected time — and position the design in three lineages:
Smith's sympathy as the ground of economic order (Smith 1759), entrainment and collective
rhythm as the physical form of social solidarity (Huygens's "odd sympathy" of coupled
pendulums; Durkheim 1912; McNeill 1995), and the cypherpunk discipline of consent,
custody, and verification (Hughes 1993; Nakamoto 2008). We define the engine's
verification doctrine — a claim is *verified* if and only if it carries the green
checkmark of on-chain source verification — and state testable propositions.

---

## I. Why an economy needs an engine of its own

Every prior engine encodes the ontology of its source domain. The game engine's frame
loop encodes the primacy of the image; the matching engine's book encodes the primacy of
the order. An emotonomic economy has a different primitive: the **gesture** — attention
given, registered, and returned as value. No existing engine has a native type for it.

The DeltaVerse substrate tradition (the nGn layer) supplies the *form* LUV inherits:
small, zero-dependency substrates, each doing one thing, each documented, composing
through shared signals rather than shared state. What emotonomics supplies is the
*derivation rule*:

> **Derivation rule.** An organ enters the LUV engine only as the implementation of a
> stated emotonomic commitment. Form follows field.

The engine therefore grows the way the field grew — axiom by axiom — and the engine's
documentation is a continuation of the field's literature, not a departure from it.
LUV does not license an engine; LUV creates its own engine **from** emotonomics, and
improves emotonomics from what the engine measures: the field feeds the engine, the
engine's measurements feed the field. This reflexive loop — theory generating
instrument, instrument refining theory — is the ordinary epistemology of the
sciences (a point owed to instrument-realist history of science), here applied to
political economy in code.

## II. The first organ: the pulse at 60 beats per minute

The engine's first organ is a clock that is also a heart. Sixty beats per minute is
exactly one beat per second — a fundamental frequency of **1 Hz** — and one beat per
chronos second, sixty to the chronos minute. Implementation is two substrates:

- **heart.js** — the *visual* organ: a consent-gated, client-cached pulsating heart
  (favicon and page), phase = chronos-corrected wall clock modulo 1000 ms, the first
  beat of each minute accented — the measure.
- **luv-pulse.js** — the *signal* organ: the same beat emitted as a measurable
  frequency output any consumer can drink — phase, lub-dub envelope (S1 at phase .14,
  S2 at .42), four spectral bands, an energy scalar, and, on explicit tap only, an
  audible lub-dub synthesized in WebAudio. The API is FrequencySource-compatible, so
  every existing DeltaVerse consumer accepts the heart as a source unmodified.

Three properties carry the doctrine:

1. **Attention has a clock.** Emotonomics holds attention to be the source of value;
   a source must be measurable, and measurement requires a time base. The pulse is that
   base: one second, one beat, humanly perceivable, machine-precise. Time itself is
   taken as a service (chronos attestation via the same-origin market contract), so the
   beat is *measured*, not merely displayed.
2. **Synchrony is sympathy made physical.** Phase is derived from corrected wall-clock
   time, never from timer accumulation — so every heart on every page, for every
   visitor on earth, beats in the same phase. Smith grounded economic order in
   sympathy, the capacity to feel with another (Smith 1759); the literature on
   entrainment shows shared rhythm to be the body's oldest mechanism of solidarity —
   Huygens observed coupled pendulums falling into "odd sympathy" in 1665, Durkheim
   (1912) located social effervescence in collective rhythm, and McNeill (1995) traced
   community-making through keeping together in time. The synchronized pulse is this
   inheritance implemented: one rhythm, held in common, owned by no one.
3. **Consent precedes signal.** Nothing is stored and nothing sounds without an
   explicit act: the favicon asks once ("your folder belongs to you"), the audible
   heartbeat starts only on a tap and stops on the next. The beat never phones home.

## III. The standard: cypherpunk2048

The engine is built to the **cypherpunk2048** standard, which the LUV surfaces already
observe and every future organ must observe. Its commitments, in lineage order:

- **Write code** (Hughes 1993): doctrine ships as running, readable, self-hosted
  source — small substrates, no dependencies, no external calls beyond the same-origin
  contracts the page already trusts.
- **Sovereignty over custody; consent over default**: what lives on the client belongs
  to the client (the heart's frame cache is created only on OK, deletable by its
  owner, never transmitted); what moves value lives behind keys the user holds — your
  keys, your LUV; your browser, your folder.
- **Power-of-two discipline (the 2048)**: quantities that can be exact are exact —
  2048 = 2¹¹ as the graphic standard, 2^n ladders for shading and scale, decimal
  precision carried at full width (18 decimals; one trillion LUV named exactly).
  Approximation is a display decision, never a storage decision.
- **Verification over trust** (Nakamoto 2008; Szabo 1997): see §IV.

The standard has a reference implementation beyond LUV — the CP2048-OVL-1 credential
and gatekeeper suite at https://github.com/cypherpunk2048; LUV is a consumer of the
standard, not its owner.

## IV. The verification doctrine: the green checkmark

In every LUV surface the word **verified** is reserved. A claim is *verified* if and
only if it traces to the **green checkmark** — source-code verification on the public
explorer, where the published source is compiled and matched byte-for-byte against the
bytecode deployed on chain. ShambaLuv (`0x2711…8254`) carries that checkmark; the
footer of every page routes "verified" to it. What this doctrine excludes is
self-attestation: an audit we paid for, a claim we typed, a screenshot — none of these
may be called *verified*. They may be called what they are. The rule is the cypherpunk
inheritance in one sentence: don't trust — verify, and let the verification be public,
mechanical, and repeatable by anyone (Nakamoto 2008).

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
   pulse removed — a falsifiable A/B claim, to be run when traffic warrants.

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
(WCAG 2.3.1). A doctrine that prices attention must never assault it.

**"Synchrony claims overreach."** The strong sociological claims (Durkheim 1912;
McNeill 1995) concern co-present bodies; a favicon is weaker medicine, and we label
proposition V.4 speculative until measured. What is *not* speculative is the
engineering: the phase lock is real, global, and verifiable today.

## References

- Durkheim, É. 1912. *Les formes élémentaires de la vie religieuse*. Paris: Alcan.
- Goldhaber, M. H. 1997. "The Attention Economy and the Net." *First Monday* 2(4).
- Hayek, F. A. 1945. "The Use of Knowledge in Society." *American Economic Review* 35(4): 519–530.
- Hughes, E. 1993. "A Cypherpunk's Manifesto." March 9, 1993.
- May, T. C. 1988. "The Crypto Anarchist Manifesto."
- McNeill, W. H. 1995. *Keeping Together in Time: Dance and Drill in Human History*. Cambridge, MA: Harvard University Press.
- Nakamoto, S. 2008. "Bitcoin: A Peer-to-Peer Electronic Cash System."
- Simon, H. A. 1971. "Designing Organizations for an Information-Rich World." In *Computers, Communications, and the Public Interest*, ed. M. Greenberger. Baltimore: Johns Hopkins Press.
- Smith, A. 1759. *The Theory of Moral Sentiments*. London: A. Millar.
- Smith, A. 1776. *An Inquiry into the Nature and Causes of the Wealth of Nations*. London: W. Strahan and T. Cadell.
- Szabo, N. 1997. "Formalizing and Securing Relationships on Public Networks." *First Monday* 2(9).
- On Huygens's 1665 observation of synchronizing pendulum clocks ("une espèce de sympathie"): Huygens, C. Letters to R. Moray, February 1665, in *Œuvres complètes de Christiaan Huygens*, vol. 5. The Hague: Martinus Nijhoff, 1893.

*Companion papers:* the field definition (`docs/EMOTONOMICS.md` / emotonomics.html), the
measurement paper (`docs/SENTIMENT.md` / sentiment.html), the arithmetic paper
(`docs/WEI_OF_LUV.md` / wei.html).
