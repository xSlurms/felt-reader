# Felt Reader — Project Handoff

This document is the context bridge for continuing work on Felt Reader in
Claude Code (or any new session). It captures what the tool is, how it's
built, every major decision, the poker logic behind the recommendations,
and the pending work queue. Read this first.

Current version: **v5.3a**. Single self-contained file: `felt-reader.html`.
Regression tests live in `test/` and drive the real engine — run `node test/check.js`
before and after any change to the decision logic.

---

## What it is

Felt Reader is a browser-based poker decision tool for beginners and
low-stakes players. You enter your two hole cards, the board (flop/turn/
river), and the bet you're facing; it returns your equity, reads the board
for dangers (flushes, straights, paired boards), and gives a clear
CALL / FOLD / RAISE recommendation with plain-English reasoning.

It's built as a **single self-contained HTML file** — vanilla JS, no
framework, no dependencies, no build step, no network calls. It runs by
double-clicking the file or hosting it statically. Works offline. This was
a deliberate choice (an early React CDN version failed; it was rebuilt
dependency-free).

Target user: a beginner playing low-stakes online poker (the original user
plays 6-max cash + SNGs on Global Poker, a US sweepstakes site). The tool's
whole value proposition is plugging common beginner leaks: over-folding,
stacking off too light, mispricing draws, and calling down too light with
weak hands vs sustained aggression.

Live at: https://felt-reader.netlify.app/ (hosted on Netlify as index.html).
Being distributed free (Gumroad + Itch + self-host) as a portfolio piece /
lead magnet, NOT as a paid product (piracy + discovery make a $10 file
unviable; this was discussed and settled).

---

## Architecture (all inside felt-reader.html)

The file is one big HTML doc: `<head>` (SEO + meta tags + all CSS in a
`<style>` block), `<body>` (the disclaimer overlay + all UI markup), and one
big `<script>` at the bottom holding all logic. ~2200 lines total.

**The script is split by a marker comment: `// ===== PURE ENGINE BOUNDARY =====`.**
Everything ABOVE it is DOM-free and testable in node. Everything below drives the
page. The test harness slices the file at that line — keep new pure logic above it
and anything touching `document` below it.

**`MODEL` (top of the script)** holds every number that encodes a poker opinion
rather than a rule of the game: bet weights, the barrel skew, the call signal, badge
margins, the preflop cutoffs. Tune the tool there, not scattered through the
functions.

**`decide(spot)`** is the whole decision pipeline as one pure function. It takes
`{hero, board, opponents, need, advMode, barrels, stackBB, iters}` and returns
`{equity, made, draws, dangerMsg, cautionMsg, dangerCap, dangerFlags, badge, cls,
why, leak, ...}`. `refresh()` is now just: read UI state -> work out the price ->
`decide()` -> `renderResult()`, wrapped in try/catch with a visible failure state.

### The poker engine (pure functions, near the top of the script)
- **eval7 / hand evaluator** — evaluates the best 5-card hand from 5–7 cards.
  Returns a numeric score; higher = better. `catOf(score)` maps to a category
  0–8 (0=high card, 1=pair, 2=two pair, 3=trips, 4=straight, 5=flush,
  6=full house, 7=quads, 8=straight flush). `catName()` gives the label.
  Verified: AA=~85% vs random, AKs=~67%, 72o=~32%.
- **equityVsRandom(hero, board, opponents, iters)** — Monte Carlo equity vs
  N random hands. Used PREFLOP only (no board to filter against) and as a
  fallback. Respects opponent count (the "vs 1–5 opp" selector), which only
  matters preflop.
