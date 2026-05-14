/**
 * Chess piece graphics (Lichess CDN SVGs). Same IDs on web (img) and mobile (SvgUri).
 * Persisted with the same key as mobile: `@chess_piece_set`.
 */
export const LICHESS_PIECE_CDN = 'https://lichess1.org/assets/piece'

/** Lichess folder names — previews use `wN` (white knight). */
export const CHESS_PIECE_SETS = [
  { id: 'cburnett', nameEn: 'Classic', nameAr: 'كلاسيكي' },
  { id: 'merida', nameEn: 'Merida', nameAr: 'ميريدا' },
  { id: 'alpha', nameEn: 'Alpha', nameAr: 'ألفا' },
  { id: 'pirouetti', nameEn: 'Pirouetti', nameAr: 'بيروتي' },
  { id: 'chessnut', nameEn: 'Chessnut', nameAr: 'تشيسنت' },
  { id: 'fantasy', nameEn: 'Fantasy', nameAr: 'فانتسي' },
  { id: 'spatial', nameEn: 'Spatial', nameAr: 'مكاني' },
  { id: 'california', nameEn: 'California', nameAr: 'كاليفورنيا' },
  { id: 'celtic', nameEn: 'Celtic', nameAr: 'سلتيك' },
  { id: 'dubrovny', nameEn: 'Dubrovny', nameAr: 'دوبروفني' },
]

export const DEFAULT_CHESS_PIECE_SET_ID = 'cburnett'

export const PIECE_SET_STORAGE_KEY = '@chess_piece_set'

export function getPieceSetById(id) {
  if (!id) return CHESS_PIECE_SETS[0]
  return CHESS_PIECE_SETS.find((s) => s.id === id) || CHESS_PIECE_SETS[0]
}

export function lichessPieceSvgUrl(setId, pieceCode) {
  return `${LICHESS_PIECE_CDN}/${setId}/${pieceCode}.svg`
}

/** FEN piece letter → react-chessboard / Lichess filename (e.g. P → wP, n → bN). */
export function fenCharToPieceCode(char) {
  if (!char || typeof char !== 'string') return 'wP'
  const t = char.toLowerCase()
  if (!'pnbrqk'.includes(t)) return 'wP'
  const isWhite = char === char.toUpperCase()
  return `${isWhite ? 'w' : 'b'}${t.toUpperCase()}`
}
