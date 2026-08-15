(function initializeEngine(globalScope) {
const SIZE = 9;
const PLAYERS = { PLAYER: "black", CPU: "white" };
const PROMOTION_ZONE = {
  black: new Set([0, 1, 2]),
  white: new Set([6, 7, 8]),
};
const PROMOTABLE = new Set(["P", "L", "N", "S", "B", "R"]);
const PIECE_SYMBOLS = {
  P: "歩",
  L: "香",
  N: "桂",
  S: "銀",
  G: "金",
  B: "角",
  R: "飛",
  K: "玉",
};
const PROMOTED_SYMBOLS = {
  P: "と",
  L: "杏",
  N: "圭",
  S: "全",
  B: "馬",
  R: "龍",
};
const PIECE_VALUES = {
  P: 100,
  L: 300,
  N: 320,
  S: 500,
  G: 600,
  B: 800,
  R: 1000,
  K: 10000,
};
const PROMOTED_VALUES = {
  P: 550,
  L: 550,
  N: 550,
  S: 650,
  B: 1100,
  R: 1300,
};
const HAND_PIECES = ["P", "L", "N", "S", "G", "B", "R"];
const PIECE_VALUE_VARIANCE = 0.3;

const MATE_SCORE = 100000;
const DRAW_SCORE = 0;
const CPU_MIN_THINK_TIME_MS = 2000;
const CPU_MAX_THINK_TIME_MS = 3000;
const CPU_DISADVANTAGE_THRESHOLD = -500;
const CPU_MAX_SEARCH_DEPTH = 7;
const QUIESCENCE_DEPTH = 5;
const TRANSPOSITION_TABLE_LIMIT = 60000;
const CHECK_BONUS = 95;
const MOBILITY_WEIGHT = 2;

const SEARCH_TIMEOUT = Symbol("search-timeout");
let latestSearchStats = { searchedNodes: 0, deepestTableEntry: 0 };

const ORTHOGONAL_DIRECTIONS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
const DIAGONAL_DIRECTIONS = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];
const KING_DIRECTIONS = [...ORTHOGONAL_DIRECTIONS, ...DIAGONAL_DIRECTIONS];

function createEmptyBoard() {
  const emptyRow = () => Array.from({ length: SIZE }, () => null);
  return Array.from({ length: SIZE }, emptyRow);
}

function createInitialBoard() {
  const board = createEmptyBoard();

  const placeRank = (row, owner, pieces) => {
    pieces.forEach((piece, col) => {
      if (piece) board[row][col] = { piece, owner, promoted: false };
    });
  };

  const backRank = ["L", "N", "S", "G", "K", "G", "S", "N", "L"];
  const pawns = Array(SIZE).fill("P");
  placeRank(0, PLAYERS.CPU, backRank);
  placeRank(1, PLAYERS.CPU, [null, "R", null, null, null, null, null, "B", null]);
  placeRank(2, PLAYERS.CPU, pawns);
  placeRank(6, PLAYERS.PLAYER, pawns);
  placeRank(7, PLAYERS.PLAYER, [null, "B", null, null, null, null, null, "R", null]);
  placeRank(8, PLAYERS.PLAYER, backRank);

  return board;
}

function createEmptyHands() {
  const createHand = () => Object.fromEntries(HAND_PIECES.map((piece) => [piece, 0]));
  return {
    [PLAYERS.PLAYER]: createHand(),
    [PLAYERS.CPU]: createHand(),
  };
}

function createPosition({
  board = createInitialBoard(),
  hands = createEmptyHands(),
  pieceValues = PIECE_VALUES,
  promotedPieceValues = PROMOTED_VALUES,
} = {}) {
  return { board, hands, pieceValues, promotedPieceValues };
}

function cloneBoard(board) {
  return board.map((row) =>
    row.map((cell) =>
      cell ? { piece: cell.piece, owner: cell.owner, promoted: cell.promoted } : null
    )
  );
}

function cloneHands(hands) {
  return {
    black: { ...hands.black },
    white: { ...hands.white },
  };
}

function createPieceValueProfile(random = Math.random) {
  // Change relative preferences while keeping the overall material scale
  // close to normal, so positional and king-safety scores stay balanced.
  const rawMultipliers = Object.fromEntries(
    HAND_PIECES.map((piece) => [
      piece,
      1 + (random() * 2 - 1) * PIECE_VALUE_VARIANCE,
    ])
  );
  const averageMultiplier =
    HAND_PIECES.reduce((total, piece) => total + rawMultipliers[piece], 0) /
    HAND_PIECES.length;
  const multipliers = Object.fromEntries(
    HAND_PIECES.map((piece) => [
      piece,
      Math.max(
        1 - PIECE_VALUE_VARIANCE,
        Math.min(1 + PIECE_VALUE_VARIANCE, rawMultipliers[piece] / averageMultiplier)
      ),
    ])
  );
  const pieces = { ...PIECE_VALUES };
  const promoted = { ...PROMOTED_VALUES };

  for (const piece of HAND_PIECES) {
    pieces[piece] = Math.round(PIECE_VALUES[piece] * multipliers[piece]);
    if (piece in PROMOTED_VALUES) {
      promoted[piece] = Math.round(PROMOTED_VALUES[piece] * multipliers[piece]);
    }
  }

  return { pieces, promoted };
}

function inBounds(row, col) {
  return row >= 0 && row < SIZE && col >= 0 && col < SIZE;
}

function getDisplaySymbol(piece) {
  if (!piece) return "";
  if (piece.promoted) {
    return PROMOTED_SYMBOLS[piece.piece] || PIECE_SYMBOLS[piece.piece] || "";
  }
  return PIECE_SYMBOLS[piece.piece] || "";
}

function forwardDirection(owner) {
  return owner === PLAYERS.PLAYER ? -1 : 1;
}

function getGoldOffsets(owner) {
  const forward = forwardDirection(owner);
  return [
    [forward, -1],
    [forward, 0],
    [forward, 1],
    [0, -1],
    [0, 1],
    [-forward, 0],
  ];
}

function getSilverOffsets(owner) {
  const forward = forwardDirection(owner);
  return [
    [forward, -1],
    [forward, 0],
    [forward, 1],
    [-forward, -1],
    [-forward, 1],
  ];
}

function getKnightMoves(owner) {
  const forward = forwardDirection(owner);
  return [
    [2 * forward, -1],
    [2 * forward, 1],
  ];
}

function getMovement(piece, owner) {
  const forward = forwardDirection(owner);
  if (piece.promoted && ["P", "L", "N", "S"].includes(piece.piece)) {
    return { steps: getGoldOffsets(owner), slides: [] };
  }
  if (piece.promoted && piece.piece === "B") {
    return { steps: ORTHOGONAL_DIRECTIONS, slides: DIAGONAL_DIRECTIONS };
  }
  if (piece.promoted && piece.piece === "R") {
    return { steps: DIAGONAL_DIRECTIONS, slides: ORTHOGONAL_DIRECTIONS };
  }

  switch (piece.piece) {
    case "P":
      return { steps: [[forward, 0]], slides: [] };
    case "L":
      return { steps: [], slides: [[forward, 0]] };
    case "N":
      return { steps: getKnightMoves(owner), slides: [] };
    case "S":
      return { steps: getSilverOffsets(owner), slides: [] };
    case "G":
      return { steps: getGoldOffsets(owner), slides: [] };
    case "B":
      return { steps: [], slides: DIAGONAL_DIRECTIONS };
    case "R":
      return { steps: [], slides: ORTHOGONAL_DIRECTIONS };
    case "K":
      return { steps: KING_DIRECTIONS, slides: [] };
    default:
      return { steps: [], slides: [] };
  }
}

function getBasePieceValue(piece, stateSnapshot) {
  return stateSnapshot.pieceValues?.[piece] ?? PIECE_VALUES[piece];
}

function getPromotedPieceValue(piece, stateSnapshot) {
  return stateSnapshot.promotedPieceValues?.[piece] ?? getBasePieceValue(piece, stateSnapshot);
}

function getPieceValue(piece, promoted, stateSnapshot) {
  return promoted
    ? getPromotedPieceValue(piece, stateSnapshot)
    : getBasePieceValue(piece, stateSnapshot);
}

function promotionZone(owner, row) {
  return PROMOTION_ZONE[owner].has(row);
}

function isPromotionMandatory(piece, owner, toRow) {
  if (piece === "P" || piece === "L") {
    return (owner === PLAYERS.PLAYER && toRow === 0) || (owner === PLAYERS.CPU && toRow === 8);
  }
  if (piece === "N") {
    return (
      (owner === PLAYERS.PLAYER && (toRow === 0 || toRow === 1)) ||
      (owner === PLAYERS.CPU && (toRow === 8 || toRow === 7))
    );
  }
  return false;
}

function promotionAvailable(piece, owner, fromRow, toRow, alreadyPromoted) {
  if (alreadyPromoted) return false;
  if (!PROMOTABLE.has(piece)) return false;
  return promotionZone(owner, fromRow) || promotionZone(owner, toRow);
}

function addMove(moves, move, stateSnapshot) {
  const nextState = applyMove(stateSnapshot, move);
  if (!isKingInCheck(nextState, move.player)) {
    moves.push(move);
  }
}

function applyMove(currentState, move) {
  const nextBoard = cloneBoard(currentState.board);
  const nextHands = cloneHands(currentState.hands);

  if (move.drop) {
    const { to, piece, player } = move;
    nextBoard[to.row][to.col] = { piece, owner: player, promoted: false };
    nextHands[player][piece] -= 1;
  } else {
    const { from, to, promote, player } = move;
    const movingPiece = { ...nextBoard[from.row][from.col] };
    nextBoard[from.row][from.col] = null;

    if (nextBoard[to.row][to.col]) {
      const captured = nextBoard[to.row][to.col];
      const basePiece = captured.piece;
      if (basePiece !== "K") {
        nextHands[player][basePiece] += 1;
      }
    }

    const shouldPromote = promote && PROMOTABLE.has(movingPiece.piece);
    movingPiece.promoted = shouldPromote ? true : movingPiece.promoted;

    nextBoard[to.row][to.col] = movingPiece;
  }

  return {
    board: nextBoard,
    hands: nextHands,
    pieceValues: currentState.pieceValues,
    promotedPieceValues: currentState.promotedPieceValues,
  };
}

function getAttackTargets(board, row, col, owner) {
  const piece = board[row][col];
  if (!piece || piece.owner !== owner) return [];
  const targets = [];

  const addStep = (dr, dc) => {
    const r = row + dr;
    const c = col + dc;
    if (!inBounds(r, c)) return;
    const target = board[r][c];
    if (target && target.owner === owner) return;
    targets.push({ row: r, col: c });
  };

  const addSliding = (directions) => {
    for (const [dr, dc] of directions) {
      let r = row + dr;
      let c = col + dc;
      while (inBounds(r, c)) {
        const target = board[r][c];
        if (target) {
          if (target.owner !== owner) {
            targets.push({ row: r, col: c });
          }
          break;
        } else {
          targets.push({ row: r, col: c });
        }
        r += dr;
        c += dc;
      }
    }
  };

  const movement = getMovement(piece, owner);
  addSliding(movement.slides);
  movement.steps.forEach(([dr, dc]) => addStep(dr, dc));

  return targets;
}

function isSquareAttacked(board, hands, squareRow, squareCol, byPlayer) {
  for (let row = 0; row < SIZE; row++) {
    for (let col = 0; col < SIZE; col++) {
      const piece = board[row][col];
      if (!piece || piece.owner !== byPlayer) continue;
      const attacks = getAttackTargets(board, row, col, byPlayer);
      if (attacks.some((sq) => sq.row === squareRow && sq.col === squareCol)) {
        return true;
      }
    }
  }
  return false;
}

function findKing(board, owner) {
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const piece = board[r][c];
      if (piece && piece.owner === owner && piece.piece === "K") {
        return { row: r, col: c };
      }
    }
  }
  return null;
}

