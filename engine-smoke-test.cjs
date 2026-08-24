const fs = require("fs");
const vm = require("vm");
const { performance } = require("perf_hooks");

function element() {
  return {
    classList: { add() {} },
    dataset: {},
    appendChild() {},
    addEventListener() {},
    setAttribute() {},
    innerHTML: "",
    textContent: "",
    disabled: false,
    tabIndex: 0,
  };
}

const elements = new Map();
const document = {
  getElementById(id) {
    if (!elements.has(id)) elements.set(id, element());
    return elements.get(id);
  },
  createElement() {
    return element();
  },
};

const source = ["engine.js", "kif.js", "app.js"]
  .map((file) => fs.readFileSync(file, "utf8"))
  .join("\n");
const testMath = Object.create(Math);
testMath.random = () => 0.25;

const context = {
  document,
  window: { confirm: () => true },
  Math: testMath,
  performance,
  setTimeout,
  console,
};
vm.runInNewContext(source, context, { filename: "app.js" });
const engine = context.ShogiEngine;
const kif = context.ShogiKif;
const app = context.ShogiApp;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const cpuEvaluation = document.getElementById("cpu-evaluation");
assert(
  cpuEvaluation.title.includes("対局パラメータ") &&
    cpuEvaluation.title.includes("駒価値：歩") &&
    cpuEvaluation.title.includes("成駒価値：と") &&
    cpuEvaluation.title.includes("持ち駒加点：+7.5%"),
  "Hovering over the CPU face should show the game's randomized parameters"
);

function createBarePosition() {
  const board = engine.createEmptyBoard();
  board[8][0] = { piece: "K", owner: engine.PLAYERS.PLAYER, promoted: false };
  board[0][8] = { piece: "K", owner: engine.PLAYERS.CPU, promoted: false };
  return engine.createPosition({ board });
}

const cautiousRookProfile = engine.createPieceValueProfile(
  (() => {
    const values = [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 1];
    return () => values.shift();
  })()
);
const cautiousBishopProfile = engine.createPieceValueProfile(
  (() => {
    const values = [0.5, 0.5, 0.5, 0.5, 0.5, 1, 0];
    return () => values.shift();
  })()
);
assert(
  cautiousRookProfile.pieces.R > cautiousBishopProfile.pieces.R,
  "Different games should be able to value the rook differently"
);
assert(
  cautiousBishopProfile.pieces.B > cautiousRookProfile.pieces.B,
  "Different games should be able to value the bishop differently"
);
assert(cautiousRookProfile.pieces.K === 10000, "The king value must never be randomized");
assert(
  engine.createHandPieceBonusRate(() => 0) === 0.05 &&
    engine.createHandPieceBonusRate(() => 1) === 0.15,
  "A game's hand-piece bonus should be randomized between 5% and 15%"
);
const profiledPosition = engine.createPosition({
  pieceValues: cautiousRookProfile.pieces,
  promotedPieceValues: cautiousRookProfile.promoted,
  handPieceBonusRate: 0.14,
});
const profiledMove = engine.generateLegalMoves(profiledPosition, engine.PLAYERS.PLAYER)[0];
assert(
  engine.applyMove(profiledPosition, profiledMove).pieceValues === cautiousRookProfile.pieces,
  "A game's piece values should remain fixed while searching future positions"
);
assert(
  engine.applyMove(profiledPosition, profiledMove).handPieceBonusRate === 0.14,
  "A game's hand-piece bonus should remain fixed while searching future positions"
);

app.onSquareClick(6, 4);
assert(app.state.selected?.type === "board", "Clicking a player piece should select it");
app.onSquareClick(6, 4);
assert(app.state.selected === null, "Clicking the selected board piece should cancel selection");

app.state.hands.black.P = 1;
app.onHandPieceClick("P");
assert(app.state.selected?.type === "drop", "Clicking a held piece should select it");
app.onHandPieceClick("P");
assert(app.state.selected === null, "Clicking the selected held piece should cancel selection");
app.resetGame(false);
assert(app.state.currentPlayer === engine.PLAYERS.CPU, "CPU should move first when assigned sente");
assert(app.state.cpuThinking, "CPU should enter thinking state when moving first");
app.flipBoard();
assert(app.state.boardFlipped, "The board should be flippable while the CPU is thinking");
app.resetGame(true);
assert(app.state.currentPlayer === engine.PLAYERS.PLAYER, "Player should move first when assigned sente");
assert(!app.state.cpuThinking, "CPU should not think during the player's opening turn");
assert(app.state.boardFlipped, "Restarting should preserve the chosen board orientation");
app.flipBoard();
assert(!app.state.boardFlipped, "The board should return to its original orientation");

