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