function isKingInCheck(stateSnapshot, player) {
  const kingPos = findKing(stateSnapshot.board, player);
  if (!kingPos) return true;
  return isSquareAttacked(
    stateSnapshot.board,
    stateSnapshot.hands,
    kingPos.row,
    kingPos.col,
    opponentOf(player)
  );
}

function generateMovesForPiece(stateSnapshot, row, col, owner) {
  const piece = stateSnapshot.board[row][col];
  const moves = [];
  if (!piece || piece.owner !== owner) return moves;

  const base = piece.piece;

  const addStandardMove = (toRow, toCol) => {
    if (!inBounds(toRow, toCol)) return;
    const target = stateSnapshot.board[toRow][toCol];
    if (target && target.owner === owner) return;
    const mandatory = isPromotionMandatory(base, owner, toRow);
    const canPromote = promotionAvailable(base, owner, row, toRow, piece.promoted);

    if (mandatory) {
      const move = { from: { row, col }, to: { row: toRow, col: toCol }, promote: true, player: owner };
      addMove(moves, move, stateSnapshot);
      return;
    }

    if (piece.promoted || !canPromote) {
      const move = { from: { row, col }, to: { row: toRow, col: toCol }, promote: false, player: owner };
      addMove(moves, move, stateSnapshot);
    } else {
      const promoteMove = { from: { row, col }, to: { row: toRow, col: toCol }, promote: true, player: owner };
      const nonPromoteMove = { from: { row, col }, to: { row: toRow, col: toCol }, promote: false, player: owner };
      addMove(moves, promoteMove, stateSnapshot);
      addMove(moves, nonPromoteMove, stateSnapshot);
    }
  };

  const addSlidingMoves = (directions) => {
    for (const [dr, dc] of directions) {
      let r = row + dr;
      let c = col + dc;
      while (inBounds(r, c)) {
        const target = stateSnapshot.board[r][c];
        if (target) {
          if (target.owner !== owner) {
            addStandardMove(r, c);
          }
          break;
        } else {
          addStandardMove(r, c);
        }
        r += dr;
        c += dc;
      }
    }
  };

  const movement = getMovement(piece, owner);
  addSlidingMoves(movement.slides);
  movement.steps.forEach(([dr, dc]) => addStandardMove(row + dr, col + dc));

  return moves;
}

