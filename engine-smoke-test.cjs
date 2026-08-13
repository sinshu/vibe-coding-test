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

const document = {
  getElementById() {
    return element();
  },
  createElement() {
    return element();
  },
};

const html = fs.readFileSync("index.html", "utf8");
const source = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const expose = `
  globalThis.engine = {
    PLAYERS, state, createInitialBoard, generateLegalMoves, applyMove,
    isKingInCheck, chooseCpuMove, moveKey, evaluate, openingStructureScore,
    onSquareClick, onHandPieceClick, resetGame, getDisplaySymbol, cpuJudgmentForScore,
    searchStats: () => ({
      searchedNodes,
      deepestTableEntry: Math.max(0, ...Array.from(transpositionTable.values(), (entry) => entry.depth)),
    })
  };
`;
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
vm.runInNewContext(source + expose, context, { filename: "index.html" });
const engine = context.engine;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

engine.onSquareClick(6, 4);
assert(engine.state.selected?.type === "board", "Clicking a player piece should select it");
engine.onSquareClick(6, 4);
assert(engine.state.selected === null, "Clicking the selected board piece should cancel selection");

engine.state.hands.black.P = 1;
engine.onHandPieceClick("P");
assert(engine.state.selected?.type === "drop", "Clicking a held piece should select it");
engine.onHandPieceClick("P");
assert(engine.state.selected === null, "Clicking the selected held piece should cancel selection");
engine.resetGame(false);
assert(engine.state.currentPlayer === engine.PLAYERS.CPU, "CPU should move first when assigned sente");
assert(engine.state.cpuThinking, "CPU should enter thinking state when moving first");
engine.resetGame(true);
assert(engine.state.currentPlayer === engine.PLAYERS.PLAYER, "Player should move first when assigned sente");
assert(!engine.state.cpuThinking, "CPU should not think during the player's opening turn");

assert(engine.getDisplaySymbol({ piece: "S", promoted: true }) === "全", "Promoted silver should use 全");
assert(engine.getDisplaySymbol({ piece: "N", promoted: true }) === "圭", "Promoted knight should use 圭");
assert(engine.getDisplaySymbol({ piece: "L", promoted: true }) === "杏", "Promoted lance should use 杏");
assert(engine.cpuJudgmentForScore(0).emoji === "😐", "An even position should show the neutral emoji");
assert(engine.cpuJudgmentForScore(700).emoji === "🙂", "A CPU edge should show a positive emoji");
assert(engine.cpuJudgmentForScore(-700).emoji === "😟", "A CPU deficit should show a worried emoji");

const initial = {
  board: engine.createInitialBoard(),
  hands: {
    black: { P: 0, L: 0, N: 0, S: 0, G: 0, B: 0, R: 0 },
    white: { P: 0, L: 0, N: 0, S: 0, G: 0, B: 0, R: 0 },
  },
};
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
const searchStats = engine.searchStats();
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

const castleBase = {
  board: engine.createInitialBoard(),
  hands: initial.hands,
};
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

const exposedKingPosition = {
  board: castleBase.board.map((row) => row.map((piece) => (piece ? { ...piece } : null))),
  hands: initial.hands,
};
exposedKingPosition.board[7][4] = exposedKingPosition.board[8][4];
exposedKingPosition.board[8][4] = null;
assert(
  engine.openingStructureScore(exposedKingPosition, engine.PLAYERS.PLAYER) <
    engine.openingStructureScore(castleBase, engine.PLAYERS.PLAYER),
  "Walking the king forward in the opening should be discouraged"
);

const castlePosition = {
  board: castleBase.board.map((row) => row.map((piece) => (piece ? { ...piece } : null))),
  hands: initial.hands,
};
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

const emptyBoard = Array.from({ length: 9 }, () => Array(9).fill(null));
emptyBoard[8][4] = { piece: "K", owner: engine.PLAYERS.PLAYER, promoted: false };
emptyBoard[0][4] = { piece: "K", owner: engine.PLAYERS.CPU, promoted: false };
emptyBoard[7][4] = { piece: "R", owner: engine.PLAYERS.CPU, promoted: false };
const matePosition = {
  board: emptyBoard,
  hands: {
    black: { P: 0, L: 0, N: 0, S: 0, G: 0, B: 0, R: 0 },
    white: { P: 0, L: 0, N: 0, S: 0, G: 0, B: 0, R: 0 },
  },
};
const winningMove = engine.chooseCpuMove(matePosition);
assert(winningMove.to.row === 8 && winningMove.to.col === 4, "CPU must take an immediate win");

const tacticalBoard = Array.from({ length: 9 }, () => Array(9).fill(null));
tacticalBoard[8][8] = { piece: "K", owner: engine.PLAYERS.PLAYER, promoted: false };
tacticalBoard[0][0] = { piece: "K", owner: engine.PLAYERS.CPU, promoted: false };
tacticalBoard[4][4] = { piece: "R", owner: engine.PLAYERS.PLAYER, promoted: false };
tacticalBoard[3][3] = { piece: "B", owner: engine.PLAYERS.CPU, promoted: false };
const tacticalPosition = {
  board: tacticalBoard,
  hands: {
    black: { P: 0, L: 0, N: 0, S: 0, G: 0, B: 0, R: 0 },
    white: { P: 0, L: 0, N: 0, S: 0, G: 0, B: 0, R: 0 },
  },
};
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
