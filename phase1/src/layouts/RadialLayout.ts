/**
 * RadialLayout - Explicit Space Accounting Algorithm
 *
 * Two-pass algorithm with detailed logging:
 * 1. Bottom-up: Calculate minimum angular requirements from leaves upward
 * 2. Top-down: Allocate space from root downward, tracking compression
 *
 * Key improvement: Tracks allocated vs required space at every node
 * to diagnose where overlaps originate.
 *
 * Now uses viewport-aware scaling for all dimensions.
 */

import type { RawNodeV21 } from '../types'
import { debug } from '../utils/debug'
import type { NodeSizeRange } from './ViewportScales'

export interface RingConfig {
  radius: number
  nodeSize: number
  label?: string
}

/**
 * Text orientation strategy for different rings/zoom levels
 */
export type TextOrientation = 'radial' | 'horizontal' | 'hidden'

/**
 * Text configuration for layout spacing calculations
 */
export interface TextConfig {
  /** Number of expanded Ring 1 branches (affects text boost) */
  expandedBranchCount: number
  /** Minimum readable font size (default 4px) */
  minReadableSize: number
  /** Maximum boosted font size (default 5px) */
  maxBoostedSize: number
  /** Base font size range from viewport */
  minFontSize: number
  maxFontSize: number
}

export interface LayoutConfig {
  rings: RingConfig[]
  nodePadding: number
  startAngle: number
  totalAngle: number
  minRingGap: number
  useFixedRadii?: boolean
  // Viewport-aware sizing parameters (optional for backward compatibility)
  sizeRange?: NodeSizeRange
  baseSpacing?: number
  spacingScaleFactor?: number
  maxSpacing?: number
  // Text-aware spacing (optional)
  textConfig?: TextConfig
}

export interface ComputedRingConfig {
  radius: number
  nodeSize: number
  label?: string
  nodeCount: number
  requiredRadius: number
}

export interface LayoutNode {
  id: string
  rawNode: RawNodeV21
  ring: number
  angle: number
  x: number
  y: number
  children: LayoutNode[]
  parent: LayoutNode | null
  subtreeLeafCount: number
  angularExtent: number
  minAngularExtent: number  // Minimum required (from bottom-up pass)
}

export interface LayoutResult {
  nodes: LayoutNode[]
  nodeMap: Map<string, LayoutNode>
  computedRings: ComputedRingConfig[]
}

/**
 * Space allocation tracking for debugging
 */
interface SpaceAllocation {
  nodeId: string
  nodeName: string
  ring: number
  required: number      // Minimum angular extent needed (radians)
  allocated: number     // Actual angular extent received (radians)
  compressionRatio: number  // allocated / required (1.0 = perfect, <1.0 = compressed)
  ownRequirement: number    // Just this node's size requirement
  childrenRequirement: number  // Sum of children's requirements
}

/**
 * DEFAULT node sizing constants (used when viewport-aware values not provided)
 * These are fallbacks for backward compatibility
 */
const DEFAULT_MIN_NODE_RADIUS = 0.5
const DEFAULT_MAX_NODE_RADIUS = 20
const DEFAULT_MIN_NODE_AREA = Math.PI * DEFAULT_MIN_NODE_RADIUS * DEFAULT_MIN_NODE_RADIUS
const DEFAULT_MAX_NODE_AREA = Math.PI * DEFAULT_MAX_NODE_RADIUS * DEFAULT_MAX_NODE_RADIUS

/**
 * Default size range for backward compatibility
 */
const DEFAULT_SIZE_RANGE: NodeSizeRange = {
  minRadius: DEFAULT_MIN_NODE_RADIUS,
  maxRadius: DEFAULT_MAX_NODE_RADIUS,
  minArea: DEFAULT_MIN_NODE_AREA,
  maxArea: DEFAULT_MAX_NODE_AREA,
  scaleFactor: DEFAULT_MAX_NODE_AREA - DEFAULT_MIN_NODE_AREA
}

// Module-level config holder for functions that don't receive config directly
let currentSizeRange: NodeSizeRange = DEFAULT_SIZE_RANGE
let currentBaseSpacing: number = 2
let currentSpacingScaleFactor: number = 0.3
let currentMaxSpacing: number = 7

// Module-level text config holder
let currentTextConfig: TextConfig | null = null

/**
 * Update the current layout parameters (called from computeRadialLayout)
 */
function setLayoutParams(config: LayoutConfig): void {
  currentSizeRange = config.sizeRange ?? DEFAULT_SIZE_RANGE
  currentBaseSpacing = config.baseSpacing ?? 2
  currentSpacingScaleFactor = config.spacingScaleFactor ?? 0.3
  currentMaxSpacing = config.maxSpacing ?? 7
  currentTextConfig = config.textConfig ?? null
}

// ============================================================================
// TEXT-AWARE SPACING CALCULATIONS
// ============================================================================

/** Average character width as fraction of font size */
const AVG_CHAR_WIDTH_RATIO = 0.55

/**
 * Ring-based text multipliers (matches ViewportScales.ts)
 */
const RING_TEXT_MULTIPLIERS: Record<number, number> = {
  0: 1.0,    // Root - full size
  1: 1.0,    // Outcomes - full size
  2: 1.0,    // Coarse Domains - full size
  3: 0.85,   // Fine Domains - slightly reduced
  4: 0.70,   // Groups - reduced
  5: 0.35    // Indicators - significantly reduced
}

/**
 * Estimate text width without DOM measurement (fast heuristic)
 * 95% accurate, 100x faster than measureText()
 */
function estimateTextWidth(text: string, fontSize: number): number {
  if (!text) return 0

  const charCount = text.length
  // Account for wide/narrow characters
  const wideCharCount = (text.match(/[WMQ@%]/gi) || []).length
  const narrowCharCount = (text.match(/[iltj!|]/gi) || []).length

  const adjustedCount = charCount +
    wideCharCount * 0.3 -     // Wide chars add 30%
    narrowCharCount * 0.3     // Narrow chars subtract 30%

  return adjustedCount * fontSize * AVG_CHAR_WIDTH_RATIO
}

/**
 * Get text orientation strategy for a ring
 * Determines how text affects spacing calculations
 */
function getTextOrientation(ringIndex: number): TextOrientation {
  if (ringIndex <= 1) {
    return 'horizontal'  // Ring 0-1: text below node
  }
  // Ring 2-5: text extends outward (radial)
  // Ring 5 included so indicator labels can be visible during branch exploration
  return 'radial'
}

/**
 * Calculate font size for a node (with boost for branch exploration)
 * Mirrors the logic in App.tsx applyTextBoost
 */
