/**
 * Causal Edge Utilities
 *
 * Functions for extracting, filtering, and grouping causal edges
 * from the visualization data for Local View.
 */

import type { RawEdge, RawNodeV21, LocalViewEdge, LocalViewNode } from '../types'

/** Default beta threshold for filtering edges */
export const DEFAULT_BETA_THRESHOLD = 0.5

/** Maximum beta value to consider (filters outliers) */
export const MAX_BETA_VALUE = 100

/**
 * Extract causal edges from raw edges
 */
export function getCausalEdges(edges: RawEdge[]): LocalViewEdge[] {
  return edges
    .filter(e => e.relationship === 'causal' && e.weight !== undefined)
    .filter(e => Math.abs(e.weight!) <= MAX_BETA_VALUE) // Filter outliers
    .map(e => ({
      source: e.source,
      target: e.target,
      beta: e.weight!,
      sourceSector: '', // Will be filled by getSectorForNode
      targetSector: ''
    }))
}

/**
 * Get the Ring 1 ancestor (sector/outcome) for a node
 */
export function getSectorForNode(
  nodeId: string,
  nodeById: Map<string, RawNodeV21>
): string {
  let current = nodeById.get(nodeId)

  while (current) {
    if (current.layer === 1) {
      return current.label
    }
    if (current.parent) {
      current = nodeById.get(String(current.parent))
    } else {
      break
    }
  }

  return 'Unknown'
}

/**
 * Get incoming edges (causes) for a target node
 */
export function getIncomingEdges(
  targetId: string,
  allEdges: LocalViewEdge[],
  threshold: number = DEFAULT_BETA_THRESHOLD
): LocalViewEdge[] {
  return allEdges
    .filter(e => e.target === targetId && Math.abs(e.beta) >= threshold)
    .sort((a, b) => Math.abs(b.beta) - Math.abs(a.beta)) // Sort by strength
}

/**
 * Get outgoing edges (effects) for a target node
 */
export function getOutgoingEdges(
  targetId: string,
  allEdges: LocalViewEdge[],
  threshold: number = DEFAULT_BETA_THRESHOLD
): LocalViewEdge[] {
  return allEdges
    .filter(e => e.source === targetId && Math.abs(e.beta) >= threshold)
    .sort((a, b) => Math.abs(b.beta) - Math.abs(a.beta))
}

/**
 * Group edges by sector (for collapsible groups in Local View)
 */
export function groupEdgesBySector(
  edges: LocalViewEdge[],
  nodeById: Map<string, RawNodeV21>,
  direction: 'incoming' | 'outgoing'
): Map<string, LocalViewEdge[]> {
  const groups = new Map<string, LocalViewEdge[]>()

  for (const edge of edges) {
    const nodeId = direction === 'incoming' ? edge.source : edge.target
    const sector = getSectorForNode(nodeId, nodeById)

    if (!groups.has(sector)) {
      groups.set(sector, [])
    }
    groups.get(sector)!.push({ ...edge, sourceSector: sector })
  }

  // Sort edges within each group by beta magnitude
  for (const [sector, sectorEdges] of groups) {
    groups.set(sector, sectorEdges.sort((a, b) => Math.abs(b.beta) - Math.abs(a.beta)))
  }

  return groups
}

/**
 * Create LocalViewNode from raw node data
 */
export function toLocalViewNode(
  rawNode: RawNodeV21,
  nodeById: Map<string, RawNodeV21>,
  domainColors: Record<string, string>,
  role: 'target' | 'input' | 'output'
): LocalViewNode {
  const sector = getSectorForNode(String(rawNode.id), nodeById)

  return {
    id: String(rawNode.id),
    label: rawNode.label.replace(/_/g, ' '),
    sector,
    sectorColor: domainColors[rawNode.domain || ''] || '#9E9E9E',
    ring: rawNode.layer,
    importance: rawNode.importance ?? 0,
    isTarget: role === 'target',
    isInput: role === 'input',
    isOutput: role === 'output'
  }
}

/**
 * Build complete Local View data for given targets
 */
export function buildLocalViewData(
  targetIds: string[],
  allEdges: RawEdge[],
  nodeById: Map<string, RawNodeV21>,
  domainColors: Record<string, string>,
  threshold: number = DEFAULT_BETA_THRESHOLD
): {
  targets: LocalViewNode[]
  inputs: LocalViewNode[]
  outputs: LocalViewNode[]
  edges: LocalViewEdge[]
} {
  // Get causal edges
  const causalEdges = getCausalEdges(allEdges)

  // Collect all edges for targets
  const relevantEdges: LocalViewEdge[] = []
  const inputNodeIds = new Set<string>()
  const outputNodeIds = new Set<string>()

  for (const targetId of targetIds) {
    // Incoming edges (causes)
    const incoming = getIncomingEdges(targetId, causalEdges, threshold)
    for (const edge of incoming) {
      if (!targetIds.includes(edge.source)) {
        inputNodeIds.add(edge.source)
        edge.sourceSector = getSectorForNode(edge.source, nodeById)
        edge.targetSector = getSectorForNode(edge.target, nodeById)
        relevantEdges.push(edge)
      }
    }

    // Outgoing edges (effects)
    const outgoing = getOutgoingEdges(targetId, causalEdges, threshold)
    for (const edge of outgoing) {
      if (!targetIds.includes(edge.target)) {
        outputNodeIds.add(edge.target)
        edge.sourceSector = getSectorForNode(edge.source, nodeById)
        edge.targetSector = getSectorForNode(edge.target, nodeById)
        relevantEdges.push(edge)
      }
    }
  }

  // Build node lists
  const targets: LocalViewNode[] = targetIds
    .map(id => nodeById.get(id))
    .filter((n): n is RawNodeV21 => n !== undefined)
    .map(n => toLocalViewNode(n, nodeById, domainColors, 'target'))

  const inputs: LocalViewNode[] = Array.from(inputNodeIds)
    .map(id => nodeById.get(id))
    .filter((n): n is RawNodeV21 => n !== undefined)
    .map(n => toLocalViewNode(n, nodeById, domainColors, 'input'))

  const outputs: LocalViewNode[] = Array.from(outputNodeIds)
    .map(id => nodeById.get(id))
    .filter((n): n is RawNodeV21 => n !== undefined)
    .map(n => toLocalViewNode(n, nodeById, domainColors, 'output'))

  return {
    targets,
    inputs,
    outputs,
    edges: relevantEdges
  }
}

/**
 * Get statistics for Local View data
 */
export function getLocalViewStats(data: ReturnType<typeof buildLocalViewData>): {
  totalInputs: number
  totalOutputs: number
  totalEdges: number
  avgBeta: number
  maxBeta: number
} {
  const betas = data.edges.map(e => Math.abs(e.beta))

  return {
    totalInputs: data.inputs.length,
    totalOutputs: data.outputs.length,
    totalEdges: data.edges.length,
    avgBeta: betas.length > 0 ? betas.reduce((a, b) => a + b, 0) / betas.length : 0,
    maxBeta: betas.length > 0 ? Math.max(...betas) : 0
  }
}
