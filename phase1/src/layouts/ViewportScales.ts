/**
 * ViewportScales - Viewport-Driven Layout System
 *
 * All layout parameters are calculated from viewport dimensions.
 * This ensures the visualization scales correctly on any screen
 * from phone to ultrawide monitor.
 *
 * Core Philosophy: Everything derives from viewport size.
 * Only mathematical floors (device pixel awareness) are truly static.
 */

/**
 * Context for viewport-aware calculations
 */
export interface ViewportContext {
  width: number           // Canvas width in CSS pixels
  height: number          // Canvas height in CSS pixels
  dpr: number             // Device pixel ratio (1, 2, or 3)
  zoomLevel: number       // Current zoom scale (0.05 to 20)
  visibleNodes: number    // How many nodes currently visible
}

/**
 * Node size range calculated from viewport and density
 */
export interface NodeSizeRange {
  minRadius: number       // Minimum node radius (visibility floor)
  maxRadius: number       // Maximum node radius (capped)
  minArea: number         // Minimum node area (pi * minRadius^2)
  maxArea: number         // Maximum node area (pi * maxRadius^2)
  scaleFactor: number     // For area-proportional sizing
}

/**
 * Complete layout result from viewport calculations
 */
export interface ViewportLayoutResult {
  sizeRange: NodeSizeRange
  ringGap: number
  innerRadius: number
  baseSpacing: number
  maxSpacing: number
  edgeBaseThickness: number
  edgeMinThickness: number
  textMinSize: number
  textMaxSize: number
  baseUnit: number
  readableUnit: number
}

/**
 * Base unit calculations from viewport dimensions
 */
export class LayoutScales {
  private ctx: ViewportContext

  constructor(ctx: ViewportContext) {
    this.ctx = ctx
  }

  /**
   * BASE UNIT: 1% of smaller viewport dimension
   *
   * Examples:
   * - Desktop 1920x1080: baseUnit = 10.8px
   * - Laptop 1440x900: baseUnit = 9px
   * - iPad Landscape 1024x768: baseUnit = 7.68px
   * - iPhone 14 Pro 430x932: baseUnit = 4.3px
   */
  get baseUnit(): number {
    return Math.min(this.ctx.width, this.ctx.height) * 0.01
  }

  /**
   * READABLE UNIT: Minimum size for legibility
   * Accounts for device pixel ratio (higher DPR = crisper small elements)
   */
  get readableUnit(): number {
    // 1px on 1x display, 0.5px on 2x display (same physical size)
    return 1 / this.ctx.dpr
  }

  /**
   * Get current context
   */
  get context(): ViewportContext {
    return this.ctx
  }

  /**
   * Update context (returns new instance for immutability)
   */
  withUpdates(updates: Partial<ViewportContext>): LayoutScales {
    return new LayoutScales({ ...this.ctx, ...updates })
  }
}

/**
 * TOTAL_NODES_REFERENCE: Expected max node count for density calculations
 * Used to scale node sizes based on how "sparse" the current view is
 */
const TOTAL_NODES_REFERENCE = 2583

/**
 * Node sizing calculator - viewport and density aware
 */
export class NodeSizeCalculator {
  private scales: LayoutScales

  constructor(scales: LayoutScales) {
    this.scales = scales
  }

  /**
   * Calculate node size range based on viewport and visible node count
   *
   * Key insight: As viewport shrinks OR node count increases,
   * nodes must get smaller to prevent overlaps
   */
  getNodeSizeRange(visibleNodes: number): NodeSizeRange {
    const { baseUnit, readableUnit } = this.scales

    // MINIMUM RADIUS: Small floor to preserve statistical truth
    // Low-importance nodes should appear genuinely tiny
    // ~0.54px on 1080p display (similar to original 0.5px static floor)
    const minRadius = Math.max(
      readableUnit * 0.5,     // 0.5px on 1x display, 0.25px on 2x
      baseUnit * 0.05         // 0.05% of viewport (~0.54px on 1080p)
    )

    // MAXIMUM RADIUS: Scales inversely with node density
    // More nodes = smaller max size (prevents overcrowding)
    const densityFactor = Math.sqrt(TOTAL_NODES_REFERENCE / Math.max(visibleNodes, 1))

    // Cap at 3x baseUnit to prevent excessively large nodes in sparse views
    const maxRadius = Math.min(
      baseUnit * 2.0 * densityFactor,
      baseUnit * 3  // Cap at ~32px on 1080p
    )

    // Ensure max > min (safety check)
    const safeMaxRadius = Math.max(maxRadius, minRadius * 2)

    // Calculate areas for area-proportional sizing
    const minArea = Math.PI * minRadius * minRadius
    const maxArea = Math.PI * safeMaxRadius * safeMaxRadius
    const scaleFactor = maxArea - minArea

    return {
      minRadius,
      maxRadius: safeMaxRadius,
      minArea,
      maxArea,
      scaleFactor
    }
  }