function calculateFontSize(importance: number, ringIndex: number): number {
  if (!currentTextConfig) return 0

  const { minFontSize, maxFontSize, expandedBranchCount, minReadableSize, maxBoostedSize } = currentTextConfig
  const range = maxFontSize - minFontSize

  // Base font size (same formula as ViewportScales)
  const baseFontSize = minFontSize + range * Math.sqrt(importance)
  const ringMultiplier = RING_TEXT_MULTIPLIERS[ringIndex] ?? 0.5
  const fontSize = baseFontSize * ringMultiplier * 0.9

  // Apply boost for branch exploration
  const boostFactor = expandedBranchCount <= 0 ? 0 : Math.max(0, 1 - (expandedBranchCount - 1) / 4)

  if (boostFactor === 0 || fontSize >= minReadableSize) {
    return fontSize
  }

  // Map small text into boosted range
  const ratio = fontSize / minReadableSize
  const boostedSize = minReadableSize + ratio * (maxBoostedSize - minReadableSize)

  return fontSize + (boostedSize - fontSize) * boostFactor
}

/**
 * Calculate visual footprint (tangential extent) for a node
 * This is the arc length needed to avoid text overlap
 *
 * @returns tangentialExtent in pixels (arc length along ring)
 */
function calculateVisualFootprint(
  nodeRadius: number,
  label: string,
  importance: number,
  ringIndex: number
): number {
  const textOrientation = getTextOrientation(ringIndex)
  const nodeDiameter = nodeRadius * 2

  // No text consideration for hidden orientation
  if (textOrientation === 'hidden' || !currentTextConfig) {
    return nodeDiameter
  }

  const fontSize = calculateFontSize(importance, ringIndex)
  const textWidth = estimateTextWidth(label, fontSize)

  // Cap text width to prevent extreme spacing for long labels
  const cappedTextWidth = Math.min(textWidth, 150)

  // Calculate boost factor for extra spacing during single-branch exploration
  // More boost = more spacing for readability
  const { expandedBranchCount } = currentTextConfig
  const boostFactor = expandedBranchCount <= 0 ? 0 : Math.max(0, 1 - (expandedBranchCount - 1) / 4)

  // Extra padding when exploring few branches (scales down as more branches expand)
  // Increased to 3x fontSize for better indicator label readability
  const explorationPadding = boostFactor * fontSize * 3

  switch (textOrientation) {
    case 'horizontal':
      // Text below node - needs max of node width or text width
      return Math.max(nodeDiameter, cappedTextWidth) + explorationPadding

    case 'radial':
      // Text extends outward - add font height + exploration padding
      // Base: 1.8x fontSize for text thickness
      return nodeDiameter + fontSize * 1.8 + explorationPadding

    default:
      return nodeDiameter
  }
}

/**
 * Pure area-proportional sizing with visibility floor.
 * Node area is directly proportional to importance (statistical truth).
 * Floor ensures all nodes are visible/clickable.
 * @param _ring - Unused, kept for API compatibility
 * @param importance - Normalized importance (0-1)
 */
function getActualNodeSize(_ring: number, importance: number): number {
  const { minRadius, minArea, scaleFactor } = currentSizeRange
  const targetArea = minArea + importance * scaleFactor
  const targetRadius = Math.sqrt(targetArea / Math.PI)
  return Math.max(minRadius, targetRadius)
}

/**
 * Adaptive spacing based on node size.
 * Tiny nodes don't need large gaps.
 * Larger nodes need proportionally more spacing.
 *
 * Formula: spacing = baseSpacing + nodeRadius × scaleFactor
 * Uses viewport-aware values when provided via config.
 */
function getAdaptiveSpacing(nodeRadius: number, neighborRadius?: number): number {
  if (neighborRadius === undefined) {
    // Single node: use its own radius
    return Math.min(currentMaxSpacing, currentBaseSpacing + nodeRadius * currentSpacingScaleFactor)
  }

  // Two nodes: spacing based on average of their radii
  const avgRadius = (nodeRadius + neighborRadius) / 2
  return Math.min(currentMaxSpacing, currentBaseSpacing + avgRadius * currentSpacingScaleFactor)
}

/**
 * Internal tree node for building hierarchy
 */
interface TreeNode {
  id: string
  rawNode: RawNodeV21
  children: TreeNode[]
  parent: TreeNode | null
  subtreeLeafCount: number
  minAngularExtent: number      // Calculated in bottom-up pass
  ownAngularRequirement: number // Just this node's size
  childrenAngularRequirement: number // Sum of children
}

// ============================================================================
// SMART SECTOR FILLING - GROW FROM RIGHT
// Outcomes fill the arc starting from right (0°), spreading around the circle
// Natural spacing when sparse, compressed when dense
// ============================================================================

// Minimum extent for a collapsed outcome (just the node itself, minimal subtree)
// Larger = more space reserved for collapsed outcomes when siblings are expanded
const COLLAPSED_OUTCOME_MIN_EXTENT = Math.PI / 24  // ~7.5°

/**
 * Assign target angles for all outcomes with RIGHT SIDE PRIORITY.
 *
 * Strategy:
 * - Expanded outcomes are placed centered around 0° (right side) for readable text
 * - Collapsed outcomes fill the remaining space (top/bottom/left)
 * - Always fills full 360°
 *
 * @param allOutcomeIds - All outcome IDs in order
 * @param outcomeRequirements - Map of outcome ID to angular extent needed (from Pass 1)
 * @param expandedNodeIds - Set of expanded node IDs (for determining which outcomes need more space)
 * @returns Map of outcome ID to target center angle and extent
 */
