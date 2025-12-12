import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import * as d3 from 'd3'
import './styles/App.css'
import type {
  RawNodeV21,
  GraphDataV21,
  PositionedNode,
  StructuralEdge
} from './types'
import {
  computeRadialLayout,
  detectOverlaps,
  computeLayoutStats,
  type LayoutConfig,
  type LayoutNode
} from './layouts/RadialLayout'

/**
 * Semantic hierarchy visualization with concentric rings - v2.1 only
 * 6 rings: Root → Outcomes → Coarse Domains → Fine Domains → Indicator Groups → Indicators
 *
 * Features:
 * - Click to expand/collapse node children
 * - Hover to see node details
 * - Starts with only root visible, expand to explore hierarchy
 * - Adjustable ring gap and node sizes via sliders
 */

// Ring labels
const RING_LABELS = [
  'Quality of Life',
  'Outcomes',
  'Coarse Domains',
  'Fine Domains',
  'Indicator Groups',
  'Indicators'
]

// Default ring gap (uniform spacing between rings)
const DEFAULT_RING_GAP = 150

// Node size multipliers per ring (tuned for fully expanded view)
const NODE_SIZE_MULTIPLIERS = [1.0, 1.5, 2.4, 1.4, 0.8, 0.7]

// Base node size ranges per ring (before multiplier)
const BASE_SIZE_RANGES: Array<{ min: number; max: number }> = [
  { min: 12, max: 12 },   // Ring 0: Root - fixed size
  { min: 3, max: 18 },    // Ring 1: Outcomes
  { min: 2, max: 14 },    // Ring 2: Coarse Domains
  { min: 2, max: 12 },    // Ring 3: Fine Domains
  { min: 1.5, max: 10 },  // Ring 4: Indicator Groups
  { min: 1, max: 8 },     // Ring 5: Indicators
]

/**
 * Generate ring configs with equal spacing
 */
function generateRingConfigs(gap: number, sizeMultipliers: number[]) {
  return RING_LABELS.map((label, i) => ({
    radius: i * gap,  // Equal spacing: ring N is at N * gap
    nodeSize: BASE_SIZE_RANGES[i].max * (sizeMultipliers[i] || 1),
    label
  }))
}

/** Extended PositionedNode with parent reference for expansion logic */
interface ExpandableNode extends PositionedNode {
  parentId: string | null
  childIds: string[]
  hasChildren: boolean
  importance: number  // Normalized SHAP importance (0-1) for node sizing
}

const DOMAIN_COLORS: Record<string, string> = {
  'Health': '#E91E63',
  'Education': '#FF9800',
  'Economic': '#4CAF50',
  'Governance': '#9C27B0',
  'Environment': '#00BCD4',
  'Demographics': '#795548',
  'Security': '#F44336',
  'Development': '#3F51B5',
  'Research': '#009688'
}

// Use Vite's base URL for correct path in GitHub Pages
const DATA_FILE = `${import.meta.env.BASE_URL}data/v2_1_visualization_final.json`

const DEFAULT_NODE_PADDING = 7
const MIN_RING_GAP = 80

/**
 * Converts a LayoutNode to an ExpandableNode for rendering
 */
function toExpandableNode(layoutNode: LayoutNode): ExpandableNode {
  const raw = layoutNode.rawNode
  return {
    id: layoutNode.id,
    label: raw.node_type === 'root' ? 'Quality of Life' : raw.label.replace(/_/g, ' '),
    description: raw.description || getDefaultDescription(raw),
    semanticPath: {
      domain: raw.domain || '',
      subdomain: raw.subdomain || '',
      fine_cluster: '',
      full_path: raw.label
    },
    isDriver: raw.node_type === 'indicator' && raw.out_degree > 0,
    isOutcome: raw.node_type === 'outcome_category',
    shapImportance: raw.shap_importance,
    importance: raw.importance ?? 0,  // Normalized SHAP importance for sizing
    degree: raw.in_degree + raw.out_degree,
    ring: layoutNode.ring,
    x: layoutNode.x,
    y: layoutNode.y,
    parentId: layoutNode.parent?.id || null,
    childIds: layoutNode.children.map(c => c.id),
    hasChildren: layoutNode.children.length > 0
  }
}

/**
 * Generates default description based on node type
 */
