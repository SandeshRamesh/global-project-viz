/**
 * ClusterLayout - D3 Cluster-based dynamic angular positioning
 *
 * Uses D3's cluster layout algorithm to dynamically reposition nodes
 * based on expansion state, giving expanded branches more angular space
 * while keeping ring radii and node sizes unchanged.
 */

import { hierarchy, cluster, HierarchyNode } from 'd3-hierarchy'

/**
 * Node data structure for the hierarchy
 */
interface HierarchyNodeData {
  id: string
  ring: number
  importance: number
  parentId: string | null
  childIds: string[]
  isExpanded: boolean
  isVisible: boolean
}

/**
 * Position result for each node
 */
export interface ClusterPosition {
  x: number
  y: number
  angle: number  // Angular position in radians (0 = top, clockwise)
}

/**
 * Input node interface - matches ExpandableNode from App.tsx
 */
export interface ClusterInputNode {
  id: string
  ring: number
  importance: number
  parentId: string | null
  childIds: string[]
}

/**
 * Per-ring size ranges for importance-based node sizing.
 * Must match the values in App.tsx getSize() function.
 */
const BASE_SIZE_RANGES: Record<number, { min: number; max: number }> = {
  0: { min: 12, max: 12 },   // Root - fixed size
  1: { min: 3, max: 18 },    // Outcomes
  2: { min: 2, max: 14 },    // Coarse Domains
  3: { min: 2, max: 12 },    // Fine Domains
  4: { min: 1.5, max: 10 },  // Indicator Groups
  5: { min: 1, max: 8 },     // Indicators
}

/**
 * Node size multipliers per ring (from App.tsx)
 */
const NODE_SIZE_MULTIPLIERS = [1.0, 1.5, 2.4, 1.4, 0.8, 0.7]

/**
 * Computes actual node size based on importance and ring.
 * Uses area-proportional sizing: radius = min + (max - min) * sqrt(importance)
 * Must match the getSize() function in App.tsx.
 */
function getNodeSize(ring: number, importance: number): number {
  const baseRange = BASE_SIZE_RANGES[ring] || { min: 2, max: 8 }
  const multiplier = NODE_SIZE_MULTIPLIERS[ring] || 1

  const min = baseRange.min * multiplier
  const max = baseRange.max * multiplier

  return min + (max - min) * Math.sqrt(importance)
}

/**
 * Builds a hierarchy tree from flat node array, filtering to visible nodes only
 */
function buildHierarchyTree(
  nodes: ClusterInputNode[],
  expandedNodeIds: Set<string>
): HierarchyNode<HierarchyNodeData> | null {
  // Create a map for quick lookup
  const nodeMap = new Map<string, ClusterInputNode>()
  nodes.forEach(n => nodeMap.set(n.id, n))

  // Determine which nodes are visible
  const visibleNodeIds = new Set<string>()

  // Root is always visible
  const rootNode = nodes.find(n => n.ring === 0)
  if (!rootNode) return null

  visibleNodeIds.add(rootNode.id)

  // Recursively mark visible children
  function markVisibleChildren(nodeId: string) {
    if (expandedNodeIds.has(nodeId)) {
      const node = nodeMap.get(nodeId)
      if (node) {
        node.childIds.forEach(childId => {
          visibleNodeIds.add(childId)
          markVisibleChildren(childId)
        })
      }
    }
  }

  markVisibleChildren(rootNode.id)

  // Build tree structure for visible nodes only
  function buildNode(nodeId: string): HierarchyNodeData & { children?: (HierarchyNodeData & { children?: unknown })[] } {
    const node = nodeMap.get(nodeId)!
    const visibleChildren = node.childIds.filter(cid => visibleNodeIds.has(cid))

    const result: HierarchyNodeData & { children?: (HierarchyNodeData & { children?: unknown })[] } = {
      id: node.id,
      ring: node.ring,
      importance: node.importance,
      parentId: node.parentId,
      childIds: node.childIds,
      isExpanded: expandedNodeIds.has(node.id),
      isVisible: true
    }

    if (visibleChildren.length > 0) {
      result.children = visibleChildren.map(childId => buildNode(childId))
    }

    return result
  }

  const rootData = buildNode(rootNode.id)
  return hierarchy(rootData)
}

/**
 * Computes angular positions for visible nodes using D3 cluster layout.
 *
 * The cluster algorithm naturally allocates more angular space to expanded
 * branches (with more children) and less to collapsed branches.
 *
 * @param nodes - All nodes in the graph (flat array)
 * @param expandedNodeIds - Set of node IDs that are currently expanded
 * @param ringGap - Gap between rings in pixels (e.g., 150)
 * @returns Map of node ID to position (x, y, angle)
 */
export function computeClusterPositions(
  nodes: ClusterInputNode[],
  expandedNodeIds: Set<string>,
  ringGap: number
): Map<string, ClusterPosition> {
  const positions = new Map<string, ClusterPosition>()

  // Build hierarchy from visible nodes
  const root = buildHierarchyTree(nodes, expandedNodeIds)
  if (!root) return positions

  // Find max visible depth for proper radial extent
  let maxDepth = 0
  root.each(node => {
    maxDepth = Math.max(maxDepth, node.data.ring)
  })

  // Create D3 cluster layout
  // size([angle, radius]) - we use [2π, maxRadius] for full circle
  const maxRadius = maxDepth * ringGap
  const clusterLayout = cluster<HierarchyNodeData>()
    .size([2 * Math.PI, maxRadius])
    .separation((a, b) => {
      // Custom separation function based on actual node sizes
      // We want nodes at the same depth to have adequate spacing

      // Get node sizes based on importance
      const sizeA = getNodeSize(a.data.ring, a.data.importance)
      const sizeB = getNodeSize(b.data.ring, b.data.importance)

      // Base separation: 1 = equal spacing for siblings
      // We need more space for nodes with larger sizes
      const avgSize = (sizeA + sizeB) / 2
      const baseSeparation = avgSize / 10

      // Siblings (same parent) need less space than cousins
      if (a.parent === b.parent) {
        return Math.max(1, baseSeparation)
      }

      // Cousins need more space to visually separate branches
      return Math.max(2, baseSeparation * 1.5)
    })

  // Apply layout
  clusterLayout(root)

  // Override depth (y) with actual ring radii (preserving cluster's angular positions)
  // D3 cluster sets node.x = angle (0 to 2π), node.y = depth-based radius
  // We override y to use our fixed ring gaps
  root.each(node => {
    // Use actual ring value for radius, not computed depth
    const actualRadius = node.data.ring * ringGap

    // D3's x is the angle in radians (0 to 2π)
    // We rotate by -π/2 so that 0 angle is at the top
    const angle = node.x - Math.PI / 2

    positions.set(node.data.id, {
      x: actualRadius * Math.cos(angle),
      y: actualRadius * Math.sin(angle),
      angle: node.x  // Store original angle for reference
    })
  })

  return positions
}

/**
 * Performance-benchmarked version of computeClusterPositions.
 * Logs timing information to console.
 */
export function computeClusterPositionsWithBenchmark(
  nodes: ClusterInputNode[],
  expandedNodeIds: Set<string>,
  ringGap: number
): Map<string, ClusterPosition> {
  const startTime = performance.now()
  const positions = computeClusterPositions(nodes, expandedNodeIds, ringGap)
  const endTime = performance.now()

  console.log(`computeClusterPositions: ${(endTime - startTime).toFixed(2)}ms for ${positions.size} nodes`)

  return positions
}
