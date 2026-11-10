// Diff the current engine's behavior against a saved baseline.
//   node check.js                 -> compare against baseline-v4.3.txt
//   node check.js <baseline.txt>  -> compare against something else
// Exits non-zero if any DECISIVE field drifts (badge / equity / flags / made / outs / draws).
// Copy-length fields are reported separately, since intentional rewrites change them.
const fs = require("fs");
const { run, digest } = require("./harness.js");

// ---- phase 4 invariant: no preflop rank is typed into the markup by hand ----
// The position guide is BUILT from PF_OPEN / PF_DEFEND / PF_RERAISE / pfLimpCut, so the page
// physically cannot print a number the engine doesn't use. That guarantee only holds while
// nobody hand-writes one back in, which is exactly what used to happen. This catches it.
//
// It checks the markup half only (everything before <script>), where a "&le;42" can only be
// a hand-typed rank. The engine half builds the same strings from the tables at runtime.
function checkNoHardCodedRanks() {
  const file = process.env.FR_FILE || require("path").join(__dirname, "..", "felt-reader.html");
  const html = fs.readFileSync(file, "utf8");
  const markup = html.slice(0, html.indexOf("<script>"));
  const hits = [];
  markup.split("\n").forEach((line, i) => {
    // "top <b>20%</b>" in the lead is an example OF the rule, not a range cutoff, so the
    // lead line is the one allowed exception and is named explicitly.
    if (line.includes('class="pos-lead"')) return;
    const m = line.match(/&le;\s*\d+|top <b>\d+<\/b>/g);
    if (m) hits.push("  line " + (i + 1) + ": " + m.join(", ") + "  --  " + line.trim().slice(0, 90));
  });
  if (hits.length) {
    console.log("HAND-WRITTEN RANKS IN MARKUP (" + hits.length + ") - these can drift from the engine:");
    console.log(hits.join("\n"));
    console.log("\nRender them from the preflop tables instead (see renderPosGuide).\n");
    return false;
  }
  return true;
}
const ranksClean = checkNoHardCodedRanks();

const baseFile = process.argv[2] || require("path").join(__dirname, "baseline.txt");
const base = fs.readFileSync(baseFile, "utf8").split("\n")
  .filter(l => l.trim() && !l.startsWith("#") && !l.startsWith("name |"))
  .map(l => l.replace(/Made hand/g, ""));

const now = digest(run()).split("\n").filter(l => l.trim());

const F = { NAME:0, BADGE:1, EQ:2, FLAGS:3, MADE:4, OUTS:5, DRAWS:6, WHY:7, DANGER:8, BARREL:9 };
const DECISIVE = [F.BADGE, F.EQ, F.FLAGS, F.MADE, F.OUTS, F.DRAWS];
const COPY = [F.WHY, F.DANGER, F.BARREL];
const LABEL = ["name","badge","equity","flags","made","outs","draws","why.len","danger.len","barrel.len"];

// the baseline's outs field carries the whole DOM line ("9 outs36% to improve..."); keep the count
const fields = l => l.split("|").map((f, i) => {
  f = f.trim();
  return i === F.OUTS ? f.replace(/^(\d+ outs).*/, "$1") : f;
});

const baseMap = new Map(base.map(l => [fields(l)[0], fields(l)]));
let decisiveDrift = [], copyDrift = [], missing = [], added = [];

now.forEach(l => {
  const f = fields(l);
  const b = baseMap.get(f[0]);
  if (!b) { added.push(f[0]); return; }
  baseMap.delete(f[0]);
  DECISIVE.forEach(i => { if (b[i] !== f[i]) decisiveDrift.push({ s: f[0], k: LABEL[i], was: b[i], now: f[i] }); });
  COPY.forEach(i => { if (b[i] !== f[i]) copyDrift.push({ s: f[0], k: LABEL[i], was: b[i], now: f[i] }); });
});
baseMap.forEach((_, k) => missing.push(k));

const pad = s => String(s).padEnd(26);
if (added.length)   console.log("NEW scenarios (no baseline): " + added.join(", ") + "\n");
if (missing.length) console.log("MISSING from run: " + missing.join(", ") + "\n");

if (decisiveDrift.length) {
  console.log("DECISIVE DRIFT (" + decisiveDrift.length + "):");
  decisiveDrift.forEach(d => console.log("  " + pad(d.s) + d.k.padEnd(11) + JSON.stringify(d.was) + "  ->  " + JSON.stringify(d.now)));
} else {
  console.log("No decisive drift: badge, equity, flags, made hand, outs and draws all match.");
}
if (copyDrift.length) {
  console.log("\ncopy-length changes (" + copyDrift.length + "):");
  copyDrift.forEach(d => console.log("  " + pad(d.s) + d.k.padEnd(11) + d.was + "  ->  " + d.now));
}
if (ranksClean) console.log("\nMarkup clean: every preflop rank on the page is rendered from the tables.");
process.exit(decisiveDrift.length || !ranksClean ? 1 : 0);