function getDefaultDescription(node: RawNodeV21): string {
  switch (node.node_type) {
    case 'root':
      return 'Root'
    case 'outcome_category':
      return `${node.indicator_count || 0} indicators`
    case 'coarse_domain':
      return `Coarse Domain: ${node.label}`
    case 'fine_domain':
      return `Fine Domain: ${node.label}`
    case 'indicator':
      return ''
    default:
      return ''
  }
}

function App() {
  const svgRef = useRef<SVGSVGElement>(null)
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null)
  const currentTransformRef = useRef<d3.ZoomTransform | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [stats, setStats] = useState<{
    nodes: number
    structuralEdges: number
    outcomes: number
    drivers: number
    overlaps: number
  } | null>(null)
  const [domainCounts, setDomainCounts] = useState<Record<string, number>>({})
  const [hoveredNode, setHoveredNode] = useState<ExpandableNode | null>(null)
  const [ringStats, setRingStats] = useState<Array<{ label: string; count: number; minDistance: number }>>([])

  // Layout configuration - fixed values for fully expanded view
  const nodePadding = DEFAULT_NODE_PADDING
  const nodeSizeMultipliers = NODE_SIZE_MULTIPLIERS
  const ringConfigs = useMemo(
    () => generateRingConfigs(DEFAULT_RING_GAP, nodeSizeMultipliers),
    [nodeSizeMultipliers]
  )

  // Expansion state - tracks which nodes have their children visible
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set())

  // All nodes from layout (stored for filtering)
  const [allNodes, setAllNodes] = useState<ExpandableNode[]>([])
  const [allEdges, setAllEdges] = useState<StructuralEdge[]>([])
  const [computedRingsState, setComputedRingsState] = useState<Array<{ radius: number; nodeSize: number; label?: string }>>([])

  // Toggle expansion of a node
  const toggleExpansion = useCallback((nodeId: string) => {
    setExpandedNodes(prev => {
      const next = new Set(prev)
      if (next.has(nodeId)) {
        // Collapse: remove this node and all descendants from expanded set
        next.delete(nodeId)
        // Also collapse all descendants
        const collapseDescendants = (id: string) => {
          const node = allNodes.find(n => n.id === id)
          if (node) {
            node.childIds.forEach(childId => {
              next.delete(childId)
              collapseDescendants(childId)
            })
          }
        }
        collapseDescendants(nodeId)
      } else {
        next.add(nodeId)
      }
      return next
    })
  }, [allNodes])

  // Expand all nodes
  const expandAll = useCallback(() => {
    const allExpandable = allNodes.filter(n => n.hasChildren).map(n => n.id)
    setExpandedNodes(new Set(allExpandable))
  }, [allNodes])

  // Collapse all nodes
  const collapseAll = useCallback(() => {
    setExpandedNodes(new Set())
  }, [])

  // Expand all nodes in a specific ring (that are currently visible)
  const expandRing = useCallback((ring: number) => {
    setExpandedNodes(prev => {
      const next = new Set(prev)
      // Find nodes in this ring that are visible (parent is expanded or is root) and have children
      allNodes
        .filter(n => {
          if (n.ring !== ring || !n.hasChildren) return false
          // Check if visible: root is always visible, others need parent expanded
          if (n.ring === 0) return true
          return n.parentId && prev.has(n.parentId)
        })
        .forEach(n => next.add(n.id))
      return next
    })
  }, [allNodes])

  // Collapse all nodes in a specific ring
  const collapseRing = useCallback((ring: number) => {
    setExpandedNodes(prev => {
      const next = new Set(prev)
      // Remove all nodes in this ring and their descendants
      allNodes
        .filter(n => n.ring === ring)
        .forEach(n => {
          next.delete(n.id)
          // Also collapse descendants
          const collapseDescendants = (id: string) => {
            const node = allNodes.find(nd => nd.id === id)
            if (node) {
              node.childIds.forEach(childId => {
                next.delete(childId)
                collapseDescendants(childId)
              })
            }
          }
          collapseDescendants(n.id)
        })
      return next
    })
  }, [allNodes])

  // Compute visible nodes based on expansion state
  const visibleNodes = useMemo(() => {
    if (allNodes.length === 0) return []

    const visible = new Set<string>()

    // Root is always visible
    const rootNode = allNodes.find(n => n.ring === 0)
    if (rootNode) {
      visible.add(rootNode.id)

      // For each expanded node, its children are visible
      const addVisibleChildren = (nodeId: string) => {
        if (expandedNodes.has(nodeId)) {
          const node = allNodes.find(n => n.id === nodeId)
          if (node) {
            node.childIds.forEach(childId => {
              visible.add(childId)
              addVisibleChildren(childId)
            })
          }
        }
      }

      addVisibleChildren(rootNode.id)
    }

    return allNodes.filter(n => visible.has(n.id))
  }, [allNodes, expandedNodes])

  // Compute visible edges based on visible nodes
  const visibleEdges = useMemo(() => {
    const visibleIds = new Set(visibleNodes.map(n => n.id))
    return allEdges.filter(e => visibleIds.has(e.sourceId) && visibleIds.has(e.targetId))
  }, [allEdges, visibleNodes])

  // Load data and compute layout (separate from rendering)
  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const response = await fetch(DATA_FILE)
      if (!response.ok) throw new Error(`Failed to load: ${response.status}`)
      const data: GraphDataV21 = await response.json()

      // Build layout config from current state
      // useFixedRadii: true ensures sliders directly control ring positions
      const layoutConfig: LayoutConfig = {
        rings: ringConfigs,
        nodePadding,
        startAngle: -Math.PI / 2,
        totalAngle: 2 * Math.PI,
        minRingGap: MIN_RING_GAP,
        useFixedRadii: true
      }

      // Compute layout using RadialLayout algorithm
      const layoutResult = computeRadialLayout(data.nodes, layoutConfig)
      const { computedRings } = layoutResult

      // Log computed ring radii
      console.log('Computed ring radii:', computedRings.map((r, i) =>
        `Ring ${i}: ${r.radius.toFixed(0)}px (required: ${r.requiredRadius.toFixed(0)}px, nodes: ${r.nodeCount})`
      ))

      // Detect any overlaps
      const overlaps = detectOverlaps(layoutResult.nodes, computedRings, nodePadding)
      if (overlaps.length > 0) {
        console.warn(`Found ${overlaps.length} overlapping node pairs:`, overlaps.slice(0, 10))
      }

      // Compute layout statistics
      const layoutStats = computeLayoutStats(layoutResult.nodes, computedRings, nodePadding)

      // Convert to ExpandableNodes
      const expandableNodes: ExpandableNode[] = layoutResult.nodes.map(toExpandableNode)

      // Build structural edges
      const structuralEdges: StructuralEdge[] = []
      for (const layoutNode of layoutResult.nodes) {
        if (layoutNode.parent) {
          structuralEdges.push({
            sourceId: layoutNode.parent.id,
            targetId: layoutNode.id,
            sourceRing: layoutNode.parent.ring,
            targetRing: layoutNode.ring
          })
        }
      }

      // Store data for rendering
      setAllNodes(expandableNodes)
      setAllEdges(structuralEdges)
      setComputedRingsState(computedRings)

      // Count domains for legend (from indicators, layer 5)
      const counts: Record<string, number> = {}
      data.nodes.forEach(n => {
        if (n.layer === 5 && n.domain) {
          counts[n.domain] = (counts[n.domain] || 0) + 1
        }
      })
      setDomainCounts(counts)

      // Compute ring stats
      const computedRingStats = ringConfigs.map((ring, i) => ({
        label: ring.label,
        count: layoutStats.nodesPerRing.get(i) || 0,
        minDistance: layoutStats.minDistancePerRing.get(i) || 0
      }))
      setRingStats(computedRingStats)

      // Compute outcome count
      const outcomeCount = expandableNodes.filter(n => n.isOutcome).length
      const driverCount = expandableNodes.filter(n => n.isDriver).length

      setStats({
        nodes: expandableNodes.length,
        structuralEdges: structuralEdges.length,
        outcomes: outcomeCount,
        drivers: driverCount,
        overlaps: overlaps.length
      })

      setLoading(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load')
      setLoading(false)
    }
  }, [ringConfigs, nodePadding])

  // Render visible nodes and edges (called when expansion state changes)
  const renderVisualization = useCallback(() => {
    if (!svgRef.current || visibleNodes.length === 0) return

    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()

    const width = window.innerWidth
    const height = window.innerHeight
    svg.attr('width', width).attr('height', height)

    const g = svg.append('g')

    // Minimum effective font size (in screen pixels) for text to be visible
    // Text is hidden if fontSize * zoomScale < this threshold
    const MIN_READABLE_FONT_SIZE = 6

    // Zoom - preserve transform across re-renders
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.05, 4])
      .on('zoom', (event) => {
        g.attr('transform', event.transform)
        currentTransformRef.current = event.transform
        // Update label visibility per ring - if most labels in a ring are too small, hide all
        const zoomScale = event.transform.k

        // Group labels by ring and check visibility
        const labelsByRing = new Map<number, Element[]>()
        const visibleCountByRing = new Map<number, number>()
        const totalCountByRing = new Map<number, number>()

        g.selectAll('text.node-label').each(function() {
          const el = this as Element
          const label = d3.select(el)
          const ring = parseInt(label.attr('data-ring') || '0')
          const fontSize = parseFloat(label.attr('font-size') || '10')
          const effectiveSize = fontSize * zoomScale
          const isReadable = effectiveSize >= MIN_READABLE_FONT_SIZE

          if (!labelsByRing.has(ring)) {
            labelsByRing.set(ring, [])
            visibleCountByRing.set(ring, 0)
            totalCountByRing.set(ring, 0)
          }
          labelsByRing.get(ring)!.push(el)
          totalCountByRing.set(ring, (totalCountByRing.get(ring) || 0) + 1)
          if (isReadable) {
            visibleCountByRing.set(ring, (visibleCountByRing.get(ring) || 0) + 1)
          }
        })

        // Show ring labels only if majority (>50%) are readable
        for (const [ring, elements] of labelsByRing) {
          const total = totalCountByRing.get(ring) || 1
          const visible = visibleCountByRing.get(ring) || 0
          const showRing = visible / total > 0.5
          elements.forEach(el => d3.select(el).style('opacity', showRing ? 1 : 0))
        }
      })

    zoomRef.current = zoom
    svg.call(zoom)

    // Only set initial zoom if no transform exists yet
    if (currentTransformRef.current) {
      // Restore previous transform
      svg.call(zoom.transform, currentTransformRef.current)
    } else {
      // Initial view - center on visible nodes with appropriate zoom
      const visibleWithPosition = visibleNodes.filter(n => n.x !== 0 || n.y !== 0)
      const maxRadius = visibleWithPosition.length > 0
        ? Math.max(...visibleWithPosition.map(n => Math.sqrt(n.x * n.x + n.y * n.y)))
        : 100
      const scale = Math.min(width, height) / (Math.max(maxRadius * 2.5, 200))
      const initialTransform = d3.zoomIdentity.translate(width / 2, height / 2).scale(scale)
      svg.call(zoom.transform, initialTransform)
      currentTransformRef.current = initialTransform
    }

    // Draw ring circles for visible rings only
    const visibleRings = new Set(visibleNodes.map(n => n.ring))
    computedRingsState.slice(1).forEach((ring, i) => {
      const ringIndex = i + 1
      if (!visibleRings.has(ringIndex)) return

      g.append('circle')
        .attr('cx', 0)
        .attr('cy', 0)
        .attr('r', ring.radius)
        .attr('fill', 'none')
        .attr('stroke', '#e5e5e5')
        .attr('stroke-width', 1.5)

      g.append('text')
        .attr('x', 0)
        .attr('y', -ring.radius - 12)
        .attr('text-anchor', 'middle')
        .attr('font-size', 12)
        .attr('font-weight', 'bold')
        .attr('fill', '#888')
        .text(`${ring.label || ringConfigs[ringIndex]?.label || ''}`)
    })

    // Build node map for edge lookups
    const nodeMap = new Map<string, ExpandableNode>()
    visibleNodes.forEach(n => nodeMap.set(n.id, n))

    // Draw structural edges (tree skeleton)
    g.append('g')
      .attr('class', 'structural-edges')
      .selectAll('line')
      .data(visibleEdges)
      .enter()
      .append('line')
      .attr('x1', d => nodeMap.get(d.sourceId)?.x || 0)
      .attr('y1', d => nodeMap.get(d.sourceId)?.y || 0)
      .attr('x2', d => nodeMap.get(d.targetId)?.x || 0)
      .attr('y2', d => nodeMap.get(d.targetId)?.y || 0)
      .attr('stroke', '#ccc')
      .attr('stroke-width', d => d.sourceRing <= 2 ? 2 : (d.sourceRing <= 4 ? 1 : 0.5))
      .attr('stroke-opacity', d => d.sourceRing <= 2 ? 0.6 : (d.sourceRing <= 4 ? 0.3 : 0.15))
      .style('pointer-events', 'none')

    // Node styling - all nodes colored by domain
    const getColor = (n: ExpandableNode): string => {
      if (n.ring === 0) return '#78909C' // Muted blue-grey for root
      return DOMAIN_COLORS[n.semanticPath.domain] || '#9E9E9E'
    }

    /**
     * Get node size based on SHAP importance and per-ring multiplier.
     * Uses area-proportional sizing: radius = min + (max - min) * sqrt(importance)
     * This ensures visual area is proportional to importance value.
     */
    const getSize = (n: ExpandableNode): number => {
      const baseRange = BASE_SIZE_RANGES[n.ring] || { min: 2, max: 8 }
      const multiplier = nodeSizeMultipliers[n.ring] || 1
      const importance = n.importance || 0

      // Apply multiplier to both min and max
      const min = baseRange.min * multiplier
      const max = baseRange.max * multiplier

      // Area-proportional: radius scales with sqrt(importance)
      // so that visual area (π*r²) is proportional to importance
      return min + (max - min) * Math.sqrt(importance)
    }

    // Draw nodes
    g.selectAll('circle.node')
      .data(visibleNodes)
      .enter()
      .append('circle')
      .attr('class', 'node')
      .attr('cx', d => d.x)
      .attr('cy', d => d.y)
      .attr('r', d => getSize(d))
      .attr('fill', d => getColor(d))
      .attr('stroke', '#fff')
      .attr('stroke-width', 0.5)
      .style('cursor', d => d.hasChildren ? 'pointer' : 'default')
      .on('click', (event, d) => {
        event.stopPropagation()
        if (d.hasChildren) {
          toggleExpansion(d.id)
        }
      })
      .on('mouseenter', function(_, d) {
        d3.select(this).attr('r', getSize(d) * 1.5)
        setHoveredNode(d)
      })
      .on('mouseleave', function(_, d) {
        d3.select(this).attr('r', getSize(d))
        setHoveredNode(null)
      })

    // Labels for children of expanded nodes (so you can read what just appeared)
    // Text size is proportional to node size
    const labelNodes = visibleNodes.filter(n => {
      // Root always has label
      if (n.ring === 0) return true
      // Show label if parent is expanded (these are the children we want to read)
      if (n.parentId && expandedNodes.has(n.parentId)) return true
      return false
    })

    // Get current zoom scale for initial label visibility
    const currentScale = currentTransformRef.current?.k ?? 1

    // Pre-compute label positions for all label nodes (avoid repeated calculations)
    // Text size scales with node size but capped to avoid overly large labels
    const labelPositions = new Map<string, { x: number; y: number; anchor: string; rotation: number; fontSize: number }>()
    for (const d of labelNodes) {
      const nodeSize = getSize(d)
      // Smaller text: use nodeSize * 0.5 with lower min/max bounds
      const baseSize = Math.min(Math.max(nodeSize * 0.5, 5), 10)
      // Ring 5 gets much smaller text, ring 4 slightly smaller
      const fontSize = d.ring === 5 ? baseSize * 0.35 : (d.ring === 4 ? baseSize * 0.7 : baseSize)

      if (d.ring <= 1) {
        const offset = nodeSize + fontSize * 0.5 + 4
        labelPositions.set(d.id, { x: d.x, y: d.y + offset, anchor: 'middle', rotation: 0, fontSize })
      } else {
        const offset = nodeSize + fontSize * 0.3 + 2
        const angle = Math.atan2(d.y, d.x)
        const angleDeg = angle * (180 / Math.PI)
        const labelX = d.x + Math.cos(angle) * offset
        const labelY = d.y + Math.sin(angle) * offset

        let rotation = angleDeg
        let anchor: 'start' | 'end' = 'start'
        if (Math.abs(angleDeg) > 90) {
          rotation = angleDeg + 180
          anchor = 'end'
        }
        labelPositions.set(d.id, { x: labelX, y: labelY, anchor, rotation, fontSize })
      }
    }

    // Calculate per-ring visibility for initial render
    const visibleCountByRing = new Map<number, number>()
    const totalCountByRing = new Map<number, number>()
    for (const d of labelNodes) {
      const pos = labelPositions.get(d.id)!
      const effectiveSize = pos.fontSize * currentScale
      const isReadable = effectiveSize >= MIN_READABLE_FONT_SIZE
      totalCountByRing.set(d.ring, (totalCountByRing.get(d.ring) || 0) + 1)
      if (isReadable) {
        visibleCountByRing.set(d.ring, (visibleCountByRing.get(d.ring) || 0) + 1)
      }
    }
    const ringVisibility = new Map<number, boolean>()
    for (const [ring, total] of totalCountByRing) {
      const visible = visibleCountByRing.get(ring) || 0
      ringVisibility.set(ring, visible / total > 0.5)
    }

    g.selectAll('text.node-label')
      .data(labelNodes)
      .enter()
      .append('text')
      .attr('class', 'node-label')
      .each(function(d) {
        const pos = labelPositions.get(d.id)!
        const isVisible = ringVisibility.get(d.ring) ?? false
        d3.select(this)
          .attr('x', pos.x)
          .attr('y', pos.y)
          .attr('text-anchor', pos.anchor)
          .attr('transform', pos.rotation !== 0 ? `rotate(${pos.rotation}, ${pos.x}, ${pos.y})` : null)
          .attr('font-size', pos.fontSize)
          .attr('font-weight', d.ring <= 1 ? 'bold' : 'normal')
          .attr('fill', '#333')
          .attr('data-ring', d.ring)
          .style('opacity', isVisible ? 1 : 0)
          .style('pointer-events', 'none')
          .text(d.label)
      })

  }, [visibleNodes, visibleEdges, computedRingsState, ringConfigs, expandedNodes, toggleExpansion, nodeSizeMultipliers])

  // Load data when config changes
  useEffect(() => {
    loadData()
  }, [loadData])

  // Re-render when visible nodes change (expansion state changes)
  useEffect(() => {
    renderVisualization()
  }, [renderVisualization])

  return (
    <div style={{ width: '100vw', height: '100vh', overflow: 'hidden', background: '#fafafa' }}>
      <div style={{
        position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)',
        background: 'white', padding: '10px 20px', borderRadius: 4,
        boxShadow: '0 2px 4px rgba(0,0,0,0.1)', zIndex: 100
      }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>Quality of Life - Semantic Hierarchy</h2>
        <div style={{ fontSize: 11, color: '#666', textAlign: 'center', marginTop: 4 }}>
          Click nodes to expand • Hover for details
        </div>
      </div>

      {loading && <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }}>Loading...</div>}
      {error && <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', color: 'red' }}>Error: {error}</div>}

      {stats && (
        <div style={{ position: 'absolute', top: 70, left: 10, background: 'white', padding: 12, borderRadius: 4, boxShadow: '0 2px 4px rgba(0,0,0,0.1)', fontSize: 13 }}>
          <div><strong>Visible:</strong> {visibleNodes.length.toLocaleString()} / {stats.nodes.toLocaleString()}</div>
          <div><strong>Outcomes:</strong> {stats.outcomes}</div>
          <div><strong>Drivers:</strong> {stats.drivers.toLocaleString()}</div>
          <div style={{ marginTop: 6, color: stats.overlaps > 0 ? '#e53935' : '#4caf50' }}>
            <strong>Overlaps:</strong> {stats.overlaps === 0 ? 'None ✓' : stats.overlaps}
          </div>
          <div style={{ marginTop: 10, fontSize: 11, color: '#666' }}>Scroll to zoom, drag to pan</div>
        </div>
      )}

      {ringStats.length > 0 && (
        <div style={{ position: 'absolute', top: 210, left: 10, background: 'white', padding: 12, borderRadius: 4, boxShadow: '0 2px 4px rgba(0,0,0,0.1)', fontSize: 12, maxWidth: 220 }}>
          <div style={{ fontWeight: 'bold', marginBottom: 8, fontSize: 13 }}>Rings ({ringStats.length})</div>
          {ringStats.map((ring, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3, paddingBottom: 3, borderBottom: i < ringStats.length - 1 ? '1px solid #eee' : 'none' }}>
              <span style={{ color: '#555' }}>{i}: {ring.label}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ fontWeight: 'bold', color: '#333', marginRight: 4 }}>{ring.count.toLocaleString()}</span>
                {i < ringStats.length - 1 && (
                  <>
                    <button
                      onClick={() => expandRing(i)}
                      style={{ padding: '1px 4px', fontSize: 10, cursor: 'pointer', border: '1px solid #ccc', borderRadius: 2, background: '#f5f5f5' }}
                      title={`Expand all ${ring.label}`}
                    >+</button>
                    <button
                      onClick={() => collapseRing(i)}
                      style={{ padding: '1px 4px', fontSize: 10, cursor: 'pointer', border: '1px solid #ccc', borderRadius: 2, background: '#f5f5f5' }}
                      title={`Collapse all ${ring.label}`}
                    >−</button>
                  </>
                )}
              </div>
            </div>
          ))}
          <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
            <button
              onClick={expandAll}
              style={{ flex: 1, padding: '4px 8px', fontSize: 11, cursor: 'pointer', border: '1px solid #ccc', borderRadius: 3, background: '#f5f5f5' }}
            >Expand All</button>
            <button
              onClick={collapseAll}
              style={{ flex: 1, padding: '4px 8px', fontSize: 11, cursor: 'pointer', border: '1px solid #ccc', borderRadius: 3, background: '#f5f5f5' }}
            >Collapse All</button>
          </div>
        </div>
      )}

      {/* Domain Legend - Top right */}
      {Object.keys(domainCounts).length > 0 && (
        <div style={{ position: 'absolute', top: 70, right: 10, background: 'white', padding: 12, borderRadius: 4, boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
          <div style={{ fontWeight: 'bold', marginBottom: 8, fontSize: 13 }}>Domains</div>
          {Object.entries(domainCounts).sort((a, b) => b[1] - a[1]).map(([domain, count]) => (
            <div key={domain} style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
              <div style={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: DOMAIN_COLORS[domain] || '#9E9E9E', marginRight: 8 }} />
              <span style={{ fontSize: 12 }}>{domain}</span>
              <span style={{ fontSize: 11, color: '#888', marginLeft: 6 }}>({count})</span>
            </div>
          ))}
        </div>
      )}


      <svg ref={svgRef} style={{ width: '100%', height: '100%' }} />

      {/* Hover tooltip panel */}
      {hoveredNode && (
        <div style={{
          position: 'absolute', bottom: 20, left: '50%', transform: 'translateX(-50%)',
          background: 'white', padding: '12px 16px', borderRadius: 8,
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)', maxWidth: 400, zIndex: 100,
          pointerEvents: 'none'
        }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
            <span style={{ padding: '2px 8px', borderRadius: 4, backgroundColor: '#eee', fontSize: 11 }}>
              {ringConfigs[hoveredNode.ring]?.label || `Ring ${hoveredNode.ring}`}
            </span>
            {hoveredNode.semanticPath.domain && (
              <span style={{ padding: '2px 8px', borderRadius: 4, backgroundColor: DOMAIN_COLORS[hoveredNode.semanticPath.domain] || '#9E9E9E', color: 'white', fontSize: 11, fontWeight: 'bold' }}>
                {hoveredNode.semanticPath.domain}
              </span>
            )}
            {hoveredNode.importance > 0 && (
              <span style={{ padding: '2px 8px', borderRadius: 4, backgroundColor: '#4CAF50', color: 'white', fontSize: 11 }}>
                Importance: {(hoveredNode.importance * 100).toFixed(1)}%
              </span>
            )}
            {hoveredNode.hasChildren && (
              <span style={{ padding: '2px 8px', borderRadius: 4, backgroundColor: expandedNodes.has(hoveredNode.id) ? '#2196F3' : '#666', color: 'white', fontSize: 11 }}>
                {expandedNodes.has(hoveredNode.id) ? 'Click to collapse' : `Click to expand (${hoveredNode.childIds.length} children)`}
              </span>
            )}
          </div>
          <div style={{ fontWeight: 'bold', fontSize: 14, marginBottom: 2 }}>{hoveredNode.label}</div>
          {hoveredNode.description && (
            <div style={{ fontSize: 12, color: '#666' }}>{hoveredNode.description}</div>
          )}
        </div>
      )}
    </div>
  )
}

export default App
