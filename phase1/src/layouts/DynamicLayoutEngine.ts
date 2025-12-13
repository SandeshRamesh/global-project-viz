/**
 * Dynamic Layout Engine for radial visualization
 *
 * Implements dynamic scaling where:
 * - L1 nodes are anchors (fixed global SHAP-based size, can move angularly)
 * - L2+ nodes are dynamic (re-normalized SHAP based on target nodes only)
 * - Target nodes = L2+ descendants of expanded L1 branches only
 * - Unexpanded branches are excluded from SHAP bounds calculation
 */

import type {
  DynamicLayoutConfig,
  DynamicLayoutState,
  DynamicLayoutNode,
  ViewportTransform,
  BranchLayoutState
} from '../types'

// Constants
const MIN_RING_GAP = 80
const MAX_RING_GAP = 200
const L1_GAP_RADIANS = (10 * Math.PI) / 180  // 10 degree gap between expanded branches

// Base node size ranges per ring (same as App.tsx)
const BASE_SIZE_RANGES: Array<{ min: number; max: number }> = [
  { min: 12, max: 12 },   // Ring 0: Root - fixed size
  { min: 3, max: 18 },    // Ring 1: Outcomes
  { min: 2, max: 14 },    // Ring 2: Coarse Domains
  { min: 2, max: 12 },    // Ring 3: Fine Domains
  { min: 1.5, max: 10 },  // Ring 4: Indicator Groups
  { min: 1, max: 8 },     // Ring 5: Indicators
]

// Node size multipliers per ring (same as App.tsx)
const NODE_SIZE_MULTIPLIERS = [1.0, 1.5, 2.4, 1.4, 0.8, 0.7]

/**
 * Builds a node map for fast lookup by ID
 */
function buildNodeMap(nodes: DynamicLayoutNode[]): Map<string, DynamicLayoutNode> {
  const map = new Map<string, DynamicLayoutNode>()
  for (const node of nodes) {
    map.set(node.id, node)
  }
  return map
}

/**
 * Gets all L1 nodes (ring === 1)
 */
function getL1Nodes(nodes: DynamicLayoutNode[]): DynamicLayoutNode[] {
  return nodes.filter(n => n.ring === 1)
}

/**
 * Gets all descendants of a node (recursive)
 */
function getAllDescendants(
  node: DynamicLayoutNode,
  nodeMap: Map<string, DynamicLayoutNode>
): DynamicLayoutNode[] {
  const descendants: DynamicLayoutNode[] = []

  function collectDescendants(n: DynamicLayoutNode) {
    for (const childId of n.childIds) {
      const child = nodeMap.get(childId)
      if (child) {
        descendants.push(child)
        collectDescendants(child)
      }
    }
  }

  collectDescendants(node)
  return descendants
}

/**
 * Phase 2: Compute optimal ring gap based on viewport and visible depth
 */
export function computeOptimalRingGap(
  config: DynamicLayoutConfig,
  deepestVisibleRing: number
): number {
  const availableRadius = (Math.min(config.viewportWidth, config.viewportHeight) / 2) * 0.9
  const optimalGap = availableRadius / Math.max(deepestVisibleRing, 1)
  return Math.min(Math.max(optimalGap, MIN_RING_GAP), MAX_RING_GAP)
}

/**
 * Phase 3 & 4: Compute L1 angular positions
 * - 0-1 expanded: Even 360 distribution (40 degrees apart)
 * - 2+ expanded: Pack expanded branches contiguously, distribute unexpanded evenly in remaining space
 */
