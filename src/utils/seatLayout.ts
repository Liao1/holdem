/**
 * Get seat position on an elliptical table.
 * Human player (seat 0) is always at the bottom center.
 * Other players are distributed clockwise around the ellipse.
 */
export function getSeatPosition(
  seatIndex: number,
  totalPlayers: number,
): { top: string; left: string } {
  // Human player at bottom center
  if (seatIndex === 0) {
    return { top: '82%', left: '50%' };
  }

  // Distribute other players clockwise around ellipse
  // Starting from bottom-left going clockwise
  const otherCount = totalPlayers - 1;
  const position = otherCount - seatIndex; // 0-indexed position among non-human players (reversed for clockwise)

  // Angle range: from ~210° (bottom-left) clockwise through top to ~330° (bottom-right)
  // We go from 210° counterclockwise in layout (which is clockwise visually)
  const startAngle = 210; // degrees, bottom-left
  const endAngle = 330;   // degrees, bottom-right
  const angleRange = 360 - (startAngle - endAngle); // total arc = 240 degrees

  const angleStep = angleRange / (otherCount + 1);
  const angleDeg = startAngle + angleStep * (position + 1);
  const angleRad = (angleDeg * Math.PI) / 180;

  // Ellipse parameters (in percentage of container)
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
