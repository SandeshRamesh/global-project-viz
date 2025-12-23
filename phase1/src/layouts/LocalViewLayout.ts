/**
 * LocalViewLayout - Vertical 3-layer layout for Local View
 *
 * Layout structure:
 *   Layer 0 (top):    Input nodes (causes)
 *   Layer 1 (middle): Target nodes
 *   Layer 2 (bottom): Output nodes (effects)
 *
 * Uses circular nodes with importance-based sizing for visual
 * consistency with Global View.
 */

import type { LocalViewNode, LocalViewEdge } from '../types'

// Layout constants - optimized for circular nodes
const LAYER_GAP = 220             // Vertical space between layers (increased for labels below)
const MIN_NODE_RADIUS = 20        // Minimum circle radius for readability
const MAX_NODE_RADIUS = 50        // Maximum circle radius for emphasis
const NODE_H_SPACING = 30         // Horizontal space between circles
const NODE_V_SPACING = 30         // Vertical space between rows
const MAX_NODES_PER_ROW = 4       // Max nodes per row in input/output layers
const LABEL_OFFSET = 15           // Space below circle for label
const COLLISION_PADDING = 5       // Minimum gap between circles

/** Positioned node for rendering */
export interface PositionedLocalNode extends LocalViewNode {
  x: number           // Center X coordinate
  y: number           // Center Y coordinate
  radius: number      // Circle radius (computed from importance)
  layer: 'input' | 'target' | 'output'
}

/** Complete layout result */
export interface LocalViewLayoutResult {
  nodes: PositionedLocalNode[]
  edges: LocalViewEdge[]
  bounds: {
    width: number
    height: number
    centerX: number
    centerY: number
  }
}

/**
 * Calculate node radius from importance using area-proportional scaling
 * Uses separate size range optimized for Local View readability
 */
export function getLocalNodeRadius(importance: number): number {
  const minArea = Math.PI * MIN_NODE_RADIUS * MIN_NODE_RADIUS
  const maxArea = Math.PI * MAX_NODE_RADIUS * MAX_NODE_RADIUS
  const area = minArea + (importance || 0) * (maxArea - minArea)
  return Math.sqrt(area / Math.PI)
}

/**
 * Calculate node radius from beta (causal strength), normalized to local view
 * @param beta - The absolute beta value for this node
 * @param maxBeta - The maximum beta in the local view (for normalization)
 */
export function getLocalNodeRadiusFromBeta(beta: number, maxBeta: number): number {
  const minArea = Math.PI * MIN_NODE_RADIUS * MIN_NODE_RADIUS
  const maxArea = Math.PI * MAX_NODE_RADIUS * MAX_NODE_RADIUS
  const normalizedBeta = maxBeta > 0 ? Math.abs(beta) / maxBeta : 0
  const area = minArea + normalizedBeta * (maxArea - minArea)
  return Math.sqrt(area / Math.PI)
}

/**
 * Truncate label to fit within circle width
 */
export function truncateLabel(label: string, maxWidth: number): string {
  const avgCharWidth = 7 // pixels per character at 12px font
  const maxChars = Math.floor(maxWidth / avgCharWidth)

  if (label.length <= maxChars) return label
  return label.substring(0, maxChars - 3) + '...'
}

/**
 * Resolve overlaps between circular nodes in the same layer
 */
function resolveCircleOverlaps(nodes: PositionedLocalNode[]): void {
  // Multiple passes to handle cascading overlaps
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const n1 = nodes[i]
        const n2 = nodes[j]

        // Skip if in different layers
        if (n1.layer !== n2.layer) continue

        const dx = n2.x - n1.x
        const dy = n2.y - n1.y
        const distance = Math.sqrt(dx * dx + dy * dy)
        const minDistance = n1.radius + n2.radius + COLLISION_PADDING

        if (distance < minDistance && distance > 0) {
          const overlap = minDistance - distance
          const angle = Math.atan2(dy, dx)
          // Push nodes apart equally
          n2.x += Math.cos(angle) * overlap / 2
          n1.x -= Math.cos(angle) * overlap / 2
        }
      }
    }
  }
}

/**
 * Compute the Local View layout with circular nodes
 */
