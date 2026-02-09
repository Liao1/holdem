/**
 * Get seat position on an elliptical table.
 * Human player (seat 0) is always at the bottom center (270°).
 * Other players are evenly distributed clockwise around the ellipse.
 */
export function getSeatPosition(
  seatIndex: number,
  totalPlayers: number,
): { top: string; left: string } {
  if (seatIndex === 0) {
    return { top: '82%', left: '50%' };
  }

  const angleStep = 360 / totalPlayers;
  const angleDeg = 270 - angleStep * seatIndex;
  const angleRad = (angleDeg * Math.PI) / 180;

  const centerX = 50;
  const centerY = 45;
  const radiusX = 40;
  const radiusY = 35;

  const x = centerX + radiusX * Math.cos(angleRad);
  const y = centerY - radiusY * Math.sin(angleRad);

  return {
    top: `${Math.min(Math.max(y, 5), 80)}%`,
    left: `${Math.min(Math.max(x, 5), 95)}%`,
  };
}