  /**
   * Get radius for a specific node based on importance
   *
   * Uses area-proportional sizing: area = minArea + importance * scaleFactor
   * Then converts back to radius: radius = sqrt(area / pi)
   */
  getNodeRadius(importance: number, sizeRange: NodeSizeRange): number {
    const { minRadius, minArea, scaleFactor } = sizeRange

    // Area proportional to importance
    const area = minArea + importance * scaleFactor
    const radius = Math.sqrt(area / Math.PI)

    // Apply floor (safety check, should rarely trigger)
    return Math.max(minRadius, radius)
  }

  /**
   * Check if a node is displayed at floor size
   */
  isNodeFloored(importance: number, sizeRange: NodeSizeRange): boolean {
    const { minRadius, minArea, scaleFactor } = sizeRange
    const area = minArea + importance * scaleFactor
    const targetRadius = Math.sqrt(area / Math.PI)
    return targetRadius < minRadius
  }
}

/**
 * Adaptive spacing calculator - viewport aware
 */
export class SpacingCalculator {
  private scales: LayoutScales

  constructor(scales: LayoutScales) {
    this.scales = scales
  }

  /**
   * Get base spacing (minimum gap between any two nodes)
   */
  get baseSpacing(): number {
    const { readableUnit, baseUnit } = this.scales

    // Either 2 readable units or 0.2% of viewport
    return Math.max(
      readableUnit * 2,       // 2px on 1x, 1px on 2x
      baseUnit * 0.2          // 0.2% of viewport
    )
  }

  /**
   * Get maximum spacing (cap for large nodes)
   */
  get maxSpacing(): number {
    return this.scales.baseUnit * 0.7  // 0.7% of viewport
  }

  /**
   * Get spacing scale factor
   */
  get scaleFactor(): number {
    return 0.3  // Spacing grows with node size at 30% rate
  }

  /**
   * Calculate spacing between two nodes
   *
   * Formula: spacing = min(maxSpacing, baseSpacing + avgRadius * scaleFactor)
   */
  getSpacing(nodeRadius: number, neighborRadius?: number): number {
    const base = this.baseSpacing
    const max = this.maxSpacing

    if (neighborRadius === undefined) {
      // Single node: use its own radius
      return Math.min(max, base + nodeRadius * this.scaleFactor)
    }

    // Two nodes: spacing based on average of their radii
    const avgRadius = (nodeRadius + neighborRadius) / 2
    return Math.min(max, base + avgRadius * this.scaleFactor)
  }
}

/**
 * Ring radii calculator - viewport and content aware
 */
export class RingRadiiCalculator {
  private scales: LayoutScales
  private nodeSizer: NodeSizeCalculator
  private spacer: SpacingCalculator

  constructor(
    scales: LayoutScales,
    nodeSizer: NodeSizeCalculator,
    spacer: SpacingCalculator
  ) {
    this.scales = scales
    this.nodeSizer = nodeSizer
    this.spacer = spacer
  }

  /**
   * Get minimum gap between adjacent rings
   */
  get minRingGap(): number {
    return this.scales.baseUnit * 8  // 8x base unit (~86px on desktop)
  }

  /**
   * Get minimum radius for Ring 1 (outcomes)
   */
  get minInnerRadius(): number {
    return this.scales.baseUnit * 10  // 10x base unit (~108px on desktop)
  }

  /**
   * Calculate minimum radius needed for a ring to fit all nodes
   */
  calculateMinRingRadius(
    nodes: Array<{ importance?: number }>,
    sizeRange: NodeSizeRange
  ): number {
    if (nodes.length === 0) return 0

    let totalArc = 0

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]
      const nodeRadius = this.nodeSizer.getNodeRadius(
        node.importance ?? 0,
        sizeRange
      )

      // Diameter
      totalArc += nodeRadius * 2

