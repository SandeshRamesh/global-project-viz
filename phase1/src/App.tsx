import { useEffect, useRef, useState, useCallback } from 'react'
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
import { LayoutControls } from './components/LayoutControls'

/**
 * Semantic hierarchy visualization with concentric rings - v2.1 only
 * 6 rings: Root → Outcomes → Coarse Domains → Fine Domains → Indicator Groups → Indicators
 */

// Default ring configuration for v2.1 with node sizes
const DEFAULT_RING_CONFIGS = [
  { radius: 0, nodeSize: 15, label: 'Root' },        // Ring 0: Root at center
  { radius: 180, nodeSize: 12, label: 'Outcomes' },  // Ring 1
  { radius: 380, nodeSize: 8, label: 'Coarse Domains' },  // Ring 2
  { radius: 650, nodeSize: 6, label: 'Fine Domains' },    // Ring 3
  { radius: 1000, nodeSize: 5, label: 'Indicator Groups' }, // Ring 4
  { radius: 1450, nodeSize: 3, label: 'Indicators' },  // Ring 5
]

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

const DEFAULT_NODE_PADDING = 2
const MIN_RING_GAP = 80

/**
 * Converts a LayoutNode to a PositionedNode for rendering
 */
function toPositionedNode(layoutNode: LayoutNode): PositionedNode {
  const raw = layoutNode.rawNode
  return {
    id: layoutNode.id,
    label: raw.label.replace(/_/g, ' '),
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
    y: layoutNode.y
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
  const [selectedNode, setSelectedNode] = useState<PositionedNode | null>(null)
  const [ringStats, setRingStats] = useState<Array<{ label: string; count: number; minDistance: number }>>([])

  // Layout configuration state - can be modified via sliders
  const [ringConfigs, setRingConfigs] = useState(DEFAULT_RING_CONFIGS)
  const [nodePadding, setNodePadding] = useState(DEFAULT_NODE_PADDING)

  const loadAndRender = useCallback(async () => {
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

      // Convert to PositionedNodes
      const positionedNodes: PositionedNode[] = layoutResult.nodes.map(toPositionedNode)
      const nodeMap = new Map<string, PositionedNode>()
      positionedNodes.forEach(n => nodeMap.set(n.id, n))

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
      const outcomeCount = positionedNodes.filter(n => n.isOutcome).length
      const driverCount = positionedNodes.filter(n => n.isDriver).length

      setStats({
        nodes: positionedNodes.length,
        structuralEdges: structuralEdges.length,
        outcomes: outcomeCount,
        drivers: driverCount,
        overlaps: overlaps.length
      })

      // === D3 Rendering ===
      if (!svgRef.current) return
      const svg = d3.select(svgRef.current)
      svg.selectAll('*').remove()

      const width = window.innerWidth
      const height = window.innerHeight
      svg.attr('width', width).attr('height', height)

      const g = svg.append('g')

      // Zoom
      const zoom = d3.zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.05, 4])
        .on('zoom', (event) => g.attr('transform', event.transform))

      svg.call(zoom)

      // Initial view - find max radius dynamically
      const maxRadius = Math.max(...positionedNodes.map(n => Math.sqrt(n.x * n.x + n.y * n.y)))
      const scale = Math.min(width, height) / (maxRadius * 2.5)
      svg.call(zoom.transform, d3.zoomIdentity.translate(width / 2, height / 2).scale(scale))

      // Draw ring circles using computed radii (skip ring 0 which is at center)
      computedRings.slice(1).forEach((ring, i) => {
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
          .text(`Ring ${i + 1}: ${ring.label || ringConfigs[i + 1]?.label || ''}`)
      })

      // Draw structural edges (tree skeleton)
      g.append('g')
        .attr('class', 'structural-edges')
        .selectAll('line')
        .data(structuralEdges)
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
      const getColor = (n: PositionedNode): string => {
        return DOMAIN_COLORS[n.semanticPath.domain] || '#9E9E9E'
      }

      const getSize = (n: PositionedNode): number => {
        return computedRings[n.ring]?.nodeSize || 3
      }

      // Draw nodes
      g.selectAll('circle.node')
        .data(positionedNodes)
        .enter()
        .append('circle')
        .attr('class', 'node')
        .attr('cx', d => d.x)
        .attr('cy', d => d.y)
        .attr('r', d => getSize(d))
        .attr('fill', d => getColor(d))
        .attr('stroke', d => d.ring <= 1 ? '#333' : '#fff')
        .attr('stroke-width', d => d.ring <= 1 ? 1.5 : 0.5)
        .style('cursor', 'pointer')
        .on('click', (_, d) => setSelectedNode(d))
        .on('mouseenter', function(_, d) {
          d3.select(this).attr('r', getSize(d) * 1.5)
        })
        .on('mouseleave', function(_, d) {
          d3.select(this).attr('r', getSize(d))
        })

      // Labels for ring 1 only
      g.selectAll('text.node-label')
        .data(positionedNodes.filter(n => n.ring === 1))
        .enter()
        .append('text')
        .attr('class', 'node-label')
        .attr('x', d => d.x)
        .attr('y', d => d.y + getSize(d) + 14)
        .attr('text-anchor', 'middle')
        .attr('font-size', 11)
        .attr('font-weight', 'bold')
        .attr('fill', '#333')
        .text(d => d.label)

      setLoading(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load')
      setLoading(false)
    }
  }, [ringConfigs, nodePadding])

  useEffect(() => {
    loadAndRender()
  }, [loadAndRender])

  return (
    <div style={{ width: '100vw', height: '100vh', overflow: 'hidden', background: '#fafafa' }}>
      <div style={{
        position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)',
        background: 'white', padding: '10px 20px', borderRadius: 4,
        boxShadow: '0 2px 4px rgba(0,0,0,0.1)', zIndex: 100
      }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>Semantic Hierarchy v2.1 - Radial Layout</h2>
      </div>

      {loading && <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }}>Loading...</div>}
      {error && <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', color: 'red' }}>Error: {error}</div>}

      {stats && (
        <div style={{ position: 'absolute', top: 60, left: 10, background: 'white', padding: 12, borderRadius: 4, boxShadow: '0 2px 4px rgba(0,0,0,0.1)', fontSize: 13 }}>
          <div><strong>Total Nodes:</strong> {stats.nodes.toLocaleString()}</div>
          <div><strong>Structural Edges:</strong> {stats.structuralEdges.toLocaleString()}</div>
          <div><strong>Outcomes:</strong> {stats.outcomes}</div>
          <div><strong>Drivers:</strong> {stats.drivers.toLocaleString()}</div>
          <div style={{ marginTop: 6, color: stats.overlaps > 0 ? '#e53935' : '#4caf50' }}>
            <strong>Overlaps:</strong> {stats.overlaps === 0 ? 'None ✓' : stats.overlaps}
          </div>
          <div style={{ marginTop: 10, fontSize: 11, color: '#666' }}>Scroll to zoom, drag to pan</div>
        </div>
      )}

      {ringStats.length > 0 && (
        <div style={{ position: 'absolute', top: 220, left: 10, background: 'white', padding: 12, borderRadius: 4, boxShadow: '0 2px 4px rgba(0,0,0,0.1)', fontSize: 12, maxWidth: 220 }}>
          <div style={{ fontWeight: 'bold', marginBottom: 8, fontSize: 13 }}>Rings ({ringStats.length})</div>
          {ringStats.map((ring, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3, paddingBottom: 3, borderBottom: i < ringStats.length - 1 ? '1px solid #eee' : 'none' }}>
              <span style={{ color: '#555' }}>{i}: {ring.label}</span>
              <span style={{ fontWeight: 'bold', color: '#333' }}>{ring.count.toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}

      {Object.keys(domainCounts).length > 0 && (
        <div style={{ position: 'absolute', top: 60, right: 10, background: 'white', padding: 12, borderRadius: 4, boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
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

      {/* Layout Controls */}
      <LayoutControls
        ringConfigs={ringConfigs}
        nodePadding={nodePadding}
        onRingConfigChange={setRingConfigs}
        onNodePaddingChange={setNodePadding}
      />

      <svg ref={svgRef} style={{ width: '100%', height: '100%' }} />

      {selectedNode && (
        <div style={{
          position: 'absolute', bottom: 20, left: '50%', transform: 'translateX(-50%)',
          background: 'white', padding: '16px 20px', borderRadius: 8,
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)', maxWidth: 500, zIndex: 100
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <span style={{ padding: '2px 8px', borderRadius: 4, backgroundColor: '#eee', fontSize: 11 }}>
                Ring {selectedNode.ring}: {ringConfigs[selectedNode.ring]?.label || 'Unknown'}
              </span>
              {selectedNode.semanticPath.domain && (
                <span style={{ padding: '2px 8px', borderRadius: 4, backgroundColor: DOMAIN_COLORS[selectedNode.semanticPath.domain] || '#9E9E9E', color: 'white', fontSize: 11, fontWeight: 'bold' }}>
                  {selectedNode.semanticPath.domain}
                </span>
              )}
            </div>
            <button onClick={() => setSelectedNode(null)} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: '#999' }}>×</button>
          </div>
          <div style={{ fontWeight: 'bold', fontSize: 15, marginBottom: 4 }}>{selectedNode.label}</div>
          <div style={{ fontSize: 12, color: '#666', marginBottom: 8 }}>{selectedNode.description}</div>
          <div style={{ fontFamily: 'monospace', fontSize: 11, color: '#888', padding: '6px 8px', background: '#f5f5f5', borderRadius: 4 }}>
            {selectedNode.semanticPath.full_path}
          </div>
        </div>
      )}
    </div>
  )
}

export default App
