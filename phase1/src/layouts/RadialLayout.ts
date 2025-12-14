/**
 * RadialLayout - Hybrid Bottom-Up + Top-Down Angular Positioning
 *
 * Two-pass algorithm:
 * 1. Bottom-up: Calculate minimum angular requirements from leaves upward
 * 2. Top-down: Allocate space from root downward, respecting minimums
 *
 * This ensures parents get enough angular space for ALL their descendants,
 * not just their own node size.
 */

import type { RawNodeV21 } from '../types'

export interface RingConfig {
  radius: number
  nodeSize: number
  label?: string
}

export interface LayoutConfig {
  rings: RingConfig[]
  nodePadding: number
  startAngle: number
  totalAngle: number
  minRingGap: number
  useFixedRadii?: boolean
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
 * Per-ring size ranges for importance-based node sizing.
 */
const SIZE_RANGES: Record<number, { min: number; max: number }> = {
  0: { min: 12, max: 12 },
  1: { min: 4, max: 20 },
  2: { min: 3, max: 16 },
  3: { min: 2, max: 12 },
  4: { min: 1.5, max: 8 },
  5: { min: 1, max: 6 },
}

/**
 * Computes actual node size based on importance.
 */
function getActualNodeSize(ring: number, importance: number): number {
  const range = SIZE_RANGES[ring] || { min: 2, max: 8 }
  return range.min + (range.max - range.min) * Math.sqrt(importance)
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
  minAngularExtent: number  // Calculated in bottom-up pass
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
  nodePadding: number
): number {
  const radius = ringRadii[ringIndex] || ringRadii[ringRadii.length - 1]

  // Calculate own size requirement at this ring
  const nodeSize = getActualNodeSize(ringIndex, node.rawNode.importance ?? 0)
  const ownArcLength = nodeSize * 2 + nodePadding
  const ownMinAngle = radius > 0 ? ownArcLength / radius : Math.PI * 2

  if (node.children.length === 0) {
    // Leaf node: just needs space for itself
    node.minAngularExtent = ownMinAngle
    return ownMinAngle
  }

  // Parent node: recursively calculate children's requirements
  const childRingIndex = ringIndex + 1
  let totalChildRequirement = 0

  for (const child of node.children) {
    totalChildRequirement += calculateMinimumRequirements(
      child,
      childRingIndex,
      ringRadii,
      nodePadding
    )
  }

  // Node's requirement = MAX of own need OR children's total need
  // Children's need is the constraint that propagates upward
  node.minAngularExtent = Math.max(ownMinAngle, totalChildRequirement)

  return node.minAngularExtent
}

/**
 * PASS 2: Top-down positioning with knowledge of minimum requirements.
 */
function positionNode(
  treeNode: TreeNode,
  startAngle: number,
  angularExtent: number,
  ringIndex: number,
  ringRadii: number[],
  nodePadding: number,
  nodeMap: Map<string, LayoutNode>,
  parentLayoutNode: LayoutNode | null
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

  if (treeNode.children.length === 0) return layoutNode

  // Position children using their pre-calculated minimum requirements
  const childRingIndex = ringIndex + 1
  if (childRingIndex >= ringRadii.length) return layoutNode

  // Get children's minimum requirements (from Pass 1)
  const childMinimums = treeNode.children.map(c => c.minAngularExtent)
  const totalMinimum = childMinimums.reduce((a, b) => a + b, 0)

  // Allocate angular extents to children
  let childExtents: number[]

  if (totalMinimum <= angularExtent) {
    // CASE A: Excess space - distribute EQUALLY among children
    // This ensures all nodes spread evenly when siblings are removed
    // Each child gets its minimum + equal share of excess
    const excessSpace = angularExtent - totalMinimum
    const perChildExcess = excessSpace / treeNode.children.length
    childExtents = childMinimums.map(min => min + perChildExcess)
  } else {
    // CASE B: Overcrowded - compress proportionally
    // This shouldn't happen often with bottom-up propagation,
    // but can occur if root doesn't have enough space for all descendants
    const compressionRatio = angularExtent / totalMinimum
    childExtents = childMinimums.map(min => min * compressionRatio)

    console.warn(
      `Overcrowded: Node ${treeNode.id} (ring ${ringIndex}) has ${treeNode.children.length} children ` +
      `needing ${(totalMinimum * 180 / Math.PI).toFixed(1)}° but only has ${(angularExtent * 180 / Math.PI).toFixed(1)}° ` +
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
      layoutNode
    )

    layoutNode.children.push(childLayoutNode)
    currentAngle += childExtent
  }

  return layoutNode
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
    const avgNodeSize = ((SIZE_RANGES[layer]?.min || 2) + (SIZE_RANGES[layer]?.max || 8)) / 2
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
 * Main layout function - Two-pass hybrid algorithm
 *
 * Pass 1 (Bottom-up): Calculate minimum angular requirements from leaves upward
 * Pass 2 (Top-down): Allocate space from root downward, respecting minimums
 */
export function computeRadialLayout(
  nodes: RawNodeV21[],
  config: LayoutConfig
): LayoutResult {
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
      minAngularExtent: 0
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
  console.log('Pass 1: Calculating minimum angular requirements...')
  for (const root of roots) {
    calculateMinimumRequirements(root, 0, ringRadii, config.nodePadding)
  }

  // Log total requirement vs available
  const totalRootRequirement = roots.reduce((sum, r) => sum + r.minAngularExtent, 0)
  console.log(
    `Total minimum requirement: ${(totalRootRequirement * 180 / Math.PI).toFixed(1)}° ` +
    `(available: ${(config.totalAngle * 180 / Math.PI).toFixed(1)}°)`
  )

  // PASS 2: Top-down positioning
  console.log('Pass 2: Positioning nodes...')
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
    const rootLayoutNode = positionNode(
      root,
      config.startAngle,
      config.totalAngle,
      0,
      ringRadii,
      config.nodePadding,
      layoutNodeMap,
      null
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

      const rootLayoutNode = positionNode(
        root,
        currentAngle,
        extent,
        0,
        ringRadii,
        config.nodePadding,
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
 * Optional post-processing: Resolve any remaining overlaps
 */
export function resolveOverlaps(
  layoutNodes: LayoutNode[],
  computedRings: ComputedRingConfig[],
  nodePadding: number,
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

    for (let iter = 0; iter < maxIterations; iter++) {
      let hadOverlap = false

      ringNodes.sort((a, b) => a.angle - b.angle)

      for (let i = 0; i < ringNodes.length; i++) {
        const n1 = ringNodes[i]
        const n2 = ringNodes[(i + 1) % ringNodes.length]

        const size1 = getActualNodeSize(n1.ring, n1.rawNode.importance ?? 0)
        const size2 = getActualNodeSize(n2.ring, n2.rawNode.importance ?? 0)
        const minDist = size1 + size2 + nodePadding

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

      if (!hadOverlap) break
    }
  }
}

/**
 * Detect overlaps - uses ARC distance (not Euclidean) since nodes are on a ring
 * Only checks ADJACENT nodes since non-adjacent nodes can't overlap.
 *
 * Note: This detects TRUE overlaps (circles intersecting), not padding violations.
 * Padding is for aesthetics during layout, not overlap detection.
 */
export function detectOverlaps(
  layoutNodes: LayoutNode[],
  computedRings: ComputedRingConfig[],
  _nodePadding: number  // Unused - we only detect true overlaps, not padding violations
): Array<{ node1: string; node2: string; ring: number; distance: number; minDistance: number }> {
  const overlaps: Array<{ node1: string; node2: string; ring: number; distance: number; minDistance: number }> = []
  const OVERLAP_TOLERANCE = 1.0  // Allow 1px tolerance for floating-point precision

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
    const radius = ringConfig.radius

    // Sort by angle so we only check adjacent pairs
    ringNodes.sort((a, b) => a.angle - b.angle)

    // Check each adjacent pair (including wrap-around from last to first)
    for (let i = 0; i < ringNodes.length; i++) {
      const n1 = ringNodes[i]
      const n2 = ringNodes[(i + 1) % ringNodes.length]

      const size1 = getActualNodeSize(n1.ring, n1.rawNode.importance ?? 0)
      const size2 = getActualNodeSize(n2.ring, n2.rawNode.importance ?? 0)

      // Minimum arc length for circles to NOT overlap = sum of radii
      // (no padding - we're detecting actual intersection, not aesthetic spacing)
      const minArcLength = size1 + size2 - OVERLAP_TOLERANCE

      // Calculate angular difference (handle wrap-around)
      let angleDiff = Math.abs(n2.angle - n1.angle)
      if (angleDiff > Math.PI) {
        angleDiff = 2 * Math.PI - angleDiff
      }

      // Actual arc length between nodes
      const arcLength = angleDiff * radius

      if (arcLength < minArcLength) {
        overlaps.push({
          node1: n1.id,
          node2: n2.id,
          ring,
          distance: arcLength,
          minDistance: minArcLength
        })
      }
    }
  }

  return overlaps
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
