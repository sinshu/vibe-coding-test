const {
  SIZE,
  PLAYERS,
  PIECE_SYMBOLS,
  createPosition,
  createPieceValueProfile,
  createHandPieceBonusRate,
  getDisplaySymbol,
  generateMovesForPiece,
  generateDropMoves,
  generateLegalMoves,
  applyMove,
  isKingInCheck,
  chooseCpuMove,
  evaluate,
  cpuJudgmentForScore,
} = ShogiEngine;

const LARGE_PIECES = new Set(["B", "R", "K"]);
const VALUE_DISPLAY_PIECES = ["P", "L", "N", "S", "G", "B", "R"];
const PROMOTED_VALUE_DISPLAY_PIECES = ["P", "L", "N", "S", "B", "R"];

const state = {
  ...createPosition({ board: [] }),
  currentPlayer: PLAYERS.PLAYER,
  playerStarts: true,
  cpuThinking: false,
  gameId: 0,
  selected: null,
  winner: null,
  lastMove: null,
  moveHistory: [],
  startedAt: new Date(),
  boardFlipped: false,
};

const boardEl = document.getElementById("board");
const playAreaEl = document.getElementById("play-area");
const messageEl = document.getElementById("message");
const cpuPiecesEl = document.getElementById("cpu-pieces");
const playerPiecesEl = document.getElementById("player-pieces");
const cpuSideLabelEl = document.getElementById("cpu-side-label");
const playerSideLabelEl = document.getElementById("player-side-label");
const cpuEvaluationEl = document.getElementById("cpu-evaluation");
const cpuEvaluationEmojiEl = document.getElementById("cpu-evaluation-emoji");
const flipButton = document.getElementById("flip-button");
const copyKifButton = document.getElementById("copy-kif-button");
const restartButton = document.getElementById("restart-button");

function createGameState(playerStarts, boardFlipped, gameId) {
  const pieceValueProfile = createPieceValueProfile();
  return {
    ...createPosition({
      pieceValues: pieceValueProfile.pieces,
      promotedPieceValues: pieceValueProfile.promoted,
      handPieceBonusRate: createHandPieceBonusRate(),
    }),
    currentPlayer: playerStarts ? PLAYERS.PLAYER : PLAYERS.CPU,
    playerStarts,
    cpuThinking: false,
    gameId,
    selected: null,
    winner: null,
    lastMove: null,
    moveHistory: [],
    startedAt: new Date(),
    boardFlipped,
  };
}

function resetGame(playerStarts = Math.random() < 0.5) {
  Object.assign(state, createGameState(playerStarts, state.boardFlipped, state.gameId + 1));
  playerSideLabelEl.textContent = playerStarts ? "先手" : "後手";
  cpuSideLabelEl.textContent = playerStarts ? "後手" : "先手";
  messageEl.textContent = playerStarts ? "先手、あなたの番です。" : "CPU が先手です。";
  render();
  if (!playerStarts) beginCpuTurn();
}

function createPieceElement(pieceData, { size = "board" } = {}) {
  const owner = pieceData.owner || PLAYERS.PLAYER;
  const element = document.createElement("div");
  element.classList.add("piece");
  if (pieceData.piece) {
    element.classList.add(`piece-${pieceData.piece.toLowerCase()}`);
  }
  if (size === "hand") {
    element.classList.add("small");
  }
  if (pieceData.promoted) {
    element.classList.add("promoted");
  }
  if (LARGE_PIECES.has(pieceData.piece)) {
    element.classList.add("large");
  }
  element.classList.add(owner === PLAYERS.PLAYER ? "player-owner" : "cpu-owner");
  const symbol = document.createElement("span");
  symbol.className = "piece-symbol";
  symbol.textContent = getDisplaySymbol(pieceData);
  element.appendChild(symbol);
  return element;
}

function getCpuJudgment() {
  if (state.cpuThinking) return { emoji: "🤔", label: "考え中" };
  if (state.winner === PLAYERS.CPU) return { emoji: "🥳", label: "勝ち" };
  if (state.winner === PLAYERS.PLAYER) return { emoji: "😵", label: "負け" };
  if (state.winner === "draw") return { emoji: "🤝", label: "引き分け" };
  return cpuJudgmentForScore(-evaluate(state));
}

function formatPieceValues(pieces, promoted = false) {
  return pieces
    .map((piece) => {
      const symbol = getDisplaySymbol({ piece, promoted });
      const values = promoted ? state.promotedPieceValues : state.pieceValues;
      return `${symbol}${values[piece]}`;
    })
    .join("、");
}

function getRandomParameterDescription() {
  const handBonusPercent = (state.handPieceBonusRate * 100)
    .toFixed(1)
    .replace(/\.0$/, "");
  return [
    "対局パラメータ",
    `駒価値：${formatPieceValues(VALUE_DISPLAY_PIECES)}`,
    `成駒価値：${formatPieceValues(PROMOTED_VALUE_DISPLAY_PIECES, true)}`,
    `持ち駒加点：+${handBonusPercent}%`,
  ].join("\n");
}