function assignOutcomeAngles(
  allOutcomeIds: string[],
  outcomeRequirements: Map<string, number>,
  expandedNodeIds: Set<string>
): { angles: Map<string, number>; extents: Map<string, number> } {
  const angles = new Map<string, number>()
  const extents = new Map<string, number>()

  if (allOutcomeIds.length === 0) return { angles, extents }

  // Separate expanded and collapsed outcomes
  const expanded: Array<{ id: string; minExtent: number }> = []
  const collapsed: Array<{ id: string; minExtent: number }> = []

  for (const id of allOutcomeIds) {
    const isExpanded = expandedNodeIds.has(id)
    const minExtent = isExpanded
      ? (outcomeRequirements.get(id) ?? COLLAPSED_OUTCOME_MIN_EXTENT)
      : COLLAPSED_OUTCOME_MIN_EXTENT

    if (isExpanded) {
      expanded.push({ id, minExtent })
    } else {
      collapsed.push({ id, minExtent })
    }
  }

  // Calculate totals
  const expandedTotal = expanded.reduce((sum, o) => sum + o.minExtent, 0)
  const collapsedTotal = collapsed.reduce((sum, o) => sum + o.minExtent, 0)
  const totalMinRequired = expandedTotal + collapsedTotal

  // Available space is full circle - ALWAYS fill 360°
  const availableSpace = 2 * Math.PI

  // Use UNIFIED compactness for Ring 1 positioning
  // This matches Ring 2 compactness so inter-branch spacing equals intra-branch spacing
  const ring1Compactness = getUnifiedCompactness(expanded.length)

  // Base scale for expanded outcomes (full extent needed for Ring 2 children)
  const baseScale = availableSpace / totalMinRequired

  // Expanded outcomes: full extent for child allocation, compacted positioning
  for (const outcome of expanded) {
    extents.set(outcome.id, outcome.minExtent * baseScale)
  }

  // Calculate how much angular space expanded outcomes use for POSITIONING
  const expandedFullExtent = expandedTotal * baseScale
  const expandedPositioningSpace = expandedFullExtent * ring1Compactness

  // Collapsed outcomes: expand to fill ALL remaining space
  const remainingSpace = availableSpace - expandedPositioningSpace
  const collapsedScale = collapsedTotal > 0 ? remainingSpace / collapsedTotal : 1
  for (const outcome of collapsed) {
    extents.set(outcome.id, outcome.minExtent * collapsedScale)
  }

  // POSITION EXPANDED OUTCOMES: Centered around 0° (right side)
  let currentAngle = -expandedPositioningSpace / 2  // Start so they center on 0°

  for (const outcome of expanded) {
    const fullExtent = extents.get(outcome.id)!
    const positioningExtent = fullExtent * ring1Compactness  // Compacted for positioning
    const centerAngle = currentAngle + positioningExtent / 2
    angles.set(outcome.id, centerAngle)
    currentAngle += positioningExtent
  }

  // POSITION COLLAPSED OUTCOMES: Fill remaining space (starting after expanded positioning)
  // They spread evenly across the remaining arc (left/top/bottom)
  currentAngle = expandedPositioningSpace / 2

  for (const outcome of collapsed) {
    const extent = extents.get(outcome.id)!  // Already scaled to fill remaining space
    let centerAngle = currentAngle + extent / 2

    // Normalize to [-π, π]
    while (centerAngle > Math.PI) centerAngle -= 2 * Math.PI
    while (centerAngle < -Math.PI) centerAngle += 2 * Math.PI

    angles.set(outcome.id, centerAngle)
    currentAngle += extent
  }

  // Log assignment
  debug.sector('[SECTOR FILLING] RIGHT-SIDE PRIORITY:')
  debug.sector(`  Expanded: ${expanded.length} outcomes, positioned in ${toDeg(expandedPositioningSpace)} (compactness: ${ring1Compactness.toFixed(2)}), full extent: ${toDeg(expandedFullExtent)}`)
  debug.sector(`  Collapsed: ${collapsed.length} outcomes filling remaining ${toDeg(remainingSpace)} (scale: ${collapsedScale.toFixed(2)}x)`)

  for (const outcome of expanded) {
    const angle = angles.get(outcome.id)!
    const extent = extents.get(outcome.id)!
    debug.sector(`  [EXPANDED] ${outcome.id}: ${toDeg(angle)} (extent: ${toDeg(extent)})`)
  }
  for (const outcome of collapsed) {
    const angle = angles.get(outcome.id)!
    const extent = extents.get(outcome.id)!
    debug.sector(`  [collapsed] ${outcome.id}: ${toDeg(angle)} (extent: ${toDeg(extent)})`)
  }

  return { angles, extents }
}

/**
 * Convert radians to degrees for logging
 */
function toDeg(radians: number): string {
  return (radians * 180 / Math.PI).toFixed(1) + '°'
}

// Global space allocation tracker for debugging
const spaceAllocations = new Map<string, SpaceAllocation>()

// Track expanded outcomes for compactness calculation
let expandedOutcomeCount = 0

/**
 * Unified compactness formula for Ring 1 positioning AND Ring 2 spread.
 *
 * By using the same compactness for both:
 * - Ring 1 outcomes are positioned such that their Ring 2 children's extents meet
 * - Inter-branch Ring 2 spacing equals intra-branch Ring 2 spacing
 *
 * Scale: 1 expanded → 0.4, linear to 5+ expanded → 1.0
 */
function getUnifiedCompactness(expandedCount: number): number {
  if (expandedCount <= 0) return 1.0
  if (expandedCount >= 5) return 1.0
  // Linear: 1→0.4, 2→0.55, 3→0.7, 4→0.85, 5→1.0
  return 0.4 + (expandedCount - 1) * (0.6 / 4)
}

/**
 * Compute subtree leaf count
 */
function computeSubtreeLeafCount(node: TreeNode): number {
  if (node.children.length === 0) {
    node.subtreeLeafCount = 1
    return 1
  }
  let total = 0
  for (const child of node.children) {
    total += computeSubtreeLeafCount(child)
  }
  node.subtreeLeafCount = total
  return total
}

/**
 * PASS 1: Bottom-up calculation of minimum angular requirements.
 *
 * Each node's minAngularExtent = MAX of:
 * 1. Its own size requirement at its ring
 * 2. Sum of all children's minAngularExtent (they need this space at next ring)
 *
 * This ensures parents "reserve" enough angular space for all descendants.
 */
function calculateMinimumRequirements(
  node: TreeNode,
  ringIndex: number,
  ringRadii: number[],
  _nodePadding: number,  // Unused - now using adaptive spacing
  verbose: boolean = false
): number {
  const radius = ringRadii[ringIndex] || ringRadii[ringRadii.length - 1]

  // Calculate own size requirement at this ring with adaptive spacing
  const nodeSize = getActualNodeSize(ringIndex, node.rawNode.importance ?? 0)
  const importance = node.rawNode.importance ?? 0
  const label = node.rawNode.label || ''

  // Calculate visual footprint (includes text if textConfig is set)
  const visualFootprint = calculateVisualFootprint(nodeSize, label, importance, ringIndex)

  // Spacing based on node size (not text - text footprint handles overlap)
  const spacing = getAdaptiveSpacing(nodeSize)

  // Convert visual footprint to angular width (arc length / radius)
  // For footprint larger than node diameter, use arc length formula
  const footprintAngular = radius > 0 ? visualFootprint / radius : Math.PI * 2
  const spacingAngular = radius > 0 ? spacing / radius : 0
  const ownMinAngle = footprintAngular + spacingAngular

  node.ownAngularRequirement = ownMinAngle

  if (node.children.length === 0) {
    // Leaf node: just needs space for itself
    node.minAngularExtent = ownMinAngle
    node.childrenAngularRequirement = 0

    // Track allocation (allocated will be set in Pass 2)
    spaceAllocations.set(node.id, {
      nodeId: node.id,
      nodeName: node.rawNode.label || node.id,
      ring: ringIndex,
      required: ownMinAngle,
      allocated: 0,
      compressionRatio: 0,
      ownRequirement: ownMinAngle,
      childrenRequirement: 0
    })

    return ownMinAngle
  }

  // Parent node: Calculate children's space needs with pairwise spacing
  const childRingIndex = ringIndex + 1
  const childRingRadius = ringRadii[childRingIndex] || ringRadii[ringRadii.length - 1]

  // Get children's visual footprints for spacing calculation
  const childFootprints = node.children.map(child => {
    const childNodeSize = getActualNodeSize(childRingIndex, child.rawNode.importance ?? 0)
    const childImportance = child.rawNode.importance ?? 0
    const childLabel = child.rawNode.label || ''
    return {
      nodeSize: childNodeSize,
      footprint: calculateVisualFootprint(childNodeSize, childLabel, childImportance, childRingIndex)
    }
  })

  // Calculate total angular extent needed: sum of visual footprints + spacing
  // Uses visual footprint (node + text) for angular width calculation
  let totalChildRequirement = 0
  for (let i = 0; i < node.children.length; i++) {
    const { nodeSize, footprint } = childFootprints[i]
    // Angular width based on visual footprint (includes text)
    const footprintAngular = childRingRadius > 0 ? footprint / childRingRadius : 0
    totalChildRequirement += footprintAngular

    if (i < node.children.length - 1) {
      // Spacing between this child and next (based on node size, not text)
      const nextNodeSize = childFootprints[i + 1].nodeSize
      const spacing = getAdaptiveSpacing(nodeSize, nextNodeSize)
      totalChildRequirement += childRingRadius > 0 ? spacing / childRingRadius : 0
    }
  }

  // Still need to recurse to set children's own requirements
  for (const child of node.children) {
    calculateMinimumRequirements(
      child,
      childRingIndex,
      ringRadii,
      _nodePadding,
      verbose
    )
  }

  node.childrenAngularRequirement = totalChildRequirement

  // Node's requirement = MAX of own need OR children's total need
  // Children's need is the constraint that propagates upward
  node.minAngularExtent = Math.max(ownMinAngle, totalChildRequirement)

  // Track allocation
  spaceAllocations.set(node.id, {
    nodeId: node.id,
    nodeName: node.rawNode.label || node.id,
    ring: ringIndex,
    required: node.minAngularExtent,
    allocated: 0,
    compressionRatio: 0,
    ownRequirement: ownMinAngle,
    childrenRequirement: totalChildRequirement
  })

  if (verbose && node.children.length > 0) {
    debug.layout(
      `[PASS 1] ${node.id} (ring ${ringIndex}): ` +
      `requires ${toDeg(node.minAngularExtent)} ` +
      `(own: ${toDeg(ownMinAngle)}, children: ${toDeg(totalChildRequirement)})`
    )
  }

  return node.minAngularExtent
}

