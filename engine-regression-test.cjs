const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { performance } = require("node:perf_hooks");

const context = { performance };
const source = fs.readFileSync(path.join(__dirname, "engine.js"), "utf8");
vm.runInNewContext(source.replace(
  "globalScope.ShogiEngine = Object.freeze({",
  "globalScope.SearchChecks = { createSearchContext, losingRepetitionPenalty, unansweredPawnCaptures }; globalScope.ShogiEngine = Object.freeze({"
), context);
vm.runInNewContext(fs.readFileSync(path.join(__dirname, "kif.js"), "utf8"), context);
const engine = context.ShogiEngine;
const kif = context.ShogiKif;
const checks = context.SearchChecks;

// Replay the supplied game, checking both legality and KIF coordinates.
const states = [{ ...engine.createPosition(), positionHistory: [] }];
const moves = [];
const records = [];
const symbols = { 歩: "P", 香: "L", 桂: "N", 銀: "S", 金: "G", 角: "B", 飛: "R", 玉: "K" };
const lines = fs.readFileSync(path.join(__dirname, "tests/fixtures/pawn-repetition.kif"), "utf8").split(/\r?\n/);
for (const line of lines) {
  const match = line.match(/^(\d+)\s+(.+)$/);
  if (!match) continue;
  const num = Number(match[1]);
  assert.equal(num, states.length, "Fixture move numbers must be consecutive");
  const notation = match[2];
  const player = num % 2 ? "black" : "white";
  const to = notation.startsWith("同") ? { ...moves.at(-1).to } : {
    row: "一二三四五六七八九".indexOf(notation[1]),
    col: 9 - "０１２３４５６７８９".indexOf(notation[0]),
  };
  const origin = notation.match(/\((\d)(\d)\)/);
  const move = notation.includes("打") ? {
    drop: true, piece: symbols[notation[2]], player, to,
  } : {
    from: { row: Number(origin[2]) - 1, col: 9 - Number(origin[1]) },
    to, player, promote: notation.includes("成"),
  };
  const state = states.at(-1);
  assert(engine.generateLegalMoves(state, player).some(m => engine.moveKey(m) === engine.moveKey(move)), `Fixture move ${num} must be legal`);
  const record = kif.createMoveRecord(state, move);
  assert.equal(kif.formatMove(record, records.at(-1)), notation);
  const positionHistory = [...state.positionHistory, engine.createPositionRecord(state, player)].slice(-32);
  states.push({ ...engine.applyMove(state, move), positionHistory });
  moves.push(move);
  records.push(record);
}
assert.equal(moves.length, 147);
assert(engine.isKingInCheck(states[147], "white"));
assert.equal(engine.generateLegalMoves(states[147], "white").length, 0);
assert.equal(JSON.stringify(states[59].board), JSON.stringify(states[67].board));
assert.equal(JSON.stringify(states[67].board), JSON.stringify(states[75].board));

// Different hands are a progress warning, never an actual repetition draw.
const repeated = engine.applyMove(states[67], moves[67]);
assert(checks.losingRepetitionPenalty(repeated, checks.createSearchContext(states[67])) > 0);
assert.equal(checks.losingRepetitionPenalty(repeated, checks.createSearchContext({ ...states[67], positionHistory: [] })), 0);
const improved = { ...repeated, hands: { black: { ...repeated.hands.black }, white: { ...repeated.hands.white, P: 10 } } };
assert.equal(checks.losingRepetitionPenalty(improved, checks.createSearchContext(states[67])), 0, "Gaining material in a repeated arrangement must remain useful");
const wrongTurnHistory = [{ ...engine.createPositionRecord(repeated, "white"), handBalance: -10000 }];
assert.equal(checks.losingRepetitionPenalty(repeated, checks.createSearchContext({ ...states[67], positionHistory: wrongTurnHistory })), 0, "The side to move is part of the arrangement");

const offeredPawn = engine.applyMove(states[59], moves[59]);
assert(checks.unansweredPawnCaptures(offeredPawn, moves[59]).length > 0, "An exposed pawn should get another full ply");
const defendedPawn = engine.applyMove(states[61], moves[61]);
assert.equal(checks.unansweredPawnCaptures(defendedPawn, moves[61]).length, 0, "An immediate recapture already belongs to quiescence");

