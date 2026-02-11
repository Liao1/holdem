import Foundation
import PDFKit
import AppKit

enum Scenario: String, Codable {
  case rfi = "RFI"
  case facingRfi = "FACING_RFI"
  case rfiVs3Bet = "RFI_VS_3BET"
  case sbLimpVsBbRaise = "SB_LIMP_VS_BB_RAISE"
}

enum Position: String, Codable {
  case btn = "BTN"
  case sb = "SB"
  case bb = "BB"
  case utg = "UTG"
  case utg1 = "UTG1"
  case utg2 = "UTG2"
  case mp = "MP"
  case mp1 = "MP1"
  case co = "CO"
}

struct RangeAction: Codable {
  let fold: Double
  let call: Double
  let raise: Double
  let allIn: Double
}

struct Spot: Codable {
  let id: String
  let scenario: Scenario
  let heroPosition: Position
  let openerPositions: [Position]?
  let threeBettorPositions: [Position]?
  let notes: String?
  let hands: [String: RangeAction]
}

struct SourceMeta: Codable {
  let pdf: String
  let extractedAt: String
  let method: String
  let stackDepthBb: Int
}

struct Assumptions: Codable {
  let handGranularity: String
  let unknownColorAction: String
  let blueIsRaise: Bool
  let greenIsCall: Bool
  let darkGrayIsFold: Bool
  let whiteIsFold: Bool
}

struct StrategyFile: Codable {
  let version: String
  let source: SourceMeta
  let assumptions: Assumptions
  let spots: [Spot]
}

struct ChartSpec {
  let id: String
  let page: Int // 1-based page index in PDF
  let x: Int
  let titleY: Int
  let scenario: Scenario
  let hero: Position
  let openerPositions: [Position]?
  let threeBettorPositions: [Position]?
  let notes: String?
}

struct ImageBuffer {
  let width: Int
  let height: Int
  let bytesPerRow: Int
  let bytesPerPixel: Int
  let bytes: UnsafePointer<UInt8>

  func rgb(_ x: Int, _ y: Int) -> (Int, Int, Int) {
    let xx = min(max(x, 0), width - 1)
    let yy = min(max(y, 0), height - 1)
    let off = yy * bytesPerRow + xx * bytesPerPixel
    return (Int(bytes[off]), Int(bytes[off + 1]), Int(bytes[off + 2]))
  }
}

enum CellColor: String {
  case red
  case blue
  case green
  case darkGray
  case white
}

private let PALETTE: [(CellColor, (Int, Int, Int))] = [
  (.red, (244, 80, 83)),
  (.blue, (63, 72, 204)),
  (.green, (57, 181, 74)),
  (.darkGray, (95, 95, 95)),
  (.white, (245, 245, 245)),
]

private let RANKS: [String] = ["A", "K", "Q", "J", "T", "9", "8", "7", "6", "5", "4", "3", "2"]