/**
 * PASS 2: Top-down positioning with knowledge of minimum requirements.
 * Now with explicit space tracking and compression logging.
 */
function positionNode(
  treeNode: TreeNode,
  startAngle: number,
  angularExtent: number,
  ringIndex: number,
  ringRadii: number[],
  nodePadding: number,
  nodeMap: Map<string, LayoutNode>,
  parentLayoutNode: LayoutNode | null,
  verbose: boolean = false
): LayoutNode {
  const radius = ringRadii[ringIndex] || 0
  const midAngle = startAngle + angularExtent / 2

  // Root node (ring 0, radius 0) stays at center
  const x = radius === 0 ? 0 : radius * Math.cos(midAngle)
  const y = radius === 0 ? 0 : radius * Math.sin(midAngle)

  const layoutNode: LayoutNode = {
    id: treeNode.id,
    rawNode: treeNode.rawNode,
    ring: ringIndex,
    angle: midAngle,
    x,
    y,
    children: [],
    parent: parentLayoutNode,
    subtreeLeafCount: treeNode.subtreeLeafCount,
    angularExtent,
    minAngularExtent: treeNode.minAngularExtent
  }

  nodeMap.set(treeNode.id, layoutNode)

  // Update allocation tracking
  const allocation = spaceAllocations.get(treeNode.id)
  if (allocation) {
    allocation.allocated = angularExtent
    allocation.compressionRatio = angularExtent / allocation.required

    // Log compression warnings
    if (allocation.compressionRatio < 0.95 && verbose) {
      debug.layoutWarn(
        `[COMPRESSION] ${treeNode.id} (${allocation.nodeName}): ` +
        `required ${toDeg(allocation.required)}, ` +
        `allocated ${toDeg(angularExtent)} ` +
        `(${(allocation.compressionRatio * 100).toFixed(1)}%)`
      )
    }
  }

  if (treeNode.children.length === 0) return layoutNode

  // Position children using their pre-calculated minimum requirements
  const childRingIndex = ringIndex + 1
  if (childRingIndex >= ringRadii.length) return layoutNode

  // Get children's minimum requirements (from Pass 1)
  const childMinimums = treeNode.children.map(c => c.minAngularExtent)
  const totalMinimum = childMinimums.reduce((a, b) => a + b, 0)
  const excessSpace = angularExtent - totalMinimum

  if (verbose && treeNode.children.length > 1) {
    debug.layout(
      `[PASS 2] Distributing space in ${treeNode.id}: ` +
      `parent has ${toDeg(angularExtent)}, ` +
      `children need ${toDeg(totalMinimum)}, ` +
      `excess: ${toDeg(excessSpace)}`
    )
  }

  // Allocate angular extents to children
  let childExtents: number[]

  if (totalMinimum <= angularExtent) {
    // CASE A: Excess space - distribute proportionally to requirement
    // Each child gets its minimum + proportional share of excess
    childExtents = childMinimums.map(min => {
      const proportion = min / totalMinimum
      const extraShare = proportion * excessSpace
      return min + extraShare
    })
  } else {
    // CASE B: Overcrowded - compress proportionally
    const compressionRatio = angularExtent / totalMinimum
    childExtents = childMinimums.map(min => min * compressionRatio)

    debug.layoutWarn(
      `[OVERCROWDING] ${treeNode.id} (ring ${ringIndex}): ` +
      `${treeNode.children.length} children need ${toDeg(totalMinimum)} ` +
      `but only have ${toDeg(angularExtent)} ` +
      `(compression: ${(compressionRatio * 100).toFixed(1)}%)`
    )
  }

  // Center children around parent's midpoint
  const totalChildExtent = childExtents.reduce((a, b) => a + b, 0)
  let currentAngle = midAngle - totalChildExtent / 2

  // Recursively position each child
  for (let i = 0; i < treeNode.children.length; i++) {
    const child = treeNode.children[i]
    const childExtent = childExtents[i]

    const childLayoutNode = positionNode(
      child,
      currentAngle,
      childExtent,
      childRingIndex,
      ringRadii,
      nodePadding,
      nodeMap,
      layoutNode,
      verbose
    )

    layoutNode.children.push(childLayoutNode)
    currentAngle += childExtent
  }

  return layoutNode
}

/**
 * PASS 2 with sector awareness: Position nodes using target angles for outcomes.
 *
 * For Ring 1 outcomes: Uses pre-assigned target angles from sector assignment
 * For other nodes: Standard proportional space allocation
 */