app.makeMove({
  from: { row: 6, col: 4 },
  to: { row: 5, col: 4 },
  promote: false,
  player: engine.PLAYERS.PLAYER,
});
assert(app.state.moveHistory.length === 1, "Played moves should be recorded for KIF export");
app.state.winner = engine.PLAYERS.PLAYER;
app.render();
assert(!app.copyKifButton.hidden, "The KIF copy button should appear after the game");
const playerWinKif = kif.generate(app.state);
assert(playerWinKif.includes("先手：あなた"), "KIF should identify the player as sente");
assert(playerWinKif.includes("   1 ５六歩(57)"), "KIF should use standard Japanese coordinates");
assert(playerWinKif.includes("   2 詰み"), "KIF should include checkmate as a terminal move");
assert(playerWinKif.includes("まで1手で先手の勝ち"), "KIF should include the game result");

const dropRecord = {
  drop: true,
  piece: "P",
  wasPromoted: false,
  promote: false,
  player: engine.PLAYERS.PLAYER,
  from: null,
  to: { row: 4, col: 4 },
};
assert(kif.formatMove(dropRecord) === "５五歩打", "KIF should mark dropped pieces with 打");
const promotedRecord = {
  drop: false,
  piece: "P",
  wasPromoted: false,
  promote: true,
  player: engine.PLAYERS.PLAYER,
  from: { row: 3, col: 4 },
  to: { row: 2, col: 4 },
};
assert(
  kif.formatMove(promotedRecord, { to: { row: 2, col: 4 } }) === "同　歩成(54)",
  "KIF should represent same-square moves and promotions"
);

const alreadyPromotedPosition = createBarePosition();
alreadyPromotedPosition.board[0][7] = {
  piece: "P",
  owner: engine.PLAYERS.PLAYER,
  promoted: true,
};
const alreadyPromotedMove = engine
  .generateMovesForPiece(alreadyPromotedPosition, 0, 7, engine.PLAYERS.PLAYER)
  .find((move) => move.to.row === 0 && move.to.col === 8);
assert(alreadyPromotedMove, "A promoted pawn should be able to move sideways on the last rank");
assert(!alreadyPromotedMove.promote, "An already promoted piece must not promote again");
assert(
  kif.formatMove(kif.createMoveRecord(alreadyPromotedPosition, alreadyPromotedMove)) ===
    "１一と(21)",
  "KIF should not append 成 to an already promoted piece"
);
assert(
  kif.formatMove({
    ...kif.createMoveRecord(alreadyPromotedPosition, alreadyPromotedMove),
    promote: true,
  }) === "１一と(21)",
  "KIF formatting should reject contradictory repeat-promotion data"
);
app.resetGame(false);
app.makeMove({
  from: { row: 2, col: 4 },
  to: { row: 3, col: 4 },
  promote: false,
  player: engine.PLAYERS.CPU,
});
app.state.winner = engine.PLAYERS.CPU;
const cpuSenteKif = kif.generate(app.state);
assert(cpuSenteKif.includes("先手：CPU"), "KIF should identify CPU as sente when it starts");
assert(
  cpuSenteKif.includes("   1 ５六歩(57)"),
  "KIF should rotate coordinates when CPU plays sente from the top"
);
assert(cpuSenteKif.includes("まで1手で先手の勝ち"), "KIF result should follow assigned sides");
app.resetGame(true);
assert(app.copyKifButton.hidden, "The KIF copy button should be hidden during a game");

assert(engine.getDisplaySymbol({ piece: "S", promoted: true }) === "全", "Promoted silver should use 全");
assert(engine.getDisplaySymbol({ piece: "N", promoted: true }) === "圭", "Promoted knight should use 圭");
assert(engine.getDisplaySymbol({ piece: "L", promoted: true }) === "杏", "Promoted lance should use 杏");
assert(engine.cpuJudgmentForScore(0).emoji === "😐", "An even position should show the neutral emoji");
assert(engine.cpuJudgmentForScore(700).emoji === "🙂", "A CPU edge should show a positive emoji");
assert(engine.cpuJudgmentForScore(-700).emoji === "😟", "A CPU deficit should show a worried emoji");
assert(engine.getCpuThinkTimeMs(app.state) === 2250, "An even position should use a random 2-3 second budget");

const initial = engine.createPosition();