export function computeL1AngularPositions(
  l1Nodes: DynamicLayoutNode[],
  expandedL1Ids: Set<string>,
  nodeMap: Map<string, DynamicLayoutNode>
): Map<string, BranchLayoutState> {
  const result = new Map<string, BranchLayoutState>()
  const expandedCount = expandedL1Ids.size

  if (expandedCount <= 1) {
    // Simple case: even 360 distribution
    const angleStep = (2 * Math.PI) / l1Nodes.length
    l1Nodes.forEach((node, index) => {
      const angle = index * angleStep
      result.set(node.id, {
        l1NodeId: node.id,
        angularStart: angle,
        angularExtent: angleStep,
        isExpanded: expandedL1Ids.has(node.id)
      })
    })
  } else {
    // Complex case: pack expanded branches, distribute unexpanded
    const expanded = l1Nodes.filter(n => expandedL1Ids.has(n.id))
    const unexpanded = l1Nodes.filter(n => !expandedL1Ids.has(n.id))

    // Compute angular budget for each expanded branch based on descendant count
    const totalDescendants = expanded.reduce((sum, n) => {
      return sum + getAllDescendants(n, nodeMap).length + 1 // +1 for the L1 node itself
    }, 0)

    // Expanded branches get proportional share of 180 degrees (pi radians)
    const expandedTotalBudget = Math.PI  // 180 degrees for expanded
    const gapsTotal = (expanded.length - 1) * L1_GAP_RADIANS
    const availableForExpanded = expandedTotalBudget - gapsTotal

    let currentAngle = 0
    for (const node of expanded) {
      const descendants = getAllDescendants(node, nodeMap).length + 1
      const proportion = descendants / totalDescendants
      const angularExtent = availableForExpanded * proportion

      result.set(node.id, {
        l1NodeId: node.id,
        angularStart: currentAngle,
        angularExtent: angularExtent,
        isExpanded: true
      })

      currentAngle += angularExtent + L1_GAP_RADIANS
    }

    // Distribute unexpanded evenly in remaining space
    const remainingSpace = 2 * Math.PI - expandedTotalBudget
    const unexpandedStep = unexpanded.length > 0 ? remainingSpace / unexpanded.length : 0

    currentAngle = expandedTotalBudget
    for (const node of unexpanded) {
      result.set(node.id, {
        l1NodeId: node.id,
        angularStart: currentAngle,
        angularExtent: unexpandedStep,
        isExpanded: false
      })
      currentAngle += unexpandedStep
    }
  }

  return result
}

/**
 * Phase 5: Compute SHAP bounds from target nodes only (expanded branches)
 *
 * CRITICAL: Unexpanded branches are EXCLUDED from bounds calculation.
 * When multiple branches ARE expanded, they share combined bounds.
 */
export function computeTargetNodeSHAPBounds(
  expandedL1Nodes: DynamicLayoutNode[],
  nodeMap: Map<string, DynamicLayoutNode>
): { minSHAP: number; maxSHAP: number } | null {
  if (expandedL1Nodes.length === 0) {
    return null
  }

  // Collect ALL L2+ descendants from ALL expanded L1 branches
  const targetL2Plus: DynamicLayoutNode[] = []
  for (const expandedL1 of expandedL1Nodes) {
    const branchDescendants = getAllDescendants(expandedL1, nodeMap)
    const branchL2Plus = branchDescendants.filter(n => n.ring >= 2)
    targetL2Plus.push(...branchL2Plus)
  }

  if (targetL2Plus.length === 0) {
    return null
  }

  // Compute COMBINED bounds across all target nodes
  const importances = targetL2Plus.map(n => n.importance)
  const minSHAP = Math.min(...importances)
  const maxSHAP = Math.max(...importances)

  // Handle edge case where all importance values are the same
  if (minSHAP === maxSHAP) {
    return { minSHAP: minSHAP, maxSHAP: maxSHAP + 0.001 }  // Avoid division by zero
  }

  return { minSHAP, maxSHAP }
}

/**
 * Phase 5: Compute node sizes with target-node SHAP re-normalization
 *
 * - L0 (Root): Fixed 12px
 * - L1 nodes: Use global SHAP (unchanged)
 * - L2+ nodes from expanded branches: Re-normalized using combined target bounds
 */
export function computeNodeSizes(
  visibleNodes: DynamicLayoutNode[],
  expandedL1Ids: Set<string>,
  nodeMap: Map<string, DynamicLayoutNode>
): Map<string, number> {
  const nodeSizes = new Map<string, number>()

  // Get expanded L1 nodes
  const expandedL1Nodes = Array.from(expandedL1Ids)
    .map(id => nodeMap.get(id))
    .filter((n): n is DynamicLayoutNode => n !== undefined && n.ring === 1)

  // Compute target SHAP bounds
  const bounds = computeTargetNodeSHAPBounds(expandedL1Nodes, nodeMap)

  for (const node of visibleNodes) {
    const ring = node.ring
    const baseRange = BASE_SIZE_RANGES[ring] || BASE_SIZE_RANGES[5]
    const multiplier = NODE_SIZE_MULTIPLIERS[ring] || 0.7
    const min = baseRange.min * multiplier
    const max = baseRange.max * multiplier

    if (ring === 0) {
      // Root: fixed size
      nodeSizes.set(node.id, 12)
    } else if (ring === 1) {
      // L1 nodes: use global SHAP (unchanged)
      const size = min + (max - min) * Math.sqrt(node.importance)
      nodeSizes.set(node.id, size)
    } else if (bounds) {
      // L2+ nodes: re-normalize using target bounds
      const renormalized = (node.importance - bounds.minSHAP) / (bounds.maxSHAP - bounds.minSHAP)
      const clampedRenorm = Math.max(0, Math.min(1, renormalized))
      const size = min + (max - min) * Math.sqrt(clampedRenorm)
      nodeSizes.set(node.id, size)
    } else {
      // Fallback: use global SHAP
      const size = min + (max - min) * Math.sqrt(node.importance)
      nodeSizes.set(node.id, size)
    }
  }

  return nodeSizes
}