const results = [];
for (const ply of [67, 69, 71, 73]) {
  const state = states[ply];
  const started = performance.now();
  const move = engine.chooseCpuMove(state);
  const elapsed = performance.now() - started;
  assert(move);
  assert(engine.generateLegalMoves(state, "white").some(m => engine.moveKey(m) === engine.moveKey(move)));
  assert.notEqual(engine.moveKey(move), engine.moveKey(moves[ply]), `Move ${ply + 1} must break the material-losing pawn cycle`);
  assert.equal(checks.losingRepetitionPenalty(engine.applyMove(state, move), checks.createSearchContext(state)), 0, "The replacement must make progress outside the losing arrangement");
  assert(elapsed < 3500, `Search exceeded budget: ${elapsed.toFixed(0)}ms`);
  results.push({ beforeMove: ply + 1, recorded: kif.formatMove(records[ply], records[ply - 1]), chosen: kif.formatMove(kif.createMoveRecord(state, move), records[ply - 1]), elapsedMs: Math.round(elapsed), completedDepth: engine.getSearchStats().completedDepth });
}

// Simulate a slow device expiring before the first iteration finishes.
let clockReads = 0;
context.performance = { now: () => clockReads++ === 0 ? 0 : 10000 };
const fallbackMove = engine.chooseCpuMove(states[91]);
context.performance = performance;
assert.equal(engine.getSearchStats().completedDepth, 0);
assert(engine.generateLegalMoves(states[91], "white").some(m => engine.moveKey(m) === engine.moveKey(fallbackMove)));
assert.notEqual(engine.moveKey(fallbackMove), engine.moveKey(moves[91]), "The fallback should not ignore the immediate loss of the pawn on 46");

// A king with no escape must still be allowed to interpose a pawn.
const board = engine.createEmptyBoard();
const put = (row, col, piece, owner) => { board[row][col] = { piece, owner, promoted: false }; };
put(0, 0, "K", "white");
put(8, 8, "K", "black");
put(0, 8, "R", "black");
put(3, 1, "R", "black");
put(2, 0, "G", "black");
const defence = { ...engine.createPosition({ board }), positionHistory: [] };
defence.hands.white.P = 1;
const defences = engine.generateLegalMoves(defence, "white");
assert(defences.length > 0 && defences.every(m => m.drop && m.piece === "P"));
defence.positionHistory = defences.map(move => {
  const record = engine.createPositionRecord(engine.applyMove(defence, move), "black");
  return { ...record, handBalance: record.handBalance - 1000 };
});
const defenceMove = engine.chooseCpuMove(defence);
assert(defences.some(m => engine.moveKey(m) === engine.moveKey(defenceMove)), "A necessary pawn interposition must remain legal and selectable");
assert(!engine.isKingInCheck(engine.applyMove(defence, defenceMove), "white"));

// A useful pawn attack must still take precedence over a historical loss.
const matingBoard = engine.createEmptyBoard();
const matingPieces = [
  [0, 0, "K", "white"], [8, 4, "K", "black"],
  [5, 4, "R", "white"], [6, 4, "P", "white"],
  [6, 3, "G", "white"], [6, 5, "G", "white"],
  [8, 3, "L", "black"], [8, 5, "L", "black"],
];
for (const [row, col, piece, owner] of matingPieces) matingBoard[row][col] = { piece, owner, promoted: false };
const pawnMate = { ...engine.createPosition({ board: matingBoard }), positionHistory: [] };
const pawnPush = { from: { row: 6, col: 4 }, to: { row: 7, col: 4 }, player: "white", promote: false };
const afterPawnPush = engine.applyMove(pawnMate, pawnPush);
const mateRecord = engine.createPositionRecord(afterPawnPush, "black");
pawnMate.positionHistory = [{ ...mateRecord, handBalance: mateRecord.handBalance - 2000 }];
assert(checks.losingRepetitionPenalty(afterPawnPush, checks.createSearchContext(pawnMate)) > 0);
const matingMove = engine.chooseCpuMove(pawnMate);
assert.equal(pawnMate.board[matingMove.from.row][matingMove.from.col].piece, "P");
const mated = engine.applyMove(pawnMate, matingMove);
assert(engine.isKingInCheck(mated, "black"));
assert.equal(engine.generateLegalMoves(mated, "black").length, 0, "The pawn attack must still deliver mate");

console.log(JSON.stringify({ replayedMoves: moves.length, cycleBreaks: results, timeoutFallback: engine.moveKey(fallbackMove), necessaryInterposition: engine.moveKey(defenceMove), pawnMate: engine.moveKey(matingMove) }));
