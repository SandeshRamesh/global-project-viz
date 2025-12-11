import { useEffect, useRef, useState, useCallback } from 'react'
import * as d3 from 'd3'
import './App.css'

/**
 * Semantic hierarchy visualization with concentric rings - v2.1 only
 * 6 rings: Root → Outcomes → Coarse Domains → Fine Domains → Indicator Groups → Indicators
 */

interface SemanticPath {
  domain: string
  subdomain: string
  fine_cluster: string
  full_path: string
}

interface RawNodeV21 {
  id: string | number
  label: string
  description?: string
  layer: number
  node_type: 'root' | 'outcome_category' | 'coarse_domain' | 'fine_domain' | 'indicator'
  domain: string | null
  subdomain: string | null
  shap_importance: number
  in_degree: number
  out_degree: number
  label_source: string
  parent?: string | number
  children?: (string | number)[]
  indicator_count?: number
}

interface RawEdge {
  source: string
  target: string
  weight?: number
  relationship?: 'causal' | 'hierarchical'
}

interface GraphDataV21 {
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

interface PositionedNode {
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

interface StructuralEdge {
  sourceId: string
  targetId: string
  sourceRing: number
  targetRing: number
}

// Ring configuration for v2.1
const RING_CONFIGS = [
  { radius: 50, label: 'Root' },
  { radius: 180, label: 'Outcomes' },
  { radius: 380, label: 'Coarse Domains' },
  { radius: 650, label: 'Fine Domains' },
  { radius: 1000, label: 'Indicator Groups' },
  { radius: 1450, label: 'Indicators' },
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

const DATA_FILE = '/v2_1_visualization_final.json'

function App() {
  const svgRef = useRef<SVGSVGElement>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [stats, setStats] = useState<{ nodes: number; structuralEdges: number; outcomes: number; drivers: number } | null>(null)
  const [domainCounts, setDomainCounts] = useState<Record<string, number>>({})
  const [selectedNode, setSelectedNode] = useState<PositionedNode | null>(null)
  const [ringStats, setRingStats] = useState<Array<{ label: string; count: number }>>([])

  const loadAndRender = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const response = await fetch(DATA_FILE)
      if (!response.ok) throw new Error(`Failed to load: ${response.status}`)
      const data: GraphDataV21 = await response.json()

      const positionedNodes: PositionedNode[] = []
      const nodeMap = new Map<string, PositionedNode>()
      const structuralEdges: StructuralEdge[] = []

      // Helper to add node to map
      const addNode = (node: PositionedNode) => {
        positionedNodes.push(node)
        nodeMap.set(node.id, node)
      }

      // Group nodes by layer
      const nodesByLayer: Record<number, RawNodeV21[]> = {}
      data.nodes.forEach(n => {
        if (!nodesByLayer[n.layer]) nodesByLayer[n.layer] = []
        nodesByLayer[n.layer].push(n)
      })

      // Count domains for legend (from indicators, layer 5)
      const counts: Record<string, number> = {}
      ;(nodesByLayer[5] || []).forEach(n => {
        if (n.domain) counts[n.domain] = (counts[n.domain] || 0) + 1
      })
      setDomainCounts(counts)

      // Build parent-children mapping
      const childrenByParent = new Map<string | number, RawNodeV21[]>()
      data.nodes.forEach(n => {
        if (n.parent !== undefined) {
          const parentKey = String(n.parent)
          if (!childrenByParent.has(parentKey)) childrenByParent.set(parentKey, [])
          childrenByParent.get(parentKey)!.push(n)
        }
      })

      // Layer 0: Root (single node at center)
      const rootNodes = nodesByLayer[0] || []
      rootNodes.forEach(n => {
        addNode({
          id: String(n.id),
          label: n.label,
          description: n.description || 'Root',
          semanticPath: { domain: '', subdomain: '', fine_cluster: '', full_path: 'Root' },
          isDriver: false,
          isOutcome: false,
          shapImportance: n.shap_importance,
          degree: n.out_degree,
          ring: 0,
          x: 0,
          y: 0
        })
      })

      // Layer 1: Outcomes (9 QoL categories) - evenly distributed
      const outcomeNodes = nodesByLayer[1] || []
      outcomeNodes.forEach((n, i) => {
        const angle = (2 * Math.PI * i) / Math.max(outcomeNodes.length, 1)
        const r = RING_CONFIGS[1].radius
        addNode({
          id: String(n.id),
          label: n.label,
          description: n.description || `${n.indicator_count || 0} indicators`,
          semanticPath: { domain: n.domain || '', subdomain: '', fine_cluster: '', full_path: n.label },
          isDriver: false,
          isOutcome: true,
          shapImportance: n.shap_importance,
          degree: n.out_degree,
          ring: 1,
          x: r * Math.cos(angle - Math.PI / 2),
          y: r * Math.sin(angle - Math.PI / 2)
        })
        // Edge from root to outcome
        if (n.parent !== undefined) {
          structuralEdges.push({ sourceId: String(n.parent), targetId: String(n.id), sourceRing: 0, targetRing: 1 })
        }
      })

      // Layer 2: Coarse Domains - position near their parent outcome
      const coarseNodes = nodesByLayer[2] || []
      outcomeNodes.forEach(outcome => {
        const parentNode = nodeMap.get(String(outcome.id))
        if (!parentNode) return
        const parentAngle = Math.atan2(parentNode.y, parentNode.x) + Math.PI / 2
        const children = childrenByParent.get(String(outcome.id)) || []
        const coarseChildren = children.filter(c => c.layer === 2)
        const angleSpread = (2 * Math.PI / outcomeNodes.length) * 0.85

        coarseChildren.forEach((n, i) => {
          const angleOffset = (i - (coarseChildren.length - 1) / 2) * (angleSpread / Math.max(coarseChildren.length - 1, 1))
          const angle = parentAngle + angleOffset
          const r = RING_CONFIGS[2].radius
          addNode({
            id: String(n.id),
            label: n.label.replace(/_/g, ' '),
            description: n.description || `Coarse Domain: ${n.label}`,
            semanticPath: { domain: n.domain || '', subdomain: '', fine_cluster: '', full_path: n.label },
            isDriver: false,
            isOutcome: false,
            shapImportance: n.shap_importance,
            degree: n.out_degree,
            ring: 2,
            x: r * Math.cos(angle - Math.PI / 2),
            y: r * Math.sin(angle - Math.PI / 2)
          })
          structuralEdges.push({ sourceId: String(outcome.id), targetId: String(n.id), sourceRing: 1, targetRing: 2 })
        })
      })

      // Layer 3: Fine Domains - position near their parent coarse domain
      const fineNodes = nodesByLayer[3] || []
      coarseNodes.forEach(coarse => {
        const parentNode = nodeMap.get(String(coarse.id))
        if (!parentNode) return
        const parentAngle = Math.atan2(parentNode.y, parentNode.x) + Math.PI / 2
        const children = childrenByParent.get(String(coarse.id)) || []
        const fineChildren = children.filter(c => c.layer === 3)
        const angleSpread = 0.25

        fineChildren.forEach((n, i) => {
          const angleOffset = (i - (fineChildren.length - 1) / 2) * (angleSpread / Math.max(fineChildren.length - 1, 1))
          const angle = parentAngle + angleOffset
          const r = RING_CONFIGS[3].radius
          addNode({
            id: String(n.id),
            label: n.label.replace(/_/g, ' '),
            description: n.description || `Fine Domain: ${n.label}`,
            semanticPath: { domain: n.domain || '', subdomain: n.subdomain || '', fine_cluster: n.label, full_path: n.label },
            isDriver: false,
            isOutcome: false,
            shapImportance: n.shap_importance,
            degree: n.out_degree,
            ring: 3,
            x: r * Math.cos(angle - Math.PI / 2),
            y: r * Math.sin(angle - Math.PI / 2)
          })
          structuralEdges.push({ sourceId: String(coarse.id), targetId: String(n.id), sourceRing: 2, targetRing: 3 })
        })
      })

      // Layer 4: Indicator Groups - position near their parent fine domain
      const indicatorGroupNodes = nodesByLayer[4] || []
      fineNodes.forEach(fine => {
        const parentNode = nodeMap.get(String(fine.id))
        if (!parentNode) return
        const parentAngle = Math.atan2(parentNode.y, parentNode.x) + Math.PI / 2
        const children = childrenByParent.get(String(fine.id)) || []
        const groupChildren = children.filter(c => c.layer === 4)
        const angleSpread = 0.15

        groupChildren.forEach((n, i) => {
          const angleOffset = (i - (groupChildren.length - 1) / 2) * (angleSpread / Math.max(groupChildren.length - 1, 1))
          const angle = parentAngle + angleOffset
          const r = RING_CONFIGS[4].radius
          addNode({
            id: String(n.id),
            label: n.label.replace(/_/g, ' '),
            description: n.description || `Indicator Group: ${n.label}`,
            semanticPath: { domain: n.domain || '', subdomain: n.subdomain || '', fine_cluster: String(fine.id), full_path: n.label },
            isDriver: false,
            isOutcome: false,
            shapImportance: n.shap_importance,
            degree: n.in_degree + n.out_degree,
            ring: 4,
            x: r * Math.cos(angle - Math.PI / 2),
            y: r * Math.sin(angle - Math.PI / 2)
          })
          structuralEdges.push({ sourceId: String(fine.id), targetId: String(n.id), sourceRing: 3, targetRing: 4 })
        })
      })

      // Layer 5: Indicators - position near their parent indicator group
      indicatorGroupNodes.forEach(group => {
        const parentNode = nodeMap.get(String(group.id))
        if (!parentNode) return
        const parentAngle = Math.atan2(parentNode.y, parentNode.x) + Math.PI / 2
        const children = childrenByParent.get(String(group.id)) || []
        const indicatorChildren = children.filter(c => c.layer === 5)
        const angleSpread = 0.08

        indicatorChildren.forEach((n, i) => {
          const angleOffset = (i - (indicatorChildren.length - 1) / 2) * (angleSpread / Math.max(indicatorChildren.length - 1, 1))
          const angle = parentAngle + angleOffset
          const r = RING_CONFIGS[5].radius
          addNode({
            id: String(n.id),
            label: n.label,
            description: n.description || '',
            semanticPath: { domain: n.domain || '', subdomain: n.subdomain || '', fine_cluster: String(group.id), full_path: n.label },
            isDriver: n.node_type === 'indicator' && n.out_degree > 0,
            isOutcome: false,
            shapImportance: n.shap_importance,
            degree: n.in_degree + n.out_degree,
            ring: 5,
            x: r * Math.cos(angle - Math.PI / 2),
            y: r * Math.sin(angle - Math.PI / 2)
          })
          structuralEdges.push({ sourceId: String(group.id), targetId: String(n.id), sourceRing: 4, targetRing: 5 })
        })
      })

      // Compute outcome count
      const outcomeCount = positionedNodes.filter(n => n.isOutcome).length

      // Compute ring stats (nodes per ring)
      const ringCounts: Record<number, number> = {}
      positionedNodes.forEach(n => {
        ringCounts[n.ring] = (ringCounts[n.ring] || 0) + 1
      })
      const computedRingStats = RING_CONFIGS.map((ring, i) => ({
        label: ring.label,
        count: ringCounts[i] || 0
      }))
      setRingStats(computedRingStats)

      // Count drivers from positioned nodes
      const driverCount = positionedNodes.filter(n => n.isDriver).length

      setStats({
        nodes: positionedNodes.length,
        structuralEdges: structuralEdges.length,
        outcomes: outcomeCount,
        drivers: driverCount
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

      // Initial view
      const maxRadius = RING_CONFIGS[RING_CONFIGS.length - 1].radius
      const scale = Math.min(width, height) / (maxRadius * 2.5)
      svg.call(zoom.transform, d3.zoomIdentity.translate(width / 2, height / 2).scale(scale))

      // Draw ring circles
      RING_CONFIGS.forEach((ring, i) => {
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
          .text(`Ring ${i}: ${ring.label}`)
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

      // Node styling
      const getColor = (n: PositionedNode): string => {
        if (n.isOutcome) return '#FFD700'
        if (n.isDriver) return '#2196F3'
        return DOMAIN_COLORS[n.semanticPath.domain] || '#9E9E9E'
      }

      const getSize = (n: PositionedNode): number => {
        if (n.ring === 0) return 15 // Root
        if (n.isOutcome) return 12  // Outcomes
        if (n.ring === 2) return 8  // Coarse domains
        if (n.ring === 3) return 6  // Fine domains
        if (n.ring === 4) return 5  // Indicator groups
        return 3 // Indicators
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
        .attr('stroke', d => d.isOutcome ? '#B8860B' : (d.ring <= 1 ? '#333' : '#fff'))
        .attr('stroke-width', d => d.isOutcome ? 2 : (d.ring <= 1 ? 1.5 : 0.5))
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
        .attr('y', d => d.y + getSize(d) + 10)
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
  }, [])

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
        <h2 style={{ margin: 0, fontSize: 16 }}>Semantic Hierarchy v2.1 - Structural Tree</h2>
      </div>

      {loading && <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }}>Loading...</div>}
      {error && <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', color: 'red' }}>Error: {error}</div>}

      {stats && (
        <div style={{ position: 'absolute', top: 60, left: 10, background: 'white', padding: 12, borderRadius: 4, boxShadow: '0 2px 4px rgba(0,0,0,0.1)', fontSize: 13 }}>
          <div><strong>Total Nodes:</strong> {stats.nodes.toLocaleString()}</div>
          <div><strong>Structural Edges:</strong> {stats.structuralEdges.toLocaleString()}</div>
          <div><strong>Outcomes:</strong> {stats.outcomes}</div>
          <div><strong>Drivers:</strong> {stats.drivers.toLocaleString()}</div>
          <div style={{ marginTop: 10, fontSize: 11, color: '#666' }}>Scroll to zoom, drag to pan</div>
        </div>
      )}

      {ringStats.length > 0 && (
        <div style={{ position: 'absolute', top: 200, left: 10, background: 'white', padding: 12, borderRadius: 4, boxShadow: '0 2px 4px rgba(0,0,0,0.1)', fontSize: 12, maxWidth: 200 }}>
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
          <div style={{ borderTop: '1px solid #eee', marginTop: 8, paddingTop: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
              <div style={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: '#FFD700', marginRight: 8, border: '2px solid #B8860B' }} />
              <span style={{ fontSize: 12 }}>Outcomes</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <div style={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: '#2196F3', marginRight: 8 }} />
              <span style={{ fontSize: 12 }}>Drivers</span>
            </div>
          </div>
        </div>
      )}

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
                Ring {selectedNode.ring}: {RING_CONFIGS[selectedNode.ring]?.label || 'Unknown'}
              </span>
              {selectedNode.semanticPath.domain && (
                <span style={{ padding: '2px 8px', borderRadius: 4, backgroundColor: DOMAIN_COLORS[selectedNode.semanticPath.domain] || '#9E9E9E', color: 'white', fontSize: 11, fontWeight: 'bold' }}>
                  {selectedNode.semanticPath.domain}
                </span>
              )}
              {selectedNode.isOutcome && <span style={{ padding: '2px 8px', borderRadius: 4, backgroundColor: '#FFD700', fontSize: 11, fontWeight: 'bold' }}>OUTCOME</span>}
              {selectedNode.isDriver && <span style={{ padding: '2px 8px', borderRadius: 4, backgroundColor: '#2196F3', color: 'white', fontSize: 11, fontWeight: 'bold' }}>DRIVER</span>}
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
