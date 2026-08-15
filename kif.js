(function initializeKif(globalScope) {
  const BOARD_SIZE = 9;
  const FILES = ["９", "８", "７", "６", "５", "４", "３", "２", "１"];
  const RANKS = ["一", "二", "三", "四", "五", "六", "七", "八", "九"];
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

  function createMoveRecord(position, move) {
    const movingPiece = move.drop ? null : position.board[move.from.row][move.from.col];
    return {
      drop: Boolean(move.drop),
      piece: move.drop ? move.piece : movingPiece.piece,
      wasPromoted: Boolean(movingPiece?.promoted),
      promote: Boolean(move.promote),
      player: move.player,
      from: move.drop ? null : { ...move.from },
      to: { ...move.to },
    };
  }

  function rotateSquare(square) {
    return {
      row: BOARD_SIZE - 1 - square.row,
      col: BOARD_SIZE - 1 - square.col,
    };
  }

  function formatMove(record, previousRecord = null, rotateBoard = false) {
    const sameDestination =
      previousRecord &&
      previousRecord.to.row === record.to.row &&
      previousRecord.to.col === record.to.col;
    const destinationSquare = rotateBoard ? rotateSquare(record.to) : record.to;
    const destination = sameDestination
      ? "同　"
      : `${FILES[destinationSquare.col]}${RANKS[destinationSquare.row]}`;
    const symbol = record.wasPromoted
      ? PROMOTED_SYMBOLS[record.piece]
      : PIECE_SYMBOLS[record.piece];
    const qualifier = record.drop ? "打" : record.promote ? "成" : "";
    const originSquare = record.drop
      ? null
      : rotateBoard
        ? rotateSquare(record.from)
        : record.from;
    const origin = record.drop
      ? ""
      : `(${BOARD_SIZE - originSquare.col}${originSquare.row + 1})`;
    return `${destination}${symbol}${qualifier}${origin}`;
  }

  function formatDate(date) {
    const pad = (value) => String(value).padStart(2, "0");
    return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(
      date.getHours()
    )}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }

  function sideForPlayer(game, player) {
    const isSente = player === "black" ? game.playerStarts : !game.playerStarts;
    return isSente ? "先手" : "後手";
  }

  function generate(game) {
    const sente = game.playerStarts ? "あなた" : "CPU";
    const gote = game.playerStarts ? "CPU" : "あなた";
    const rotateBoard = !game.playerStarts;
    const lines = [
      "# KIF形式棋譜ファイル",
      "# ブラウザで遊べる対CPU将棋",
      `開始日時：${formatDate(game.startedAt)}`,
      "手合割：平手",
      `先手：${sente}`,
      `後手：${gote}`,
      "手数----指手---------消費時間--",
    ];

    game.moveHistory.forEach((record, index) => {
      const notation = formatMove(record, game.moveHistory[index - 1], rotateBoard);
      lines.push(`${String(index + 1).padStart(4, " ")} ${notation}`);
    });

    if (game.winner === "draw") {
      lines.push(`${String(game.moveHistory.length + 1).padStart(4, " ")} 千日手`);
      lines.push(`まで${game.moveHistory.length}手で引き分け`);
    } else if (game.winner) {
      lines.push(`${String(game.moveHistory.length + 1).padStart(4, " ")} 詰み`);
      lines.push(`まで${game.moveHistory.length}手で${sideForPlayer(game, game.winner)}の勝ち`);
    }
    return `${lines.join("\r\n")}\r\n`;
  }

  globalScope.ShogiKif = Object.freeze({ createMoveRecord, formatMove, generate });
})(globalThis);