export function computeLocalViewLayout(
  targets: LocalViewNode[],
  inputs: LocalViewNode[],
  outputs: LocalViewNode[],
  edges: LocalViewEdge[],
  containerWidth: number,
  containerHeight: number
): LocalViewLayoutResult {
  const positionedNodes: PositionedLocalNode[] = []

  // Calculate center X
  const centerX = containerWidth / 2

  // Calculate max beta for normalization (local view only)
  const maxBeta = Math.max(...edges.map(e => Math.abs(e.beta)), 0.1)

  // === LAYER 1: Target nodes (middle) ===
  const targetLayerY = containerHeight / 2

  // Calculate radii for targets (use importance for targets)
  const targetRadii = targets.map(t => getLocalNodeRadius(t.importance))
  const targetTotalWidth = targetRadii.reduce((sum, r) => sum + r * 2, 0) +
    (targets.length - 1) * NODE_H_SPACING

  let targetCurrentX = centerX - targetTotalWidth / 2

  for (let i = 0; i < targets.length; i++) {
    const radius = targetRadii[i]
    positionedNodes.push({
      ...targets[i],
      x: targetCurrentX + radius,  // x is center
      y: targetLayerY,
      radius,
      layer: 'target'
    })
    targetCurrentX += radius * 2 + NODE_H_SPACING
  }

  // === LAYER 0: Input nodes (top) ===
  // Calculate beta for each input (max beta across all edges from this input)
  const inputBetas = new Map<string, number>()
  for (const edge of edges) {
    if (inputs.some(n => n.id === edge.source)) {
      const current = inputBetas.get(edge.source) || 0
      inputBetas.set(edge.source, Math.max(current, Math.abs(edge.beta)))
    }
  }

  // Sort inputs by beta magnitude (strongest first)
  const sortedInputs = [...inputs].sort((a, b) =>
    (inputBetas.get(b.id) || 0) - (inputBetas.get(a.id) || 0)
  )

  // Calculate radii for inputs based on beta (causal strength)
  const inputRadii = sortedInputs.map(n =>
    getLocalNodeRadiusFromBeta(inputBetas.get(n.id) || 0, maxBeta)
  )
  const maxInputRadius = Math.max(...inputRadii, MIN_NODE_RADIUS)

  // Arrange inputs in rows
  const inputRows = Math.ceil(sortedInputs.length / MAX_NODES_PER_ROW)
  const inputRowHeight = maxInputRadius * 2 + LABEL_OFFSET
  const inputLayerHeight = inputRows * inputRowHeight + (inputRows - 1) * NODE_V_SPACING
  const inputLayerStartY = targetLayerY - LAYER_GAP - inputLayerHeight / 2

  for (let i = 0; i < sortedInputs.length; i++) {
    const row = Math.floor(i / MAX_NODES_PER_ROW)
    const col = i % MAX_NODES_PER_ROW
    const nodesInRow = Math.min(MAX_NODES_PER_ROW, sortedInputs.length - row * MAX_NODES_PER_ROW)

    // Calculate row width based on actual radii
    const rowStartIdx = row * MAX_NODES_PER_ROW
    const rowRadii = inputRadii.slice(rowStartIdx, rowStartIdx + nodesInRow)
    const rowWidth = rowRadii.reduce((sum, r) => sum + r * 2, 0) +
      (nodesInRow - 1) * NODE_H_SPACING

    let rowCurrentX = centerX - rowWidth / 2
    for (let c = 0; c < col; c++) {
      rowCurrentX += inputRadii[rowStartIdx + c] * 2 + NODE_H_SPACING
    }

    const radius = inputRadii[i]
    // Bottom-align: all nodes in row share same bottom Y, center Y = bottomY - radius
    const rowBottomY = inputLayerStartY + row * (inputRowHeight + NODE_V_SPACING) + maxInputRadius
    positionedNodes.push({
      ...sortedInputs[i],
      x: rowCurrentX + radius,
      y: rowBottomY - radius,
      radius,
      layer: 'input'
    })
  }

  // === LAYER 2: Output nodes (bottom) ===
  // Calculate beta for each output (max beta across all edges to this output)
  const outputBetas = new Map<string, number>()
  for (const edge of edges) {
    if (outputs.some(n => n.id === edge.target)) {
      const current = outputBetas.get(edge.target) || 0
      outputBetas.set(edge.target, Math.max(current, Math.abs(edge.beta)))
    }
  }

  // Sort outputs by beta magnitude (strongest first)
  const sortedOutputs = [...outputs].sort((a, b) =>
    (outputBetas.get(b.id) || 0) - (outputBetas.get(a.id) || 0)
  )

  // Calculate radii for outputs based on beta (causal strength)
  const outputRadii = sortedOutputs.map(n =>
    getLocalNodeRadiusFromBeta(outputBetas.get(n.id) || 0, maxBeta)
  )
  const maxOutputRadius = Math.max(...outputRadii, MIN_NODE_RADIUS)
  const outputRowHeight = maxOutputRadius * 2 + LABEL_OFFSET
  const outputLayerStartY = targetLayerY + LAYER_GAP

  for (let i = 0; i < sortedOutputs.length; i++) {
    const row = Math.floor(i / MAX_NODES_PER_ROW)
    const col = i % MAX_NODES_PER_ROW
    const nodesInRow = Math.min(MAX_NODES_PER_ROW, sortedOutputs.length - row * MAX_NODES_PER_ROW)

    // Calculate row width based on actual radii
    const rowStartIdx = row * MAX_NODES_PER_ROW
    const rowRadii = outputRadii.slice(rowStartIdx, rowStartIdx + nodesInRow)
    const rowWidth = rowRadii.reduce((sum, r) => sum + r * 2, 0) +
      (nodesInRow - 1) * NODE_H_SPACING

    let rowCurrentX = centerX - rowWidth / 2
    for (let c = 0; c < col; c++) {
      rowCurrentX += outputRadii[rowStartIdx + c] * 2 + NODE_H_SPACING
    }

    const radius = outputRadii[i]
    // Bottom-align: all nodes in row share same bottom Y, center Y = bottomY - radius
    const rowBottomY = outputLayerStartY + row * (outputRowHeight + NODE_V_SPACING) + maxOutputRadius
    positionedNodes.push({
      ...sortedOutputs[i],
      x: rowCurrentX + radius,
      y: rowBottomY - radius,
      radius,
      layer: 'output'
    })
  }

  // Resolve any overlaps
  resolveCircleOverlaps(positionedNodes)

  // Calculate bounds (accounting for radius and labels)
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity

  for (const node of positionedNodes) {
    minX = Math.min(minX, node.x - node.radius)
    maxX = Math.max(maxX, node.x + node.radius)
    minY = Math.min(minY, node.y - node.radius)
    maxY = Math.max(maxY, node.y + node.radius + LABEL_OFFSET + 15) // Extra space for label
  }

  // Handle empty case
  if (!isFinite(minX)) {
    minX = 0
    maxX = containerWidth
    minY = 0
    maxY = containerHeight
  }

  return {
    nodes: positionedNodes,
    edges,
    bounds: {
      width: maxX - minX,
      height: maxY - minY,
      centerX: (minX + maxX) / 2,
      centerY: (minY + maxY) / 2
    }
  }
}