function generateDropMoves(stateSnapshot, owner) {
  const moves = [];
  const hand = stateSnapshot.hands[owner];
  for (const piece of Object.keys(hand)) {
    if (hand[piece] <= 0) continue;
    for (let row = 0; row < SIZE; row++) {
      for (let col = 0; col < SIZE; col++) {
        if (stateSnapshot.board[row][col]) continue;
        if (!canDropPiece(owner, piece, row, col, stateSnapshot)) continue;
        const move = {
          drop: true,
          piece,
          to: { row, col },
          player: owner,
        };
        addMove(moves, move, stateSnapshot);
      }
    }
  }
  return moves;
}

function canDropPiece(owner, piece, row, col, stateSnapshot) {
  if (piece === "P") {
    if ((owner === PLAYERS.PLAYER && row === 0) || (owner === PLAYERS.CPU && row === 8)) return false;
    for (let r = 0; r < SIZE; r++) {
      const existing = stateSnapshot.board[r][col];
      if (existing && existing.owner === owner && existing.piece === "P" && !existing.promoted) {
        return false;
      }
    }
  }
  if (piece === "L") {
    if ((owner === PLAYERS.PLAYER && row === 0) || (owner === PLAYERS.CPU && row === 8)) return false;
  }
  if (piece === "N") {
    if ((owner === PLAYERS.PLAYER && row <= 1) || (owner === PLAYERS.CPU && row >= 7)) return false;
  }
  return true;
}