      // Spacing to next node (wrap around for last)
      const nextNode = nodes[(i + 1) % nodes.length]
      const nextRadius = this.nodeSizer.getNodeRadius(
        nextNode.importance ?? 0,
        sizeRange
      )
      totalArc += this.spacer.getSpacing(nodeRadius, nextRadius)
    }

    // Required radius: circumference = 2 * PI * R
    return totalArc / (2 * Math.PI)
  }

  /**
   * Calculate all ring radii dynamically
   *
   * Each ring gets the larger of:
   * 1. Minimum radius to fit all its nodes
   * 2. Previous ring + minimum gap
   * 3. Minimum inner radius (for ring 1)
   */
  calculateRadii(
    nodesByRing: Map<number, Array<{ importance?: number }>>,
    sizeRange: NodeSizeRange,
    maxRings: number = 6
  ): number[] {
    const radii: number[] = [0]  // Ring 0 (root) at center
    let currentRadius = 0

    for (let ringIndex = 1; ringIndex < maxRings; ringIndex++) {
      const nodesInRing = nodesByRing.get(ringIndex) ?? []

      if (nodesInRing.length === 0) {
        // Empty ring: just add minimum gap
        radii.push(currentRadius + this.minRingGap)
        currentRadius += this.minRingGap
        continue
      }

      // Calculate minimum radius for this ring
      const requiredRadius = this.calculateMinRingRadius(nodesInRing, sizeRange)

      // Apply constraints - no viewport clamping, let rings extend as needed
      // Users can zoom out or pan to see full layout
      const finalRadius = Math.max(
        requiredRadius,                          // Fit all nodes
        currentRadius + this.minRingGap,         // Min gap from previous
        ringIndex === 1 ? this.minInnerRadius : 0  // Min inner radius
      )

      radii.push(finalRadius)
      currentRadius = finalRadius
    }

    return radii
  }
}

/**
 * Text size calculator - viewport and zoom aware
 *
 * Uses same 1:14 ratio as original static implementation,
 * but scales proportionally with viewport size.
 *
 * Ring-based multipliers reduce text size in dense outer rings.
 */
export class TextSizeCalculator {
  private scales: LayoutScales

  // Text size ratios (relative to baseUnit)
  // Increased for better readability
  private static readonly MIN_TEXT_RATIO = 0.18    // ~2px on 1080p
  private static readonly MAX_TEXT_RATIO = 1.5     // ~16px on 1080p

  // Ring-based multipliers - inner rings get full size, outer rings scaled down
  // This prevents text overlap in dense outer rings while keeping inner rings readable
  private static readonly RING_MULTIPLIERS: Record<number, number> = {
    0: 1.0,    // Root - full size
    1: 1.0,    // Outcomes - full size
    2: 1.0,    // Coarse Domains - full size
    3: 0.85,   // Fine Domains - slightly reduced
    4: 0.70,   // Groups - reduced
    5: 0.35    // Indicators - significantly reduced (very dense)
  }

  constructor(scales: LayoutScales) {
    this.scales = scales
  }

  /**
   * Get minimum font size (scales with viewport)
   * ~1px on 1080p, ~0.7px on 768p, ~0.4px on phone
   */
  get minFontSize(): number {
    return this.scales.baseUnit * TextSizeCalculator.MIN_TEXT_RATIO
  }

  /**
   * Get maximum font size (scales with viewport)
   * ~14px on 1080p, ~10px on 768p, ~5.6px on phone
   */
  get maxFontSize(): number {
    return this.scales.baseUnit * TextSizeCalculator.MAX_TEXT_RATIO
  }

  /**
   * Get ring multiplier for text sizing
   */
  getRingMultiplier(ring: number): number {
    return TextSizeCalculator.RING_MULTIPLIERS[ring] ?? 0.5
  }

  /**
   * Get minimum readable font size at current zoom
   */
  getMinReadableSize(zoomLevel: number): number {
    return this.scales.readableUnit * 6 / zoomLevel
  }

  /**
   * Calculate font size for a node
   *
   * NOTE: Font size is set WITHOUT zoom adjustment.
   * D3's zoom transform handles visual scaling.
   * Only visibility check considers zoom.
   *
   * @param importance - Node importance (0-1)
   * @param ring - Ring index (0-5) for ring-based scaling
   */
  getFontSize(importance: number, ring: number = 0): number {
    const min = this.minFontSize
    const max = this.maxFontSize
    const range = max - min

    // Importance-based scaling (sqrt for perceptual linearity)
    const baseFontSize = min + range * Math.sqrt(importance)

    // Apply ring multiplier (inner rings full size, outer rings reduced)
    const ringMultiplier = this.getRingMultiplier(ring)

    // Apply fixed multiplier (matches existing 0.9x behavior)
    return baseFontSize * ringMultiplier * 0.9
  }