/**
 * Phase 6: Position a subtree recursively
 * Children fan out from parent's angle within allocated angular extent
 */
function positionSubtree(
  node: DynamicLayoutNode,
  parentAngle: number,
  angularExtent: number,
  ringGap: number,
  nodeMap: Map<string, DynamicLayoutNode>,
  positions: Map<string, { x: number; y: number; angle: number }>,
  visibleNodeIds: Set<string>
): void {
  const radius = node.ring * ringGap
  const x = Math.cos(parentAngle) * radius
  const y = Math.sin(parentAngle) * radius

  positions.set(node.id, { x, y, angle: parentAngle })

  // Position children if they're visible
  const visibleChildren = node.childIds.filter(id => visibleNodeIds.has(id))
  if (visibleChildren.length === 0) return

  const childExtent = angularExtent / visibleChildren.length
  let childAngle = parentAngle - (angularExtent / 2) + (childExtent / 2)

  for (const childId of visibleChildren) {
    const child = nodeMap.get(childId)
    if (child) {
      positionSubtree(child, childAngle, childExtent, ringGap, nodeMap, positions, visibleNodeIds)
      childAngle += childExtent
    }
  }
}

/**
 * Compute visible nodes based on expansion state
 */
export function computeVisibleNodes(
  allNodes: DynamicLayoutNode[],
  expandedNodeIds: Set<string>
): DynamicLayoutNode[] {
  const nodeMap = buildNodeMap(allNodes)
  const visibleIds = new Set<string>()

  // Root is always visible
  const root = allNodes.find(n => n.ring === 0)
  if (root) {
    visibleIds.add(root.id)

    // If root is expanded, show L1 nodes
    if (expandedNodeIds.has(root.id)) {
      for (const childId of root.childIds) {
        visibleIds.add(childId)
      }
    }
  }

  // For each expanded node, show its children
  for (const expandedId of expandedNodeIds) {
    const node = nodeMap.get(expandedId)
    if (node) {
      for (const childId of node.childIds) {
        visibleIds.add(childId)
      }
    }
  }

  return allNodes.filter(n => visibleIds.has(n.id))
}

/**
 * Get deepest visible ring
 */
function getDeepestVisibleRing(visibleNodes: DynamicLayoutNode[]): number {
  return Math.max(...visibleNodes.map(n => n.ring), 0)
}

/**
 * Phase 7: Compute viewport transform to center on target nodes
 */
export function computeViewportTransform(
  targetPositions: Map<string, { x: number; y: number; angle: number }>,
  config: DynamicLayoutConfig
): ViewportTransform {
  if (targetPositions.size === 0) {
    return { x: 0, y: 0, scale: 1 }
  }

  // Compute bounding box of target nodes
  let minX = Infinity, maxX = -Infinity
  let minY = Infinity, maxY = -Infinity

  for (const pos of targetPositions.values()) {
    minX = Math.min(minX, pos.x)
    maxX = Math.max(maxX, pos.x)
    minY = Math.min(minY, pos.y)
    maxY = Math.max(maxY, pos.y)
  }

  const contentWidth = maxX - minX
  const contentHeight = maxY - minY
  const contentCenterX = (minX + maxX) / 2
  const contentCenterY = (minY + maxY) / 2

  // Add 10% margin
  const margin = 0.1
  const availableWidth = config.viewportWidth * (1 - 2 * margin)
  const availableHeight = config.viewportHeight * (1 - 2 * margin)

  // Compute scale to fit content (capped at 1.0)
  const scaleX = contentWidth > 0 ? availableWidth / contentWidth : 1
  const scaleY = contentHeight > 0 ? availableHeight / contentHeight : 1
  const scale = Math.min(1, Math.min(scaleX, scaleY))

  // Compute translation to center content
  const viewportCenterX = config.viewportWidth / 2
  const viewportCenterY = config.viewportHeight / 2
  const x = viewportCenterX - contentCenterX * scale
  const y = viewportCenterY - contentCenterY * scale

  return { x, y, scale }
}