private let CHART_SPECS: [ChartSpec] = [
  // Page 3: RFI
  ChartSpec(id: "rfi_utg", page: 3, x: 27, titleY: 95, scenario: .rfi, hero: .utg, openerPositions: nil, threeBettorPositions: nil, notes: nil),
  ChartSpec(id: "rfi_utg1", page: 3, x: 320, titleY: 95, scenario: .rfi, hero: .utg1, openerPositions: nil, threeBettorPositions: nil, notes: nil),
  ChartSpec(id: "rfi_utg2", page: 3, x: 612, titleY: 95, scenario: .rfi, hero: .utg2, openerPositions: nil, threeBettorPositions: nil, notes: nil),
  ChartSpec(id: "rfi_mp", page: 3, x: 900, titleY: 95, scenario: .rfi, hero: .mp, openerPositions: nil, threeBettorPositions: nil, notes: "Lojack"),
  ChartSpec(id: "rfi_mp1", page: 3, x: 27, titleY: 507, scenario: .rfi, hero: .mp1, openerPositions: nil, threeBettorPositions: nil, notes: "Hijack"),
  ChartSpec(id: "rfi_co", page: 3, x: 320, titleY: 507, scenario: .rfi, hero: .co, openerPositions: nil, threeBettorPositions: nil, notes: "Cutoff"),
  ChartSpec(id: "rfi_btn", page: 3, x: 612, titleY: 507, scenario: .rfi, hero: .btn, openerPositions: nil, threeBettorPositions: nil, notes: "Button"),
  ChartSpec(id: "rfi_sb", page: 3, x: 900, titleY: 507, scenario: .rfi, hero: .sb, openerPositions: nil, threeBettorPositions: nil, notes: "Small Blind has limp strategy"),

  // Pages 4-8: Facing RFI
  ChartSpec(id: "facing_rfi_utg1_vs_utg", page: 4, x: 27, titleY: 95, scenario: .facingRfi, hero: .utg1, openerPositions: [.utg], threeBettorPositions: nil, notes: nil),
  ChartSpec(id: "facing_rfi_utg2_vs_utg_utg1", page: 4, x: 320, titleY: 95, scenario: .facingRfi, hero: .utg2, openerPositions: [.utg, .utg1], threeBettorPositions: nil, notes: nil),
  ChartSpec(id: "facing_rfi_mp_vs_utg_utg1", page: 4, x: 612, titleY: 95, scenario: .facingRfi, hero: .mp, openerPositions: [.utg, .utg1], threeBettorPositions: nil, notes: "Lojack"),
  ChartSpec(id: "facing_rfi_mp_vs_utg2", page: 4, x: 900, titleY: 95, scenario: .facingRfi, hero: .mp, openerPositions: [.utg2], threeBettorPositions: nil, notes: "Lojack"),
  ChartSpec(id: "facing_rfi_mp1_vs_utg", page: 4, x: 27, titleY: 507, scenario: .facingRfi, hero: .mp1, openerPositions: [.utg], threeBettorPositions: nil, notes: "Hijack"),
  ChartSpec(id: "facing_rfi_mp1_vs_utg1", page: 4, x: 320, titleY: 507, scenario: .facingRfi, hero: .mp1, openerPositions: [.utg1], threeBettorPositions: nil, notes: "Hijack"),
  ChartSpec(id: "facing_rfi_mp1_vs_utg2", page: 4, x: 612, titleY: 507, scenario: .facingRfi, hero: .mp1, openerPositions: [.utg2], threeBettorPositions: nil, notes: "Hijack"),
  ChartSpec(id: "facing_rfi_mp1_vs_mp", page: 4, x: 900, titleY: 507, scenario: .facingRfi, hero: .mp1, openerPositions: [.mp], threeBettorPositions: nil, notes: "Hijack vs Lojack"),

  ChartSpec(id: "facing_rfi_co_vs_utg_utg1", page: 5, x: 27, titleY: 149, scenario: .facingRfi, hero: .co, openerPositions: [.utg, .utg1], threeBettorPositions: nil, notes: nil),
  ChartSpec(id: "facing_rfi_co_vs_utg2", page: 5, x: 320, titleY: 149, scenario: .facingRfi, hero: .co, openerPositions: [.utg2], threeBettorPositions: nil, notes: nil),
  ChartSpec(id: "facing_rfi_co_vs_mp", page: 5, x: 612, titleY: 149, scenario: .facingRfi, hero: .co, openerPositions: [.mp], threeBettorPositions: nil, notes: "vs Lojack"),
  ChartSpec(id: "facing_rfi_co_vs_mp1", page: 5, x: 900, titleY: 149, scenario: .facingRfi, hero: .co, openerPositions: [.mp1], threeBettorPositions: nil, notes: "vs Hijack"),

  ChartSpec(id: "facing_rfi_btn_vs_utg", page: 6, x: 27, titleY: 95, scenario: .facingRfi, hero: .btn, openerPositions: [.utg], threeBettorPositions: nil, notes: nil),
  ChartSpec(id: "facing_rfi_btn_vs_utg1", page: 6, x: 320, titleY: 95, scenario: .facingRfi, hero: .btn, openerPositions: [.utg1], threeBettorPositions: nil, notes: nil),
  ChartSpec(id: "facing_rfi_btn_vs_utg2", page: 6, x: 612, titleY: 95, scenario: .facingRfi, hero: .btn, openerPositions: [.utg2], threeBettorPositions: nil, notes: nil),
  ChartSpec(id: "facing_rfi_btn_vs_mp", page: 6, x: 900, titleY: 95, scenario: .facingRfi, hero: .btn, openerPositions: [.mp], threeBettorPositions: nil, notes: "vs Lojack"),
  ChartSpec(id: "facing_rfi_btn_vs_mp1", page: 6, x: 27, titleY: 507, scenario: .facingRfi, hero: .btn, openerPositions: [.mp1], threeBettorPositions: nil, notes: "vs Hijack"),
  ChartSpec(id: "facing_rfi_btn_vs_co", page: 6, x: 320, titleY: 507, scenario: .facingRfi, hero: .btn, openerPositions: [.co], threeBettorPositions: nil, notes: nil),

  ChartSpec(id: "facing_rfi_sb_vs_utg_utg1", page: 7, x: 27, titleY: 95, scenario: .facingRfi, hero: .sb, openerPositions: [.utg, .utg1], threeBettorPositions: nil, notes: nil),
  ChartSpec(id: "facing_rfi_sb_vs_utg2", page: 7, x: 320, titleY: 95, scenario: .facingRfi, hero: .sb, openerPositions: [.utg2], threeBettorPositions: nil, notes: nil),
  ChartSpec(id: "facing_rfi_sb_vs_mp", page: 7, x: 612, titleY: 95, scenario: .facingRfi, hero: .sb, openerPositions: [.mp], threeBettorPositions: nil, notes: "vs Lojack"),
  ChartSpec(id: "facing_rfi_sb_vs_mp1", page: 7, x: 900, titleY: 95, scenario: .facingRfi, hero: .sb, openerPositions: [.mp1], threeBettorPositions: nil, notes: "vs Hijack"),
  ChartSpec(id: "facing_rfi_sb_vs_co", page: 7, x: 27, titleY: 507, scenario: .facingRfi, hero: .sb, openerPositions: [.co], threeBettorPositions: nil, notes: nil),
  ChartSpec(id: "facing_rfi_sb_vs_btn", page: 7, x: 320, titleY: 507, scenario: .facingRfi, hero: .sb, openerPositions: [.btn], threeBettorPositions: nil, notes: nil),

  ChartSpec(id: "facing_rfi_bb_vs_utg_utg1", page: 8, x: 27, titleY: 83, scenario: .facingRfi, hero: .bb, openerPositions: [.utg, .utg1], threeBettorPositions: nil, notes: nil),
  ChartSpec(id: "facing_rfi_bb_vs_utg2", page: 8, x: 320, titleY: 83, scenario: .facingRfi, hero: .bb, openerPositions: [.utg2], threeBettorPositions: nil, notes: nil),
  ChartSpec(id: "facing_rfi_bb_vs_mp", page: 8, x: 612, titleY: 83, scenario: .facingRfi, hero: .bb, openerPositions: [.mp], threeBettorPositions: nil, notes: "vs Lojack"),
  ChartSpec(id: "facing_rfi_bb_vs_mp1", page: 8, x: 900, titleY: 83, scenario: .facingRfi, hero: .bb, openerPositions: [.mp1], threeBettorPositions: nil, notes: "vs Hijack"),
  ChartSpec(id: "facing_rfi_bb_vs_co", page: 8, x: 27, titleY: 507, scenario: .facingRfi, hero: .bb, openerPositions: [.co], threeBettorPositions: nil, notes: nil),
  ChartSpec(id: "facing_rfi_bb_vs_btn", page: 8, x: 320, titleY: 507, scenario: .facingRfi, hero: .bb, openerPositions: [.btn], threeBettorPositions: nil, notes: nil),
  ChartSpec(id: "facing_rfi_bb_vs_sb", page: 8, x: 612, titleY: 507, scenario: .facingRfi, hero: .bb, openerPositions: [.sb], threeBettorPositions: nil, notes: nil),

  // Pages 9-14: RFI vs 3bet
  ChartSpec(id: "rfi3_utg_vs_utg1", page: 9, x: 27, titleY: 86, scenario: .rfiVs3Bet, hero: .utg, openerPositions: nil, threeBettorPositions: [.utg1], notes: nil),
  ChartSpec(id: "rfi3_utg_vs_utg2", page: 9, x: 320, titleY: 86, scenario: .rfiVs3Bet, hero: .utg, openerPositions: nil, threeBettorPositions: [.utg2], notes: nil),
  ChartSpec(id: "rfi3_utg_vs_mp", page: 9, x: 612, titleY: 86, scenario: .rfiVs3Bet, hero: .utg, openerPositions: nil, threeBettorPositions: [.mp], notes: "vs Lojack"),
  ChartSpec(id: "rfi3_utg_vs_mp1", page: 9, x: 900, titleY: 86, scenario: .rfiVs3Bet, hero: .utg, openerPositions: nil, threeBettorPositions: [.mp1], notes: "vs Hijack"),
  ChartSpec(id: "rfi3_utg_vs_co_btn", page: 9, x: 27, titleY: 500, scenario: .rfiVs3Bet, hero: .utg, openerPositions: nil, threeBettorPositions: [.co, .btn], notes: nil),
  ChartSpec(id: "rfi3_utg_vs_sb_bb", page: 9, x: 320, titleY: 500, scenario: .rfiVs3Bet, hero: .utg, openerPositions: nil, threeBettorPositions: [.sb, .bb], notes: nil),

  ChartSpec(id: "rfi3_utg1_vs_utg2", page: 10, x: 27, titleY: 89, scenario: .rfiVs3Bet, hero: .utg1, openerPositions: nil, threeBettorPositions: [.utg2], notes: nil),
  ChartSpec(id: "rfi3_utg1_vs_mp", page: 10, x: 320, titleY: 89, scenario: .rfiVs3Bet, hero: .utg1, openerPositions: nil, threeBettorPositions: [.mp], notes: "vs Lojack"),
  ChartSpec(id: "rfi3_utg1_vs_mp1_co", page: 10, x: 612, titleY: 89, scenario: .rfiVs3Bet, hero: .utg1, openerPositions: nil, threeBettorPositions: [.mp1, .co], notes: "vs Hijack/Cutoff"),
  ChartSpec(id: "rfi3_utg1_vs_btn", page: 10, x: 900, titleY: 89, scenario: .rfiVs3Bet, hero: .utg1, openerPositions: nil, threeBettorPositions: [.btn], notes: nil),
  ChartSpec(id: "rfi3_utg1_vs_sb_bb", page: 10, x: 27, titleY: 505, scenario: .rfiVs3Bet, hero: .utg1, openerPositions: nil, threeBettorPositions: [.sb, .bb], notes: nil),

  ChartSpec(id: "rfi3_utg2_vs_mp", page: 11, x: 27, titleY: 162, scenario: .rfiVs3Bet, hero: .utg2, openerPositions: nil, threeBettorPositions: [.mp], notes: "vs Lojack"),
  ChartSpec(id: "rfi3_utg2_vs_mp1", page: 11, x: 320, titleY: 162, scenario: .rfiVs3Bet, hero: .utg2, openerPositions: nil, threeBettorPositions: [.mp1], notes: "vs Hijack"),
  ChartSpec(id: "rfi3_utg2_vs_co_btn", page: 11, x: 612, titleY: 162, scenario: .rfiVs3Bet, hero: .utg2, openerPositions: nil, threeBettorPositions: [.co, .btn], notes: nil),
  ChartSpec(id: "rfi3_utg2_vs_sb_bb", page: 11, x: 900, titleY: 162, scenario: .rfiVs3Bet, hero: .utg2, openerPositions: nil, threeBettorPositions: [.sb, .bb], notes: nil),

  ChartSpec(id: "rfi3_mp_vs_mp1", page: 12, x: 27, titleY: 89, scenario: .rfiVs3Bet, hero: .mp, openerPositions: nil, threeBettorPositions: [.mp1], notes: "Lojack vs Hijack"),
  ChartSpec(id: "rfi3_mp_vs_co", page: 12, x: 320, titleY: 89, scenario: .rfiVs3Bet, hero: .mp, openerPositions: nil, threeBettorPositions: [.co], notes: "Lojack vs Cutoff"),
  ChartSpec(id: "rfi3_mp_vs_btn", page: 12, x: 612, titleY: 89, scenario: .rfiVs3Bet, hero: .mp, openerPositions: nil, threeBettorPositions: [.btn], notes: "Lojack vs Button"),
  ChartSpec(id: "rfi3_mp_vs_sb", page: 12, x: 900, titleY: 89, scenario: .rfiVs3Bet, hero: .mp, openerPositions: nil, threeBettorPositions: [.sb], notes: "Lojack vs SB"),
  ChartSpec(id: "rfi3_mp_vs_bb", page: 12, x: 27, titleY: 505, scenario: .rfiVs3Bet, hero: .mp, openerPositions: nil, threeBettorPositions: [.bb], notes: "Lojack vs BB"),

  ChartSpec(id: "rfi3_mp1_vs_co", page: 13, x: 27, titleY: 86, scenario: .rfiVs3Bet, hero: .mp1, openerPositions: nil, threeBettorPositions: [.co], notes: "Hijack vs Cutoff"),
  ChartSpec(id: "rfi3_mp1_vs_btn", page: 13, x: 320, titleY: 86, scenario: .rfiVs3Bet, hero: .mp1, openerPositions: nil, threeBettorPositions: [.btn], notes: "Hijack vs Button"),
  ChartSpec(id: "rfi3_mp1_vs_sb", page: 13, x: 612, titleY: 86, scenario: .rfiVs3Bet, hero: .mp1, openerPositions: nil, threeBettorPositions: [.sb], notes: "Hijack vs SB"),
  ChartSpec(id: "rfi3_mp1_vs_bb", page: 13, x: 900, titleY: 86, scenario: .rfiVs3Bet, hero: .mp1, openerPositions: nil, threeBettorPositions: [.bb], notes: "Hijack vs BB"),
  ChartSpec(id: "rfi3_co_vs_btn_sb", page: 13, x: 27, titleY: 500, scenario: .rfiVs3Bet, hero: .co, openerPositions: nil, threeBettorPositions: [.btn, .sb], notes: nil),
  ChartSpec(id: "rfi3_co_vs_bb", page: 13, x: 320, titleY: 500, scenario: .rfiVs3Bet, hero: .co, openerPositions: nil, threeBettorPositions: [.bb], notes: nil),

  ChartSpec(id: "rfi3_btn_vs_sb_bb", page: 14, x: 27, titleY: 162, scenario: .rfiVs3Bet, hero: .btn, openerPositions: nil, threeBettorPositions: [.sb, .bb], notes: nil),
  ChartSpec(id: "rfi3_sb_vs_bb", page: 14, x: 320, titleY: 162, scenario: .rfiVs3Bet, hero: .sb, openerPositions: nil, threeBettorPositions: [.bb], notes: "AA/KK/AKo are handled via limp/3bet value range"),
  ChartSpec(id: "sb_limp_vs_bb_raise", page: 14, x: 612, titleY: 162, scenario: .sbLimpVsBbRaise, hero: .sb, openerPositions: [.bb], threeBettorPositions: nil, notes: nil),
]