  /**
   * Check if text is readable at current zoom
   */
  isTextReadable(fontSize: number, zoomLevel: number): boolean {
    // Effective size = base font * zoom
    const effectiveSize = fontSize * zoomLevel

    // Readable if >= 6 readable units
    return effectiveSize >= this.scales.readableUnit * 6
  }

  /**
   * Calculate per-ring text visibility
   * Hide labels in a ring if >50% would be unreadable
   */
  shouldShowRingLabels(
    nodesInRing: Array<{ importance?: number }>,
    zoomLevel: number
  ): boolean {
    if (nodesInRing.length === 0) return false

    let readableCount = 0

    for (const node of nodesInRing) {
      const fontSize = this.getFontSize(node.importance ?? 0)
      if (this.isTextReadable(fontSize, zoomLevel)) {
        readableCount++
      }
    }

    const readablePercent = readableCount / nodesInRing.length
    return readablePercent > 0.5  // Show if >50% readable
  }
}

/**
 * Edge style calculator - viewport aware
 */
export class EdgeStyleCalculator {
  private scales: LayoutScales

  constructor(scales: LayoutScales) {
    this.scales = scales
  }

  /**
   * Get base edge thickness (at root level)
   */
  get baseThickness(): number {
    return this.scales.baseUnit * 0.2  // 0.2% of viewport (~2.16px on desktop)
  }

  /**
   * Get minimum edge thickness (legibility floor)
   */
  get minThickness(): number {
    return this.scales.readableUnit * 0.5  // 0.5px on 1x display
  }

  /**
   * Depth decay factor (each level is 60% of previous)
   */
  get depthDecay(): number {
    return 0.6
  }

  /**
   * Base opacity (at root level)
   */
  get baseOpacity(): number {
    return 0.6
  }

  /**
   * Minimum opacity
   */
  get minOpacity(): number {
    return 0.12
  }

  /**
   * Calculate edge thickness for a given depth
   */
  getEdgeThickness(ringDepth: number): number {
    const thickness = this.baseThickness * Math.pow(this.depthDecay, ringDepth)
    return Math.max(thickness, this.minThickness)
  }

  /**
   * Calculate edge opacity for a given depth
   */
  getEdgeOpacity(ringDepth: number): number {
    const opacity = this.baseOpacity * Math.pow(this.depthDecay, ringDepth)
    return Math.max(opacity, this.minOpacity)
  }
}

/**
 * MASTER LAYOUT ENGINE: Coordinates all viewport-aware calculations
 */
export class ViewportAwareLayout {
  private ctx: ViewportContext
  private _scales: LayoutScales
  private _nodeSizer: NodeSizeCalculator
  private _spacer: SpacingCalculator
  private _ringRadiiCalc: RingRadiiCalculator
  private _textSizer: TextSizeCalculator
  private _edgeStyler: EdgeStyleCalculator

  constructor(
    width: number,
    height: number,
    dpr: number = 1,
    zoomLevel: number = 1,
    visibleNodes: number = 100
  ) {
    this.ctx = { width, height, dpr, zoomLevel, visibleNodes }
    this._scales = new LayoutScales(this.ctx)
    this._nodeSizer = new NodeSizeCalculator(this._scales)
    this._spacer = new SpacingCalculator(this._scales)
    this._ringRadiiCalc = new RingRadiiCalculator(
      this._scales,
      this._nodeSizer,
      this._spacer
    )
    this._textSizer = new TextSizeCalculator(this._scales)
    this._edgeStyler = new EdgeStyleCalculator(this._scales)
  }

  // Expose calculators for direct access
  get scales(): LayoutScales { return this._scales }
  get nodeSizer(): NodeSizeCalculator { return this._nodeSizer }
  get spacer(): SpacingCalculator { return this._spacer }
  get ringRadiiCalc(): RingRadiiCalculator { return this._ringRadiiCalc }
  get textSizer(): TextSizeCalculator { return this._textSizer }
  get edgeStyler(): EdgeStyleCalculator { return this._edgeStyler }

  /**
   * Get current viewport context
   */
  get context(): ViewportContext {
    return this.ctx
  }

  /**
   * Get all computed layout values as a single object
   */
  getLayoutValues(): ViewportLayoutResult {
    const sizeRange = this._nodeSizer.getNodeSizeRange(this.ctx.visibleNodes)

    return {
      sizeRange,
      ringGap: this._ringRadiiCalc.minRingGap,
      innerRadius: this._ringRadiiCalc.minInnerRadius,
      baseSpacing: this._spacer.baseSpacing,
      maxSpacing: this._spacer.maxSpacing,
      edgeBaseThickness: this._edgeStyler.baseThickness,
      edgeMinThickness: this._edgeStyler.minThickness,
      textMinSize: this._textSizer.minFontSize,
      textMaxSize: this._textSizer.maxFontSize,
      baseUnit: this._scales.baseUnit,
      readableUnit: this._scales.readableUnit
    }
  }