function positionNodeWithSectorAwareness(
  treeNode: TreeNode,
  startAngle: number,
  angularExtent: number,
  ringIndex: number,
  ringRadii: number[],
  nodePadding: number,
  nodeMap: Map<string, LayoutNode>,
  parentLayoutNode: LayoutNode | null,
  outcomeTargetAngles: Map<string, number>,
  outcomeExtents: Map<string, number>,  // Computed extents with natural spacing
  verbose: boolean = false
): LayoutNode {
  const radius = ringRadii[ringIndex] || 0
  const midAngle = startAngle + angularExtent / 2

  // Root node (ring 0, radius 0) stays at center
  const x = radius === 0 ? 0 : radius * Math.cos(midAngle)
  const y = radius === 0 ? 0 : radius * Math.sin(midAngle)

  const layoutNode: LayoutNode = {
    id: treeNode.id,
    rawNode: treeNode.rawNode,
    ring: ringIndex,
    angle: midAngle,
    x,
    y,
    children: [],
    parent: parentLayoutNode,
    subtreeLeafCount: treeNode.subtreeLeafCount,
    angularExtent,
    minAngularExtent: treeNode.minAngularExtent
  }

  nodeMap.set(treeNode.id, layoutNode)

  // Update allocation tracking
  const allocation = spaceAllocations.get(treeNode.id)
  if (allocation) {
    allocation.allocated = angularExtent
    allocation.compressionRatio = angularExtent / allocation.required
  }

  if (treeNode.children.length === 0) return layoutNode

  // Position children
  const childRingIndex = ringIndex + 1
  if (childRingIndex >= ringRadii.length) return layoutNode

  // SPECIAL CASE: Ring 0 (root) positioning Ring 1 (outcomes) with sector assignment
  if (ringIndex === 0 && outcomeTargetAngles.size > 0) {
    // Use target angles for outcomes
    for (const child of treeNode.children) {
      const targetAngle = outcomeTargetAngles.get(child.id)
      const childExtent = outcomeExtents.get(child.id) ?? child.minAngularExtent

      if (targetAngle !== undefined) {
        // Position outcome at its assigned target angle
        const childRadius = ringRadii[childRingIndex] || 0
        const childX = childRadius * Math.cos(targetAngle)
        const childY = childRadius * Math.sin(targetAngle)

        const childLayoutNode: LayoutNode = {
          id: child.id,
          rawNode: child.rawNode,
          ring: childRingIndex,
          angle: targetAngle,
          x: childX,
          y: childY,
          children: [],
          parent: layoutNode,
          subtreeLeafCount: child.subtreeLeafCount,
          angularExtent: childExtent,
          minAngularExtent: child.minAngularExtent
        }

        nodeMap.set(child.id, childLayoutNode)

        // Update allocation tracking for outcome
        const childAllocation = spaceAllocations.get(child.id)
        if (childAllocation) {
          childAllocation.allocated = childExtent
          childAllocation.compressionRatio = childExtent / childAllocation.required
        }

        // Recursively position outcome's children using standard algorithm
        if (child.children.length > 0) {
          const grandchildRingIndex = childRingIndex + 1
          if (grandchildRingIndex < ringRadii.length) {
            // Use UNIFIED compactness for Ring 2 spread
            // This matches Ring 1 positioning so inter-branch spacing equals intra-branch spacing
            const ring2Compactness = grandchildRingIndex === 2
              ? getUnifiedCompactness(expandedOutcomeCount)
              : 1.0

            positionChildrenStandard(
              child,
              childLayoutNode,
              targetAngle,
              childExtent,
              grandchildRingIndex,
              ringRadii,
              nodePadding,
              nodeMap,
              verbose,
              ring2Compactness
            )
          }
        }

        layoutNode.children.push(childLayoutNode)

        if (verbose) {
          debug.sector(
            `[SECTOR] Positioned outcome ${child.id} at ${toDeg(targetAngle)} ` +
            `with extent ${toDeg(childExtent)}`
          )
        }
      }
    }

    return layoutNode
  }

  // STANDARD CASE: Normal proportional distribution for non-root nodes
  const childMinimums = treeNode.children.map(c => c.minAngularExtent)
  const totalMinimum = childMinimums.reduce((a, b) => a + b, 0)
  const excessSpace = angularExtent - totalMinimum

  let childExtents: number[]

  if (totalMinimum <= angularExtent) {
    childExtents = childMinimums.map(min => {
      const proportion = totalMinimum > 0 ? min / totalMinimum : 1 / childMinimums.length
      const extraShare = proportion * excessSpace
      return min + extraShare
    })
  } else {
    const compressionRatio = angularExtent / totalMinimum
    childExtents = childMinimums.map(min => min * compressionRatio)
  }

  const totalChildExtent = childExtents.reduce((a, b) => a + b, 0)
  let currentAngle = midAngle - totalChildExtent / 2

  for (let i = 0; i < treeNode.children.length; i++) {
    const child = treeNode.children[i]
    const childExtent = childExtents[i]

    const childLayoutNode = positionNodeWithSectorAwareness(
      child,
      currentAngle,
      childExtent,
      childRingIndex,
      ringRadii,
      nodePadding,
      nodeMap,
      layoutNode,
      outcomeTargetAngles,
      outcomeExtents,
      verbose
    )

    layoutNode.children.push(childLayoutNode)
    currentAngle += childExtent
  }

  return layoutNode
}

/**
 * Helper: Position children using standard proportional algorithm.
 * Used after sector-assigned outcomes to position their descendants.
 *
 * compactness: 0-1 value that reduces spread (1 = full spread, 0.5 = half spread)
 * Used for Ring 2 when few outcomes are expanded, to keep nodes bundled.
 */
function positionChildrenStandard(
  parentTreeNode: TreeNode,
  parentLayoutNode: LayoutNode,
  parentAngle: number,
  parentExtent: number,
  childRingIndex: number,
  ringRadii: number[],
  nodePadding: number,
  nodeMap: Map<string, LayoutNode>,
  verbose: boolean,
  compactness: number = 1.0  // 1.0 = full spread, 0.5 = half spread
): void {
  const childMinimums = parentTreeNode.children.map(c => c.minAngularExtent)
  const totalMinimum = childMinimums.reduce((a, b) => a + b, 0)

  // Apply compactness to get the effective extent for positioning
  // IMPORTANT: Never exceed parentExtent to prevent spillover into adjacent domains
  const compactedExtent = parentExtent * compactness
  const effectiveExtent = Math.min(Math.max(totalMinimum, compactedExtent), parentExtent)

  let childExtents: number[]

  if (totalMinimum <= effectiveExtent) {
    // Enough space - distribute proportionally with excess
    const excessSpace = effectiveExtent - totalMinimum
    childExtents = childMinimums.map(min => {
      const proportion = totalMinimum > 0 ? min / totalMinimum : 1 / childMinimums.length
      const extraShare = proportion * excessSpace
      return min + extraShare
    })
  } else {
    // Not enough space - compress to fit within parent's boundary
    const compressionRatio = effectiveExtent / totalMinimum
    childExtents = childMinimums.map(min => min * compressionRatio)
  }

  const totalChildExtent = childExtents.reduce((a, b) => a + b, 0)
  let currentAngle = parentAngle - totalChildExtent / 2

  for (let i = 0; i < parentTreeNode.children.length; i++) {
    const child = parentTreeNode.children[i]
    const childExtent = childExtents[i]

    const childLayoutNode = positionNode(
      child,
      currentAngle,
      childExtent,
      childRingIndex,
      ringRadii,
      nodePadding,
      nodeMap,
      parentLayoutNode,
      verbose
    )

    parentLayoutNode.children.push(childLayoutNode)
    currentAngle += childExtent
  }
}