func renderPage(_ doc: PDFDocument, pageIndex0: Int, scale: CGFloat = 1.5) -> ImageBuffer {
  guard let page = doc.page(at: pageIndex0) else {
    fatalError("Failed to read page index \(pageIndex0)")
  }

  let bounds = page.bounds(for: .mediaBox)
  let width = Int(bounds.width * scale)
  let height = Int(bounds.height * scale)

  guard let rep = NSBitmapImageRep(
    bitmapDataPlanes: nil,
    pixelsWide: width,
    pixelsHigh: height,
    bitsPerSample: 8,
    samplesPerPixel: 4,
    hasAlpha: true,
    isPlanar: false,
    colorSpaceName: .deviceRGB,
    bytesPerRow: 0,
    bitsPerPixel: 0
  ) else {
    fatalError("Failed to allocate bitmap rep")
  }

  NSGraphicsContext.saveGraphicsState()
  guard let ctx = NSGraphicsContext(bitmapImageRep: rep) else {
    fatalError("Failed to create graphics context")
  }
  NSGraphicsContext.current = ctx
  NSColor.white.set()
  NSRect(x: 0, y: 0, width: CGFloat(width), height: CGFloat(height)).fill()
  ctx.cgContext.scaleBy(x: scale, y: scale)
  page.draw(with: .mediaBox, to: ctx.cgContext)
  NSGraphicsContext.restoreGraphicsState()

  guard let cg = rep.cgImage, let data = cg.dataProvider?.data else {
    fatalError("Failed to read CGImage bytes")
  }

  return ImageBuffer(
    width: cg.width,
    height: cg.height,
    bytesPerRow: cg.bytesPerRow,
    bytesPerPixel: cg.bitsPerPixel / 8,
    bytes: CFDataGetBytePtr(data)!
  )
}