function generateLegalMoves(stateSnapshot, owner) {
  let moves = [];
  for (let row = 0; row < SIZE; row++) {
    for (let col = 0; col < SIZE; col++) {
      const piece = stateSnapshot.board[row][col];
      if (!piece || piece.owner !== owner) continue;
      const pieceMoves = generateMovesForPiece(stateSnapshot, row, col, owner);
      moves = moves.concat(pieceMoves);
    }
  }
  moves = moves.concat(generateDropMoves(stateSnapshot, owner));
  return moves;
}

function opponentOf(player) {
  return player === PLAYERS.PLAYER ? PLAYERS.CPU : PLAYERS.PLAYER;
}

function pieceSquareBonus(piece, row, col) {
  if (piece.piece === "K") return 0;
  const advancement = piece.owner === PLAYERS.PLAYER ? 8 - row : row;
  const centrality = 4 - Math.abs(4 - col);
  let bonus = centrality * (piece.piece === "B" || piece.piece === "R" ? 3 : 2);

  switch (piece.piece) {
    case "P":
      bonus += advancement * 6;
      break;
    case "L":
      bonus += advancement * 2;
      break;
    case "N":
      bonus += advancement * 4;
      break;
    case "S":
      bonus += advancement * 5;
      break;
    case "G":
      bonus += advancement * 2;
      break;
    default:
      bonus += advancement;
  }
  return bonus;
}

function kingSafety(stateSnapshot, owner, enemyAttacks) {
  const king = findKing(stateSnapshot.board, owner);
  if (!king) return -MATE_SCORE;
  const forward = forwardDirection(owner);
  let defenderStrength = 0;
  let shieldPawns = 0;
  let pressure = enemyAttacks[king.row * SIZE + king.col] * 3;

  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const row = king.row + dr;
      const col = king.col + dc;
      if (!inBounds(row, col)) continue;
      const nearby = stateSnapshot.board[row][col];
      if (nearby && nearby.owner === owner) {
        if (nearby.piece === "G") defenderStrength += 22;
        else if (nearby.piece === "S") defenderStrength += 18;
        else if (nearby.piece === "P") defenderStrength += 8;
        else defenderStrength += 10;
      }
      pressure += enemyAttacks[row * SIZE + col];
    }
  }

  const shieldRow = king.row + forward;
  for (let dc = -1; dc <= 1; dc++) {
    const col = king.col + dc;
    if (!inBounds(shieldRow, col)) continue;
    const shield = stateSnapshot.board[shieldRow][col];
    if (shield && shield.owner === owner && shield.piece === "P" && !shield.promoted) {
      shieldPawns++;
    }
  }

  const edgeShelter = Math.abs(king.col - 4) * 7;
  return defenderStrength + shieldPawns * 22 + edgeShelter - pressure * 13;
}

