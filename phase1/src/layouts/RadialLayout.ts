/**
 * RadialLayout - Overlap-free radial/hierarchical layout algorithm
 *
 * Computes node positions in concentric rings where:
 * - Each node is positioned based on its parent's angle
 * - Angular space is allocated proportionally to subtree size
 * - Ring radii are auto-computed to prevent overlap
 * - Minimum spacing prevents node overlap at each ring level
 */

import type { RawNodeV21 } from '../types'

export interface RingConfig {
  radius: number       // Base/minimum radius (will be auto-adjusted if needed)
  nodeSize: number
  label?: string
}

export interface LayoutConfig {
  rings: RingConfig[]
  nodePadding: number  // Base padding in pixels between node edges
  startAngle: number   // Starting angle in radians (default: -PI/2 for top)
  totalAngle: number   // Total angle to distribute nodes (default: 2*PI)
  minRingGap: number   // Minimum gap between consecutive rings (default: 50)
  scalePaddingWithNodeSize?: boolean  // If true, padding scales proportionally with node size (default: true)
}

/**
 * Reference node size used for padding scaling calculations.
 * Padding is defined relative to this size, then scaled for each ring.
 * Value of 6 is the median of typical ring node sizes (3, 5, 6, 8, 12, 15).
 */
const REFERENCE_NODE_SIZE = 6

/**
 * Calculates effective padding for a specific ring based on its node size.
 *
 * When scalePaddingWithNodeSize is enabled:
 * - Larger nodes get proportionally more padding
 * - Smaller nodes get proportionally less padding
 * - This maintains consistent visual spacing ratios across rings
 *
 * Formula: effectivePadding = basePadding * (nodeSize / REFERENCE_NODE_SIZE)
 *
 * Example with basePadding=7 and REFERENCE_NODE_SIZE=6:
 * - Ring 1 (nodeSize 12): 7 * (12/6) = 14px padding
 * - Ring 3 (nodeSize 6):  7 * (6/6)  = 7px padding
 * - Ring 5 (nodeSize 3):  7 * (3/6)  = 3.5px padding
 *
 * @param nodeSize - The node size for the ring
 * @param basePadding - The base padding value from config
 * @param scalePadding - Whether to apply scaling (default true)
 */
export function getEffectivePadding(
  nodeSize: number,
  basePadding: number,
  scalePadding: boolean = true
): number {
  if (!scalePadding) return basePadding
  return basePadding * (nodeSize / REFERENCE_NODE_SIZE)
}

/**
 * Computed ring configuration with auto-adjusted radius
 */
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
  angularExtent: number  // Angular space allocated to this subtree
}

export interface LayoutResult {
  nodes: LayoutNode[]
  nodeMap: Map<string, LayoutNode>
  computedRings: ComputedRingConfig[]
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
  nodeCountByLayer: Map<number, number>  // Count of nodes at each layer in this subtree
}

/**
 * Computes the minimum radius needed to fit N nodes without overlap
 * when nodes are evenly distributed around the circle.
 *
 * @param nodeCount - Number of nodes on the ring
 * @param nodeSize - Radius of each node
 * @param basePadding - Base padding value
 * @param scalePadding - Whether to scale padding with node size
 */
function computeRequiredRadiusForEvenDistribution(
  nodeCount: number,
  nodeSize: number,
  basePadding: number,
  scalePadding: boolean
): number {
  if (nodeCount <= 1) return 0
  const effectivePadding = getEffectivePadding(nodeSize, basePadding, scalePadding)
  const minArcDistance = nodeSize * 2 + effectivePadding
  const requiredCircumference = nodeCount * minArcDistance
  return requiredCircumference / (2 * Math.PI)
}

/**
 * Builds a tree structure and computes descendant counts per layer for each subtree
 */
interface SubtreeInfo {
  id: string
  layer: number
  descendantCountByLayer: Map<number, number>
  children: SubtreeInfo[]
}

