/** Resign or end any active chess/card game (e.g. when ending a live stream). */
export function resignActiveGames(socket, user) {
  if (!socket || !user?._id) return;

  const gameLive = localStorage.getItem('gameLive') === 'true';
  const chessRoomId = localStorage.getItem('chessRoomId');

  if (gameLive && chessRoomId) {
    const match = chessRoomId.match(/^chess_(.+?)_(.+?)_(\d+)$/);
    if (match) {
      const me = String(user._id);
      const opponent = me === String(match[1]) ? match[2] : match[1];
      socket.emit('resignChess', { roomId: chessRoomId, to: opponent });
    } else {
      socket.emit('chessGameEnd', { roomId: chessRoomId });
    }
    localStorage.removeItem('chessOrientation');
    localStorage.removeItem('gameLive');
    localStorage.removeItem('chessRoomId');
    localStorage.removeItem('chessFEN');
    localStorage.removeItem('capturedWhite');
    localStorage.removeItem('capturedBlack');
    const s = String(chessRoomId).trim();
    if (s) {
      window.dispatchEvent(new CustomEvent('chessGameFeedUiEnded', { detail: { roomId: s } }));
    }
  }

  const cardRoomId = localStorage.getItem('cardRoomId');
  if (cardRoomId) {
    const match = cardRoomId.match(/^card_(.+?)_(.+?)_(\d+)$/);
    if (match) {
      socket.emit('cardGameEnd', { roomId: cardRoomId, player1: match[1], player2: match[2] });
    } else {
      socket.emit('cardGameEnd', { roomId: cardRoomId });
    }
    localStorage.removeItem('cardRoomId');
  }
}