function renderCpuJudgment() {
  const judgment = getCpuJudgment();
  const description = `CPUの形勢判断：${judgment.label}`;
  cpuEvaluationEmojiEl.textContent = judgment.emoji;
  cpuEvaluationEl.setAttribute("aria-label", description);
  cpuEvaluationEl.title = `${description}\n${getRandomParameterDescription()}`;
}

function makeMove(move) {
  const record = ShogiKif.createMoveRecord(state, move);
  const applied = applyMove(state, move);
  state.lastMove = move.drop
    ? {
        drop: true,
        piece: move.piece,
        player: move.player,
        to: { ...move.to },
      }
    : {
        drop: false,
        player: move.player,
        from: { ...move.from },
        to: { ...move.to },
        promote: !!move.promote,
      };
  state.board = applied.board;
  state.hands = applied.hands;
  state.moveHistory.push(record);
  state.selected = null;
  state.currentPlayer = state.currentPlayer === PLAYERS.PLAYER ? PLAYERS.CPU : PLAYERS.PLAYER;
  render();
}

function tryPlayerMove(move) {
  if (state.currentPlayer !== PLAYERS.PLAYER || state.winner) return;
  makeMove(move);
  if (checkForWinner()) return;
  beginCpuTurn();
}

function beginCpuTurn() {
  if (state.currentPlayer !== PLAYERS.CPU || state.winner) return;
  state.cpuThinking = true;
  messageEl.textContent = "CPU が考えています...";
  renderCpuJudgment();
  const scheduledGameId = state.gameId;
  setTimeout(() => {
    if (scheduledGameId === state.gameId) cpuTurn();
  }, 400);
}

function cpuTurn() {
  if (state.currentPlayer !== PLAYERS.CPU || state.winner) return;
  const move = chooseCpuMove(state);
  state.cpuThinking = false;
  if (!move) {
    state.winner = PLAYERS.PLAYER;
    messageEl.textContent = "詰み！あなたの勝ちです。";
    render();
    return;
  }
  makeMove(move);
  if (checkForWinner()) return;
  messageEl.textContent = "あなたの番です。";
}

function checkForWinner() {
  const current = state.currentPlayer;
  const moves = generateLegalMoves(state, current);
  if (moves.length === 0) {
    const inCheck = isKingInCheck(state, current);
    state.winner = inCheck ? (current === PLAYERS.PLAYER ? PLAYERS.CPU : PLAYERS.PLAYER) : "draw";
    if (state.winner === PLAYERS.PLAYER) {
      messageEl.textContent = "詰み！あなたの勝ちです。";
    } else if (state.winner === PLAYERS.CPU) {
      messageEl.textContent = "詰み！CPUの勝ちです。";
    } else {
      messageEl.textContent = "千日手です。";
    }
    render();
    return true;
  }
  return false;
}

function isSquareAt(square, row, col) {
  return Boolean(square && square.row === row && square.col === col);
}

function indexMovesByDestination(moves = []) {
  const index = new Map();
  for (const move of moves) {
    const key = move.to.row * SIZE + move.to.col;
    const movesAtSquare = index.get(key) || [];
    movesAtSquare.push(move);
    index.set(key, movesAtSquare);
  }
  return index;
}

function renderBoard() {
  boardEl.innerHTML = "";
  const selectedMoves = indexMovesByDestination(state.selected?.moves);
  for (let displayRow = 0; displayRow < SIZE; displayRow++) {
    for (let displayCol = 0; displayCol < SIZE; displayCol++) {
      const row = state.boardFlipped ? SIZE - 1 - displayRow : displayRow;
      const col = state.boardFlipped ? SIZE - 1 - displayCol : displayCol;
      const square = document.createElement("button");
      square.className = "square";
      square.type = "button";
      square.dataset.row = row;
      square.dataset.col = col;
      const piece = state.board[row][col];
      square.setAttribute(
        "aria-label",
        piece
          ? `${row + 1}段${col + 1}筋 ${getDisplaySymbol(piece)}`
          : `${row + 1}段${col + 1}筋 空き`
      );
      if (piece) {
        const pieceNode = createPieceElement(piece);
        square.appendChild(pieceNode);
      }

      if (state.lastMove) {
        const lastMove = state.lastMove;
        if (!lastMove.drop && isSquareAt(lastMove.from, row, col)) {
          square.classList.add("last-move-from");
        }
        if (isSquareAt(lastMove.to, row, col)) {
          square.classList.add("last-move-to");
        }
      }

      if (state.selected) {
        const legal = selectedMoves.get(row * SIZE + col) || [];
        if (state.selected.type === "board") {
          const isSelectedSquare = isSquareAt(state.selected.from, row, col);
          if (isSelectedSquare || legal.length) {
            square.classList.add("highlight");
          }
          if (legal.length && piece) {
            square.classList.add("capture-target");
          }
        } else if (state.selected.type === "drop") {
          if (legal.length) {
            square.classList.add("highlight");
          }
        }
      }

      square.addEventListener("click", () => onSquareClick(row, col));
      boardEl.appendChild(square);
    }
  }
}