func nearestPaletteColor(_ rgb: (Int, Int, Int)) -> CellColor {
  var best = CellColor.white
  var bestDist = Int.max

  for (color, p) in PALETTE {
    let d = (rgb.0 - p.0) * (rgb.0 - p.0)
      + (rgb.1 - p.1) * (rgb.1 - p.1)
      + (rgb.2 - p.2) * (rgb.2 - p.2)
    if d < bestDist {
      bestDist = d
      best = color
    }
  }

  return best
}

func classifyCellColor(_ image: ImageBuffer, cellX: Int, cellY: Int) -> CellColor {
  let sampleOffsets: [(Int, Int)] = [
    (3, 3), (9, 3), (15, 3),
    (3, 9), (15, 9),
    (3, 15), (9, 15), (15, 15),
  ]

  var histogram: [CellColor: Int] = [:]

  for (dx, dy) in sampleOffsets {
    let c = nearestPaletteColor(image.rgb(cellX + dx, cellY + dy))
    histogram[c, default: 0] += 1
  }

  return histogram.max(by: { $0.value < $1.value })?.key ?? .white
}

func detectGridTopY(_ image: ImageBuffer, x: Int, titleY: Int) -> Int {
  let start = min(max(0, titleY + 8), image.height - 1)
  let end = min(image.height - 1, titleY + 100)
  let x2 = min(image.width - 1, x + 259)

  for y in start...end {
    var count = 0
    for px in x...x2 {
      let (r, g, b) = image.rgb(px, y)
      let sat = max(r, max(g, b)) - min(r, min(g, b))
      let lum = (r + g + b) / 3
      if sat > 20 && lum < 245 {
        count += 1
      }
    }

    if count >= 80 {
      return y
    }
  }

  // Fallback if line detection misses: use fixed offset.
  return min(image.height - 260, titleY + 32)
}