  /**
   * Update viewport context and rebuild calculators
   */
  updateContext(updates: Partial<ViewportContext>): void {
    this.ctx = { ...this.ctx, ...updates }
    this._scales = new LayoutScales(this.ctx)
    this._nodeSizer = new NodeSizeCalculator(this._scales)
    this._spacer = new SpacingCalculator(this._scales)
    this._ringRadiiCalc = new RingRadiiCalculator(
      this._scales,
      this._nodeSizer,
      this._spacer
    )
    this._textSizer = new TextSizeCalculator(this._scales)
    this._edgeStyler = new EdgeStyleCalculator(this._scales)
  }

  /**
   * Calculate ring radii for given node distribution
   */
  calculateRingRadii(
    nodesByRing: Map<number, Array<{ importance?: number }>>,
    maxRings: number = 6
  ): number[] {
    const sizeRange = this._nodeSizer.getNodeSizeRange(this.ctx.visibleNodes)
    return this._ringRadiiCalc.calculateRadii(nodesByRing, sizeRange, maxRings)
  }

  /**
   * Get node radius for a specific importance value
   */
  getNodeRadius(importance: number): number {
    const sizeRange = this._nodeSizer.getNodeSizeRange(this.ctx.visibleNodes)
    return this._nodeSizer.getNodeRadius(importance, sizeRange)
  }

  /**
   * Check if node is at floor size
   */
  isNodeFloored(importance: number): boolean {
    const sizeRange = this._nodeSizer.getNodeSizeRange(this.ctx.visibleNodes)
    return this._nodeSizer.isNodeFloored(importance, sizeRange)
  }

  /**
   * Get spacing between nodes
   */
  getSpacing(nodeRadius: number, neighborRadius?: number): number {
    return this._spacer.getSpacing(nodeRadius, neighborRadius)
  }

  /**
   * Get font size for a node
   * @param importance - Node importance (0-1)
   * @param ring - Ring index (0-5) for ring-based scaling
   */
  getFontSize(importance: number, ring: number = 0): number {
    return this._textSizer.getFontSize(importance, ring)
  }

  /**
   * Check if text is readable at current zoom
   */
  isTextReadable(fontSize: number): boolean {
    return this._textSizer.isTextReadable(fontSize, this.ctx.zoomLevel)
  }

  /**
   * Get edge thickness for a depth level
   */
  getEdgeThickness(ringDepth: number): number {
    return this._edgeStyler.getEdgeThickness(ringDepth)
  }

  /**
   * Get edge opacity for a depth level
   */
  getEdgeOpacity(ringDepth: number): number {
    return this._edgeStyler.getEdgeOpacity(ringDepth)
  }

  /**
   * Log current layout parameters (for debugging)
   */
  logParameters(): void {
    const values = this.getLayoutValues()
    console.log('[ViewportAwareLayout] Parameters:')
    console.log(`  Viewport: ${this.ctx.width}x${this.ctx.height} @ ${this.ctx.dpr}x DPR`)
    console.log(`  Base unit: ${values.baseUnit.toFixed(2)}px`)
    console.log(`  Readable unit: ${values.readableUnit.toFixed(2)}px`)
    console.log(`  Node size: ${values.sizeRange.minRadius.toFixed(2)}px - ${values.sizeRange.maxRadius.toFixed(2)}px`)
    console.log(`  Ring gap: ${values.ringGap.toFixed(2)}px`)
    console.log(`  Inner radius: ${values.innerRadius.toFixed(2)}px`)
    console.log(`  Spacing: ${values.baseSpacing.toFixed(2)}px - ${values.maxSpacing.toFixed(2)}px`)
    console.log(`  Edge thickness: ${values.edgeBaseThickness.toFixed(2)}px (min: ${values.edgeMinThickness.toFixed(2)}px)`)
    console.log(`  Text size: ${values.textMinSize.toFixed(2)}px - ${values.textMaxSize.toFixed(2)}px`)
  }
}

/**
 * Factory function for creating viewport-aware layout
 */
export function createViewportLayout(
  width: number = window.innerWidth,
  height: number = window.innerHeight,
  dpr: number = window.devicePixelRatio || 1,
  zoomLevel: number = 1,
  visibleNodes: number = 100
): ViewportAwareLayout {
  return new ViewportAwareLayout(width, height, dpr, zoomLevel, visibleNodes)
}
