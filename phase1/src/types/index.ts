/**
 * Type definitions for the semantic hierarchy visualization
 */

export interface SemanticPath {
  domain: string
  subdomain: string
  fine_cluster: string
  full_path: string
}

export interface RawNodeV21 {
  id: string | number
  label: string
  description?: string
  layer: number
  node_type: 'root' | 'outcome_category' | 'coarse_domain' | 'fine_domain' | 'indicator'
  domain: string | null
  subdomain: string | null
  shap_importance: number
  importance: number  // Normalized SHAP importance (0-1) for node sizing
  shap_raw?: number   // Raw aggregated SHAP value before normalization
  in_degree: number
  out_degree: number
  label_source: string
  parent?: string | number
  children?: (string | number)[]
  indicator_count?: number
}

export interface RawEdge {
  source: string
  target: string
  weight?: number
  relationship?: 'causal' | 'hierarchical'
}

export interface GraphDataV21 {
  nodes: RawNodeV21[]
  edges: RawEdge[]
  hierarchy: Record<string, unknown>
  outcomes?: unknown
  metadata: {
    version: string
    statistics: {
      total_nodes: number
      layers: Record<string, number>
    }
  }
}

export interface PositionedNode {
  id: string
  label: string
  description: string
  semanticPath: SemanticPath
  isDriver: boolean
  isOutcome: boolean
  shapImportance: number
  degree: number
  ring: number
  x: number
  y: number
}

export interface StructuralEdge {
  sourceId: string
  targetId: string
  sourceRing: number
  targetRing: number
}

export interface CausalEdge {
  sourceId: string
  targetId: string
  weight: number  // β coefficient (effect size)
}

export interface RingConfig {
  radius: number
  label: string
}

// ============================================
// Local View Types
// ============================================

/** View mode for the application */
export type ViewMode = 'global' | 'local' | 'split'

/** A node in the Local View */
export interface LocalViewNode {
  id: string
  label: string
  sector: string        // Ring 1 ancestor (outcome category)
  sectorColor: string   // Domain color for the sector
  ring: number
  importance: number
  isTarget: boolean     // Is this a selected target node?
  isInput: boolean      // Is this an input (cause) to a target?
  isOutput: boolean     // Is this an output (effect) of a target?
}

/** A causal edge in the Local View */
export interface LocalViewEdge {
  source: string
  target: string
  beta: number          // Effect size (β coefficient)
  sourceSector: string  // Sector of source node
  targetSector: string  // Sector of target node
}

/** Aggregated data for Local View */
export interface LocalViewData {
  targets: LocalViewNode[]
  inputs: LocalViewNode[]
  outputs: LocalViewNode[]
  edges: LocalViewEdge[]
}

/** State for Local View */
export interface LocalViewState {
  targetIds: string[]           // Selected target node IDs
  betaThreshold: number         // Filter threshold (default: 0.5)
  expandedSectors: Set<string>  // Which sector groups are expanded
  sectorFilter: string[]        // Filter by sectors (empty = all)
}