/**
 * Get expanded L1 node IDs from the set of all expanded nodes
 */
function getExpandedL1Ids(
  expandedNodeIds: Set<string>,
  allNodes: DynamicLayoutNode[]
): Set<string> {
  const l1Ids = new Set(allNodes.filter(n => n.ring === 1).map(n => n.id))
  const expandedL1Ids = new Set<string>()

  for (const id of expandedNodeIds) {
    if (l1Ids.has(id)) {
      expandedL1Ids.add(id)
    }
  }

  return expandedL1Ids
}

/**
 * Main orchestrator: Compute complete dynamic layout
 */
export function computeDynamicLayout(
  allNodes: DynamicLayoutNode[],
  expandedNodeIds: Set<string>,
  config: DynamicLayoutConfig
): DynamicLayoutState {
  const nodeMap = buildNodeMap(allNodes)
  const l1Nodes = getL1Nodes(allNodes)
  const expandedL1Ids = getExpandedL1Ids(expandedNodeIds, allNodes)

  // Phase 1: Compute visible nodes
  const visibleNodes = computeVisibleNodes(allNodes, expandedNodeIds)
  const visibleNodeIds = new Set(visibleNodes.map(n => n.id))
  const deepestRing = getDeepestVisibleRing(visibleNodes)

  // Phase 2: Compute optimal ring gap
  const ringGap = computeOptimalRingGap(config, deepestRing)

  // Phase 3 & 4: Compute L1 angular positions
  const l1Positions = computeL1AngularPositions(l1Nodes, expandedL1Ids, nodeMap)

  // Phase 5: Compute node sizes with SHAP re-normalization
  const nodeSizes = computeNodeSizes(visibleNodes, expandedL1Ids, nodeMap)

  // Phase 5: Get target SHAP bounds for debugging/display
  const expandedL1Nodes = Array.from(expandedL1Ids)
    .map(id => nodeMap.get(id))
    .filter((n): n is DynamicLayoutNode => n !== undefined)
  const targetSHAPBounds = computeTargetNodeSHAPBounds(expandedL1Nodes, nodeMap)

  // Phase 6: Compute all node positions
  const nodePositions = new Map<string, { x: number; y: number; angle: number }>()

  // Position root at center
  const root = allNodes.find(n => n.ring === 0)
  if (root) {
    nodePositions.set(root.id, { x: 0, y: 0, angle: 0 })

    // Position L1 nodes and their subtrees
    for (const l1Node of l1Nodes) {
      if (!visibleNodeIds.has(l1Node.id)) continue

      const branchState = l1Positions.get(l1Node.id)
      if (branchState) {
        const angle = branchState.angularStart + branchState.angularExtent / 2
        positionSubtree(
          l1Node,
          angle,
          branchState.angularExtent,
          ringGap,
          nodeMap,
          nodePositions,
          visibleNodeIds
        )
      }
    }
  }

  // Phase 7: Compute viewport transform
  // Target nodes = expanded L1s + their descendants
  const targetPositions = new Map<string, { x: number; y: number; angle: number }>()
  for (const l1Id of expandedL1Ids) {
    const l1Pos = nodePositions.get(l1Id)
    if (l1Pos) {
      targetPositions.set(l1Id, l1Pos)
      const l1Node = nodeMap.get(l1Id)
      if (l1Node) {
        for (const desc of getAllDescendants(l1Node, nodeMap)) {
          const pos = nodePositions.get(desc.id)
          if (pos) {
            targetPositions.set(desc.id, pos)
          }
        }
      }
    }
  }

  // If no L1 expanded, center on all visible
  const positionsForViewport = targetPositions.size > 0 ? targetPositions : nodePositions
  const viewportTransform = computeViewportTransform(positionsForViewport, config)

  return {
    expandedL1Ids,
    ringGap,
    nodeSizes,
    nodePositions,
    viewportTransform,
    targetSHAPBounds
  }
}

/**
 * Debug helper: Log layout state
 */
export function logLayoutState(state: DynamicLayoutState): void {
  console.group('Dynamic Layout State')
  console.log('Expanded L1 IDs:', Array.from(state.expandedL1Ids))
  console.log('Ring Gap:', state.ringGap)
  console.log('Target SHAP Bounds:', state.targetSHAPBounds)
  console.log('Viewport Transform:', state.viewportTransform)
  console.log('Node Positions Count:', state.nodePositions.size)
  console.log('Node Sizes Count:', state.nodeSizes.size)
  console.groupEnd()
}
