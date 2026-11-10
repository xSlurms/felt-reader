// Regression harness for Felt Reader.
// Slices felt-reader.html at the PURE ENGINE BOUNDARY and drives the real decide()
// with a seeded RNG, so runs are reproducible and comparable across edits.
const fs = require("fs");

const FILE = process.env.FR_FILE || require("path").join(__dirname, "..", "felt-reader.html");

const html = fs.readFileSync(FILE, "utf8");
const script = html.match(/<script>([\s\S]*)<\/script>/)[1];
const cut = script.indexOf("// ===== PURE ENGINE BOUNDARY =====");
if (cut < 0) throw new Error("PURE ENGINE BOUNDARY marker not found in " + FILE);
const engineSrc = script.slice(0, cut);

const engine = {};
new Function("exports", engineSrc + "\n;Object.assign(exports,{" +
  "decide,recommend,capMin,rangeBehind,boardOwnCat,boardContext,eval7,catOf,catName,parseCard,cardRank,cardSuit," +
  "equityVsRandom,equityVsBoardRange,boardDangers,heroHandWeakness,drawBreakdown,weightedRange," +
  "GRID_DATA,HAND_PCT,BUCKETS,bucketNeed,PF_OPEN,PF_SEATS,PF_RAISE_TIERS,PF_DEFEND,PF_RERAISE," +
  "PF_RANGE_BET,PF_RANGE_RERAISE,pfOppRange,heroShape," +
  "pfOpenAdvice,pfDefendAdvice,pfLimpAdvice,pfLimpCut,pfReRaiseAdvice,pfRaisedCalledAdvice,"+
  "preflopVerdict,handRankOf" +
  "});")(engine);

// Prices come from the engine's own BUCKETS now. This used to be a hand-copied map, which
// is a drift seam of exactly the kind the guide had: the tests could keep passing against
// numbers the shipped file had stopped using.
const NEED = engine.BUCKETS.reduce((m, b) => (m[b.key] = b.need, m), {});
const NO_BARRELS = () => ({ preflop:{action:'check',size:null}, flop:{action:'check',size:null}, turn:{action:'check',size:null}, river:{action:'check',size:null} });

const cards = s => (s ? s.trim().split(/\s+/).map(engine.parseCard) : []);
const lcg = seed => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

const SCENARIOS = require("./scenarios.js");

const streetOf = b => (b.length >= 5 ? "river" : b.length === 4 ? "turn" : b.length === 3 ? "flop" : "preflop");

// Mirror how the page builds the preflop row. In the page a preflop price can ONLY exist
// because the Preflop row says someone put money in, so a scenario that names a `bet` with
// an empty board has to produce that row too — otherwise the harness hands decide() a price
// with no action behind it, which is a state the UI cannot reach.
//
// `pfAct` / `pfSize` set the row directly, for the actions that aren't a plain raise:
// "limp" (pfSize is the limper count), "call" (you raised, they called) and "reraise".
function barrelsFor(s) {
  const b = s.adv ? JSON.parse(JSON.stringify(s.adv)) : NO_BARRELS();
  if (!b.preflop) b.preflop = { action: "check", size: null };
  if (s.pfAct) b.preflop = { action: s.pfAct, size: s.pfSize || null };
  else if (streetOf(cards(s.b)) === "preflop" && s.bet) b.preflop = { action: "bet", size: s.bet };
  return b;
}

// Mirror how refresh() derives the price being faced. In advanced mode the price is the
// CURRENT street's bet, and only when they were the one betting — not from the bet bucket.
function needFor(s) {
  const cur = streetOf(cards(s.b));
  if (cur === "preflop") {
    const pf = barrelsFor(s).preflop;
    const facing = pf.action === "bet" || pf.action === "reraise";
    return facing && pf.size && NEED[pf.size] != null ? NEED[pf.size] : null;
  }
  if (s.adv) {
    const st = s.adv[cur];
    return st && st.action === "bet" && st.size ? NEED[st.size] : null;
  }
  return s.bet ? NEED[s.bet] : null;
}

function run(scenarios = SCENARIOS, seed = 987654321) {
  const real = Math.random;
  const rows = scenarios.map(s => {
    Math.random = lcg(seed);
    const res = engine.decide({
      hero: cards(s.h),
      board: cards(s.b),
      opponents: s.opp || 1,
      need: needFor(s),
      seat: s.seat || null,
      advMode: !!s.adv,
      barrels: barrelsFor(s),
      iters: 14000,
    });
    return { n: s.n, res };
  });
  Math.random = real;
  return rows;
}

// The browser baseline was scraped with .textContent, which drops <b> tags and includes the
// wrapper copy renderResult adds around each block. Reproduce that exactly so the character
// counts are comparable rather than off by the markup.
const strip = h => (h || "").replace(/<[^>]+>/g, "");
const DANGER_PREFIX = "Board danger. ";
const DANGER_SUFFIX = " The equity number can't see this — it counts hands you'd never actually face here as wins.";
// The warning slot carries its own heading now (a barrel line or a preflop read).
const BARREL_PREFIX = (r) => (r.warnTitle || "Barrel alert.") + " ";
const asDom = {
  why: r => strip(r.why),
  danger: r => (r.dangerMsg ? DANGER_PREFIX + strip(r.dangerMsg) + DANGER_SUFFIX : ""),
  barrel: r => (r.barrelWarn ? BARREL_PREFIX(r) + strip(r.barrelWarn) : ""),
};

// Same field set and ordering as the browser-side digest, so the two are comparable.
function digest(rows) {
  return rows.map(({ n, res }) => {
    const outs = res.draws && res.draws.labels.length
      ? `${res.draws.totalOuts} outs`
      : "-";
    const draws = res.draws && res.draws.labels.length
      ? res.draws.labels.map(l => `${l.type} ${l.outs}`).join("+")
      : "-";
    return [
      n,
      res.badge,
      Math.round(res.equity * 100) + "%",
      // v5.0 made flags objects {label,tone}; v4.3 baseline captured them as plain strings.
      (res.dangerFlags || []).map(f => "\u26A0 " + (f && f.label !== undefined ? f.label : f)).join("+") || "-",
      res.made || "-",
      outs,
      draws,
      asDom.why(res).length,
      asDom.danger(res).length,
      asDom.barrel(res).length,
    ].join(" | ");
  }).join("\n");
}

if (require.main === module) {
  const rows = run();
  const out = digest(rows);
  console.log(out);
  if (process.env.FR_OUT) fs.writeFileSync(process.env.FR_OUT, out + "\n");
}

module.exports = { engine, run, digest, cards, NEED, lcg, SCENARIOS };