/**
 * Compute ring configuration with node counts
 */
function computeRingConfigs(
  nodes: RawNodeV21[],
  config: LayoutConfig
): ComputedRingConfig[] {
  const nodeCountByLayer = new Map<number, number>()
  for (const node of nodes) {
    nodeCountByLayer.set(node.layer, (nodeCountByLayer.get(node.layer) || 0) + 1)
  }

  return config.rings.map((ringConfig, layer) => {
    const nodeCount = nodeCountByLayer.get(layer) || 0
    // Use global average node size for spacing calculations (from current config)
    const avgNodeSize = (currentSizeRange.minRadius + currentSizeRange.maxRadius) / 2
    const minSpacing = avgNodeSize * 2 + config.nodePadding
    const requiredCircumference = nodeCount * minSpacing
    const requiredRadius = requiredCircumference / (2 * Math.PI)

    return {
      radius: ringConfig.radius,
      nodeSize: ringConfig.nodeSize,
      label: ringConfig.label,
      nodeCount,
      requiredRadius
    }
  })
}

/**
 * Print space allocation summary for debugging
 */
function printAllocationSummary(): void {
  const allocations = Array.from(spaceAllocations.values())

  // Group by compression status
  const compressed = allocations.filter(a => a.compressionRatio < 0.95 && a.compressionRatio > 0)
  const adequate = allocations.filter(a => a.compressionRatio >= 0.95)

  debug.space('\n=== Space Allocation Summary ===')
  debug.space(`Total nodes: ${allocations.length}`)
  debug.space(`Adequate space: ${adequate.length} (${(adequate.length / allocations.length * 100).toFixed(1)}%)`)
  debug.space(`Compressed: ${compressed.length} (${(compressed.length / allocations.length * 100).toFixed(1)}%)`)

  if (compressed.length > 0) {
    debug.space('\nMost compressed nodes (top 20):')
    compressed
      .sort((a, b) => a.compressionRatio - b.compressionRatio)
      .slice(0, 20)
      .forEach(allocation => {
        debug.space(
          `  Ring ${allocation.ring}: ${allocation.nodeId} (${allocation.nodeName.substring(0, 30)}): ` +
          `${(allocation.compressionRatio * 100).toFixed(1)}% ` +
          `(needed ${toDeg(allocation.required)}, got ${toDeg(allocation.allocated)})`
        )
      })

    // Group compressions by ring
    debug.space('\nCompressions by ring:')
    const byRing = new Map<number, number>()
    compressed.forEach(a => {
      byRing.set(a.ring, (byRing.get(a.ring) || 0) + 1)
    })
    Array.from(byRing.entries())
      .sort((a, b) => a[0] - b[0])
      .forEach(([ring, count]) => {
        debug.space(`  Ring ${ring}: ${count} compressed nodes`)
      })
  }
}

/**
 * Main layout function - Two-pass hybrid algorithm with explicit space tracking
 *
 * Pass 1 (Bottom-up): Calculate minimum angular requirements from leaves upward
 * Pass 2 (Top-down): Allocate space from root downward, tracking compression
 *
 * Smart Lateral-First Sector Filling:
 * When expandedNodeIds is provided, expanded Ring 1 outcomes are positioned
 * in lateral bands (right, left) for readable text labels, with collapsed
 * outcomes filling the remaining space.
 */
export function computeRadialLayout(
  nodes: RawNodeV21[],
  config: LayoutConfig,
  expandedNodeIds: Set<string> = new Set(),  // NEW: Track which nodes are expanded
  verbose: boolean = true
): LayoutResult {
  // Initialize viewport-aware parameters
  setLayoutParams(config)

  // Clear previous allocations
  spaceAllocations.clear()

  // Count expanded outcomes (Ring 1 nodes) for Ring 2 compactness
  const outcomeNodeIds = nodes.filter(n => n.layer === 1).map(n => String(n.id))
  expandedOutcomeCount = outcomeNodeIds.filter(id => expandedNodeIds.has(id)).length

  const computedRings = computeRingConfigs(nodes, config)
  const ringRadii = computedRings.map(r => r.radius)

  // Build tree structure
  const treeNodeMap = new Map<string, TreeNode>()

  for (const node of nodes) {
    treeNodeMap.set(String(node.id), {
      id: String(node.id),
      rawNode: node,
      children: [],
      parent: null,
      subtreeLeafCount: 0,
      minAngularExtent: 0,
      ownAngularRequirement: 0,
      childrenAngularRequirement: 0
    })
  }

  // Build parent-child relationships
  const roots: TreeNode[] = []
  for (const node of nodes) {
    const treeNode = treeNodeMap.get(String(node.id))!
    if (node.parent !== undefined) {
      const parentNode = treeNodeMap.get(String(node.parent))
      if (parentNode) {
        parentNode.children.push(treeNode)
        treeNode.parent = parentNode
      }
    } else {
      roots.push(treeNode)
    }
  }

  // Compute subtree leaf counts
  for (const root of roots) {
    computeSubtreeLeafCount(root)
  }

  // PASS 1: Bottom-up calculation of minimum requirements
  if (verbose) debug.layout('\n=== PASS 1: Calculating minimum angular requirements ===')
  for (const root of roots) {
    calculateMinimumRequirements(root, 0, ringRadii, config.nodePadding, verbose)
  }

  // Log total requirement vs available
  const totalRootRequirement = roots.reduce((sum, r) => sum + r.minAngularExtent, 0)
  if (verbose) {
    debug.layout(
      `\nTotal minimum requirement: ${toDeg(totalRootRequirement)} ` +
      `(available: ${toDeg(config.totalAngle)})`
    )
    if (totalRootRequirement > config.totalAngle) {
      debug.layoutWarn(
        `[WARNING] Total requirement exceeds available space by ${toDeg(totalRootRequirement - config.totalAngle)}!`
      )
    }
  }

  // ========================================================================
  // SMART SECTOR FILLING - GROW FROM RIGHT
  // All outcomes positioned starting from right (0°), spreading around circle
  // Natural spacing when sparse, compressed when dense
  // ========================================================================

  // Extract Ring 1 outcomes (children of root)
  const outcomeNodes: TreeNode[] = []
  for (const root of roots) {
    for (const child of root.children) {
      if (child.rawNode.layer === 1) {
        outcomeNodes.push(child)
      }
    }
  }

  // Extract angular requirements from Pass 1 results
  const outcomeRequirements = new Map<string, number>()
  for (const outcome of outcomeNodes) {
    outcomeRequirements.set(outcome.id, outcome.minAngularExtent)
  }

  // Assign target angles and extents for ALL outcomes (grow from right)
  const { angles: outcomeTargetAngles, extents: outcomeTargetExtents } = assignOutcomeAngles(
    outcomeNodes.map(n => n.id),
    outcomeRequirements,
    expandedNodeIds
  )

  // ========================================================================
  // PASS 2: Top-down positioning (with sector-aware outcome placement)
  // ========================================================================

  if (verbose) debug.layout('\n=== PASS 2: Allocating space (top-down) ===')
  const layoutNodeMap = new Map<string, LayoutNode>()
  const layoutNodes: LayoutNode[] = []

  const collectNodes = (node: LayoutNode) => {
    layoutNodes.push(node)
    for (const child of node.children) {
      collectNodes(child)
    }
  }

  if (roots.length === 1) {
    const root = roots[0]
    const rootLayoutNode = positionNodeWithSectorAwareness(
      root,
      config.startAngle,
      config.totalAngle,
      0,
      ringRadii,
      config.nodePadding,
      layoutNodeMap,
      null,
      outcomeTargetAngles,
      outcomeTargetExtents,  // Use computed extents (includes natural spacing)
      verbose
    )
    collectNodes(rootLayoutNode)
  } else {
    // Multiple roots: distribute based on their minimum requirements
    const totalRequirement = roots.reduce((sum, r) => sum + r.minAngularExtent, 0)
    let currentAngle = config.startAngle

    for (const root of roots) {
      // Allocate proportional to requirement (not just leaf count)
      const proportion = root.minAngularExtent / totalRequirement
      const extent = config.totalAngle * proportion

      const rootLayoutNode = positionNodeWithSectorAwareness(
        root,
        currentAngle,
        extent,
        0,
        ringRadii,
        config.nodePadding,
        layoutNodeMap,
        null,
        outcomeTargetAngles,
        outcomeTargetExtents,  // Use computed extents (includes natural spacing)
        verbose
      )
      collectNodes(rootLayoutNode)

      currentAngle += extent
    }
  }

  // Print allocation summary
  if (verbose) {
    printAllocationSummary()
  }

  return {
    nodes: layoutNodes,
    nodeMap: layoutNodeMap,
    computedRings
  }
}