function openingWeight(stateSnapshot) {
  let piecesOnBoard = 0;
  for (const row of stateSnapshot.board) {
    for (const piece of row) {
      if (piece) piecesOnBoard++;
    }
  }
  return Math.max(0, Math.min(1, (piecesOnBoard - 26) / 14));
}

function openingStructureScore(stateSnapshot, owner, weight = openingWeight(stateSnapshot)) {
  if (weight <= 0) return 0;

  const board = stateSnapshot.board;
  const homeRow = owner === PLAYERS.PLAYER ? 8 : 0;
  const pawnStartRow = owner === PLAYERS.PLAYER ? 6 : 2;
  const forward = forwardDirection(owner);
  const king = findKing(board, owner);
  let score = 0;
  let rook = null;
  let bishop = null;
  const generals = [];

  for (let row = 0; row < SIZE; row++) {
    for (let col = 0; col < SIZE; col++) {
      const piece = board[row][col];
      if (!piece || piece.owner !== owner) continue;
      if (piece.piece === "R" && !piece.promoted) rook = { row, col };
      if (piece.piece === "B" && !piece.promoted) bishop = { row, col };
      if (piece.piece === "G" || piece.piece === "S") generals.push({ row, col });
    }
  }

  // Reward pushing the pawn on the rook's file. One or two squares is
  // useful development; overextended pawns receive no extra opening bonus.
  if (rook) {
    for (let row = 0; row < SIZE; row++) {
      const pawn = board[row][rook.col];
      if (!pawn || pawn.owner !== owner || pawn.piece !== "P" || pawn.promoted) continue;
      const advance = (row - pawnStartRow) * forward;
      if (advance > 0) score += Math.min(advance, 2) * 42;
      break;
    }
  }

  // An opened bishop diagonal is the other sound universal opening plan.
  // Mobility is capped so this remains an opening preference, not material.
  if (bishop) {
    const bishopMobility = getAttackTargets(board, bishop.row, bishop.col, owner).length;
    score += Math.min(bishopMobility, 7) * 8;
  }

  if (king) {
    const homeDepth = (king.row - homeRow) * forward;
    const lateral = Math.abs(king.col - 4);
    const nearbyGenerals = generals.filter(
      (piece) => Math.max(Math.abs(piece.row - king.row), Math.abs(piece.col - king.col)) <= 2
    ).length;
    let pawnWall = 0;
    for (let distance = 1; distance <= 3; distance++) {
      const row = king.row + forward * distance;
      if (!inBounds(row, king.col)) continue;
      for (let dc = -1; dc <= 1; dc++) {
        const col = king.col + dc;
        if (!inBounds(row, col)) continue;
        const pawn = board[row][col];
        if (pawn && pawn.owner === owner && pawn.piece === "P" && !pawn.promoted) pawnWall++;
      }
    }

    // In the opening the king should travel sideways along the back ranks,
    // not walk toward the centre of the board before its escorts are ready.
    score -= Math.max(0, homeDepth) * 92;
    if (homeDepth <= 1) score += lateral * 10;

    // A castle is recognised by three ingredients rather than one fixed
    // pattern: an off-centre king, nearby gold/silver, and a pawn wall.
    const castleProgress = Math.max(0, lateral - 1);
    score += castleProgress * (nearbyGenerals * 18 + Math.min(pawnWall, 5) * 7);
    if (lateral >= 2 && nearbyGenerals < 2) score -= 32;
  }

  return score * weight;
}

function evaluate(stateSnapshot) {
  let total = 0;
  const attacks = {
    black: Array(SIZE * SIZE).fill(0),
    white: Array(SIZE * SIZE).fill(0),
  };

  for (let row = 0; row < SIZE; row++) {
    for (let col = 0; col < SIZE; col++) {
      const piece = stateSnapshot.board[row][col];
      if (!piece) continue;
      const sign = piece.owner === PLAYERS.PLAYER ? 1 : -1;
      const targets = getAttackTargets(stateSnapshot.board, row, col, piece.owner);
      const value = getPieceValue(piece.piece, piece.promoted, stateSnapshot);
      for (const target of targets) {
        attacks[piece.owner][target.row * SIZE + target.col]++;
      }
      total += sign * (value + pieceSquareBonus(piece, row, col));
      total += sign * targets.length * MOBILITY_WEIGHT;
    }
  }

  for (const piece of Object.keys(stateSnapshot.hands.black)) {
    const handFactor = piece === "B" || piece === "R" ? 1.05 : 0.92;
    const value = getBasePieceValue(piece, stateSnapshot);
    total += stateSnapshot.hands.black[piece] * value * handFactor;
    total -= stateSnapshot.hands.white[piece] * value * handFactor;
  }

  total += kingSafety(stateSnapshot, PLAYERS.PLAYER, attacks.white);
  total -= kingSafety(stateSnapshot, PLAYERS.CPU, attacks.black);
  const opening = openingWeight(stateSnapshot);
  total += openingStructureScore(stateSnapshot, PLAYERS.PLAYER, opening);
  total -= openingStructureScore(stateSnapshot, PLAYERS.CPU, opening);
  if (isKingInCheck(stateSnapshot, PLAYERS.PLAYER)) total -= CHECK_BONUS;
  if (isKingInCheck(stateSnapshot, PLAYERS.CPU)) total += CHECK_BONUS;
  return total;
}