function buildSubtreeInfo(
  nodes: RawNodeV21[],
  maxLayer: number
): SubtreeInfo[] {
  // Build maps
  const nodeById = new Map<string, RawNodeV21>()
  const childrenByParent = new Map<string, RawNodeV21[]>()

  for (const node of nodes) {
    nodeById.set(String(node.id), node)
    if (node.parent !== undefined) {
      const parentKey = String(node.parent)
      if (!childrenByParent.has(parentKey)) childrenByParent.set(parentKey, [])
      childrenByParent.get(parentKey)!.push(node)
    }
  }

  // Recursively build subtree info
  function buildInfo(nodeId: string): SubtreeInfo {
    const node = nodeById.get(nodeId)!
    const children = childrenByParent.get(nodeId) || []
    const childInfos = children.map(c => buildInfo(String(c.id)))

    // Count descendants at each layer
    const descendantCountByLayer = new Map<number, number>()
    for (let layer = 0; layer <= maxLayer; layer++) {
      descendantCountByLayer.set(layer, 0)
    }

    // Add this node
    descendantCountByLayer.set(node.layer, 1)

    // Add children's counts
    for (const childInfo of childInfos) {
      for (const [layer, count] of childInfo.descendantCountByLayer) {
        descendantCountByLayer.set(layer, (descendantCountByLayer.get(layer) || 0) + count)
      }
    }

    return {
      id: nodeId,
      layer: node.layer,
      descendantCountByLayer,
      children: childInfos
    }
  }

  // Find roots and build info for each
  const roots = nodes.filter(n => n.parent === undefined)
  return roots.map(r => buildInfo(String(r.id)))
}

/**
 * Computes optimal ring radii accounting for hierarchical clustering.
 * The key insight: nodes aren't evenly distributed - they cluster under ancestors.
 * Each subtree needs contiguous angular space, and the constraining layer may differ per subtree.
 * We compute radii such that the sum of MAX(angular extent per layer) for all subtrees = 2π.
 */
function computeOptimalRingRadii(
  nodes: RawNodeV21[],
  config: LayoutConfig
): ComputedRingConfig[] {
  const maxLayer = Math.max(...nodes.map(n => n.layer))
  const scalePadding = config.scalePaddingWithNodeSize !== false // default true

  // Count nodes per layer
  const nodeCountByLayer = new Map<number, number>()
  for (const node of nodes) {
    nodeCountByLayer.set(node.layer, (nodeCountByLayer.get(node.layer) || 0) + 1)
  }

  // Build subtree info to understand hierarchical structure
  const subtreeInfos = buildSubtreeInfo(nodes, maxLayer)

  // Get the first-level subtrees (children of root, usually outcomes at layer 1)
  let firstLevelSubtrees: SubtreeInfo[] = []
  if (subtreeInfos.length === 1 && subtreeInfos[0].children.length > 0) {
    firstLevelSubtrees = subtreeInfos[0].children
  } else {
    firstLevelSubtrees = subtreeInfos
  }

  // First pass: compute base radii (simple even distribution)
  const baseRings: ComputedRingConfig[] = []
  let currentRadius = 0

  for (let layer = 0; layer < config.rings.length; layer++) {
    const ringConfig = config.rings[layer]
    const nodeCount = nodeCountByLayer.get(layer) || 0
    const requiredRadius = computeRequiredRadiusForEvenDistribution(
      nodeCount, ringConfig.nodeSize, config.nodePadding, scalePadding
    )

    let radius = Math.max(requiredRadius, ringConfig.radius, layer === 0 ? 0 : currentRadius + config.minRingGap)
    if (layer === 0 && nodeCount <= 1) radius = 0

    baseRings.push({
      radius,
      nodeSize: ringConfig.nodeSize,
      label: ringConfig.label,
      nodeCount,
      requiredRadius
    })
    currentRadius = radius
  }

  // Second pass: compute overcommitment factor
  // For each first-level subtree, find the MAX angular extent across all layers
  // Then sum these to get total required angular space
  let totalRequiredExtent = 0

  for (const subtree of firstLevelSubtrees) {
    let maxExtent = 0
    for (let layer = 0; layer <= maxLayer && layer < baseRings.length; layer++) {
      const count = subtree.descendantCountByLayer.get(layer) || 0
      const ring = baseRings[layer]
      if (ring.radius > 0 && count > 0) {
        const effectivePadding = getEffectivePadding(ring.nodeSize, config.nodePadding, scalePadding)
        const minSpacing = ring.nodeSize * 2 + effectivePadding
        const extent = (count * minSpacing) / ring.radius
        maxExtent = Math.max(maxExtent, extent)
      }
    }
    totalRequiredExtent += maxExtent
  }

  // Compute scale factor needed to fit everything in 2π
  const overcommitmentFactor = totalRequiredExtent / (2 * Math.PI)
  const scaleFactor = Math.max(1, overcommitmentFactor)

  // Third pass: scale radii by overcommitment factor and maintain gaps
  const computedRings: ComputedRingConfig[] = []
  currentRadius = 0

  for (let layer = 0; layer < baseRings.length; layer++) {
    const base = baseRings[layer]
    let radius = base.radius * scaleFactor

    // Ensure minimum gap from previous ring
    if (layer > 0) {
      radius = Math.max(radius, currentRadius + config.minRingGap)
    }

    // Keep root at center
    if (layer === 0 && base.nodeCount <= 1) {
      radius = 0
    }

    computedRings.push({
      radius,
      nodeSize: base.nodeSize,
      label: base.label,
      nodeCount: base.nodeCount,
      requiredRadius: base.requiredRadius * scaleFactor
    })
    currentRadius = radius
  }

  return computedRings
}