const handBonusPosition = createBarePosition();
const handBonusBaseScore = engine.evaluate(handBonusPosition);
handBonusPosition.hands.black.P = 1;
assert(
  Math.abs(engine.evaluate(handBonusPosition) - handBonusBaseScore - 110) < 1e-9,
  "A held piece should receive the default 10% bonus"
);

const mandatoryPromotion = createBarePosition();
mandatoryPromotion.board[1][4] = {
  piece: "P",
  owner: engine.PLAYERS.PLAYER,
  promoted: false,
};
const lastRankPawnMoves = engine.generateLegalMoves(
  mandatoryPromotion,
  engine.PLAYERS.PLAYER
).filter((move) => !move.drop && move.from.row === 1 && move.from.col === 4);
assert(
  lastRankPawnMoves.length === 1 && lastRankPawnMoves[0].promote,
  "A pawn reaching the last rank must promote"
);

const knightPromotion = createBarePosition();
knightPromotion.board[2][4] = {
  piece: "N",
  owner: engine.PLAYERS.PLAYER,
  promoted: false,
};
const lastRankKnightMoves = engine.generateLegalMoves(
  knightPromotion,
  engine.PLAYERS.PLAYER
).filter((move) => !move.drop && move.from.row === 2 && move.from.col === 4);
assert(
  lastRankKnightMoves.length === 2 && lastRankKnightMoves.every((move) => move.promote),
  "A knight reaching the last rank must promote"
);

const pawnDropPosition = createBarePosition();
pawnDropPosition.board[4][4] = {
  piece: "P",
  owner: engine.PLAYERS.PLAYER,
  promoted: false,
};
pawnDropPosition.hands.black.P = 1;
const pawnDrops = engine
  .generateLegalMoves(pawnDropPosition, engine.PLAYERS.PLAYER)
  .filter((move) => move.drop && move.piece === "P");
assert(pawnDrops.length > 0, "A held pawn should have legal drop squares");
assert(pawnDrops.every((move) => move.to.col !== 4), "A pawn cannot be dropped on a doubled file");
assert(pawnDrops.every((move) => move.to.row !== 0), "A pawn cannot be dropped on the last rank");

const capturePosition = createBarePosition();
capturePosition.board[4][4] = {
  piece: "S",
  owner: engine.PLAYERS.PLAYER,
  promoted: false,
};
capturePosition.board[3][4] = {
  piece: "P",
  owner: engine.PLAYERS.CPU,
  promoted: true,
};
const captureMove = engine
  .generateLegalMoves(capturePosition, engine.PLAYERS.PLAYER)
  .find((move) => !move.drop && move.to.row === 3 && move.to.col === 4);
const capturedPosition = engine.applyMove(capturePosition, captureMove);
assert(capturedPosition.hands.black.P === 1, "A captured promoted piece returns to hand unpromoted");

const promotedBishopPosition = createBarePosition();
promotedBishopPosition.board[4][4] = {
  piece: "B",
  owner: engine.PLAYERS.PLAYER,
  promoted: true,
};
const promotedBishopMoves = engine.generateLegalMoves(
  promotedBishopPosition,
  engine.PLAYERS.PLAYER
);
assert(
  promotedBishopMoves.some((move) => !move.drop && move.to.row === 3 && move.to.col === 4),
  "A promoted bishop can step orthogonally"
);
assert(
  promotedBishopMoves.some((move) => !move.drop && move.to.row === 1 && move.to.col === 1),
  "A promoted bishop keeps its diagonal slide"
);

const cpuDisadvantage = engine.createPosition({
  board: initial.board.map((row) => row.map((piece) => (piece ? { ...piece } : null))),
});
cpuDisadvantage.board[1][1] = null;
assert(engine.getCpuThinkTimeMs(cpuDisadvantage) === 3000, "A CPU deficit should use a 3 second budget");

const blackMoves = engine.generateLegalMoves(initial, engine.PLAYERS.PLAYER);
assert(blackMoves.length > 20, "Initial position should have a healthy set of legal moves");
assert(
  blackMoves.every((move) => !engine.isKingInCheck(engine.applyMove(initial, move), engine.PLAYERS.PLAYER)),
  "Every generated move must leave the moving king safe"
);

