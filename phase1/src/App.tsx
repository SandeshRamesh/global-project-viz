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
 */

// Default ring configuration for v2.1 with node sizes
const DEFAULT_RING_CONFIGS = [
  { radius: 0, nodeSize: 15, label: 'Quality of Life' },  // Ring 0: Root at center
  { radius: 180, nodeSize: 12, label: 'Outcomes' },  // Ring 1
  { radius: 380, nodeSize: 8, label: 'Coarse Domains' },  // Ring 2
  { radius: 650, nodeSize: 6, label: 'Fine Domains' },    // Ring 3
  { radius: 1000, nodeSize: 5, label: 'Indicator Groups' }, // Ring 4
  { radius: 1450, nodeSize: 3, label: 'Indicators' },  // Ring 5
]

/** Extended PositionedNode with parent reference for expansion logic */
interface ExpandableNode extends PositionedNode {
  parentId: string | null
  childIds: string[]
  hasChildren: boolean
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

const DATA_FILE = '/data/v2_1_visualization_final.json'

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

  // Layout configuration state
  const [ringConfigs] = useState(DEFAULT_RING_CONFIGS)
  const [nodePadding] = useState(DEFAULT_NODE_PADDING)

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
      const layoutConfig: LayoutConfig = {
        rings: ringConfigs,
        nodePadding,
        startAngle: -Math.PI / 2,
        totalAngle: 2 * Math.PI,
        minRingGap: MIN_RING_GAP
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

    // Minimum zoom scale at which labels are visible
    const LABEL_VISIBILITY_THRESHOLD = 0.5

    // Track last label visibility state to avoid unnecessary DOM updates
    let labelsCurrentlyVisible = true

    // Zoom - preserve transform across re-renders
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.05, 4])
      .on('zoom', (event) => {
        g.attr('transform', event.transform)
        currentTransformRef.current = event.transform
        // Only update label visibility when crossing threshold
        const shouldShowLabels = event.transform.k >= LABEL_VISIBILITY_THRESHOLD
        if (shouldShowLabels !== labelsCurrentlyVisible) {
          labelsCurrentlyVisible = shouldShowLabels
          g.selectAll('text.node-label').style('opacity', shouldShowLabels ? 1 : 0)
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

    const getSize = (n: ExpandableNode): number => {
      return computedRingsState[n.ring]?.nodeSize || 3
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
      .attr('stroke', d => {
        if (expandedNodes.has(d.id)) return '#2196F3' // Blue border for expanded
        if (d.hasChildren) return '#333' // Dark border for expandable
        return '#fff'
      })
      .attr('stroke-width', d => {
        if (expandedNodes.has(d.id)) return 3
        if (d.hasChildren) return 2
        return 0.5
      })
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
    const labelsVisible = currentScale >= LABEL_VISIBILITY_THRESHOLD

    // Pre-compute label positions for all label nodes (avoid repeated calculations)
    const labelPositions = new Map<string, { x: number; y: number; anchor: string; rotation: number; fontSize: number }>()
    for (const d of labelNodes) {
      const nodeSize = getSize(d)
      const baseSize = Math.max(nodeSize * 0.9, 8)
      const fontSize = d.ring === 5 ? baseSize * 0.7 : baseSize

      if (d.ring <= 1) {
        const offset = nodeSize + fontSize * 0.6 + 8
        labelPositions.set(d.id, { x: d.x, y: d.y + offset, anchor: 'middle', rotation: 0, fontSize })
      } else {
        const offset = nodeSize + fontSize * 0.4 + 4
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

    g.selectAll('text.node-label')
      .data(labelNodes)
      .enter()
      .append('text')
      .attr('class', 'node-label')
      .each(function(d) {
        const pos = labelPositions.get(d.id)!
        d3.select(this)
          .attr('x', pos.x)
          .attr('y', pos.y)
          .attr('text-anchor', pos.anchor)
          .attr('transform', pos.rotation !== 0 ? `rotate(${pos.rotation}, ${pos.x}, ${pos.y})` : null)
          .attr('font-size', pos.fontSize)
          .attr('font-weight', d.ring <= 1 ? 'bold' : 'normal')
          .attr('fill', '#333')
          .style('opacity', labelsVisible ? 1 : 0)
          .style('pointer-events', 'none')
          .text(d.label)
      })

  }, [visibleNodes, visibleEdges, computedRingsState, ringConfigs, expandedNodes, toggleExpansion])

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