function cpuJudgmentForScore(cpuAdvantage) {
  if (cpuAdvantage >= 1800) return { emoji: "😎", label: "かなり優勢" };
  if (cpuAdvantage >= 500) return { emoji: "🙂", label: "やや優勢" };
  if (cpuAdvantage > CPU_DISADVANTAGE_THRESHOLD) return { emoji: "😐", label: "互角" };
  if (cpuAdvantage > -1800) return { emoji: "😟", label: "やや劣勢" };
  return { emoji: "😣", label: "かなり劣勢" };
}

function getCpuThinkTimeMs(stateSnapshot) {
  const cpuAdvantage = -evaluate(stateSnapshot);
  if (cpuAdvantage <= CPU_DISADVANTAGE_THRESHOLD) return CPU_MAX_THINK_TIME_MS;
  return CPU_MIN_THINK_TIME_MS +
    Math.random() * (CPU_MAX_THINK_TIME_MS - CPU_MIN_THINK_TIME_MS);
}

function moveKey(move) {
  if (move.drop) return `D${move.piece}${move.to.row}${move.to.col}`;
  return `${move.from.row}${move.from.col}${move.to.row}${move.to.col}${move.promote ? "+" : "-"}`;
}

function positionKey(stateSnapshot, currentPlayer) {
  let key = currentPlayer === PLAYERS.PLAYER ? "b|" : "w|";
  for (let row = 0; row < SIZE; row++) {
    for (let col = 0; col < SIZE; col++) {
      const piece = stateSnapshot.board[row][col];
      key += piece
        ? `${piece.owner === PLAYERS.PLAYER ? "b" : "w"}${piece.piece}${piece.promoted ? "+" : "-"}`
        : ".";
    }
  }
  key += "|";
  for (const owner of [PLAYERS.PLAYER, PLAYERS.CPU]) {
    for (const piece of Object.keys(stateSnapshot.hands[owner])) {
      key += stateSnapshot.hands[owner][piece].toString(36);
    }
    key += "|";
  }
  return key;
}

function createSearchContext(stateSnapshot) {
  return {
    deadline: performance.now() + getCpuThinkTimeMs(stateSnapshot),
    searchedNodes: 0,
    transpositionTable: new Map(),
    killerMoves: [],
    historyScores: new Map(),
  };
}

function evaluateMoveHeuristic(
  stateSnapshot,
  move,
  player,
  ply,
  searchContext,
  ttMoveKey = null
) {
  const key = moveKey(move);
  if (key === ttMoveKey) return 1000000000;

  let score = searchContext.historyScores.get(`${player}:${key}`) || 0;
  if (searchContext.killerMoves[ply]?.includes(key)) score += 90000;

  if (move.drop) {
    const enemyKing = findKing(stateSnapshot.board, opponentOf(player));
    if (enemyKing) {
      const distance = Math.max(
        Math.abs(enemyKing.row - move.to.row),
        Math.abs(enemyKing.col - move.to.col)
      );
      score += Math.max(0, 5 - distance) * 20;
    }
    return score + getBasePieceValue(move.piece, stateSnapshot) * 0.05;
  }

  const moving = stateSnapshot.board[move.from.row][move.from.col];
  const target = stateSnapshot.board[move.to.row][move.to.col];
  if (target) {
    score += getPieceValue(target.piece, target.promoted, stateSnapshot) * 16;
    score -= getPieceValue(moving.piece, moving.promoted, stateSnapshot);
  }
  if (move.promote) {
    score +=
      (getPromotedPieceValue(moving.piece, stateSnapshot) -
        getBasePieceValue(moving.piece, stateSnapshot)) *
        6 +
      500;
  }
  return score;
}