const opening = engine.applyMove(
  initial,
  blackMoves.find((move) => !move.drop && move.from.row === 6 && move.from.col === 4)
);
const cpuLegal = engine.generateLegalMoves(opening, engine.PLAYERS.CPU);
const started = performance.now();
const cpuMove = engine.chooseCpuMove(opening);
const elapsed = performance.now() - started;
const searchStats = engine.getSearchStats();
assert(cpuMove, "CPU must find a move in the opening");
assert(
  cpuLegal.some((move) => engine.moveKey(move) === engine.moveKey(cpuMove)),
  "CPU choice must be legal"
);
assert(
  !cpuMove.drop && cpuMove.from.row === 2 && [1, 6].includes(cpuMove.from.col),
  "CPU should open with either the rook pawn or the bishop-diagonal pawn"
);
assert(elapsed < 3500, `CPU exceeded the response budget: ${elapsed.toFixed(0)}ms`);

const castleBase = engine.createPosition();
const rookPawnPosition = engine.applyMove(castleBase, {
  from: { row: 6, col: 7 },
  to: { row: 5, col: 7 },
  promote: false,
  player: engine.PLAYERS.PLAYER,
});
const bishopPawnPosition = engine.applyMove(castleBase, {
  from: { row: 6, col: 2 },
  to: { row: 5, col: 2 },
  promote: false,
  player: engine.PLAYERS.PLAYER,
});
assert(
  engine.openingStructureScore(rookPawnPosition, engine.PLAYERS.PLAYER) >
    engine.openingStructureScore(castleBase, engine.PLAYERS.PLAYER),
  "Advancing the rook pawn should be rewarded"
);
assert(
  engine.openingStructureScore(bishopPawnPosition, engine.PLAYERS.PLAYER) >
    engine.openingStructureScore(castleBase, engine.PLAYERS.PLAYER),
  "Opening the bishop diagonal should be rewarded"
);

const exposedKingPosition = engine.createPosition({
  board: castleBase.board.map((row) => row.map((piece) => (piece ? { ...piece } : null))),
});
exposedKingPosition.board[7][4] = exposedKingPosition.board[8][4];
exposedKingPosition.board[8][4] = null;
assert(
  engine.openingStructureScore(exposedKingPosition, engine.PLAYERS.PLAYER) <
    engine.openingStructureScore(castleBase, engine.PLAYERS.PLAYER),
  "Walking the king forward in the opening should be discouraged"
);

const castlePosition = engine.createPosition({
  board: castleBase.board.map((row) => row.map((piece) => (piece ? { ...piece } : null))),
});
castlePosition.board[8][4] = null;
castlePosition.board[7][4] = castlePosition.board[8][1];
castlePosition.board[8][1] = { piece: "K", owner: engine.PLAYERS.PLAYER, promoted: false };
castlePosition.board[7][2] = castlePosition.board[8][5];
castlePosition.board[8][5] = null;
assert(
  engine.openingStructureScore(castlePosition, engine.PLAYERS.PLAYER) >
    engine.openingStructureScore(castleBase, engine.PLAYERS.PLAYER),
  "A king protected near the edge by generals and pawns should be rewarded"
);

const emptyBoard = engine.createEmptyBoard();
emptyBoard[8][4] = { piece: "K", owner: engine.PLAYERS.PLAYER, promoted: false };
emptyBoard[0][4] = { piece: "K", owner: engine.PLAYERS.CPU, promoted: false };
emptyBoard[7][4] = { piece: "R", owner: engine.PLAYERS.CPU, promoted: false };
const matePosition = engine.createPosition({
  board: emptyBoard,
});
const winningMove = engine.chooseCpuMove(matePosition);
assert(winningMove.to.row === 8 && winningMove.to.col === 4, "CPU must take an immediate win");

const tacticalBoard = engine.createEmptyBoard();
tacticalBoard[8][8] = { piece: "K", owner: engine.PLAYERS.PLAYER, promoted: false };
tacticalBoard[0][0] = { piece: "K", owner: engine.PLAYERS.CPU, promoted: false };
tacticalBoard[4][4] = { piece: "R", owner: engine.PLAYERS.PLAYER, promoted: false };
tacticalBoard[3][3] = { piece: "B", owner: engine.PLAYERS.CPU, promoted: false };
const tacticalPosition = engine.createPosition({
  board: tacticalBoard,
});
const tacticalMove = engine.chooseCpuMove(tacticalPosition);
assert(tacticalMove.to.row === 4 && tacticalMove.to.col === 4, "CPU must take a free rook");

console.log(JSON.stringify({
  legalMovesAtStart: blackMoves.length,
  cpuResponseMs: Math.round(elapsed),
  searchedNodes: searchStats.searchedNodes,
  deepestTableEntry: searchStats.deepestTableEntry,
  openingMove: engine.moveKey(cpuMove),
  immediateWin: engine.moveKey(winningMove),
  tacticalCapture: engine.moveKey(tacticalMove),
}));