/**
 * Computes the minimum angular extent needed for N nodes at a given ring
 *
 * @param nodeCount Number of nodes at this ring level
 * @param ringConfig Configuration for the target ring
 * @param basePadding Base padding value
 * @param scalePadding Whether to scale padding with node size
 * @returns Minimum angular extent in radians
 */
function computeMinAngularExtent(
  nodeCount: number,
  ringConfig: ComputedRingConfig,
  basePadding: number,
  scalePadding: boolean
): number {
  if (nodeCount === 0 || ringConfig.radius === 0) return 0

  // Compute effective padding for this ring's node size
  const effectivePadding = getEffectivePadding(ringConfig.nodeSize, basePadding, scalePadding)

  // Minimum arc distance between adjacent node centers
  const minArcDistance = ringConfig.nodeSize * 2 + effectivePadding

  // Convert to angular distance: arc = radius * angle, so angle = arc / radius
  const minAngularSpacing = minArcDistance / ringConfig.radius

  // Total angular extent needed for all nodes with spacing
  return nodeCount * minAngularSpacing
}

/**
 * Recursively computes subtree statistics:
 * - subtreeLeafCount: total leaf nodes
 * - nodeCountByLayer: count of nodes at each layer level
 */
function computeSubtreeStats(node: TreeNode, maxLayer: number): number {
  // Initialize nodeCountByLayer
  node.nodeCountByLayer = new Map()
  for (let i = 0; i <= maxLayer; i++) {
    node.nodeCountByLayer.set(i, 0)
  }

  // Count this node at its layer
  node.nodeCountByLayer.set(node.rawNode.layer, 1)

  if (node.children.length === 0) {
    node.subtreeLeafCount = 1
    return 1
  }

  let leafTotal = 0
  for (const child of node.children) {
    leafTotal += computeSubtreeStats(child, maxLayer)

    // Aggregate child's layer counts into this node's counts
    for (const [layer, count] of child.nodeCountByLayer) {
      node.nodeCountByLayer.set(layer, (node.nodeCountByLayer.get(layer) || 0) + count)
    }
  }
  node.subtreeLeafCount = leafTotal
  return leafTotal
}

/**
 * Computes the minimum angular extent needed for a subtree,
 * considering all descendant rings (uses the most constrained ring).
 * Now uses actual node count per layer instead of leaf count.
 */
function computeRequiredAngularExtent(
  node: TreeNode,
  computedRings: ComputedRingConfig[],
  basePadding: number,
  scalePadding: boolean
): number {
  let maxExtent = 0

  // Check each ring and use actual node count at that ring
  for (const [layer, count] of node.nodeCountByLayer) {
    if (layer < computedRings.length && count > 0) {
      const ringConfig = computedRings[layer]
      const extent = computeMinAngularExtent(count, ringConfig, basePadding, scalePadding)
      maxExtent = Math.max(maxExtent, extent)
    }
  }

  return maxExtent
}