function orderMoves(stateSnapshot, moves, player, ply, searchContext, ttMoveKey = null) {
  return moves
    .map((move) => ({
      move,
      score: evaluateMoveHeuristic(stateSnapshot, move, player, ply, searchContext, ttMoveKey),
    }))
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.move);
}

function checkSearchTime(searchContext) {
  searchContext.searchedNodes++;
  if (
    (searchContext.searchedNodes & 127) === 0 &&
    performance.now() >= searchContext.deadline
  ) {
    throw SEARCH_TIMEOUT;
  }
}

function terminalScore(stateSnapshot, currentPlayer, ply, moves) {
  if (moves.length > 0) return null;
  if (!isKingInCheck(stateSnapshot, currentPlayer)) return DRAW_SCORE;
  return currentPlayer === PLAYERS.PLAYER ? -MATE_SCORE + ply : MATE_SCORE - ply;
}

function quiescence(stateSnapshot, currentPlayer, alpha, beta, ply, depthLeft, searchContext) {
  checkSearchTime(searchContext);
  const inCheck = isKingInCheck(stateSnapshot, currentPlayer);
  const standPat = evaluate(stateSnapshot);

  if (!inCheck) {
    if (currentPlayer === PLAYERS.PLAYER) {
      if (standPat >= beta) return standPat;
      alpha = Math.max(alpha, standPat);
    } else {
      if (standPat <= alpha) return standPat;
      beta = Math.min(beta, standPat);
    }
    if (depthLeft <= 0) return standPat;
  } else if (depthLeft <= -2) {
    return standPat;
  }

  let moves = generateLegalMoves(stateSnapshot, currentPlayer);
  const terminal = terminalScore(stateSnapshot, currentPlayer, ply, moves);
  if (terminal !== null) return terminal;

  if (!inCheck) {
    moves = moves.filter((move) => {
      if (move.promote) return true;
      return !move.drop && !!stateSnapshot.board[move.to.row][move.to.col];
    });
    if (moves.length === 0) return standPat;
  }
  moves = orderMoves(stateSnapshot, moves, currentPlayer, ply, searchContext);

  if (currentPlayer === PLAYERS.PLAYER) {
    let value = inCheck ? -Infinity : standPat;
    for (const move of moves) {
      value = Math.max(
        value,
        quiescence(
          applyMove(stateSnapshot, move),
          PLAYERS.CPU,
          alpha,
          beta,
          ply + 1,
          depthLeft - 1,
          searchContext
        )
      );
      alpha = Math.max(alpha, value);
      if (alpha >= beta) break;
    }
    return value;
  }

  let value = inCheck ? Infinity : standPat;
  for (const move of moves) {
    value = Math.min(
      value,
      quiescence(
        applyMove(stateSnapshot, move),
        PLAYERS.PLAYER,
        alpha,
        beta,
        ply + 1,
        depthLeft - 1,
        searchContext
      )
    );
    beta = Math.min(beta, value);
    if (alpha >= beta) break;
  }
  return value;
}

function alphaBeta(stateSnapshot, depth, currentPlayer, alpha, beta, ply, searchContext) {
  checkSearchTime(searchContext);
  if (depth <= 0) {
    return quiescence(
      stateSnapshot,
      currentPlayer,
      alpha,
      beta,
      ply,
      QUIESCENCE_DEPTH,
      searchContext
    );
  }

  const alphaStart = alpha;
  const betaStart = beta;
  const key = positionKey(stateSnapshot, currentPlayer);
  const cached = searchContext.transpositionTable.get(key);
  if (cached && cached.depth >= depth) {
    if (cached.flag === "exact") return cached.score;
    if (cached.flag === "lower") alpha = Math.max(alpha, cached.score);
    if (cached.flag === "upper") beta = Math.min(beta, cached.score);
    if (alpha >= beta) return cached.score;
  }

  let moves = generateLegalMoves(stateSnapshot, currentPlayer);
  const terminal = terminalScore(stateSnapshot, currentPlayer, ply, moves);
  if (terminal !== null) return terminal;
  moves = orderMoves(
    stateSnapshot,
    moves,
    currentPlayer,
    ply,
    searchContext,
    cached?.bestMoveKey
  );

  let bestMoveKey = null;
  let value = currentPlayer === PLAYERS.PLAYER ? -Infinity : Infinity;
  for (const move of moves) {
    const score = alphaBeta(
      applyMove(stateSnapshot, move),
      depth - 1,
      opponentOf(currentPlayer),
      alpha,
      beta,
      ply + 1,
      searchContext
    );

    if (currentPlayer === PLAYERS.PLAYER) {
      if (score > value) {
        value = score;
        bestMoveKey = moveKey(move);
      }
      alpha = Math.max(alpha, value);
    } else {
      if (score < value) {
        value = score;
        bestMoveKey = moveKey(move);
      }
      beta = Math.min(beta, value);
    }

    if (alpha >= beta) {
      const isCapture = !move.drop && !!stateSnapshot.board[move.to.row][move.to.col];
      if (!isCapture && !move.promote) {
        const cutoffKey = moveKey(move);
        searchContext.killerMoves[ply] = [
          cutoffKey,
          ...(searchContext.killerMoves[ply] || []).filter((item) => item !== cutoffKey),
        ].slice(0, 2);
        const historyKey = `${currentPlayer}:${cutoffKey}`;
        searchContext.historyScores.set(
          historyKey,
          (searchContext.historyScores.get(historyKey) || 0) + depth * depth * 20
        );
      }
      break;
    }
  }

  const flag = value <= alphaStart ? "upper" : value >= betaStart ? "lower" : "exact";
  if (searchContext.transpositionTable.size >= TRANSPOSITION_TABLE_LIMIT) {
    searchContext.transpositionTable.clear();
  }
  searchContext.transpositionTable.set(key, { depth, score: value, flag, bestMoveKey });
  return value;
}