/**
 * Optional post-processing: Resolve any remaining overlaps
 *
 * This checks ALL pairs within an angular window (not just adjacent pairs)
 * to catch overlaps between siblings or nearby nodes of different sizes.
 */
export function resolveOverlaps(
  layoutNodes: LayoutNode[],
  computedRings: ComputedRingConfig[],
  _nodePadding: number,  // Unused - now using adaptive spacing
  maxIterations: number = 50
): void {
  const nodesByRing = new Map<number, LayoutNode[]>()
  for (const node of layoutNodes) {
    if (!nodesByRing.has(node.ring)) {
      nodesByRing.set(node.ring, [])
    }
    nodesByRing.get(node.ring)!.push(node)
  }

  for (const [ring, ringNodes] of nodesByRing) {
    if (ringNodes.length <= 1) continue

    const ringConfig = computedRings[ring]
    if (!ringConfig || ringConfig.radius === 0) continue

    const radius = ringConfig.radius

    // Angular window for checking nearby nodes (must match detectOverlaps)
    const maxAngularWindow = (currentSizeRange.maxRadius * 4) / radius

    for (let iter = 0; iter < maxIterations; iter++) {
      let hadOverlap = false

      ringNodes.sort((a, b) => a.angle - b.angle)

      // Check all pairs within angular window (not just adjacent)
      for (let i = 0; i < ringNodes.length; i++) {
        const n1 = ringNodes[i]
        const size1 = getActualNodeSize(n1.ring, n1.rawNode.importance ?? 0)

        // Check forward within window
        for (let j = i + 1; j < ringNodes.length; j++) {
          const n2 = ringNodes[j]

          // Calculate angular difference
          let angleDiff = n2.angle - n1.angle
          if (angleDiff > Math.PI) angleDiff = 2 * Math.PI - angleDiff

          // Stop if past window (nodes are sorted)
          if (angleDiff > maxAngularWindow) break

          const size2 = getActualNodeSize(n2.ring, n2.rawNode.importance ?? 0)
          const spacing = getAdaptiveSpacing(size1, size2)
          const minDist = size1 + size2 + spacing

          const dx = n2.x - n1.x
          const dy = n2.y - n1.y
          const dist = Math.sqrt(dx * dx + dy * dy)

          if (dist < minDist && dist > 0) {
            hadOverlap = true

            const overlap = minDist - dist
            const pushAngle = overlap / (2 * radius)

            n1.angle -= pushAngle / 2
            n2.angle += pushAngle / 2

            n1.x = radius * Math.cos(n1.angle)
            n1.y = radius * Math.sin(n1.angle)
            n2.x = radius * Math.cos(n2.angle)
            n2.y = radius * Math.sin(n2.angle)
          }
        }

        // Check wrap-around for nodes near the start
        if (i < 10) {
          for (let j = ringNodes.length - 1; j >= ringNodes.length - 10 && j > i; j--) {
            const n2 = ringNodes[j]

            // Angular diff with wrap-around
            let angleDiff = (2 * Math.PI) - (n2.angle - n1.angle)
            if (angleDiff > Math.PI) angleDiff = 2 * Math.PI - angleDiff

            if (angleDiff > maxAngularWindow) continue

            const size2 = getActualNodeSize(n2.ring, n2.rawNode.importance ?? 0)
            const spacing = getAdaptiveSpacing(size1, size2)
            const minDist = size1 + size2 + spacing

            const dx = n2.x - n1.x
            const dy = n2.y - n1.y
            const dist = Math.sqrt(dx * dx + dy * dy)

            if (dist < minDist && dist > 0) {
              hadOverlap = true

              const overlap = minDist - dist
              const pushAngle = overlap / (2 * radius)

              n1.angle -= pushAngle / 2
              n2.angle += pushAngle / 2

              // Normalize angles to [0, 2*PI)
              while (n1.angle < 0) n1.angle += 2 * Math.PI
              while (n2.angle < 0) n2.angle += 2 * Math.PI
              while (n1.angle >= 2 * Math.PI) n1.angle -= 2 * Math.PI
              while (n2.angle >= 2 * Math.PI) n2.angle -= 2 * Math.PI

              n1.x = radius * Math.cos(n1.angle)
              n1.y = radius * Math.sin(n1.angle)
              n2.x = radius * Math.cos(n2.angle)
              n2.y = radius * Math.sin(n2.angle)
            }
          }
        }
      }

      if (!hadOverlap) break
    }
  }
}

/**
 * Overlap pair with detailed info
 */
export interface OverlapPair {
  node1: string
  node2: string
  ring: number
  distance: number
  minDistance: number
  overlapAmount: number
  angleDiff: number
}

/**
 * Detailed overlap report
 */
export interface OverlapReport {
  totalOverlaps: number
  overlapsByRing: Map<number, number>
  worstOverlaps: OverlapPair[]
  overlapPairs: OverlapPair[]
}

/**
 * Detect overlaps using Euclidean distance with detailed reporting.
 * Checks nearby pairs within an angular window to catch large nodes
 * that might overlap even if not angularly adjacent.
 */