/**
 * Recursively positions nodes, allocating angular space based on required extent
 * (not proportional to leaf count, but based on actual space needed at each ring)
 */
function positionSubtree(
  node: TreeNode,
  startAngle: number,
  angularExtent: number,
  computedRings: ComputedRingConfig[],
  basePadding: number,
  scalePadding: boolean,
  nodeMap: Map<string, LayoutNode>,
  parentLayoutNode: LayoutNode | null
): LayoutNode {
  const ring = node.rawNode.layer
  const ringConfig = computedRings[ring] || computedRings[computedRings.length - 1]

  // Position this node at the center of its angular extent
  const centerAngle = startAngle + angularExtent / 2

  const layoutNode: LayoutNode = {
    id: node.id,
    rawNode: node.rawNode,
    ring,
    angle: centerAngle,
    x: ringConfig.radius * Math.cos(centerAngle),
    y: ringConfig.radius * Math.sin(centerAngle),
    children: [],
    parent: parentLayoutNode,
    subtreeLeafCount: node.subtreeLeafCount,
    angularExtent
  }

  nodeMap.set(node.id, layoutNode)

  // Position children
  if (node.children.length > 0) {
    // Calculate required extent for each child (based on actual node counts per layer)
    const childExtents: number[] = []
    let totalRequiredExtent = 0

    for (const child of node.children) {
      const required = computeRequiredAngularExtent(child, computedRings, basePadding, scalePadding)
      childExtents.push(required)
      totalRequiredExtent += required
    }

    // Scale extents if total exceeds available (shouldn't happen with correct radii)
    // or if total is less than available (spread out)
    const scaleFactor = angularExtent / Math.max(totalRequiredExtent, 0.0001)

    // Distribute angular space among children based on their required extents
    let childStartAngle = startAngle

    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i]
      // Use required extent scaled to fit available space
      const childAngularExtent = childExtents[i] * scaleFactor

      const childLayoutNode = positionSubtree(
        child,
        childStartAngle,
        childAngularExtent,
        computedRings,
        basePadding,
        scalePadding,
        nodeMap,
        layoutNode
      )

      layoutNode.children.push(childLayoutNode)
      childStartAngle += childAngularExtent
    }
  }

  return layoutNode
}

/**
 * Main layout function - computes positions for all nodes
 *
 * @param nodes Raw node data from graph
 * @param config Layout configuration (rings, padding, etc.)
 * @returns Layout result with positioned nodes and computed ring radii
 */