function chooseCpuMove(stateSnapshot) {
  let rootMoves = generateLegalMoves(stateSnapshot, PLAYERS.CPU);
  if (rootMoves.length === 0) return null;

  const searchContext = createSearchContext(stateSnapshot);
  rootMoves = orderMoves(stateSnapshot, rootMoves, PLAYERS.CPU, 0, searchContext);

  // Complete a cheap one-position scan first, so even a very slow device
  // gets a positionally sensible fallback before deeper search starts.
  let completedBestMove = rootMoves[0];
  let completedBestScore = Infinity;
  let previousScores = new Map();
  for (const move of rootMoves) {
    const score = evaluate(applyMove(stateSnapshot, move));
    previousScores.set(moveKey(move), score);
    if (score < completedBestScore) {
      completedBestScore = score;
      completedBestMove = move;
    }
  }

  for (let depth = 1; depth <= CPU_MAX_SEARCH_DEPTH; depth++) {
    let iterationBestMove = null;
    let iterationBestScore = Infinity;
    const iterationScores = new Map();
    rootMoves.sort((a, b) => {
      const scoreA = previousScores.get(moveKey(a));
      const scoreB = previousScores.get(moveKey(b));
      if (scoreA !== undefined || scoreB !== undefined) {
        return (scoreA ?? Infinity) - (scoreB ?? Infinity);
      }
      return evaluateMoveHeuristic(stateSnapshot, b, PLAYERS.CPU, 0, searchContext) -
        evaluateMoveHeuristic(stateSnapshot, a, PLAYERS.CPU, 0, searchContext);
    });

    try {
      let beta = Infinity;
      for (const move of rootMoves) {
        const score = alphaBeta(
          applyMove(stateSnapshot, move),
          depth - 1,
          PLAYERS.PLAYER,
          -Infinity,
          beta,
          1,
          searchContext
        );
        iterationScores.set(moveKey(move), score);
        if (score < iterationBestScore) {
          iterationBestScore = score;
          iterationBestMove = move;
        }
        beta = Math.min(beta, iterationBestScore);
      }
    } catch (error) {
      if (error !== SEARCH_TIMEOUT) throw error;
      break;
    }

    if (iterationBestMove) {
      completedBestMove = iterationBestMove;
      completedBestScore = iterationBestScore;
      previousScores = iterationScores;
    }
    if (Math.abs(completedBestScore) >= MATE_SCORE - 100) break;
    if (performance.now() >= searchContext.deadline) break;
  }

  latestSearchStats = {
    searchedNodes: searchContext.searchedNodes,
    deepestTableEntry: Math.max(
      0,
      ...Array.from(searchContext.transpositionTable.values(), (entry) => entry.depth)
    ),
  };
  return completedBestMove;
}

function getSearchStats() {
  return { ...latestSearchStats };
}

globalScope.ShogiEngine = Object.freeze({
  SIZE,
  PLAYERS,
  PIECE_SYMBOLS,
  createEmptyBoard,
  createInitialBoard,
  createEmptyHands,
  createPosition,
  createPieceValueProfile,
  getDisplaySymbol,
  generateMovesForPiece,
  generateDropMoves,
  generateLegalMoves,
  applyMove,
  isKingInCheck,
  chooseCpuMove,
  moveKey,
  evaluate,
  openingStructureScore,
  cpuJudgmentForScore,
  getCpuThinkTimeMs,
  getSearchStats,
});
})(globalThis);