export function detectOverlaps(
  layoutNodes: LayoutNode[],
  computedRings: ComputedRingConfig[],
  _nodePadding: number  // Unused - we only detect true overlaps, not padding violations
): OverlapPair[] {
  const overlaps: OverlapPair[] = []
  const OVERLAP_TOLERANCE = 0.5  // Allow 0.5px tolerance for sub-pixel precision

  const nodesByRing = new Map<number, LayoutNode[]>()
  for (const node of layoutNodes) {
    if (!nodesByRing.has(node.ring)) {
      nodesByRing.set(node.ring, [])
    }
    nodesByRing.get(node.ring)!.push(node)
  }

  for (const [ring, ringNodes] of nodesByRing) {
    if (ringNodes.length < 2) continue

    const ringConfig = computedRings[ring]
    if (!ringConfig || ringConfig.radius === 0) continue
    const ringRadius = ringConfig.radius

    // Sort by angle for efficient nearby checking
    ringNodes.sort((a, b) => a.angle - b.angle)

    // For each node, check nearby nodes within an angular window
    // Window size based on max possible node size at this ring
    const maxNodeRadius = currentSizeRange.maxRadius
    const maxAngularWindow = (maxNodeRadius * 4) / ringRadius // 4x max radius as safety margin

    for (let i = 0; i < ringNodes.length; i++) {
      const n1 = ringNodes[i]
      const size1 = getActualNodeSize(n1.ring, n1.rawNode.importance ?? 0)

      // Check nodes within the angular window (forward only to avoid duplicates)
      for (let j = i + 1; j < ringNodes.length; j++) {
        const n2 = ringNodes[j]

        // Calculate angular difference
        let angleDiff = n2.angle - n1.angle
        if (angleDiff > Math.PI) angleDiff = 2 * Math.PI - angleDiff

        // Stop if we're past the angular window (nodes are sorted)
        if (angleDiff > maxAngularWindow) break

        const size2 = getActualNodeSize(n2.ring, n2.rawNode.importance ?? 0)

        // Use Euclidean distance (what visually matters)
        const dx = n1.x - n2.x
        const dy = n1.y - n2.y
        const distance = Math.sqrt(dx * dx + dy * dy)

        // Minimum distance for circles to NOT overlap = sum of radii
        const minDistance = size1 + size2 - OVERLAP_TOLERANCE

        if (distance < minDistance) {
          overlaps.push({
            node1: n1.id,
            node2: n2.id,
            ring,
            distance,
            minDistance,
            overlapAmount: minDistance - distance,
            angleDiff: angleDiff * 180 / Math.PI
          })
        }
      }

      // Also check wrap-around (last few nodes might overlap with first few)
      if (i < 5) { // Check first 5 nodes against last nodes
        for (let j = ringNodes.length - 1; j >= ringNodes.length - 5 && j > i; j--) {
          const n2 = ringNodes[j]

          // Angular diff with wrap-around
          let angleDiff = (2 * Math.PI - n2.angle) + n1.angle
          if (angleDiff > Math.PI) angleDiff = 2 * Math.PI - angleDiff

          if (angleDiff > maxAngularWindow) continue

          const size2 = getActualNodeSize(n2.ring, n2.rawNode.importance ?? 0)

          const dx = n1.x - n2.x
          const dy = n1.y - n2.y
          const distance = Math.sqrt(dx * dx + dy * dy)
          const minDistance = size1 + size2 - OVERLAP_TOLERANCE

          if (distance < minDistance) {
            overlaps.push({
              node1: n1.id,
              node2: n2.id,
              ring,
              distance,
              minDistance,
              overlapAmount: minDistance - distance,
              angleDiff: angleDiff * 180 / Math.PI
            })
          }
        }
      }
    }
  }

  // Log overlap summary
  if (overlaps.length > 0) {
    debug.overlap('\n=== Overlap Detection Report ===')
    debug.overlap(`Total overlaps: ${overlaps.length}`)

    // Group by ring
    const byRing = new Map<number, number>()
    overlaps.forEach(o => {
      byRing.set(o.ring, (byRing.get(o.ring) || 0) + 1)
    })
    debug.overlap('By ring:')
    Array.from(byRing.entries())
      .sort((a, b) => a[0] - b[0])
      .forEach(([ring, count]) => {
        debug.overlap(`  Ring ${ring}: ${count} overlaps`)
      })

    debug.overlap('\nWorst overlaps (top 10):')
    overlaps
      .sort((a, b) => b.overlapAmount - a.overlapAmount)
      .slice(0, 10)
      .forEach(o => {
        debug.overlap(
          `  Ring ${o.ring}: ${o.node1} <-> ${o.node2}: ` +
          `overlap=${o.overlapAmount.toFixed(2)}px, ` +
          `distance=${o.distance.toFixed(2)}px, ` +
          `needed=${o.minDistance.toFixed(2)}px, ` +
          `angleDiff=${o.angleDiff.toFixed(3)}°`
        )
      })
  }

  return overlaps
}

/**
 * Generate detailed overlap report
 */
export function generateOverlapReport(overlaps: OverlapPair[]): OverlapReport {
  const byRing = new Map<number, number>()
  overlaps.forEach(o => {
    byRing.set(o.ring, (byRing.get(o.ring) || 0) + 1)
  })

  return {
    totalOverlaps: overlaps.length,
    overlapsByRing: byRing,
    worstOverlaps: overlaps
      .sort((a, b) => b.overlapAmount - a.overlapAmount)
      .slice(0, 20),
    overlapPairs: overlaps
  }
}

/**
 * Compute layout statistics
 */
export function computeLayoutStats(
  layoutNodes: LayoutNode[],
  computedRings: ComputedRingConfig[],
  nodePadding: number
): {
  nodesPerRing: Map<number, number>
  minDistancePerRing: Map<number, number>
  requiredRadiusPerRing: Map<number, number>
} {
  const nodesPerRing = new Map<number, number>()
  const minDistancePerRing = new Map<number, number>()
  const requiredRadiusPerRing = new Map<number, number>()

  const nodesByRing = new Map<number, LayoutNode[]>()
  for (const node of layoutNodes) {
    if (!nodesByRing.has(node.ring)) {
      nodesByRing.set(node.ring, [])
    }
    nodesByRing.get(node.ring)!.push(node)
  }

  for (const [ring, ringNodes] of nodesByRing) {
    nodesPerRing.set(ring, ringNodes.length)

    let minDist = Infinity
    for (let i = 0; i < ringNodes.length; i++) {
      for (let j = i + 1; j < ringNodes.length; j++) {
        const dx = ringNodes[i].x - ringNodes[j].x
        const dy = ringNodes[i].y - ringNodes[j].y
        const dist = Math.sqrt(dx * dx + dy * dy)
        minDist = Math.min(minDist, dist)
      }
    }
    minDistancePerRing.set(ring, minDist === Infinity ? 0 : minDist)

    const ringConfig = computedRings[ring] || computedRings[computedRings.length - 1]
    const minNodeSpacing = ringConfig.nodeSize * 2 + nodePadding
    const circumference = ringNodes.length * minNodeSpacing
    const requiredRadius = circumference / (2 * Math.PI)
    requiredRadiusPerRing.set(ring, requiredRadius)
  }

  return { nodesPerRing, minDistancePerRing, requiredRadiusPerRing }
}

export { getActualNodeSize }