- **board_range.js logic (now inlined)** — the v4.0 core. `weightedRange()`
  builds the opponent's range as *only the hands a bettor would actually hold
  on THIS board*, weighted by bet likelihood:
  value hands (two pair+) = 1.0, top pair/overpair = 0.9, middle/2nd pair =
  0.45, weak/bottom pair = 0.2, strong draws (flush draw/OESD) = 0.8,
  gutshot = 0.35, air = 0.08. `equityVsBoardRange(hero, board, iters,
  oneStreet, lateBarrels)` samples that weighted range for equity.
  - `oneStreet=true` on the flop → deals only the TURN then stops (you pay per
    street; you don't get the river free). Turn/river deal to completion.
  - `lateBarrels` (a number, can be fractional) skews the range harder toward
    made hands per barrel: non-value weights ×= pow(0.45, lateBarrels).
- **drawBreakdown(hero, board)** — identifies draws (flush draw, OESD,
  gutshot) and out counts.
- **boardDangers(hero, board)** — detects flush (3+ suited on board), flush
  DRAW (exactly 2 suited, flop/turn), full house (paired board), trips,
  straight (coordinated board), and overcard ("overpairbeat") dangers. Each
  danger reports whether hero beats it (`beatsIt`) and whether hero has it
  (`heroHas`).
- **heroHandWeakness(hero, board)** — classifies hero's made hand:
  `weak` = bottom/second pair or worse (any overcard on board).
  `weakTwoPair` = a LOW two pair on a PAIRED board (vulnerable to trips/full
  houses/bigger two pairs). Strong top-two-pair is NOT weak.

### The recommendation pipeline (in `refresh()`)
1. Compute equity (board-filtered postflop, vs-random preflop).
2. Compute made hand label. **Playing-the-board detection**: if hero's best
   5 cards == the board's best 5 (hole cards add nothing), flag
   `playingBoard` and label it "— on board, not yours". You can only chop.
3. Run `boardDangers` + `heroHandWeakness`. Build the danger message, the
   danger flag chips, and a **cap** (`dangerCap`: 'fold' | 'marginal' |
   'call' = the strongest badge allowed).
4. Determine `need` % from the bet bucket (or exact entry).
5. `recommend()` produces a base badge from equity vs need. Then the cap is
   applied in `renderResult()`: the badge can never exceed the cap when
   facing a bet.

### The cap logic (this is the heart of the "smart" behavior)
The equity number stays HONEST (it's just math). The *recommendation* on top
of it is capped by board reality. Rules:
- Weak made hand (bottom/2nd pair) + flush/straight you don't beat → **FOLD**.
- Strong made hand (top pair+/overpair) + same danger → **CALL** cap (don't
  raise into it, but don't force a fold).
- **Weak two pair** (low two pair on paired board) + full-house danger:
  3+ barrels → FOLD; 1 barrel → CALL; no barrel → CALL. (v4.3)
- Strong (top) two pair on paired board → MARGINAL cap, never FOLD. (v4.3)
- Overcard on board + strong 2nd pair (T+ kicker) → softened "call one bet,
  don't stack off" message, CALL cap.
- **Playing the board** → never RAISE; big bet (need≥0.30) → MARGINAL (lean
  fold, you can only chop); small bet → CALL. (v4.3)
- The cap only applies when actually FACING a bet (need != null). With no bet
  it's just an equity gauge and the danger shows as a warning only.
- Danger messages name the SPECIFIC dangers present (e.g. "a straight or a
  better pair"), never a generic "flush or straight" on a board without a
  flush. (fixed in v4.2/4.3)

### Advanced mode (barrel + call tracking)
Per-street rows (flop/turn/river). Each street's action is one of:
`{action: 'check'|'bet'|'call', size: bucketKey}`.
- 'bet' = they bet into you (this is the price you're facing on the current
  street).
- 'call' = YOU bet and they called (your size). Calls trim their range toward
  hands that continue (~0.6 of a barrel each; big-bet calls count more).
- 'check' = no bet.
Turn/river bets ("late barrels") tighten the range toward value.

### UI sections
1. Disclaimer overlay (shows on load, dismiss with "I understand — let's
   play", reopen via "about" link). Sets honest expectations: learning aid
   not a solver, won't guarantee results.
2. Header + version badge (tap "what's new" for changelog).
3. How-to (expanded by default as of the final pass).
4. "vs 1–5 opp" selector (with hint: leave on 1 for most spots, only matters
   preflop).
5. Section 1 — Your hand: 13×13 ranked hand chart (tap → suit picker) OR the
   card grid (tap two cards). A lead note tells beginners the card grid is
   easier and the chart is optional.
6. Section 2 — Board: card grid fills hand first (until 2), then board.
7. Section 3 — Bet you're facing: Basic (5 buckets) / Advanced (per-street).
   Buckets are ¼ / ½ / ¾ / pot / overbet, expressed as a fraction of the pot
   **BEFORE their bet** (v4.1 — the user's client shows pot and bet
   separately). need% = f/(1+2f): Tiny 17, Half 25, Big 30, Pot 33, Over 40.
   Exact entry asks "pot before their bet" + "their bet".
8. Result: recommendation badge (the hero), danger flag chips, barrel/call
   alert, board-danger warning, small equity number + bar, made-hand label,
   draw readout.
9. Collapsibles: position opening guide, short-stack push/fold (SNG Nash),
   draw cheat sheet.

---

## Key design decisions (and WHY)

- **Board-filtered ranges over vs-random** (v4.0): a beginner's real question
  is "vs the hands this person would bet on THIS board, am I ahead?" — not
  "vs a random hand." This deflates overvalued spots (2nd pair on AQ6 went
  65%→46%; two pair into a 4-flush 43%→27%). Trade-off: more assumptions, can
  be confidently wrong in spots where the range model mismatches a specific
  villain. The danger warnings + barrel alerts are the backstop.
- **Equity stays honest; the recommendation carries the board-awareness.**
  The user explicitly wanted the equity % left as a pure calculation and the
  CALL/FOLD/RAISE badge to reflect the fuller picture. So caps live on the
  recommendation, not the equity. Equity number was shrunk (v4.0) so the
  badge is the hero.
- **One-street flop equity** (v4.0): flop equity is "see the turn, then decide
  again," not a free river. Labeled "this street only".
- **Automatic ranges, no manual Loose/Std/Tight** (v4.0): the range is
  computed from board + barrels; the tool shows what it assumed. User chose
  "fully automatic, show the assumption" over a player-type toggle.
- **Pre-bet pot sizing** (v4.1): matches how the user's client displays pot
  and bet separately. Cleaner than "% of pot shown".
- **Disclaimer screen**: required before strangers use it, since a beginner
  over-trusts the badge. Learning aid, not gospel.
- **Position, fold equity, stack depth/SPR**: deliberately NOT built. User
  handles position himself. These were discussed as the biggest remaining
  strategic gaps but scoped out.

---

## The poker logic taught / encoded (so future changes stay correct)

- Strong hands miss the flop constantly (AK misses ~2/3). Missing ≠ bad luck.
- C-bet is a one-time question, not an auto-3-barrel. If called, assume they
  have something; shut down without a plan.
- Second pair vs sustained turn/river barrels = usually FOLD (catches too few
  bluffs). This is a core beginner leak the tool actively guards.
- Draws are a PRICE question: flush/OESD ≈ call up to ¼–⅕ pot on one street;
  gutshot/overcards ≈ ⅒ pot. Bigger than ⅓ pot needs implied odds (deep
  stacks + strong disguised draw) or fold.
- Overcards are "dirty outs" — hitting top pair doesn't always win. Discount.
- Set over two pair, two pair into a set on an unpaired board, etc. = coolers,
  not leaks. Don't start folding strong hands because a rare monster exists.
- Low two pair on a PAIRED board is fragile (trips/full houses/bigger two
  pairs), especially into barrels → the v4.3 fold cap.
- Table selection (when/where to play) matters more than most in-game
  decisions: weekend evenings, high flops-seen %, loose-passive tables.

---

## v5.3a — two more controls removed

Continued simplification from real use. Both of these were things the user never reached
for, and each one was a question the tool asked before it would answer.

**Opponent count selector removed.** It had always been preflop-only, and v5.1 made that
honest by locking it once a board appeared -- but a control that greys itself out is still
a control you have to understand. In its place, the `.posblind` note directly above the
verdict now LEADS with the multiway caution: *"Every read below assumes one opponent. With
more than one player in the hand, tighten up -- someone connects with the board far more
often, so marginal calls become folds and thin value bets stop being worth it."* The
position note is still there, demoted below a divider.

**Effective stack removed.** Added in v5.1 to make the implied-odds wording concrete; the
user didn't use it, and it was one more field between opening the tool and getting an
answer. `impliedOddsClause(null)` already had the generic fallback, so the MARGINAL and
FOLD copy degrades cleanly to *"Call only with implied odds..."*.

**Deliberate: decide() keeps both parameters.** `opponents` and `stackBB` are still
accepted and still work -- the preflop multiway tightening
(`MODEL.perOpponentTighten`) and the stack-aware implied-odds tiers are correct logic, and
the regression suite still exercises them (`preflop AKs vs3 half`, `multiway flop opp4`).
What changed is that the UI never sets them: every read is now `opponents:1` with no stack.
Those scenarios are kept on purpose -- they guard engine behaviour that the queued position
work would revive. Don't delete them as "unreachable".

Also removed as orphans: `buildOpp()`, the `debounce()` helper and `refreshSoon` (they
existed only for the pot/bet/stack number fields, all now gone), and the `.opp*` /
`.stackrow` / `.opp-hint` CSS.

## v5.3 — chart-first, typing removed

User-driven simplification after a stretch of real use.

**Typing a hand is gone.** `parseCardList`, `applyCardEntry`, `syncCardEntry`, the
`#cardEntry` input, its listeners and the `.entry` CSS are all removed. Note this reverses
a v5.0 decision: text entry was added precisely because five taps on small targets was the
practical ceiling on live use. It went because in practice the user didn't reach for it,
and two overlapping input paths plus a third reference chart was more surface than the
tool needed. If live-entry speed ever becomes the complaint again, this is the thing to
bring back -- but bring it back as the primary path, not as a third option alongside two
others.

**The strength chart is now the default way in.** It moved above the card picker, opens
expanded, and is labelled as route 1 (the picker is route 2 and remains the only way to
set the BOARD). `wireDisclosure("chartToggle","chartWrap",true)` still persists a collapse,
so a user who hides it keeps it hidden.

**Chart tap targets.** The chart is primary now, so its cells matter. 13 columns cannot
reach 44px wide at phone width without horizontal scrolling, and scrolling a matrix
destroys the row/column reading that makes the chart legible at all. Width stays capped at
26px; HEIGHT went 28px -> 40px, which is free vertically and lifts the target area to 143%
of what it was. The real mitigation for a mis-tap is that nothing commits until the suit
picker -- which names the hand ("Pick suits for 72o") and cancels cleanly.

## v5.2 — one input model

Two user-driven changes.

**The bet section lost its modes.** Buckets and Exact are gone; the per-street view is the
only way to enter action, and it now starts at **Preflop**. `barrels` gained a `preflop`
key (`freshBarrels()` is the single place that defines the shape), `currentStreet()`
returns `"preflop"` instead of `null` with no board, and `streetsUpTo()` always leads with
it. The preflop row gets its own labels — "No raise / They raised / I raised, they
called" — because "checked" and "bet" don't describe preflop, where money goes in as
raises.

**Deliberate: preflop action is inert for the postflop range.** It supplies the preflop
price and nothing else. `lateBarrelCount()` only ever counted turn/river, and
`callStreets()` now explicitly skips preflop — everyone calls preflop, so treating it as
a range-narrowing signal would wrongly tighten every postflop read. Verified: marking
preflop as a call or a raise leaves flop equity at 44%, while a turn barrel still moves it
to 30%. If you ever want preflop to inform the postflop range, that is a real modelling
change and needs its own thought, not a one-line edit to `streetsUpTo()`.

Because the engine's `decide()` reads only `flop`/`turn`/`river` from `barrels`, adding the
preflop key needed **no engine change at all** — the whole feature is UI-layer, which is
why the 32 regression scenarios show no drift.

`advMode` is now permanently `true`. That is behaviour-identical to the old basic mode when
nothing is marked (`lateBarrelCount()` 0, `callStreets()` empty), which is why the harness
— which still passes `advMode:false` for non-barrel scenarios — continues to match.

**The mantra and headspace panel.** Three lines at the top of the page, plus eight
principles behind a toggle. This is the one part of the tool that isn't math: it exists
because the user's own session reviews kept landing on the same conclusion -- that tilt,
not board reading, was the expensive leak. The content is distilled from those reviews:
don't fight aggression with aggression, charge draws rather than fearing them, read the
betting story not just your own cards, over-folding and calling-down-light cost the same,
table talk is noise, never chase losses. The closing line is the decision rule: if the
problem is the spot, work the adjustment; if the problem is you, leave.

Keep the mantra lines short enough to hold ONE line at 375px -- a creed that wraps
mid-phrase stops reading like a creed. `text-wrap:balance` handles anything narrower.

**Fixed a real inconsistency in the draw cheat sheet.** The "1 overcard" row said "tiny
only", which pointed at the Tiny bucket = a quarter of the pot. One overcard hits ~7%, so
the most it can profitably call is `0.07/(1-2*0.07)` = about 8% of the pot. It now reads
"less than a tenth" with the matching pot picture. The other rows are deliberately
conservative against their true break-evens (a flush draw can mathematically call a third
of pot; the sheet says a quarter) to leave room for dirty outs -- that is intentional, not
an error, so don't "correct" them.

**Bet sizes are drawn, not spelled.** `potFracSvg(frac, over)` renders a pot as a circle
with the bet's share filled in gold; overbet adds a dashed ring outside the full circle.
This replaced the vulgar-fraction characters (¼ ½ ¾, and ⅕ ⅒ ⅓ in the draw cheat
sheet), which render as tiny composed glyphs in most monospace faces — and this file ships
with no webfont, so it gets whatever the OS provides. ⅒ in particular is absent from many
system fonts entirely. Inline SVG scales with zoom and needs no asset, which is the only
option that survives being a single self-contained file. `BUCKETS` now carries a numeric
`frac` (and `over` on the overbet row) so the picture is generated from the model rather
than hand-drawn. Cheat-sheet cells opt in with `data-frac`.

Icon and label sit in a `.sg-row` flex container: a label long enough to wrap indents
beside the pot instead of falling underneath it.

**A size-guide toggle** replaces the always-on prose: a table built from `BUCKETS` so it
cannot drift from the model, showing fraction, bucket name and break-even percentage.

**Effective stack moved above the opponent count and now survives Clear all.** It is a
property of your session, not of the hand; re-typing it after every clear was friction.

Removed with the modes: `buildBets()`, `exactNeed()`, `betFrac`, `exactMode`, `potVal`,
`betVal`, and the `.bets` / `.betbtn` / `.betnote` / `.mode-switch` / `.ms-opt` / `.exact`
CSS blocks.

**Tradeoff worth knowing:** the exact-amount fields were the one path that required no
mental arithmetic, which v5.0 added specifically for beginners. Dropping them puts the
bet-÷-pot division back on the user. The size-guide toggle softens it but does not
replace it. If beginners struggle with bucket choice, that is the thing to revisit.

## v5.1a — review follow-ups

Everything left open by the v5.1 committee pass, minus the two standing exclusions
(disclaimer memory, and full keyboard/screen-reader support — both deliberately declined
by the user, twice).

- **Result card trimmed back.** The amber panel had been repeating the behind-percentage
  that already sits in a chip immediately above it; it now says what the number MEANS
  instead of printing it twice. The leak line moved inside the existing "why?" disclosure
  rather than standing as its own block — it is a lesson, not part of the decision.
  Card on the aces spot: 7 blocks, ~575px on a 375px viewport.
- **Glossary caught up with the output.** `kicker`, `kickers`, `board`, `quads`,
  `full house` and `two pair` added — all terms v5.1 introduced into the copy without
  defining. Flag chips now run through `glossaryMarkup` too; they were the most-read text
  in the card and were skipping the glossary entirely.
- **`memo1()`** replaces three hand-rolled one-slot caches (`_rangeCache`, `_bctxCache`,
  `_behindCache`). One slot is deliberate, not a limitation: the inputs move together, so
  a second slot would never be hit. Cache behaviour verified unchanged — 15ms warm re-tap
  vs 29ms cold.
- **`readBoard()` split out of `decide()`.** The seam is observation vs judgement:
  `readBoard(hero, board, need, lateBarrels)` works out what you have, what beats it and
  how you stand; `decide()` then reaches a verdict. 358 lines became 222 + 155, and
  `readBoard` contains zero references to `advMode`, `betFrac` or the DOM — verified by
  grep, so the decoupling is real rather than nominal. Pure code movement: the harness
  showed no drift on any of the 32 scenarios, seeded equity included.

## What changed in v5.1 (and why)

Triggered by a user screenshot: 2♠2♥ on A♣A♦A♥ facing an overbet returned a green
**CALL at 77%**. That turned out not to be one bad spot but the visible edge of a
modelling flaw that had been disabling the board-filtering feature since v4.0.

**Root cause.** `handWeightOnBoard` opened with `if(cat>=2) return 1.0`. It graded hands
by ABSOLUTE category. On A-A-A every possible holding makes at least trips, so every one
of the 1,081 combos scored 1.0 and the opponent's range became uniform — identical to
having no range model at all. Measured before the fix: A-A-A **100%** of combos at weight
1.0, Q-Q-Q 100%, A-A-K-K-7 100%, K-K-5 26%. Healthy unpaired boards were 3–7%.

**The fix.** `boardOwnCat(board)` computes what the board makes on its own, from the
board's cards only (no blank-filling, which would invent a straight on 4-5-6 or a flush
on a four-flush board). `handWeightOnBoard` now grades by IMPROVEMENT over that: if your
category doesn't beat the board's, you have kickers, whatever it's called. Trips on A-A-A
is air; trips on A-7-2 is still a monster.

Everything else in this pass fell out of that once it was visible:

- **`rangeBehind()`** — new, and the general answer to "is it truly reviewing the possible
  hands". Exact (not sampled) over the weighted range: how much of it beats hero RIGHT
  NOW. Surfaced as a chip and a sentence. 2-2 on A-A-A reads 62%; A-K on A-A-A reads 0%.
  **Drawing hands are exempt** — a draw is supposed to be behind, and the first version
  wrongly capped flush draws at "88% behind". A four-flush on the BOARD is also excluded,
  since that draw belongs to everyone.
- **Non-nut full house / trips** — the `!d.heroHas` guard suppressed all warning the
  moment hero held the category. Same blind spot fixed for flushes in v5.0. K-Q on
  A-A-K-K-7 (kings full, losing to any ace) was CALL at 89% with no flag.
- **Kicker-only labels on every street** — K-Q on A-A-A said "Three of a kind". The
  honest-label logic existed but ran only on the river and only for pairs.
- **Cap relaxation** — a danger cap only says a better hand is POSSIBLE. Trips on K-K-5
  (91% equity, 7% of range ahead) was capped to MARGINAL. Below 15% behind, a cap now
  relaxes to "don't raise". **Guarded against playingBoard/kickerOnly**, where `behind` is
  near zero only because the range TIES you.
- **Kicker cap graded by standing** — quads on board with the best kicker is the effective
  nuts, not a marginal hand.
- **`rangeBehind` mode** — was measuring a betting range while equity measured a checking
  range, with both shown in the same card.
- **`applyBarrelSkew()`** — the barrel formula had been copy-pasted into two places. That
  is the exact shape of the bug this pass was about, so it now has one home.

UI: three routes into setting a hand are now named and numbered (type / card grid /
strength chart), and the chart was **moved below the picker** so the numbering matches
page order. A `.posblind` note above the result states plainly that the read does not know
position. Made-hand line carries "not the best one available" when the non-nut flag is set.

Verification: 600 randomised spots screened for contradictions (0 found), a deliberate
sweep of degenerate board archetypes (trips, quads, double-paired, boat-on-board,
monotone, four-flush, straight-on-board), and 8 new regression scenarios — including
controls (top set, nut straight, trips with a good kicker) that must NOT trigger a
warning, which is what stops a future fix over-correcting into folding monsters.

**Known, deliberately not done** (raised in review, left as your call): the result card is
growing back toward v4.3 density — the behind% sentence in the amber panel duplicates the
chip, and the leak line could collapse behind the "why?" toggle. And `kicker`, `board` and
`quads` are not in `GLOSSARY`; chip labels bypass `glossaryMarkup` entirely.

## What changed in v5.0 (and why)

A four-perspective review (software / UI / poker expert / beginner) drove this pass.
The headline problems and their fixes:

- **Preflop no longer uses pot odds.** v4.3 compared equity-vs-a-*random*-hand to the
  pot odds, which told beginners to CALL a pot-sized bet with 72o and CALL/RAISE with
  J3o. Both halves were wrong: a bettor doesn't hold a random hand, and calling
  preflop buys three more streets rather than a showdown. `preflopVerdict()` now
  reads the chart rank from `GRID_DATA` against the cutoffs the position guide
  already stated in prose (~45 vs a min-raise, ~15 vs a standard raise, ~8 vs a
  3-bet), tightened by `MODEL.perOpponentTighten` per extra player. Equity is still
  shown, labelled as a strength gauge.
- **Non-nut flushes and straights now warn.** The render guard was `!d.heroHas`, so
  the moment hero held *any* flush the danger was dropped entirely — a K-high flush
  with the ace live got a green badge and no warning. Split `heroHas` from
  `beatsIt`: holding it but not the nuts gives an amber `not the nuts` chip and a
  CALL cap.
- **No more CALL / RAISE badge.** Raising well depends on fold equity, which this tool
  does not model. The badge states the call; the reason mentions the raise. Note the
  consequence: a `"call"` cap can no longer *lower* a badge, so there's an explicit
  branch that keeps the "call, but don't raise" wording when the cap and the badge
  agree. Don't delete it — that warning is the whole value of the cap.
- **The one-street contradiction is gone.** `streetNote` still claimed the equity
  assumed turn *and* river, eight lines above the note saying the opposite. Deleted.
  The outs line is now rule-of-2 (next card only), consistent with the flop sim.
- **Red vs amber.** `dangerMsg` (red) means you are probably beaten. `cautionMsg`
  (amber) is worth-knowing. Flush-draw-on-board and a single overcard moved to amber —
  red was firing on the majority of flops, which trains people to ignore red.
- **Flags are deduped.** `boardDangers` emits one `flushdraw` per suit, so a
  two-tone-twice board rendered the same chip and sentence twice.
- **Checking ranges.** With no bet selected, equity is measured against a *checking*
  range (`weightedRange(..., {mode:"check"})`, roughly the complement of the betting
  range, floored so slowplays survive) instead of a betting range.
- **Opponent count locks postflop.** It only ever affected preflop; postflop it was
  silently ignored while looking like a live setting.
- **`stackBB`** (optional input) makes the implied-odds wording concrete. By design
  it changes only copy, never the badge.
- **`leak`** — every read names the beginner leak it guards. The tool always knew;
  it just never said so.

UI/beginner work in the same pass: fixed a `.pos-tag.pe` collision with the app
container `.pe` (the "Early" seat tag was inheriting a gold border, ring shadow and
♠♥♣♦ pseudo-elements); five bet buckets in a five-column grid; mobile card picker from
7 columns (targets ~22x36px -> ~40x53px); badge is now the largest thing in the result
card with the reasoning behind a "why?" toggle; a fixed verdict bar on mobile so the
answer stays reachable while you pick cards; type-a-hand entry (`ahkd ts9s2h`); a
tap-to-reveal glossary; Exact promoted to a first-class mode beside Buckets/Advanced.

Removed: `analyzeDraws`, `equityVsRange`, `rangeCombos`, `applyBarrelTightening`,
the `buildRange` stub, `lastEquity`, dead vars in `boardDangers`, a duplicate
`cardSuit`, four near-identical toggle CSS blocks (now one `.disclosure`), the
`.bg-deco` layer, and the old 17-row changelog (full history is in the about panel).

Performance: `weightedRange` is memoized on cards+mode, and `refresh()` only
rebuilds the picker/slots when the card set changes (`buildGrid` is static and runs
once at init). Number inputs are debounced 200ms. Re-tapping bet sizes on one board
went from ~70ms to ~17ms.

## PENDING QUEUE (discussed, not yet built)

### QUEUED — Position awareness, up to 9-handed (highest-value remaining add)

Explicitly deferred, not rejected. The user's call: adding it now would complicate the
tool, so it waits. Recorded here in enough detail to build without re-deriving it.

As of v5.1 the tool says plainly that it does **not** know position (the `.posblind`
note above the result, plus the disclaimer). That honesty is the stopgap; this is the
fix.

**Table sizes to support:** 9-handed (full ring), 8, 7, 6-max. Seats, in order:
UTG, UTG+1, UTG+2 (MP1), MP2, MP3/LJ, HJ, CO, BTN, SB, BB — trimmed from the front as
the table shrinks, so 6-max is LJ, HJ, CO, BTN, SB, BB and 9-handed drops only UTG+2.
`PF_SHOVE` already keys off UTG/MP/CO/BTN/SB, so the push-fold table needs the same
widening or an explicit mapping from the finer seats onto those five buckets.

**Where it plugs in — most of the wiring already exists:**

1. `preflopVerdict(hero, need, opponents)` already takes a chart rank and compares it to
   a cutoff from `MODEL.preflopCutoffs`. Add a `seat` argument and a per-seat multiplier
   (early seats tighten, late seats loosen). The opening ranks are already written down
   in the position guide markup: Early ≤10, Middle ≤20, Late/CO ≤40, BTN ≤70, SB ≤55,
   BB defends wide. Those are the numbers — they just aren't wired to anything yet.
2. `MODEL` gains a `seatFactor` table so the tuning stays in one place, consistent with
   how every other poker constant now lives there.
3. Postflop, position should shift two things and no more, or it becomes a solver:
   - **in position** — widen the marginal band slightly (you get to act last, so you
     realise more of your equity), and allow a float where the tool currently says FOLD;
   - **out of position** — tighten the marginal band and lean the `dangerCap` one notch
     harder, because you have to act first on every remaining street.
   Do NOT try to model fold equity or bet sizing off position; that is a different tool.
4. The opponent-count selector and the seat selector overlap conceptually. Decide
   deliberately whether "vs 3 opponents" and "I'm on the button" are one control or two
   before building either.

**Risks to respect:** equity realisation by position is the single easiest thing to
overfit. Keep the effect small and legible — a nudge to the marginal band, not a
recalculated equity. And keep the `.posblind` note until the feature actually ships,
then replace it rather than deleting it.


Nothing is currently mid-build. Ideas raised and their status:
- **Board-filtered ranges** — DONE (v4.0).
- **Villain-calls tracking** — DONE (v4.0/later).
- **Weak-two-pair fold on paired boards** — DONE (v4.3).
- **Playing-the-board never-raise** — DONE (v4.3).
- **Position tap** — QUEUED with a full spec, see the section directly above.
- **Fold equity / bet-as-bluff EV** — NOT built. Scoped out.
- **Stack depth / SPR awareness** — NOT built. Scoped out.
- **River-specific bluff-catch math** (value:bluff ratio rather than equity)
  — partially addressed via framing; the board-filtered model on a 5-card
  board already computes "how often you beat the betting range," which is the
  right idea. Could be made more explicit.
- **Multiway postflop** — intentionally heads-up by design postflop. The
  opponent-count selector only affects preflop.

---

## Testing approach

`test/` holds a real regression suite. It slices `felt-reader.html` at the
`PURE ENGINE BOUNDARY` marker and calls the actual `decide()` — nothing is
re-implemented, which was the flaw in the old `edge_test.js` (it kept its own copy of
the cap logic and could pass while the shipped file was broken). `edge_test.js` has
been deleted.

```bash
node test/check.js     # diff against test/baseline.txt, non-zero exit on drift
node test/harness.js   # print the raw table
```

`Math.random` is seeded per scenario, so equity is reproducible and a real change
shows up as an exact diff instead of hiding in ~1% Monte Carlo wobble. `check.js`
separates *decisive* drift (badge, equity, flags, made hand, outs, draws — fails the
run) from copy-length drift (reported only, since rewording is usually intentional).

To change behaviour on purpose: make the change, run `check.js`, confirm every drifted
line is one you meant, then re-baseline with
`node test/harness.js > test/baseline.txt`.

See `test/README.md` for the scenarios that matter most — they encode the leaks the
tool exists to guard.

---

## Files in this package

- `felt-reader.html` — THE TOOL. v4.3. Single source of truth. Everything
  (engine, UI, CSS, SEO) is in here. Domain hardcoded to
  https://felt-reader.netlify.app/. To host: rename to index.html, put the
  cover PNG at the site root (the OG image tag points to
  /felt-reader-cover.png).
- `felt-reader-cover.png` / `.svg` — 1280×720 cover (Gumroad/social).
- `felt-reader-thumbnail.png` / `.jpg` / thumb `.svg` — 800×800 square.
- `test/` — regression suite driving the real engine (`harness.js`, `check.js`,
  `scenarios.js`, `baseline.txt`, `README.md`).
- `felt-reader.v4.3.backup.html` — the pre-v5.0 file, kept because this project
  isn't under version control.
- `SEO-SETUP-README.html` — hosting/SEO notes (NOT to be deployed publicly).
- `HANDOFF.md` — this file.

## First things to do in Claude Code
1. Run `node test/check.js` to confirm you're starting from a clean baseline.
2. Open `felt-reader.html`. Search for `function decide(` — that's the whole
   decision pipeline and almost every logic change belongs inside it. `MODEL` at the
   top of the script holds the tunable numbers.
3. Make the change, re-run `check.js`, and read every drifted line before
   re-baselining.
4. The highest-value untouched feature is still a **position input** — and note it
   would slot straight into `preflopVerdict()`, which already takes a rank and a
   cutoff. After that, explicit river bluff-catch framing.

---

## v5.3b — Big-blind defence, and the facing-a-raise note made readable

Two changes, both inside the **Which hands to open (by position)** panel.

### 1. The big blind gets a table of its own

The BB row used to say "defend wider — you're getting a price" and stop there, which is
advice without a number. It's also the seat a beginner sits in more than any other, and the
one where the correct range is *least* intuitive: you continue with far more hands than you'd
ever open, and the right amount swings from ~15% to ~60% purely on the raise size.

So the row now states the principle and points down to `.bbdef`, a table keyed on their raise:

| Their raise | Continue with | That's |
|---|---|---|
| Min-raise, ~2x | ≤60 | 3 hands in 5 |
| Standard 2.5–3x from BTN / CO / SB | ≤45 | just under half |
| Standard 2.5–3x from early or middle | ≤30 | under a third |
| Big raise, 4x+ | ≤15 | about a sixth |

Four notes under it carry the parts a bare number gets wrong: why it's wide (the posted blind
is a discount nobody else gets), tighten a tier if someone already called the raise, prefer
shape over rank at the cutoff, 3-bet only the top ~8, and — the one that keeps wide defence
from becoming a leak — the discount ends on the flop, so fold when you miss.

The block is tinted to match the `seat-bb` tag so the eye connects it to the row above.

**On the numbers.** `GRID_DATA` ranks run 0–100 and are calibrated so a cutoff is almost
exactly the percentile. Verified by combo-weighting every cell (pairs 6, suited 4, offsuit 12):

```
rank <=8  =>  7.8%     rank <=30 => 29.7%     rank <=60 => 60.2%
rank <=15 => 15.4%     rank <=45 => 45.1%     rank <=70 => 70.1%
```

That property is worth keeping — the new `.pos-lead` line states it outright ("≤20 means
roughly the top 20% of all hands"), which makes every other number in the panel self-explaining.
If `GRID_DATA` is ever re-ranked, re-run that check before trusting the copy.

### 2. `.posnote` is a block, not fine print

It was a 10.5px grey paragraph with five rank cutoffs buried mid-sentence — the most-used
advice in the panel, styled as the least readable thing on the page. Now a titled block with
one row per raise size and the rank pulled out right in 15px gold:

- Tiny / min-raise → ≤45
- Standard 2.5–3x → ≤15
- Big raise or 3-bet → ≤8

with a footer that sends the blinds elsewhere (SB tightens, BB uses the table above).

### Verification

`PARSE OK`; `node test/check.js` → no decisive drift (markup and CSS only, engine untouched).
At 375px: no horizontal overflow anywhere in the panel, `scrollWidth === innerWidth === 375`,
all three table headers single-line, no console errors. File is 2486 lines.

---

## v5.4 — one way in

The page offered two routes to a hand and apologised for it ("two ways, pick whichever is
quickest"). That's a choice the user has to make before they can start, about something that
doesn't matter. v5.4 names a single method and lays the page out to match it.

- **How-to panel** now leads with *"Before the flop it uses the starting-hand chart; after the
  flop it uses the board."* — the one sentence that explains the tool's shape. The old
  "Best after the flop." header is gone; it read as an apology.
- **Section 1** is `1 — Your hand — on the chart`. The `.ways` pill strip is deleted (CSS too),
  and the chart's lead line says outright that the chart sets the hand and the card table
  below is for the board.
- **The chart toggle is gone.** `#chartWrap` is a plain always-open div and
  `wireDisclosure("chartToggle","chartWrap",true)` is removed. The chart is the entry point,
  so it can't be behind a tap.
- **The picker label** is `For the board — tap the flop, turn and river cards here`.
  The picker *still* fills an empty hand first — that behaviour is untouched, it's just no
  longer advertised, because advertising it is what created the second route.
- **The bet-size guide moved** from between `3 — The action` and the barrels down to the
  bottom, immediately above the draw cheat sheet, where the other reference panels live.
  The how-to step 3 now points at "the bottom of the page".

Markup and CSS only. `PARSE OK`, `node test/check.js` clean, and the whole flow re-walked in
the browser at 375px: chart tap → suit picker → picker fills board → flop street detected →
Half bet → MARGINAL 32%, size guide and cheat sheet both open in their new order, no console
errors, no horizontal overflow.

---

## v5.5 — preflop phase 1: folded to you

The first half of the preflop plan. Pick a seat, and when it's folded to you the tool stops
gauging and gives an answer: **OPEN** (with a size) or **FOLD**.

### Why this is cheap and exact

Preflop is a lookup, not a simulation. No board to run equity against, and opening ranges
aren't derived at the table anyway — they're chart ranges. Two consequences worth keeping
in mind before anyone "improves" this:

1. **The new scenarios are RNG-free.** They don't touch Monte Carlo, so any drift in them is
   a real change to `PF_OPEN`, never wobble. They should be stone-stable forever.
2. **An OPEN badge is honest here in a way it isn't postflop.** v5.0 dropped RAISE because
   the tool has no fold-equity model. That reasoning doesn't reach preflop, where the answer
   comes from a chart rather than from EV at the table. Don't "fix" the inconsistency by
   deleting the OPEN badge — the inconsistency is the point.

### `PF_OPEN` — single source of truth

```
early  cut 10  open 3bb      mid  cut 20  open 3bb
co     cut 40  open 3bb      btn  cut 70  open 2.5bb
sb     cut 55  open 3bb      bb   cut null (no open exists)
```

`cut` is a chart rank, and GRID_DATA is calibrated so a rank is near enough a percentile
(verified in the v5.3b section). The seat buttons render their "top N%" captions **from this
table**, so the number on the button cannot drift from the number the engine judges by.
That's the pattern to extend in phase 2 — the `Which hands to open` guide should eventually
render from these tables too.

Bands: `<= cut*0.4` strong open · `<= cut` open · `<= cut*1.25` MARGINAL · beyond that FOLD.

**Sizing is convention, not computation**, and the copy says so outright. 3bb opens (2.5bb on
the button), +1bb per limper. If that ever becomes a model, drop the disclaimer with it.

### Position is preflop-only, deliberately

`seat` enters `decide()` as `spot.seat` and is read in exactly one branch:

```js
if(board.length===0 && need==null && seat && pfAct==="check"){ rec = pfOpenAdvice(hero, seat); }
```

`pfAct` is the preflop barrel row — `"check"` there means *no raise*, i.e. folded to you.
Mark a raise, or deal a board, and it falls straight back to the existing paths. Postflop
stays position-blind; the note above the verdict was reworded to say that precisely rather
than claiming the tool never knows your position. Equity realisation by position is still the
easiest thing here to overfit, and it stays out until there's more than a guess behind it.

Seat clears with **Clear all**, because your seat moves every hand. It is not persisted.

### The seam phase 2 closes

Facing a raise, `preflopVerdict()` still derives its cutoff from the **price** (`MODEL.preflopCutoffs`),
not the seat. It happens to agree with the guide in the common cases — AJo vs a standard raise
gives cutoff 30 against the guide's ≤15-to-≤45 band — but they're two different sources of
truth for the same question, and that's exactly what phase 2 should merge into `PF_OPEN`'s table.

### Also fixed

The result card's footnote read *"Figured against the hands a bettor would actually hold on
this board"* on preflop reads, where there is no board and no betting range. Preflop now gets
its own line saying the percentage is a strength gauge against a random hand and the verdict
comes from the chart.

### Verification

`PARSE OK`; 11 new scenarios baselined, no drift in the 32 existing ones. The seat matters and
only where it should:

```
open AJo early  | MARGINAL      open AJo cutoff | OPEN
open 76o early  | FOLD          open 76o button | OPEN
open 72o button | FOLD          open KQo big blind | NOTHING TO DO
```

Browser at 375px: all six seats cycled on AJo (MARGINAL / OPEN×4 / NOTHING TO DO), tapping a
lit seat deselects back to the gauge, "They raised" + Half falls back to `preflopVerdict`
(CALL, cutoff 30), adding a flop falls back to the postflop read, **Clear all** resets the
seat, no overflow, no console errors.

---

## v5.6 — preflop phase 2: facing a raise

Pick your seat, mark their raise size on the **Preflop** row, and the tool answers outright:
**3-BET** (with a size), **CALL**, **MARGINAL** or **FOLD**. The blinds get their own numbers,
because the big blind's discount is the single biggest positional fact before the flop.

### The seam this closes — read this before touching the preflop tables

v5.5 left two sources of truth for one question. `MODEL.preflopCutoffs` was a rank ladder keyed
on the **price** (`need` → cutoff), while the position guide on the page answered the same
question by **seat**. They agreed by luck in common cases and disagreed at the edges.

`MODEL.preflopCutoffs`, `MODEL.perOpponentTighten` and `preflopCutoff()` are **gone**. There is
now one preflop table set, all of it above the engine boundary:

| | what it holds |
|---|---|
| `PF_OPEN` | per-seat opening ranks, raise sizes, defend family (`fam`) |
| `PF_RAISE_TIERS` | price → the raise size a player actually sees (4 tiers) |
| `PF_DEFEND` | continue ranks per family × tier: `three` / `call` / `lean` |

`preflopVerdict()` still exists under that name, because `decide()` and the tests call it, but
it is now a four-line wrapper over `pfDefendAdvice()` with no seat. **Don't reintroduce a
price-keyed ladder.** If a preflop number needs changing, change `PF_DEFEND`.

### Why four tiers and not five

The bet buckets are a pot-fraction ladder (`tiny half big pot over`), which is the wrong frame
preflop: a 3bb open into a 1.5bb pot is already a 2x *overbet* by that measure. So preflop the
same buttons are **relabelled in raise multiples** — `Min 2x · 2.5x · 3x · 4x · 5x+` — via a
`pf` field on each bucket, read only by `buildBarrels` on the preflop row.

`half` and `big` (2.5x and 3x) both map to the **one** `std` tier. That's deliberate: the
position guide says "standard 2.5–3x" as a single tier, and splitting it would mean inventing
a number the page doesn't print. Two buttons landing on one tier is harmless; a number with
nothing behind it is not. `defend QTo button 2.5x` and `defend QTo button 3x` exist to lock
this — if they ever diverge, someone has split the tier.

### The `lean` band is load-bearing — don't flatten it

Each `PF_DEFEND` row is `{three, call, lean}`. `lean` is the band where the honest answer is a
**question**, because it turns on something the tool cannot see: who raised, and who else has
already called. There the badge is MARGINAL and the copy names the thing to go and look at.

The clearest case is `bb.std`. The guide gives **two** numbers for that one spot — continue to
≤45 against a button/cutoff/SB raise, ≤30 against early or middle — because it depends on the
raiser's seat, which the tool doesn't know. Rather than average them into a third invented
number, the engine calls the tighter one (30) and makes **31–45** the MARGINAL band, with copy
that states the condition. Collapsing `lean` into `call` would turn a judgement call into a
false instruction.

### Where the numbers come from

Printed on the page, in the position guide:

```
open   min-raise -> 45   standard -> 15   5x+/3-bet -> 8
bb     min-raise -> 60   standard -> 45 vs a late raiser, 30 vs an early one
       4x -> 15          5x+ -> 8         3-bet with the top 8
sb     standard -> 20   ("call or 3-bet only the top 20")
```

Derived rather than printed: the `open` 4x row (10) and the `sb` min / 4x / 5x+ rows, scaled off
the bb ladder for a seat with half the discount and none of the position. The guide markup was
updated in this version so its printed rows match `PF_DEFEND.open`'s `call` column exactly —
**phase 4 should render those rows from the table and delete the hand-written ones.**

3-bet sizing is convention, labelled as such, and expressed as a multiple of *their* raise
rather than in big blinds, because that's the number already in front of the player. It
resolves by seat: BB/SB → 4x (always out of position), BTN → 3x (always in position),
everything else → conditional, because the raiser's seat is unknown.

### Multiway

`opponents > 1` means players have already called the raise, and shifts the lookup **one tier
tighter per extra opponent** — the guide's own "cut them back a tier", applied as a tier shift
rather than a multiplier so the numbers stay numbers off the page.

A bug worth not reintroducing: the first cut of this renamed the raise as well as the numbers
("They've made it a big raise, 4x or so" when the user had marked 3x), i.e. it misreported the
user's own input back at them. The shift now moves `row` only; `actual` keeps the tier the
player actually marked, and the copy says the numbers were read a tier tighter and why.

### Also fixed

**Break-even is hidden on preflop reads.** The equity row printed "break-even 30%" beside a
3x raise — a pot-odds number, in the one place the card explicitly tells you the verdict is
*not* from pot odds, and derived from a pot fraction that no longer matches the button's label.
It returns the moment there's a board, where it's the right frame.

**A raise with no size no longer falls through to the bare equity gauge.** It asks for the one
missing input instead.

### Verification

`PARSE OK`; `node test/check.js` clean; 64 baseline rows (21 new, all RNG-free).

Two intentional badge changes in the pre-existing rows, both from the seam closing:
`preflop AA pot` and `preflop AKs vs3 half` went **CALL → 3-BET**. The old price ladder had no
3-bet concept at all, so premiums facing a big raise could only flat. The protected rows
(`preflop 72o pot`, `preflop J3o pot`) held at FOLD.

Browser at 375px: K9o cycled through all six seats at 3x → FOLD everywhere but the big blind,
where it's MARGINAL with the "it depends who raised" note; AKo at 3x → 3-BET in gold with the
sizing resolving per seat (BB 4x, BTN 3x, MID conditional); the missing-size prompt fires;
adding a flop falls back to the postflop read; **Clear all** resets the seat and the preflop
row; the five preflop size buttons fit one line; no overflow, no console errors.

### Still open

- **Phase 3** — limpers (isolate / overlimp / fold) and 4-bets. Also `"I raised — they called"`
  on the preflop row, which currently falls through to the generic gauge: the player who marks
  the real sequence gets a *worse* answer than one who marks nothing. It belongs with phase 3
  as the rest of the preflop action grid.
- **Phase 4** — render the `Which hands to open` guide from `PF_OPEN` / `PF_DEFEND`, killing the
  copy/engine drift permanently. The tables and the markup agree right now; nothing enforces it.
- Fold equity is still unmodelled postflop, which is why there is no RAISE badge there. 3-BET
  preflop is honest for the opposite reason: preflop is a lookup, not a simulation.
- Chart cells are ~24px wide on mobile, under the 44px guideline.

---

## v5.7 — preflop phase 3: the rest of the action grid

Preflop now answers every shape of action that can reach you before the flop. The Preflop row
went from three buttons to five:

| Preflop row says | engine | badges |
|---|---|---|
| No raise | `pfOpenAdvice` | OPEN / MARGINAL / FOLD |
| They limped | `pfLimpAdvice` | RAISE / MARGINAL / FOLD, or RAISE / CHECK in the BB |
| They raised | `pfDefendAdvice` | 3-BET / CALL / MARGINAL / FOLD |
| I raised — called | `pfRaisedCalledAdvice` | ON TO THE FLOP |
| I raised — re-raised | `pfReRaiseAdvice` | RE-RAISE / CALL / MARGINAL / FOLD |

All five are lookups, so all five are RNG-free and stone-stable in the tests.

### One dispatch, and why it moved

`decide()` used to route preflop on `need != null`. It now routes on **the preflop action**,
in a single `if(board.length===0)` block, because "there is a price" stopped being enough to
identify the spot once a limp (no price) and a re-raise (a price, different meaning) existed.
Everything falls through to `recommend()` if no preflop branch claims it.

### The size slot holds two different vocabularies

`barrels.preflop.size` holds a **bet bucket key** for `bet` / `call` / `reraise`, and a
**limper head count** (`"1"` `"2"` `"3"`) for `limp`. That is a deliberate reuse of the one
slot, and it has one hard requirement: the slot is cleared whenever the action moves between
those vocabularies (`BUCKET_ACTIONS` in `buildBarrels`). Without it, switching from "They
limped / 3+" to "They raised" would hand `BUCKETS.filter()` the key `"3"`, get `undefined`
back, and throw on `abk.need`. Switching *within* a vocabulary (bet ↔ call) keeps the value,
which is the behaviour that was there before.

### Shape, not just rank

`heroShape()` is new, and it exists for the overlimp band only. Near the bottom of a calling
range the reason to take a cheap flop is to make a hand worth a big pot, and offsuit rags
never do — so the engine allows the call on shape (pair / suited / gap ≤ 2) and refuses it
without, rather than leaving it to the reader the way the printed guide has to.

The copy branches on `shape.pair` too, because a pair flops a **set**, not a draw. That was
wrong in the first cut and read as filler; it is the kind of line a beginner would notice is
nonsense and then trust the tool less for.

### The overlimp band answers, it doesn't hand back the condition

First cut told a cutoff player "call if you'll be acting late" — when it already knew they
were. When a seat is picked the band now resolves it: late (BTN/CO) → call, early (early/mid)
→ fold, SB → fold with the reason, no seat → the condition plus "tap your seat". **Keep this
pattern.** A tool that knows the answer and restates the question is worse than one that
never asked.

### Numbers

- **Limpers.** The isolate cut is the seat's own *opening* range, tightened per limper
  (`PF_LIMP_TIGHTEN` = 1 / 0.7 / 0.5). More limpers means more players seeing the flop with
  you, and an isolation raise that isolates nobody is just a bigger pot played out of
  position. The BB has no opening rank, so it gets `PF_LIMP_BB` = 60 / 40 / 25, anchored on
  the guide's "if the small blind just limps, raise ≤60 and take it away from them". No seat
  → middle position (20), the safer guess. Overlimp band is `cut × 1.6`.
- **The BB cannot fold to limpers.** Checking is free, so the badge is RAISE or CHECK and
  never FOLD. Same shape of special case as "there is no open from the big blind" in v5.5 —
  if a future change makes the BB fold here, it is a bug.
- **Isolation size** is `open + 1 + limpers` bb: bigger than a normal open, not smaller,
  because a limper has already shown they will put money in without a hand. Convention,
  labelled as such, like every other size in the tool.
- **Re-raises.** `PF_RERAISE`, same family × tier shape as `PF_DEFEND`. Covers both "I opened
  and they 3-bet" and "I 3-bet from a blind and they 4-bet" — the answer has the same form
  either way, and the blind families being the tighter ones is right, because that is the
  deeper of the two spots. The badge is **RE-RAISE** rather than 4-BET for exactly that
  reason: 4-BET would be wrong in half the cases it fires.
- **Raise got called.** No decision left, but it is the one moment the tool can grade *the
  raise itself* against the seat's opening range — the thing a beginner never learns from the
  result of the hand. `raised called 76o early` vs `raised called 76o button` is that test.

### The harness was testing a state the UI cannot reach

A scenario with an empty board and `bet:"pot"` used to set `need` while leaving the Preflop
row at "No raise". In the page a preflop price exists *only because* that row says someone put
money in, so the harness was handing `decide()` a price with no action behind it. It passed
only because the old routing keyed on the price. `barrelsFor()` now builds the row, and the
bare `bet` shorthand is documented as meaning `pfAct:"bet"`.

This is worth remembering as a class of bug: the harness mirrors `refresh()`, and any place it
stops mirroring it is a place the tests can go green over a broken page.

### Verification

`PARSE OK`; `node test/check.js` clean; **89 baseline rows** (25 new, all RNG-free), and **no
drift in the 64 existing ones** — the dispatch rewrite is behaviour-preserving for every spot
that already worked.

Browser at 375px: all five actions present and the row wraps to three lines without overflow;
limper counts render 1 / 2 / 3+; switching limp→raise clears the size and prompts for the
right input instead of throwing; bet↔call keeps the bucket; a preflop limp followed by a flop
falls through to the postflop read with the head count left harmlessly in the slot; Clear all
resets everything; no console errors.

### Still open

- **Phase 4** — render the `Which hands to open` guide from `PF_OPEN` / `PF_DEFEND`. This is
  now the only preflop copy that can drift from the engine, and phase 3 added a third table
  (`PF_RERAISE`) and a limp ladder that the guide says nothing about at all.
- Preflop action does not inform the **postflop** range model: `callStreetCount()` counts a
  preflop "call", but `limp` and `reraise` are invisible after the flop. Someone who got
  re-raised preflop is facing a far stronger range on the flop than the model assumes.
- 4-bet/5-bet depth and stack-offs are still outside the model; the RE-RAISE copy says to be
  ready for stacks to go in but the tool does not check whether they can.
- Fold equity is still unmodelled postflop, which is why no RAISE badge exists there.
- Chart cells are ~24px wide on mobile, under the 44px guideline.

---

## v5.8 — preflop phase 4: the guide is rendered, not written

`Which hands to open` was the last place a preflop number was typed in by hand. It is now
**built from the tables** — `PF_OPEN`, `PF_DEFEND`, `PF_RERAISE`, `pfLimpCut` — by
`renderPosGuide()`. The page cannot print a rank the engine doesn't use, because there is
nowhere left for it to come from.

5,248 characters of static markup went; `#posGuide` is an empty div the renderer fills.

### The guard, and why it exists rather than a note saying "keep these in sync"

`node test/check.js` now fails if the markup half of `felt-reader.html` contains a
hand-written rank (`&le;<n>` or `top <b>n</b>`). One exception, named explicitly in the code:
`.pos-lead`, where `&le;20` / `top 20%` is an *example of the rule*, not a cutoff.

It was tested by injecting one and confirming the run goes red and names the line. That
matters more than it sounds: a guard nobody has seen fail is a guard nobody knows works.

The alignment this replaces was done by hand in v5.6 and held for exactly as long as nobody
edited one side without the other — which is to say, until v5.7 added a limp ladder and a
third table that the guide said nothing about at all.

### What the guide gained by being generated

Writing the renderer surfaced things the hand-written version had quietly omitted:

- **Limpers.** A seat × limper-count table (6 × 3) that did not exist in any form. The page
  had one number about limping, buried in the big blind's row.
- **Re-raises.** `PF_RERAISE` shipped in v5.7 with nothing on the page about it.
- **The stretch column.** Every defend row now prints its `lean` number *and the condition
  that opens it*, in `pfLeanReason`'s own words. The old table printed one cutoff and hid the
  judgement call behind it.

### `pfLeanReason` — one condition, two renderings

`pfLeanNote` became `pfLeanReason(fam, tier, seat)` returning `{tag, note}`: `tag` for the
guide's table cell, `note` for the verdict card. `pfLeanNote` is a one-line wrapper, kept
because the verdict code reads better with it. **Don't let these drift into two functions** —
the condition the page prints and the condition the engine applies have to be the same
sentence, or the stretch column becomes a lie.

### `pctWord(n)` — derived, not written beside

The "that's roughly" column is computed from the rank, so it cannot end up describing a
different number than the one next to it. First cut had 30 landing on "about a quarter";
thresholds now sit at the midpoints between unit fractions, so each rank gets its nearest one.

### A real ambiguity this fixed

"About 2.5–3x" means *of the blind* when someone opens and *of your raise* when they come back
over the top — same words, two referents, and the player picks the number off a button. The
re-raise table header now says "as a multiple of **your** raise", the preflop size tag reads
"re-raise size (x your raise):", and `pfReRaiseAdvice` says "2.5–3x the size of your raise".

### Verification

`PARSE OK`; `check.js` clean on both counts; 89 baseline rows with **no decisive drift** —
phases 1–3 behaviour is untouched, only the re-raise copy changed (re-baselined).

In the browser, every rank the panel prints was collected with a regex and compared against a
set rebuilt from the live tables: **52 printed, 52 expected, zero mismatches.** That check is
worth re-running by hand after any change to the preflop tables; it is the thing the markup
guard cannot prove on its own.

At 375px: both new tables fit (the limp table is four columns and still doesn't overflow), no
console errors.

### Still open

- Preflop action does not inform the **postflop** range model. `callStreetCount()` counts a
  preflop "call", but `limp` and `reraise` are invisible after the flop — someone who got
  re-raised preflop is facing a far stronger range on the flop than the model assumes. This is
  the biggest remaining hole in the tool.
- The derived numbers in `PF_DEFEND` (the `open` 4x row, the `sb` min / 4x / 5x+ rows) and all
  of `PF_RERAISE` and the limp ladder are now *printed*, which makes them more load-bearing
  than when they were internal. They are reasoned, not measured.
- 4-bet/5-bet depth and stack-offs are outside the model; the RE-RAISE copy says to be ready
  for stacks to go in without checking whether they can.
- Fold equity is still unmodelled postflop, hence no RAISE badge there.
- Chart cells are ~24px wide on mobile, under the 44px guideline.

---

## v5.9 — the preflop action reaches the postflop range model

The Preflop row used to go blind the moment a board appeared: every postflop read measured you
against the same generic range whether they had limped in or 4-bet you. It doesn't now.

```
KQo on K-7-2, facing a half-pot flop bet. Only the Preflop row differs:

  not recorded   78%
  they limped    81%
  they raised    73%
  they 3-bet you 70%
```

And where it matters most, the badge moves with it: second pair on T-8-5 is a **CALL at 51%**
with nothing recorded and a **MARGINAL at 38%** against someone who 3-bet preflop.

### A range is a band now, not a cap

`_weightedRange` had one cutoff, `MODEL.preflopCap`: hands below it were trimmed as preflop
trash. It now takes a **band**:

- `hi` — the bottom. Below this they'd have folded. (This is the old cap.)
- `lo` — the top. **Above** this they'd have played *faster* than they did.

`lo` is the half the model had no concept of, and it's the half a beginner most needs. In a
limped pot nobody has aces — which is exactly why your top pair is worth more there than the
same top pair facing a 3-bet. Combos in that band are multiplied by `MODEL.preTopTrim` (0.3),
never removed: people limp aces and flat premiums, just rarely.

A limper moves **both ends, in opposite directions** — wider at the bottom (they're in with
85o) and missing the top. A single cap cannot express that, which is the whole reason for the
band.

### "No raise" means "not recorded", and must keep meaning that

`pfOppRange()` returns **null** for `check`, and the model then behaves exactly as it did.
This is deliberate and load-bearing: "No raise" is the row's default, so it means "I didn't
fill this in" far more often than it means "we both limped". Treating it as a limped pot would
quietly widen the range for every user who never touched the row.

It is also why **all 89 pre-existing baseline rows are unchanged** — the model change is
strictly additive. If a future edit makes `check` return a band, expect the whole baseline to
move, and be sure that's intended.

### Bands

| row says | lo | hi | why |
|---|---|---|---|
| not recorded | — | `MODEL.preflopCap` | unchanged behaviour |
| they limped | 0.12 | 0.90 | wide at the bottom, missing everything they'd have opened |
| they raised | 0 | 0.50 / 0.35 / 0.25 / 0.15 by tier | a raising range |
| I raised, they called | 0.06 | 0.45 | no 3-bet, so the very top is unlikely; no trash either |
| they re-raised | 0 | 0.15 / 0.10 / 0.08 / 0.05 by tier | very tight |

First cut had the limp band at `lo:0.04, hi:0.80`, which moved the equity by a single point —
the two ends were cancelling. The hands a limper is really missing go down to about the top
12%, and their bottom is *wider* than a default range, not tighter.

These are reasoned, not measured. They are the most load-bearing unmeasured numbers in the
tool, because unlike the preflop tables they move a percentage the user reads as precise.

### BUCKETS moved into the engine

The engine needed the preflop raise size's price to pick a tier. Rather than duplicate the
need values, `BUCKETS` moved above the boundary — it was always pure data. `bucketNeed(key)`
is the lookup. `test/harness.js` kept its own hand-copied `NEED` map, which was a drift seam of
exactly the kind phase 4 existed to close; it can now read the engine's.

### The warning slot has a heading

`barrelWarn` carried a hard-coded "Barrel alert." at the render site. A preflop note landed
under that heading, which was the wrong label on the right information. `decide()` now returns
`warnTitle` alongside it ("Before the flop." for the preflop notes, default unchanged). The
harness mirrors it, since the baseline measures that string.

Only two readings get a note — a limped pot and a re-raise — because those are the two that
should change how you play the hand. A barrel line still wins the slot when there is one: what
they're doing on *this* street matters more than what they did before the flop.

### Verification

`PARSE OK`; `check.js` clean on both counts; **97 baseline rows, no drift in the 89 existing
ones.**

The new rows are built as a controlled comparison: same hand, same board, same bet faced, only
the Preflop row differing. Any spread between them is the preflop read doing its job, and two
boards are covered so it isn't a quirk of one texture.

In the browser: 81 / 78 / 73 / 70 across limp / not-recorded / raised / re-raised on KQo on
K-7-2, with "No raise" returning to exactly the old number; the label names the range each
time; the note renders under "Before the flop."; no overflow at 375px, no console errors.

### Still open

- `preRange` is **not** gated on `advMode`, while the barrel signals are. In the page this is
  moot (`advMode` is set true at load and never turned off — the flag is vestigial), and the
  ungated reading is the better semantic: if the row says something, use it. Worth knowing if
  the flag is ever revived.
- The bands are reasoned, not derived from data. If this tool ever gets a hand history to
  check against, these are the numbers to check first.
- Preflop *position* still doesn't reach postflop, deliberately — equity realisation by seat
  is the easiest thing here to overfit.
- 4-bet/5-bet depth and stack-offs remain outside the model.
- Fold equity is still unmodelled postflop, hence no RAISE badge there.
- Chart cells are ~24px wide on mobile, under the 44px guideline.
