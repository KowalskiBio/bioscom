export type ChessBoard = string[][];
export type ChessColor = "white" | "black";

export const CHESS_PIECE_MAP: Record<string, string> = {
  P: "🧬", R: "🏭", N: "🔬", B: "🧪", Q: "⚗️", K: "👨‍🔬",
  p: "🦠", r: "💊", n: "🧫", b: "☣️", q: "☠️", k: "🧟",
};

export const CHESS_INITIAL_BOARD: ChessBoard = [
  ["r", "n", "b", "q", "k", "b", "n", "r"],
  ["p", "p", "p", "p", "p", "p", "p", "p"],
  ["", "", "", "", "", "", "", ""],
  ["", "", "", "", "", "", "", ""],
  ["", "", "", "", "", "", "", ""],
  ["", "", "", "", "", "", "", ""],
  ["P", "P", "P", "P", "P", "P", "P", "P"],
  ["R", "N", "B", "Q", "K", "B", "N", "R"],
];

export function isUpperCase(ch: string): boolean {
  return ch === ch.toUpperCase() && ch !== ch.toLowerCase();
}

export function isWhitePiece(p: string): boolean {
  return p !== "" && isUpperCase(p);
}

export function getPieceColor(p: string): ChessColor | null {
  if (p === "") {
    return null;
  }
  return isWhitePiece(p) ? "white" : "black";
}

export function getChessValidMoves(board: ChessBoard, r: number, c: number, myColor: ChessColor): Array<[number, number]> {
  const piece = board[r]?.[c] ?? "";
  if (piece === "") {
    return [];
  }
  const color = getPieceColor(piece);
  if (color !== myColor) {
    return [];
  }

  const moves: Array<[number, number]> = [];
  const isWhite = color === "white";
  const type = piece.toUpperCase();

  const inBounds = (rr: number, cc: number): boolean => rr >= 0 && rr < 8 && cc >= 0 && cc < 8;
  const canMoveTo = (tr: number, tc: number): boolean => {
    if (!inBounds(tr, tc)) {
      return false;
    }
    const target = board[tr]![tc] ?? "";
    if (target === "") {
      return true;
    }
    return getPieceColor(target) !== color;
  };
  const isEnemy = (tr: number, tc: number): boolean => {
    if (!inBounds(tr, tc)) {
      return false;
    }
    const target = board[tr]![tc] ?? "";
    return target !== "" && getPieceColor(target) !== color;
  };

  if (type === "P") {
    const dir = isWhite ? -1 : 1;
    const startRow = isWhite ? 6 : 1;
    if (inBounds(r + dir, c) && board[r + dir]![c] === "") {
      moves.push([r + dir, c]);
      if (r === startRow && board[r + 2 * dir]![c] === "") {
        moves.push([r + 2 * dir, c]);
      }
    }
    if (isEnemy(r + dir, c - 1)) {
      moves.push([r + dir, c - 1]);
    }
    if (isEnemy(r + dir, c + 1)) {
      moves.push([r + dir, c + 1]);
    }
  }

  if (type === "R" || type === "Q") {
    for (const [dr, dc] of [[0, 1], [0, -1], [1, 0], [-1, 0]] as const) {
      for (let i = 1; i < 8; i += 1) {
        const tr = r + dr * i;
        const tc = c + dc * i;
        if (!inBounds(tr, tc)) {
          break;
        }
        if (board[tr]![tc] === "") {
          moves.push([tr, tc]);
          continue;
        }
        if (getPieceColor(board[tr]![tc]!) !== color) {
          moves.push([tr, tc]);
        }
        break;
      }
    }
  }

  if (type === "B" || type === "Q") {
    for (const [dr, dc] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
      for (let i = 1; i < 8; i += 1) {
        const tr = r + dr * i;
        const tc = c + dc * i;
        if (!inBounds(tr, tc)) {
          break;
        }
        if (board[tr]![tc] === "") {
          moves.push([tr, tc]);
          continue;
        }
        if (getPieceColor(board[tr]![tc]!) !== color) {
          moves.push([tr, tc]);
        }
        break;
      }
    }
  }

  if (type === "N") {
    for (const [dr, dc] of [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]] as const) {
      if (canMoveTo(r + dr, c + dc)) {
        moves.push([r + dr, c + dc]);
      }
    }
  }

  if (type === "K") {
    for (let dr = -1; dr <= 1; dr += 1) {
      for (let dc = -1; dc <= 1; dc += 1) {
        if (dr === 0 && dc === 0) {
          continue;
        }
        if (canMoveTo(r + dr, c + dc)) {
          moves.push([r + dr, c + dc]);
        }
      }
    }
  }

  return moves;
}

export function applyChessMove(
  board: ChessBoard,
  from: [number, number],
  to: [number, number],
  moverColor: ChessColor,
): { board: ChessBoard; capturedPiece: string; promoted: boolean } {
  const next = board.map((row) => [...row]);
  const [sr, sc] = from;
  const [tr, tc] = to;
  const capturedPiece = next[tr]![tc] ?? "";
  next[tr]![tc] = next[sr]![sc] ?? "";
  next[sr]![sc] = "";
  let promoted = false;
  if (next[tr]![tc]!.toUpperCase() === "P") {
    if ((moverColor === "white" && tr === 0) || (moverColor === "black" && tr === 7)) {
      next[tr]![tc] = moverColor === "white" ? "Q" : "q";
      promoted = true;
    }
  }
  return { board: next, capturedPiece, promoted };
}