function renderHands() {
  const createHandButtons = (handEl, owner, isPlayer) => {
    handEl.innerHTML = "";
    for (const piece of Object.keys(state.hands[owner])) {
      const count = state.hands[owner][piece];
      const button = document.createElement("button");
      button.className = "piece-button";
      button.type = "button";
      const pieceNode = createPieceElement(
        { piece, owner, promoted: false },
        { size: "hand" }
      );
      const label = document.createElement("div");
      label.className = "piece-label";
      label.textContent = PIECE_SYMBOLS[piece];

      button.appendChild(pieceNode);
      button.appendChild(label);
      const countEl = document.createElement("div");
      countEl.className = "piece-count";
      countEl.textContent = `×${count}`;
      button.appendChild(countEl);
      if (isPlayer) {
        button.disabled = count <= 0;
        if (count <= 0) {
          button.classList.add("empty");
        }
        if (
          state.selected &&
          state.selected.type === "drop" &&
          state.selected.piece === piece
        ) {
          button.classList.add("selected");
          button.setAttribute("aria-pressed", "true");
        } else {
          button.setAttribute("aria-pressed", "false");
        }
        button.addEventListener("click", () => onHandPieceClick(piece));
      } else {
        button.setAttribute("aria-disabled", "true");
        button.tabIndex = -1;
        if (count <= 0) {
          button.classList.add("empty");
        }
      }
      handEl.appendChild(button);
    }
  };

  createHandButtons(cpuPiecesEl, PLAYERS.CPU, false);
  createHandButtons(playerPiecesEl, PLAYERS.PLAYER, true);
}

function onSquareClick(row, col) {
  if (state.winner) return;
  const piece = state.board[row][col];
  if (state.selected && state.selected.type === "board") {
    if (isSquareAt(state.selected.from, row, col)) {
      state.selected = null;
      render();
      return;
    }

    const selectedMove = state.selected.moves.filter((move) => isSquareAt(move.to, row, col));
    if (selectedMove.length) {
      if (selectedMove.length === 1) {
        tryPlayerMove(selectedMove[0]);
      } else {
        const promoteMove = selectedMove.find((m) => m.promote);
        const nonPromoteMove = selectedMove.find((m) => !m.promote);
        const shouldPromote = window.confirm("成りますか？");
        tryPlayerMove(shouldPromote ? promoteMove : nonPromoteMove);
      }
      return;
    }
  }

  if (state.selected && state.selected.type === "drop") {
    const move = state.selected.moves.find((candidate) => isSquareAt(candidate.to, row, col));
    if (move) {
      tryPlayerMove(move);
      return;
    }
  }

  if (piece && piece.owner === PLAYERS.PLAYER && state.currentPlayer === PLAYERS.PLAYER) {
    const moves = generateMovesForPiece(state, row, col, PLAYERS.PLAYER);
    state.selected = { type: "board", from: { row, col }, moves };
  } else {
    state.selected = null;
  }
  render();
}

function onHandPieceClick(piece) {
  if (state.currentPlayer !== PLAYERS.PLAYER || state.winner) return;
  if (state.selected && state.selected.type === "drop" && state.selected.piece === piece) {
    state.selected = null;
    render();
    return;
  }
  const moves = generateDropMoves(state, PLAYERS.PLAYER).filter((m) => m.piece === piece);
  state.selected = { type: "drop", piece, moves };
  render();
}

function render() {
  playAreaEl.className = state.boardFlipped ? "flipped" : "";
  copyKifButton.hidden = !state.winner;
  copyKifButton.textContent = "KIFをコピー";
  flipButton.setAttribute("aria-pressed", String(state.boardFlipped));
  const flipDescription = state.boardFlipped
    ? "盤面を反転して、あなたを下にする"
    : "盤面を反転して、あなたを上にする";
  flipButton.setAttribute("aria-label", flipDescription);
  flipButton.setAttribute("title", flipDescription);
  renderBoard();
  renderHands();
  renderCpuJudgment();
}

function flipBoard() {
  state.boardFlipped = !state.boardFlipped;
  render();
}

async function writeTextToClipboard(text) {
  if (globalThis.navigator?.clipboard?.writeText) {
    try {
      await globalThis.navigator.clipboard.writeText(text);
      return;
    } catch (error) {
      // Local files and older browsers may deny the asynchronous API.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("Clipboard copy failed");
}

async function copyKifToClipboard() {
  if (!state.winner) return;
  try {
    await writeTextToClipboard(ShogiKif.generate(state));
    copyKifButton.textContent = "コピー済み";
  } catch (error) {
    copyKifButton.textContent = "コピー失敗";
  }
}

globalThis.ShogiApp = Object.freeze({
  state,
  onSquareClick,
  onHandPieceClick,
  resetGame,
  flipBoard,
  makeMove,
  render,
  copyKifButton,
});

flipButton.addEventListener("click", flipBoard);
copyKifButton.addEventListener("click", copyKifToClipboard);
restartButton.addEventListener("click", () => resetGame());

resetGame();