func handKeyForCell(row: Int, col: Int) -> String {
  let a = RANKS[row]
  let b = RANKS[col]

  if row == col {
    return a + b
  }

  let high = row < col ? a : b
  let low = row < col ? b : a
  let suited = row < col ? "s" : "o"
  return high + low + suited
}

func mapColorToAction(_ color: CellColor, scenario: Scenario, hero: Position) -> RangeAction {
  switch scenario {
  case .rfi:
    if hero == .sb {
      switch color {
      case .red, .blue:
        return RangeAction(fold: 0, call: 0, raise: 1, allIn: 0)
      case .green:
        return RangeAction(fold: 0, call: 1, raise: 0, allIn: 0)
      case .darkGray, .white:
        return RangeAction(fold: 1, call: 0, raise: 0, allIn: 0)
      }
    }

    switch color {
    case .red, .blue:
      return RangeAction(fold: 0, call: 0, raise: 1, allIn: 0)
    case .green:
      return RangeAction(fold: 0, call: 1, raise: 0, allIn: 0)
    case .darkGray, .white:
      return RangeAction(fold: 1, call: 0, raise: 0, allIn: 0)
    }

  case .facingRfi, .rfiVs3Bet, .sbLimpVsBbRaise:
    switch color {
    case .red, .blue:
      return RangeAction(fold: 0, call: 0, raise: 1, allIn: 0)
    case .green:
      return RangeAction(fold: 0, call: 1, raise: 0, allIn: 0)
    case .darkGray, .white:
      return RangeAction(fold: 1, call: 0, raise: 0, allIn: 0)
    }
  }
}

