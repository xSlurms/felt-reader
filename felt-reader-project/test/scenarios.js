// Regression scenarios for Felt Reader. Each entry drives the real refresh() pipeline.
// h = hole cards, b = board, bet = bucket key or null, adv = advanced-mode barrels, opp = opponent count.
var SCENARIOS = [
  {n:"preflop AA no bet",        h:"Ah Ad", b:"",                  bet:null},
  {n:"preflop AA pot",           h:"Ah Ad", b:"",                  bet:"pot"},
  {n:"preflop 72o pot",          h:"7c 2d", b:"",                  bet:"pot"},
  {n:"preflop 72o half",         h:"7c 2d", b:"",                  bet:"half"},
  {n:"preflop J3o pot",          h:"Jc 3d", b:"",                  bet:"pot"},
  {n:"preflop AKs vs3 half",     h:"Ah Kh", b:"",                  bet:"half", opp:3},
  {n:"flop top pair dry",        h:"Ah Kd", b:"Kc 7h 2s",          bet:"half"},
  {n:"flop bottom pair monotone",h:"7h 2d", b:"As Ks 2s",          bet:"half"},
  {n:"flop weak 2pair paired",   h:"5c 4c", b:"Ks Kh 5d",          bet:"half"},
  {n:"river weak 2pair 3barrel", h:"5c 4c", b:"Ks Kh 5d 8c 3h",    bet:"big",
     adv:{flop:{action:"bet",size:"half"},turn:{action:"bet",size:"big"},river:{action:"bet",size:"big"}}},
  {n:"playing the board",        h:"2c 3d", b:"As Ks Qs Js Ts",    bet:"pot"},
  {n:"flop flush draw",          h:"Ah Kh", b:"7h 2h 9s",          bet:"half"},
  {n:"flop OESD",                h:"9c 8c", b:"7h 6d 2s",          bet:"half"},
  {n:"river bluff catch",        h:"Ah Qd", b:"Ks 7h 2c 9d 4s",    bet:"big"},
  {n:"strong hand no bet",       h:"Ah Ad", b:"Ac 7h 2c",          bet:null},
  {n:"underpair 2 overcards",    h:"8h 8d", b:"Ts 9s 2h",          bet:"half"},
  {n:"turn two-tone duplicate",  h:"7c 7d", b:"As Ks Qh Jh",       bet:"half"},
  {n:"adv flop call turn bet",   h:"Ah Jd", b:"Jc 8h 3s 5d",       bet:null,
     adv:{flop:{action:"call",size:"half"},turn:{action:"bet",size:"big"},river:{action:"check",size:null}}},
  {n:"multiway flop opp4",       h:"Ah Kd", b:"Kc 7h 2s",          bet:"half", opp:4},
  {n:"overbet vs trips",         h:"9c 9d", b:"9s 4h 2c",          bet:"over"},
  {n:"non-nut flush river",      h:"Kh 3h", b:"Ah 7h 2h 9d 4s",    bet:"big"},
  {n:"weak hand air flop",       h:"7c 3d", b:"As Kh Qd",          bet:"half"},
  // K-high flush with the Ah live, and the bottom end of a straight: hero HAS the hand
  // but not the nuts. v4.3 suppressed all warning here.
  {n:"non-nut flush river 2",    h:"Kh 3h", b:"Qh 7h 2h 9d 4s",    bet:"big"},
  {n:"non-nut straight",         h:"8c 7d", b:"9s Ts Jh 2c 3d",    bet:"big"},
  // --- v5.1: boards where the category is mostly the board's, not yours ---
  // These are the spots where absolute hand strength lied. 2-2 on A-A-A read as a
  // 77% CALL in v5.0 because every hand scored "trips or better" and the range
  // filter collapsed to uniform.
  {n:"worst boat on trips board", h:"2s 2h", b:"Ac Ad Ah",          bet:"over"},
  {n:"kickers only on trips",     h:"Kc Qd", b:"Ac Ad Ah",          bet:"big"},
  {n:"quads on trips board",      h:"Ac Kd", b:"As Ad Ah",          bet:"big"},
  {n:"small 2pair paired board",  h:"3c 3d", b:"Ks Kh 5d",          bet:"big"},
  {n:"trips good kicker",         h:"Kc Jd", b:"Ks Kh 5d",          bet:"big"},
  {n:"top set unpaired",          h:"Ac Ad", b:"As 7h 2c",          bet:"big"},
  {n:"boat on double-paired",     h:"Kc Qd", b:"Ac Ad Ks Kh 7c",    bet:"big"},
  {n:"nut straight",              h:"8c 7d", b:"4s 5h 6d",          bet:"big"},

  // --- preflop, folded to you (seat set, no raise). These are a lookup, not a simulation,
  // so they should be stone-stable: any drift here is a change to PF_OPEN, not RNG wobble.
  {n:"open AA early",             h:"As Ad", b:"",   seat:"early"},
  {n:"open AJo early",            h:"Ah Jd", b:"",   seat:"early"},   // rank 12, outside 10
  {n:"open AJo cutoff",           h:"Ah Jd", b:"",   seat:"co"},      // same hand, inside 40
  {n:"open 76o early",            h:"7h 6d", b:"",   seat:"early"},   // clear fold
  {n:"open 76o button",           h:"7h 6d", b:"",   seat:"btn"},     // rank 57, inside 70
  {n:"open K5o button",           h:"Kh 5d", b:"",   seat:"btn"},
  {n:"open 72o button",           h:"7h 2d", b:"",   seat:"btn"},     // rank 100, fold anywhere
  {n:"open 55 middle",            h:"5h 5d", b:"",   seat:"mid"},
  {n:"open A9s small blind",      h:"As 9s", b:"",   seat:"sb"},
  {n:"open KQo big blind",        h:"Kh Qd", b:"",   seat:"bb"},      // no open exists
  {n:"open J9s middle marginal",  h:"Js 9s", b:"",   seat:"mid"},     // rank 11 -> inside 20

  // --- preflop, facing a raise (seat + their raise size). Also a lookup, so also
  // RNG-free and stone-stable. `bet` is the raise tier: tiny=min 2x, half=2.5x, big=3x,
  // pot=4x, over=5x+. The pairs here are the point -- same hand, one input changed.
  {n:"defend 86s BB min-raise",   h:"8h 6h", b:"",   seat:"bb", bet:"tiny"},  // 27, in 60
  {n:"defend T7o BB min-raise",   h:"Th 7d", b:"",   seat:"bb", bet:"tiny"},  // 59, in 60
  {n:"defend K5o BB min-raise",   h:"Kh 5d", b:"",   seat:"bb", bet:"tiny"},  // 63, lean band
  {n:"defend 72o BB min-raise",   h:"7h 2d", b:"",   seat:"bb", bet:"tiny"},  // widest seat still folds it
  {n:"defend 86s BB 3x",          h:"8h 6h", b:"",   seat:"bb", bet:"big"},   // 27, in 30
  {n:"defend K9o BB 3x",          h:"Kh 9d", b:"",   seat:"bb", bet:"big"},   // 35 -> depends who raised
  {n:"defend K9o BB 4x",          h:"Kh 9d", b:"",   seat:"bb", bet:"pot"},   // same hand, bigger raise
  {n:"defend AKo BB 3x",          h:"Ah Kd", b:"",   seat:"bb", bet:"big"},   // 5 -> 3-bet
  {n:"defend QTo SB 3x",          h:"Qh Td", b:"",   seat:"sb", bet:"big"},   // 22, lean fold
  {n:"defend 55 SB 3x",           h:"5h 5d", b:"",   seat:"sb", bet:"big"},   // 20, the guide's anchor
  {n:"defend J9s cutoff 3x",      h:"Js 9s", b:"",   seat:"co", bet:"big"},   // 11, in 15
  {n:"defend QTo button 3x",      h:"Qh Td", b:"",   seat:"btn", bet:"big"},  // 22 -> button note
  {n:"defend QTo button 2.5x",    h:"Qh Td", b:"",   seat:"btn", bet:"half"}, // 2.5x and 3x are ONE tier
  {n:"defend QTo middle 3x",      h:"Qh Td", b:"",   seat:"mid", bet:"big"},  // 22 -> position note
  {n:"defend QTo no seat 3x",     h:"Qh Td", b:"",              bet:"big"},   // 22 -> no-seat fallback
  {n:"defend K9o button 3x",      h:"Kh 9d", b:"",   seat:"btn", bet:"big"},  // 35, outside
  {n:"defend 54s button min",     h:"5s 4s", b:"",   seat:"btn", bet:"tiny"}, // 28, in 45
  {n:"defend AKs middle 5x",      h:"As Ks", b:"",   seat:"mid", bet:"over"}, // 2 -> 4-bet band
  {n:"defend 99 cutoff 5x",       h:"9h 9d", b:"",   seat:"co", bet:"over"},  // 7 -> call, not raise
  {n:"defend 86s BB 3x 1caller",  h:"8h 6h", b:"",   seat:"bb", bet:"big", opp:2}, // tier shift
  {n:"defend J9s BB 3x 2callers", h:"Js 9s", b:"",   seat:"bb", bet:"big", opp:3}, // two tier shifts

  // --- preflop, someone limped. pfSize is the head count, not a bet bucket.
  {n:"limp AJo cutoff 1",         h:"Ah Jd", b:"", seat:"co",  pfAct:"limp", pfSize:"1"}, // 12, in 40
  {n:"limp AJo cutoff 3",         h:"Ah Jd", b:"", seat:"co",  pfAct:"limp", pfSize:"3"}, // 3 limpers -> cut 20
  {n:"limp 54s cutoff 1",         h:"5s 4s", b:"", seat:"co",  pfAct:"limp", pfSize:"1"}, // 28, inside 40
  {n:"limp 54s cutoff 3",         h:"5s 4s", b:"", seat:"co",  pfAct:"limp", pfSize:"3"}, // same hand, cut 20 -> shape band
  {n:"limp J7o cutoff 1",         h:"Jh 7d", b:"", seat:"co",  pfAct:"limp", pfSize:"1"}, // 64, no shape
  {n:"limp 54s early 1",          h:"5s 4s", b:"", seat:"early", pfAct:"limp", pfSize:"1"},
  {n:"limp T9s BB 1",             h:"Ts 9s", b:"", seat:"bb",  pfAct:"limp", pfSize:"1"}, // 10, raise at it
  {n:"limp 72o BB 1",             h:"7h 2d", b:"", seat:"bb",  pfAct:"limp", pfSize:"1"}, // BB never folds
  {n:"limp 72o button 1",         h:"7h 2d", b:"", seat:"btn", pfAct:"limp", pfSize:"1"},
  {n:"limp 55 no seat 2",         h:"5h 5d", b:"",             pfAct:"limp", pfSize:"2"}, // no-seat default
  {n:"limp 55 middle 2",          h:"5h 5d", b:"", seat:"mid", pfAct:"limp", pfSize:"2"}, // shape band, early -> fold
  {n:"limp 76o button 2",         h:"7h 6d", b:"", seat:"btn", pfAct:"limp", pfSize:"2"}, // shape band, late -> take the flop

  // --- preflop, you raised and they re-raised.
  {n:"reraise AA button 3x",      h:"As Ad", b:"", seat:"btn", pfAct:"reraise", pfSize:"big"},
  {n:"reraise 99 button 3x",      h:"9h 9d", b:"", seat:"btn", pfAct:"reraise", pfSize:"big"}, // 7, call band
  {n:"reraise AJo button 3x",     h:"Ah Jd", b:"", seat:"btn", pfAct:"reraise", pfSize:"big"}, // 12, marginal
  {n:"reraise KQo button 3x",     h:"Kh Qd", b:"", seat:"btn", pfAct:"reraise", pfSize:"big"}, // 9, call
  {n:"reraise T9s button 3x",     h:"Ts 9s", b:"", seat:"btn", pfAct:"reraise", pfSize:"big"}, // 10, in 10
  {n:"reraise T9s BB 3x",         h:"Ts 9s", b:"", seat:"bb",  pfAct:"reraise", pfSize:"big"}, // same hand, blinds are tighter
  {n:"reraise AJo button 5x",     h:"Ah Jd", b:"", seat:"btn", pfAct:"reraise", pfSize:"over"},
  {n:"reraise 86s cutoff 3x",     h:"8h 6h", b:"", seat:"co",  pfAct:"reraise", pfSize:"big"}, // 27, fold
  {n:"reraise AKs no seat 3x",    h:"As Ks", b:"",             pfAct:"reraise", pfSize:"big"},

  // --- preflop, you raised and got called. No decision left, but the open gets graded.
  {n:"raised called AKo early",   h:"Ah Kd", b:"", seat:"early", pfAct:"call", pfSize:"big"},  // 5, in range
  {n:"raised called 76o early",   h:"7h 6d", b:"", seat:"early", pfAct:"call", pfSize:"big"},  // 57, was a leak
  {n:"raised called 76o button",  h:"7h 6d", b:"", seat:"btn",   pfAct:"call", pfSize:"big"},  // 57, fine there
  {n:"raised called AKo no seat", h:"Ah Kd", b:"",               pfAct:"call", pfSize:"big"},

  // --- the preflop action reaching the POSTFLOP range model. Same hand, same board, same
  // bet faced: only the Preflop row differs, so any equity spread between these rows is the
  // preflop read doing its job. "not recorded" must stay identical to the old behaviour.
  {n:"K72 toppair pf not recorded", h:"Kc Qd", b:"Kh 7d 2c", adv:{flop:{action:"bet",size:"half"},turn:{action:"check",size:null},river:{action:"check",size:null}}},
  {n:"K72 toppair pf limped",       h:"Kc Qd", b:"Kh 7d 2c", pfAct:"limp",    pfSize:"2", adv:{flop:{action:"bet",size:"half"},turn:{action:"check",size:null},river:{action:"check",size:null}}},
  {n:"K72 toppair pf they raised",  h:"Kc Qd", b:"Kh 7d 2c", pfAct:"bet",     pfSize:"big", adv:{flop:{action:"bet",size:"half"},turn:{action:"check",size:null},river:{action:"check",size:null}}},
  {n:"K72 toppair pf they 3bet",    h:"Kc Qd", b:"Kh 7d 2c", pfAct:"reraise", pfSize:"big", adv:{flop:{action:"bet",size:"half"},turn:{action:"check",size:null},river:{action:"check",size:null}}},
  {n:"K72 toppair pf I raised",     h:"Kc Qd", b:"Kh 7d 2c", pfAct:"call",    pfSize:"big", adv:{flop:{action:"bet",size:"half"},turn:{action:"check",size:null},river:{action:"check",size:null}}},
  // a second texture, so the effect isn't a quirk of one board
  {n:"T85 secondpair pf not rec",   h:"8h 7h", b:"Ts 8d 5c", adv:{flop:{action:"bet",size:"half"},turn:{action:"check",size:null},river:{action:"check",size:null}}},
  {n:"T85 secondpair pf limped",    h:"8h 7h", b:"Ts 8d 5c", pfAct:"limp",    pfSize:"2", adv:{flop:{action:"bet",size:"half"},turn:{action:"check",size:null},river:{action:"check",size:null}}},
  {n:"T85 secondpair pf they 3bet", h:"8h 7h", b:"Ts 8d 5c", pfAct:"reraise", pfSize:"big", adv:{flop:{action:"bet",size:"half"},turn:{action:"check",size:null},river:{action:"check",size:null}}}
];
if (typeof module !== "undefined") module.exports = SCENARIOS;
