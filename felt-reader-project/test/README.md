# Regression tests

These drive the **real** `decide()` out of `felt-reader.html`. Nothing is re-implemented
here — that was the flaw in the old `edge_test.js`, which kept its own copy of the cap
logic and so could pass while the shipped file was broken.

## How it works

`harness.js` reads `felt-reader.html`, slices the script at the `PURE ENGINE BOUNDARY`
marker, and evaluates everything above it. That half is DOM-free by construction, so the
engine runs in plain node with no browser and no dependencies.

`Math.random` is replaced with a seeded LCG before each scenario, so equity percentages
are **reproducible**. A behavioural change shows up as an exact diff rather than being
lost in Monte Carlo wobble.

## Running them

```bash
node test/check.js
```

Two checks run, and either one failing exits non-zero:

1. **Behaviour** &mdash; the engine against `baseline.txt`.
2. **Markup** &mdash; that no preflop rank is hand-written into `felt-reader.html`. The
   position guide is rendered from `PF_OPEN` / `PF_DEFEND` / `PF_RERAISE` / `pfLimpCut`, so a
   `&le;45` typed into the markup is a number that can drift away from the one the engine
   uses. `.pos-lead` is the one allowed exception, because its `&le;20` is an example of the
   rule rather than a cutoff.

Compares the current engine against `baseline.txt` and exits non-zero if any *decisive*
field drifts — badge, equity, flags, made hand, outs, draws. Copy-length changes are
reported separately, because rewording is usually intentional and shouldn't fail a run.

To see the raw table instead of a diff:

```bash
node test/harness.js
```

## Changing behaviour on purpose

1. Make the change.
2. Run `node test/check.js` and read the drift — every line should be something you meant.
3. Re-baseline: `node test/harness.js > test/baseline.txt`

## Adding a case

Add a row to `scenarios.js`:

```js
{n:"short name", h:"Ah Kd", b:"Kc 7h 2s", bet:"half"}
```

`bet` is a bucket key (`tiny` `half` `big` `pot` `over`) or `null`. `opp` sets the
opponent count. `seat` is a `PF_OPEN` key (`early` `mid` `co` `btn` `sb` `bb`).

`pfAct` / `pfSize` set the Preflop row directly, which is what picks the preflop read.
With an empty board:

| `pfAct` | `pfSize` | read |
|---|---|---|
| *(none)* | &mdash; | folded to you &mdash; `pfOpenAdvice`, OPEN / MARGINAL / FOLD with a size |
| `"limp"` | head count `"1"` `"2"` `"3"` | `pfLimpAdvice` &mdash; RAISE / MARGINAL / FOLD, or RAISE / CHECK in the BB |
| `"bet"` | bucket key | facing a raise &mdash; `pfDefendAdvice`, 3-BET / CALL / MARGINAL / FOLD |
| `"reraise"` | bucket key | they played back &mdash; `pfReRaiseAdvice`, RE-RAISE / CALL / MARGINAL / FOLD |
| `"call"` | bucket key | you raised, they called &mdash; `pfRaisedCalledAdvice`, ON TO THE FLOP |

A scenario with an empty board and a bare `bet` is shorthand for `pfAct:"bet"`: the harness
builds that Preflop row for you, because **in the page a preflop price can only exist because
the Preflop row says someone put money in**. Handing `decide()` a price with no action behind
it is a state the UI cannot reach, and a test that does it is testing nothing real.

With no `seat`, every one of these still answers &mdash; using the non-blind (or
middle-position) numbers &mdash; and says in the copy that it did.

Once there IS a board, the Preflop row reshapes the range the equity is measured against
(`pfOppRange`). A scenario with `pfAct` plus a board and `adv` tests that; one without `pfAct`
tests that the default is untouched.

Preflop, `bet` is read as a **raise tier**, not a pot fraction: `tiny` is a min-raise,
`half` and `big` both land on "standard 2.5&ndash;3x", `pot` is 4x and `over` is 5x+. The
`half`/`big` collapse is deliberate &mdash; the position guide treats 2.5&ndash;3x as one
tier, and splitting it would mean inventing a number the page doesn't print.

`opp` above 1 means players have already called the raise, which shifts the lookup one
tier tighter per extra opponent (the guide's own "cut them back a tier"). It changes the
numbers, never the stated raise size. `adv` supplies per-street barrels, and the harness derives the price from
the current street exactly as `refresh()` does:

```js
adv:{flop:{action:"bet",size:"half"}, turn:{action:"bet",size:"big"}, river:{action:"check",size:null}}
```

New scenarios are reported as `NEW` until you re-baseline.

## The cases that matter most

These encode the leaks the tool exists to guard, so they're the ones to protect:

| Scenario | Must stay |
|---|---|
| `preflop 72o pot` / `preflop J3o pot` | FOLD — pot odds must never drive a preflop verdict |
| `flop bottom pair monotone` | FOLD — weak hand into a flush |
| `river weak 2pair 3barrel` | FOLD — low two pair on a paired board vs three barrels |
| `playing the board` | never CALL / never raise |
| `non-nut flush river 2` / `non-nut straight` | `not the nuts` flag + a CALL cap |
| `turn two-tone duplicate` | exactly one `flush draw` flag, not two |
| `open AJo early` / `open AJo cutoff` | MARGINAL vs OPEN &mdash; the same hand must answer differently by seat |
| `open 72o button` | FOLD &mdash; the widest seat in the table still folds the worst hand |
| `open KQo big blind` | no open exists from the BB |
| `defend K9o BB 3x` vs the same hand from any other seat | MARGINAL only in the big blind &mdash; the discount is the whole reason that seat defends wider |
| `defend K9o BB 3x` / `defend K9o BB 4x` | MARGINAL &rarr; FOLD &mdash; raise size has to move the answer |
| `defend 72o BB min-raise` | FOLD &mdash; the widest defend in the table still folds the worst hand |
| `defend QTo button 3x` / `defend QTo button 2.5x` | identical &mdash; 2.5x and 3x are one tier, by design |
| `defend 86s BB 3x` / `defend 86s BB 3x 1caller` | CALL &rarr; FOLD &mdash; the per-caller tier shift must bite |
| `defend AKo BB 3x` / `defend AKs middle 5x` | 3-BET &mdash; a badge postflop never gives, because there is no fold-equity model there |
| `limp 72o BB 1` | CHECK, never FOLD &mdash; there is nothing to fold when the flop is already yours |
| `limp 54s cutoff 1` / `limp 54s cutoff 3` | RAISE &rarr; MARGINAL &mdash; limper count has to move the answer |
| `limp 55 middle 2` / `limp 76o button 2` | same band, opposite advice &mdash; the overlimp call is resolved by seat, not left as a condition |
| `limp J7o cutoff 1` | FOLD &mdash; shape, not rank, is what refuses the cheap flop |
| `reraise T9s button 3x` / `reraise T9s BB 3x` | CALL &rarr; MARGINAL &mdash; the blinds continue tighter against a re-raise |
| `reraise 86s cutoff 3x` | FOLD &mdash; a hand fine to raise with is not fine to call a re-raise with |
| `raised called 76o early` / `raised called 76o button` | same badge, opposite verdict on the raise itself |
| `K72 toppair pf not recorded` | must stay identical to the pre-v5.9 number &mdash; "No raise" means *not recorded* |
| the five `K72 toppair pf *` rows | one hand, one board, one bet: the equity spread between them IS the preflop read |
| `T85 secondpair pf not rec` / `pf they 3bet` | CALL &rarr; MARGINAL &mdash; the preflop action has to be able to move a badge |