func extractSpot(_ spec: ChartSpec, _ image: ImageBuffer) -> Spot {
  let topY = detectGridTopY(image, x: spec.x, titleY: spec.titleY)

  var hands: [String: RangeAction] = [:]
  var colorCounts: [CellColor: Int] = [:]

  for row in 0..<13 {
    for col in 0..<13 {
      let cellX = spec.x + col * 20
      let cellY = topY + row * 20
      let color = classifyCellColor(image, cellX: cellX, cellY: cellY)
      colorCounts[color, default: 0] += 1

      let handKey = handKeyForCell(row: row, col: col)
      hands[handKey] = mapColorToAction(color, scenario: spec.scenario, hero: spec.hero)
    }
  }

  let nonWhite = 169 - (colorCounts[.white] ?? 0)
  print("[extract] \(spec.id): page=\(spec.page) x=\(spec.x) titleY=\(spec.titleY) gridTop=\(topY) nonWhite=\(nonWhite) colors=\(colorCounts)")

  return Spot(
    id: spec.id,
    scenario: spec.scenario,
    heroPosition: spec.hero,
    openerPositions: spec.openerPositions,
    threeBettorPositions: spec.threeBettorPositions,
    notes: spec.notes,
    hands: hands
  )
}

func parseArgs() -> (input: String, output: String) {
  var input = "docs/100bb-gto-charts.pdf"
  var output = "src/engine/gto/strategies/preflop-100bb-gto.json"

  var i = 1
  while i < CommandLine.arguments.count {
    let arg = CommandLine.arguments[i]
    switch arg {
    case "--input":
      if i + 1 < CommandLine.arguments.count {
        input = CommandLine.arguments[i + 1]
        i += 1
      }
    case "--output":
      if i + 1 < CommandLine.arguments.count {
        output = CommandLine.arguments[i + 1]
        i += 1
      }
    default:
      break
    }
    i += 1
  }

  return (input, output)
}