/**
 * Calculate edge path between two circular nodes (Bezier curve)
 * Connects at circle perimeters, not centers
 */
export function calculateEdgePath(
  sourceNode: PositionedLocalNode,
  targetNode: PositionedLocalNode
): string {
  const x1 = sourceNode.x
  const y1 = sourceNode.y
  const x2 = targetNode.x
  const y2 = targetNode.y

  // Start point: bottom of source circle (going down)
  // For vertical layout, edges go from bottom of source to top of target
  const startX = x1
  const startY = y1 + sourceNode.radius

  // End point: top of target circle (coming from above)
  const endX = x2
  const endY = y2 - targetNode.radius

  // Control points for smooth curve
  const midY = (startY + endY) / 2

  return `M ${startX} ${startY} C ${startX} ${midY}, ${endX} ${midY}, ${endX} ${endY}`
}

/**
 * Get edge styling based on beta value
 */
export function getEdgeStyle(beta: number, maxBeta: number): {
  strokeWidth: number
  stroke: string
  opacity: number
} {
  const normalizedBeta = Math.abs(beta) / Math.max(maxBeta, 1)

  return {
    strokeWidth: 1.5 + normalizedBeta * 3.5, // 1.5px to 5px
    stroke: beta > 0 ? '#4CAF50' : '#F44336', // Green positive, red negative
    opacity: 0.3 + normalizedBeta * 0.2 // 0.3 to 0.5 (lighter for text readability)
  }
}

/**
 * Calculate initial transform to fit layout in viewport
 */
export function calculateFitTransform(
  bounds: LocalViewLayoutResult['bounds'],
  containerWidth: number,
  containerHeight: number,
  padding: number = 60
): { x: number; y: number; scale: number } {
  const availableWidth = containerWidth - padding * 2
  const availableHeight = containerHeight - padding * 2

  const scaleX = availableWidth / Math.max(bounds.width, 1)
  const scaleY = availableHeight / Math.max(bounds.height, 1)
  const scale = Math.min(scaleX, scaleY, 1.2) // Cap at 1.2x zoom

  const x = containerWidth / 2 - bounds.centerX * scale
  const y = containerHeight / 2 - bounds.centerY * scale

  return { x, y, scale }
}