export function computeRadialLayout(
  nodes: RawNodeV21[],
  config: LayoutConfig
): LayoutResult {
  // Compute optimal ring radii based on node counts
  const computedRings = computeOptimalRingRadii(nodes, config)
  const maxLayer = Math.max(...nodes.map(n => n.layer))
  const scalePadding = config.scalePaddingWithNodeSize !== false // default true

  // Build tree structure
  const treeNodeMap = new Map<string, TreeNode>()

  // Create tree nodes
  for (const node of nodes) {
    treeNodeMap.set(String(node.id), {
      id: String(node.id),
      rawNode: node,
      children: [],
      parent: null,
      subtreeLeafCount: 0,
      nodeCountByLayer: new Map()
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

  // Compute subtree statistics (leaf counts and node counts per layer)
  for (const root of roots) {
    computeSubtreeStats(root, maxLayer)
  }

  // Position nodes
  const layoutNodeMap = new Map<string, LayoutNode>()
  const layoutNodes: LayoutNode[] = []

  // Helper to collect all nodes into flat array
  const collectNodes = (node: LayoutNode) => {
    layoutNodes.push(node)
    for (const child of node.children) {
      collectNodes(child)
    }
  }

  if (roots.length === 1) {
    // Single root - standard radial layout
    const root = roots[0]
    const rootLayoutNode = positionSubtree(
      root,
      config.startAngle,
      config.totalAngle,
      computedRings,
      config.nodePadding,
      scalePadding,
      layoutNodeMap,
      null
    )
    collectNodes(rootLayoutNode)
  } else {
    // Multiple roots - distribute evenly
    const totalWeight = roots.reduce((sum, r) => sum + r.subtreeLeafCount, 0)
    let currentAngle = config.startAngle

    for (const root of roots) {
      const weight = root.subtreeLeafCount / totalWeight
      const extent = config.totalAngle * weight

      const rootLayoutNode = positionSubtree(
        root,
        currentAngle,
        extent,
        computedRings,
        config.nodePadding,
        scalePadding,
        layoutNodeMap,
        null
      )
      collectNodes(rootLayoutNode)

      currentAngle += extent
    }
  }

  return {
    nodes: layoutNodes,
    nodeMap: layoutNodeMap,
    computedRings
  }
}

/**
 * Validates that no nodes visually overlap within each ring.
 *
 * IMPORTANT: This checks for actual visual overlap (circles touching/intersecting),
 * NOT whether nodes have the desired padding between them. The padding parameter
 * is used by the layout algorithm to create spacing, but "overlap" means the
 * node circles actually intersect.
 *
 * A small tolerance (0.5px) is applied to account for floating point precision
 * and the difference between arc-based layout calculations and Euclidean detection.
 *
 * @returns Array of overlapping node pairs if any found
 */
export function detectOverlaps(
  layoutNodes: LayoutNode[],
  computedRings: ComputedRingConfig[],
  _nodePadding: number // Kept for API compatibility but not used in overlap detection
): Array<{ node1: string; node2: string; ring: number; distance: number; minDistance: number }> {
  const overlaps: Array<{ node1: string; node2: string; ring: number; distance: number; minDistance: number }> = []

  // Small tolerance to account for floating point precision and arc vs chord differences
  const OVERLAP_TOLERANCE = 0.5

  // Group nodes by ring
  const nodesByRing = new Map<number, LayoutNode[]>()
  for (const node of layoutNodes) {
    if (!nodesByRing.has(node.ring)) {
      nodesByRing.set(node.ring, [])
    }
    nodesByRing.get(node.ring)!.push(node)
  }

  // Check each ring for actual visual overlaps
  for (const [ring, ringNodes] of nodesByRing) {
    const ringConfig = computedRings[ring] || computedRings[computedRings.length - 1]
    // Actual overlap = circles touch when distance < sum of radii
    // Apply tolerance to avoid false positives from floating point errors
    const minDistance = ringConfig.nodeSize * 2 - OVERLAP_TOLERANCE

    for (let i = 0; i < ringNodes.length; i++) {
      for (let j = i + 1; j < ringNodes.length; j++) {
        const n1 = ringNodes[i]
        const n2 = ringNodes[j]

        // Compute Euclidean distance
        const dx = n1.x - n2.x
        const dy = n1.y - n2.y
        const distance = Math.sqrt(dx * dx + dy * dy)

        if (distance < minDistance) {
          overlaps.push({
            node1: n1.id,
            node2: n2.id,
            ring,
            distance,
            minDistance
          })
        }
      }
    }
  }

  return overlaps
}

/**
 * Computes statistics about the layout
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

  // Group nodes by ring
  const nodesByRing = new Map<number, LayoutNode[]>()
  for (const node of layoutNodes) {
    if (!nodesByRing.has(node.ring)) {
      nodesByRing.set(node.ring, [])
    }
    nodesByRing.get(node.ring)!.push(node)
  }

  for (const [ring, ringNodes] of nodesByRing) {
    nodesPerRing.set(ring, ringNodes.length)

    // Find minimum distance between any two nodes in this ring
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

    // Compute minimum radius needed to fit all nodes without overlap
    const ringConfig = computedRings[ring] || computedRings[computedRings.length - 1]
    const minNodeSpacing = ringConfig.nodeSize * 2 + nodePadding
    const circumference = ringNodes.length * minNodeSpacing
    const requiredRadius = circumference / (2 * Math.PI)
    requiredRadiusPerRing.set(ring, requiredRadius)
  }

  return { nodesPerRing, minDistancePerRing, requiredRadiusPerRing }
}