let args = parseArgs()
let inputURL = URL(fileURLWithPath: args.input)
let outputURL = URL(fileURLWithPath: args.output)

if !FileManager.default.fileExists(atPath: inputURL.path) {
  fputs("Input PDF not found: \(inputURL.path)\n", stderr)
  exit(1)
}

guard let doc = PDFDocument(url: inputURL) else {
  fputs("Failed to open PDF: \(inputURL.path)\n", stderr)
  exit(1)
}

var pageCache: [Int: ImageBuffer] = [:]
var spots: [Spot] = []

for spec in CHART_SPECS {
  if pageCache[spec.page] == nil {
    pageCache[spec.page] = renderPage(doc, pageIndex0: spec.page - 1)
  }

  guard let image = pageCache[spec.page] else {
    fputs("Failed to render page \(spec.page)\n", stderr)
    exit(1)
  }

  spots.append(extractSpot(spec, image))
}

let strategy = StrategyFile(
  version: "1.0.0",
  source: SourceMeta(
    pdf: "docs/100bb-gto-charts.pdf",
    extractedAt: ISO8601DateFormatter().string(from: Date()),
    method: "swift-pdfkit-color-grid-extraction-v1",
    stackDepthBb: 100
  ),
  assumptions: Assumptions(
    handGranularity: "169",
    unknownColorAction: "FOLD",
    blueIsRaise: true,
    greenIsCall: true,
    darkGrayIsFold: true,
    whiteIsFold: true
  ),
  spots: spots
)

let encoder = JSONEncoder()
encoder.outputFormatting = [.prettyPrinted, .sortedKeys]

let data = try encoder.encode(strategy)
try FileManager.default.createDirectory(at: outputURL.deletingLastPathComponent(), withIntermediateDirectories: true)
try data.write(to: outputURL)

print("[extract] wrote \(spots.count) spots to \(outputURL.path)")
