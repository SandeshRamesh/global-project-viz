/**
 * LocalView - Causal pathway visualization
 *
 * Shows inputs (causes) → targets → outputs (effects)
 * with circular nodes matching Global View appearance,
 * sector-colored outlines, and beta-based edge styling.
 */

import { useEffect, useRef, useState, useMemo } from 'react'
import * as d3 from 'd3'
import type { RawNodeV21, RawEdge } from '../../types'
import {
  buildLocalViewData,
  getLocalViewStats,
  getCausalEdges
} from '../../utils/causalEdges'
import {
  computeLocalViewLayout,
  calculateEdgePath,
  getEdgeStyle,
  calculateFitTransform,
  type PositionedLocalNode
} from '../../layouts/LocalViewLayout'

interface LocalViewProps {
  targetIds: string[]
  allEdges: RawEdge[]
  nodeById: Map<string, RawNodeV21>
  domainColors: Record<string, string>
  onRemoveTarget: (nodeId: string) => void
  onClearTargets: () => void
  onSwitchToGlobal: () => void
  onNavigateToNode?: (nodeId: string) => void
  showGlow?: boolean  // Only show glow in split mode
  onBetaThresholdChange?: (threshold: number) => void  // Notify parent of threshold changes
}

export function LocalView({
  targetIds,
  allEdges,
  nodeById,
  domainColors,
  onRemoveTarget,
  onClearTargets,
  onSwitchToGlobal,
  onNavigateToNode,
  showGlow = false,
  onBetaThresholdChange
}: LocalViewProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null)
  const currentTransformRef = useRef<d3.ZoomTransform | null>(null)
  const prevTargetIdsRef = useRef<string[]>([])
  const prevDimensionsRef = useRef<{ width: number; height: number } | null>(null)
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 })
  const [betaThreshold, setBetaThreshold] = useState(0.5)
  const [hoveredNode, setHoveredNode] = useState<PositionedLocalNode | null>(null)
  const [hoveredEdge, setHoveredEdge] = useState<{ source: string; target: string; beta: number } | null>(null)

  // Target node count for auto-adjustment (show 4-8 nodes)
  const TARGET_NODE_COUNT = 6

  // Calculate optimal beta threshold to show 4-8 nodes
  const calculateOptimalThreshold = useMemo(() => {
    if (targetIds.length === 0) return 0.5

    const causalEdges = getCausalEdges(allEdges)

    // Get all betas for edges connected to our targets
    const relevantBetas: number[] = []
    for (const targetId of targetIds) {
      // Incoming edges
      causalEdges
        .filter(e => e.target === targetId)
        .forEach(e => relevantBetas.push(Math.abs(e.beta)))
      // Outgoing edges
      causalEdges
        .filter(e => e.source === targetId)
        .forEach(e => relevantBetas.push(Math.abs(e.beta)))
    }

    if (relevantBetas.length === 0) return 0.5

    // Sort betas descending (strongest first)
    relevantBetas.sort((a, b) => b - a)

    // Find threshold that gives us ~6 nodes (4-8 range)
    // We want the threshold just below the Nth largest beta
    const targetIndex = Math.min(TARGET_NODE_COUNT, relevantBetas.length) - 1
    const optimalThreshold = relevantBetas[targetIndex] * 0.99 // Slightly below to include it

    // Clamp to reasonable range
    return Math.max(0.1, Math.min(optimalThreshold, 10))
  }, [targetIds, allEdges])

  // Auto-adjust threshold when targets change
  useEffect(() => {
    setBetaThreshold(calculateOptimalThreshold)
  }, [calculateOptimalThreshold])

  // Notify parent of threshold changes
  useEffect(() => {
    onBetaThresholdChange?.(betaThreshold)
  }, [betaThreshold, onBetaThresholdChange])

  // Measure container - use ResizeObserver for accurate sizing on view switches
  useEffect(() => {
    if (!containerRef.current) return

    const updateDimensions = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect()
        if (rect.width > 0 && rect.height > 0) {
          setDimensions({ width: rect.width, height: rect.height })
        }
      }
    }

    // Use ResizeObserver for accurate container size changes (including view switches)
    const resizeObserver = new ResizeObserver(updateDimensions)
    resizeObserver.observe(containerRef.current)

    // Also measure on window resize as fallback
    updateDimensions()
    window.addEventListener('resize', updateDimensions)

    return () => {
      resizeObserver.disconnect()
      window.removeEventListener('resize', updateDimensions)
    }
  }, [])

  // Build Local View data
  const localViewData = useMemo(() => {
    if (targetIds.length === 0) return null
    return buildLocalViewData(
      targetIds,
      allEdges,
      nodeById,
      domainColors,
      betaThreshold
    )
  }, [targetIds, allEdges, nodeById, domainColors, betaThreshold])

  // Compute layout
  const layout = useMemo(() => {
    if (!localViewData) return null
    return computeLocalViewLayout(
      localViewData.targets,
      localViewData.inputs,
      localViewData.outputs,
      localViewData.edges,
      dimensions.width,
      dimensions.height
    )
  }, [localViewData, dimensions])

  // Get stats
  const stats = useMemo(() => {
    if (!localViewData) return null
    return getLocalViewStats(localViewData)
  }, [localViewData])

  // Render SVG
  useEffect(() => {
    if (!svgRef.current || !layout) return

    const svg = d3.select(svgRef.current)

    // Check if targets changed (need to reset view)
    const targetsChanged = JSON.stringify(targetIds) !== JSON.stringify(prevTargetIdsRef.current)
    prevTargetIdsRef.current = [...targetIds]

    // Check if dimensions changed significantly (>5% change or first render triggers refit)
    const prevDims = prevDimensionsRef.current
    const isFirstRender = prevDims === null
    let dimensionsChanged = isFirstRender
    if (prevDims) {
      const widthChange = Math.abs(dimensions.width - prevDims.width) / Math.max(prevDims.width, 1)
      const heightChange = Math.abs(dimensions.height - prevDims.height) / Math.max(prevDims.height, 1)
      dimensionsChanged = widthChange > 0.05 || heightChange > 0.05
    }
    prevDimensionsRef.current = { ...dimensions }

    // Clear existing content but preserve zoom behavior
    svg.select('g.local-view-content').remove()

    // Create main group for content
    const g = svg.append('g')
      .attr('class', 'local-view-content')

    // Set up zoom behavior (only once)
    if (!zoomRef.current) {
      const zoom = d3.zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.2, 4])
        .on('zoom', (event) => {
          currentTransformRef.current = event.transform
          svg.select('g.local-view-content').attr('transform', event.transform.toString())
        })

      zoomRef.current = zoom
      svg.call(zoom)
    }

    // Calculate fit transform for initial/reset view
    const initialTransform = calculateFitTransform(
      layout.bounds,
      dimensions.width,
      dimensions.height,
      80
    )

    // Set transform: use stored transform or calculate new one if targets or dimensions changed
    if (targetsChanged || dimensionsChanged || !currentTransformRef.current) {
      const transform = d3.zoomIdentity
        .translate(initialTransform.x, initialTransform.y)
        .scale(initialTransform.scale)
      currentTransformRef.current = transform
      // Animate the transition when dimensions change (smoother experience)
      if (dimensionsChanged && !targetsChanged) {
        svg.transition().duration(200).call(zoomRef.current!.transform, transform)
      } else {
        svg.call(zoomRef.current!.transform, transform)
      }
    } else {
      // Apply current transform to new content
      g.attr('transform', currentTransformRef.current.toString())
    }

    // Create node lookup for edge rendering
    const nodePositions = new Map<string, PositionedLocalNode>()
    layout.nodes.forEach(n => nodePositions.set(n.id, n))

    // Calculate max beta for normalization
    const maxBeta = Math.max(...layout.edges.map(e => Math.abs(e.beta)), 1)

    // === RENDER LAYER LABELS ===
    const labelsGroup = g.append('g').attr('class', 'layer-labels')

    // Find Y positions for each layer
    const inputNodes = layout.nodes.filter(n => n.layer === 'input')
    const targetNodes = layout.nodes.filter(n => n.layer === 'target')
    const outputNodes = layout.nodes.filter(n => n.layer === 'output')

    // Calculate left edge (minimum X minus max radius minus padding)
    const allX = layout.nodes.map(n => n.x - n.radius)
    const leftEdge = Math.min(...allX) - 60

    // Add "Input" label if inputs exist
    if (inputNodes.length > 0) {
      const inputY = Math.min(...inputNodes.map(n => n.y))
      labelsGroup.append('text')
        .attr('x', leftEdge)
        .attr('y', inputY)
        .attr('text-anchor', 'start')
        .attr('font-size', 14)
        .attr('font-weight', 500)
        .attr('fill', '#888')
        .text('Input')
    }

    // Add "Target" label
    if (targetNodes.length > 0) {
      const targetY = Math.min(...targetNodes.map(n => n.y))
      labelsGroup.append('text')
        .attr('x', leftEdge)
        .attr('y', targetY)
        .attr('text-anchor', 'start')
        .attr('font-size', 14)
        .attr('font-weight', 500)
        .attr('fill', '#888')
        .text('Target')
    }

    // Add "Output" label if outputs exist
    if (outputNodes.length > 0) {
      const outputY = Math.min(...outputNodes.map(n => n.y))
      labelsGroup.append('text')
        .attr('x', leftEdge)
        .attr('y', outputY)
        .attr('text-anchor', 'start')
        .attr('font-size', 14)
        .attr('font-weight', 500)
        .attr('fill', '#888')
        .text('Output')
    }

    // === RENDER EDGES ===
    const edgesGroup = g.append('g').attr('class', 'edges')

    for (const edge of layout.edges) {
      const sourceNode = nodePositions.get(edge.source)
      const targetNode = nodePositions.get(edge.target)
      if (!sourceNode || !targetNode) continue

      const path = calculateEdgePath(sourceNode, targetNode)
      const style = getEdgeStyle(edge.beta, maxBeta)

      edgesGroup.append('path')
        .attr('d', path)
        .attr('fill', 'none')
        .attr('stroke', style.stroke)
        .attr('stroke-width', style.strokeWidth)
        .attr('stroke-opacity', style.opacity)
        .attr('data-source', edge.source)
        .attr('data-target', edge.target)
        .attr('data-beta', edge.beta)
        .style('cursor', 'pointer')
        .on('mouseenter', function() {
          d3.select(this).attr('stroke-opacity', 1).attr('stroke-width', style.strokeWidth + 2)
          setHoveredEdge({ source: edge.source, target: edge.target, beta: edge.beta })
        })
        .on('mouseleave', function() {
          d3.select(this).attr('stroke-opacity', style.opacity).attr('stroke-width', style.strokeWidth)
          setHoveredEdge(null)
        })
    }

    // === RENDER NODES (Circular) ===
    const nodesGroup = g.append('g').attr('class', 'nodes')

    // Calculate label vertical offsets with overlap detection
    const CHAR_WIDTH = 6.5 // Approximate width per character at font-size 11
    const LABEL_PADDING = 4 // Minimum horizontal gap between labels
    const LABEL_HEIGHT = 16 // Height of label bubble
    const BASE_OFFSET = 22 // Base offset below node (increased for more padding)
    const OFFSET_STEP = 18 // Vertical step between label layers

    // Group nodes by layer and sort by X position
    const nodesByLayer: Record<string, PositionedLocalNode[]> = {
      input: layout.nodes.filter(n => n.layer === 'input').sort((a, b) => a.x - b.x),
      target: layout.nodes.filter(n => n.layer === 'target').sort((a, b) => a.x - b.x),
      output: layout.nodes.filter(n => n.layer === 'output').sort((a, b) => a.x - b.x)
    }

    // Calculate label bounds and assign vertical layers to avoid overlap
    interface LabelInfo {
      nodeId: string
      x: number
      baseY: number // Y position at bottom of node (node.y + node.radius)
      width: number
      height: number
      verticalLayer: number // additional vertical offset layer (0, 1, 2, ...)
    }

    const labelLayers = new Map<string, number>()

    // Process each horizontal layer separately
    Object.values(nodesByLayer).forEach(nodes => {
      const labels: LabelInfo[] = nodes.map(n => ({
        nodeId: n.id,
        x: n.x,
        baseY: n.y + n.radius, // Account for node size
        width: n.label.length * CHAR_WIDTH + 8,
        height: LABEL_HEIGHT,
        verticalLayer: 0
      }))

      // Greedy assignment: for each label, find lowest layer without overlap
      for (let i = 0; i < labels.length; i++) {
        const current = labels[i]
        const currentNode = nodes[i]
        let assignedLayer = 0
        let foundFreeLayer = false

        while (!foundFreeLayer) {
          foundFreeLayer = true
          // Calculate current label's actual Y position
          const currentY = current.baseY + BASE_OFFSET + assignedLayer * OFFSET_STEP
          const currentLeft = current.x - current.width / 2 - LABEL_PADDING
          const currentRight = current.x + current.width / 2 + LABEL_PADDING
          const currentTop = currentY - LABEL_HEIGHT / 2
          const currentBottom = currentY + LABEL_HEIGHT / 2

          // Check against ALL nodes (not just in same layer) for node-label collision
          for (const otherNode of layout.nodes) {
            if (otherNode.id === currentNode.id) continue

            // Check if label overlaps with this node's circle
            const nodeLeft = otherNode.x - otherNode.radius
            const nodeRight = otherNode.x + otherNode.radius
            const nodeTop = otherNode.y - otherNode.radius
            const nodeBottom = otherNode.y + otherNode.radius

            const hOverlap = !(currentRight < nodeLeft || currentLeft > nodeRight)
            const vOverlap = !(currentBottom < nodeTop || currentTop > nodeBottom)

            if (hOverlap && vOverlap) {
              foundFreeLayer = false
              assignedLayer++
              break
            }
          }

          if (!foundFreeLayer) continue

          // Check against all previously assigned labels
          for (let j = 0; j < i; j++) {
            const other = labels[j]
            const otherY = other.baseY + BASE_OFFSET + other.verticalLayer * OFFSET_STEP

            const otherLeft = other.x - other.width / 2 - LABEL_PADDING
            const otherRight = other.x + other.width / 2 + LABEL_PADDING
            const hOverlap = !(currentRight < otherLeft || currentLeft > otherRight)

            const otherTop = otherY - LABEL_HEIGHT / 2
            const otherBottom = otherY + LABEL_HEIGHT / 2
            const vOverlap = !(currentBottom < otherTop || currentTop > otherBottom)

            if (hOverlap && vOverlap) {
              foundFreeLayer = false
              assignedLayer++
              break
            }
          }
        }
        current.verticalLayer = assignedLayer
        labelLayers.set(current.nodeId, assignedLayer)
      }
    })

    for (const node of layout.nodes) {
      const isTarget = node.isTarget
      const labelVerticalLayer = labelLayers.get(node.id) || 0

      // Create node group centered at node position
      const nodeGroup = nodesGroup.append('g')
        .attr('class', `node node-${node.layer}`)
        .attr('data-id', node.id)
        .attr('transform', `translate(${node.x}, ${node.y})`)

      // Highlight colors by node type
      // Target: cyan, Input: orange, Output: purple
      const GLOW_COLORS = {
        target: '#00BCD4',  // Cyan
        input: '#FF9800',   // Orange
        output: '#9C27B0'   // Purple
      }
      const glowColor = GLOW_COLORS[node.layer]

      // Glow circle (rendered after text so it's on top)
      // Will be appended later after text

      // Invisible larger circle for easier hovering (10px padding)
      nodeGroup.append('circle')
        .attr('r', node.radius + 10)
        .attr('fill', 'transparent')
        .attr('pointer-events', 'all')
        .style('cursor', 'pointer')
        .on('mouseenter', () => setHoveredNode(node))
        .on('mouseleave', () => setHoveredNode(null))
        .on('dblclick', () => {
          if (!node.isTarget && onNavigateToNode) {
            onNavigateToNode(node.id)
          }
        })

      // Visible circle with sector-colored fill
      nodeGroup.append('circle')
        .attr('r', node.radius)
        .attr('fill', node.sectorColor)
        .attr('stroke', 'none')
        .attr('opacity', isTarget ? 1 : 0.85)
        .attr('pointer-events', 'none') // Let invisible circle handle events

      // Label below circle - positioned in assigned vertical layer to avoid overlap
      const labelOffset = BASE_OFFSET + labelVerticalLayer * OFFSET_STEP
      const labelY = node.radius + labelOffset

      nodeGroup.append('text')
        .attr('x', 0)
        .attr('y', labelY)
        .attr('text-anchor', 'middle')
        .attr('font-size', 11)
        .attr('fill', '#333')
        .attr('stroke', 'white')
        .attr('stroke-width', 4)
        .attr('stroke-linejoin', 'round')
        .style('paint-order', 'stroke fill')
        .attr('font-weight', isTarget ? 600 : 400)
        .attr('pointer-events', 'none')
        .text(node.label)

      // Subtle glow circle (on top of everything) - only in split mode
      if (showGlow) {
        nodeGroup.append('circle')
          .attr('r', node.radius + 3)
          .attr('fill', 'none')
          .attr('stroke', glowColor)
          .attr('stroke-width', 3)
          .attr('opacity', 0.35)
          .style('filter', 'blur(2px)')
          .attr('pointer-events', 'none')
      }

      // Remove button for targets (positioned at 45° angle, top-right)
      if (isTarget) {
        const buttonX = node.radius * 0.7
        const buttonY = -node.radius * 0.7

        const removeBtn = nodeGroup.append('g')
          .attr('class', 'remove-btn')
          .attr('transform', `translate(${buttonX}, ${buttonY})`)
          .style('cursor', 'pointer')
          .on('click', (event) => {
            event.stopPropagation()
            onRemoveTarget(node.id)
          })

        removeBtn.append('circle')
          .attr('r', 7)
          .attr('fill', '#f44336')

        // X mark using lines
        removeBtn.append('line')
          .attr('x1', -3)
          .attr('y1', -3)
          .attr('x2', 3)
          .attr('y2', 3)
          .attr('stroke', '#fff')
          .attr('stroke-width', 1.5)

        removeBtn.append('line')
          .attr('x1', 3)
          .attr('y1', -3)
          .attr('x2', -3)
          .attr('y2', 3)
          .attr('stroke', '#fff')
          .attr('stroke-width', 1.5)
      }
    }

  }, [layout, dimensions, targetIds, onRemoveTarget, onNavigateToNode, showGlow])

  // Empty state
  if (targetIds.length === 0) {
    return (
      <div
        ref={containerRef}
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#fafafa'
        }}
      >
        <div style={{ textAlign: 'center', color: '#666' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🔍</div>
          <div style={{ fontSize: 18, fontWeight: 500, marginBottom: 8 }}>
            No targets selected
          </div>
          <div style={{ fontSize: 14, color: '#888' }}>
            Double-click a node in Global View to explore its causal pathways
          </div>
          <button
            onClick={onSwitchToGlobal}
            style={{
              marginTop: 24,
              padding: '10px 20px',
              fontSize: 14,
              cursor: 'pointer',
              border: '1px solid #3B82F6',
              borderRadius: 6,
              background: '#3B82F6',
              color: 'white',
              fontWeight: 500
            }}
          >
            Go to Global View
          </button>
        </div>
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        position: 'relative',
        background: '#fafafa'
      }}
    >
      {/* Controls Panel - Bottom right, compact */}
      <div
        style={{
          position: 'absolute',
          bottom: 40,  // Above the node tooltip area
          right: 10,
          background: 'rgba(255,255,255,0.95)',
          padding: '8px 12px',
          borderRadius: 6,
          boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
          zIndex: 10,
          fontSize: 11
        }}
      >
        {/* Beta Threshold - inline */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <span style={{ color: '#666', whiteSpace: 'nowrap' }}>β ≥ {betaThreshold.toFixed(1)}</span>
          <input
            type="range"
            min="0.1"
            max="5"
            step="0.1"
            value={betaThreshold}
            onChange={(e) => setBetaThreshold(parseFloat(e.target.value))}
            style={{ width: 80 }}
          />
        </div>

        {/* Stats + Clear - inline */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {stats && (
            <span style={{ color: '#888' }}>
              {stats.totalInputs}↓ {stats.totalOutputs}↑ ({stats.totalEdges})
            </span>
          )}
          <button
            onClick={onClearTargets}
            style={{
              padding: '2px 8px',
              fontSize: 10,
              cursor: 'pointer',
              border: '1px solid #ccc',
              borderRadius: 3,
              background: 'white',
              color: '#666'
            }}
          >
            Clear
          </button>
        </div>
      </div>

      {/* SVG Canvas */}
      <svg
        ref={svgRef}
        style={{ width: '100%', height: '100%' }}
      />

      {/* Node Tooltip */}
      {hoveredNode && (() => {
        // Find beta for this node
        const edge = layout?.edges.find(e =>
          (hoveredNode.isInput && e.source === hoveredNode.id) ||
          (hoveredNode.isOutput && e.target === hoveredNode.id)
        )
        const beta = edge?.beta

        return (
          <div
            style={{
              position: 'absolute',
              bottom: 20,
              left: '50%',
              transform: 'translateX(-50%)',
              background: 'white',
              padding: '12px 16px',
              borderRadius: 8,
              boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
              zIndex: 20,
              maxWidth: 400
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 4 }}>{hoveredNode.label}</div>
            <div style={{ fontSize: 12, color: '#666' }}>
              <span style={{
                display: 'inline-block',
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: hoveredNode.sectorColor,
                marginRight: 6
              }} />
              {hoveredNode.sector} • Ring {hoveredNode.ring}
              {hoveredNode.isTarget && <span style={{ marginLeft: 8, color: '#3B82F6', fontWeight: 500 }}>Target</span>}
              {hoveredNode.isInput && <span style={{ marginLeft: 8, color: '#4CAF50' }}>Cause</span>}
              {hoveredNode.isOutput && <span style={{ marginLeft: 8, color: '#F44336' }}>Effect</span>}
            </div>
            {beta !== undefined && (
              <div style={{
                fontSize: 14,
                fontWeight: 600,
                marginTop: 8,
                color: beta > 0 ? '#4CAF50' : '#F44336'
              }}>
                β = {beta > 0 ? '+' : ''}{beta.toFixed(3)}
              </div>
            )}
            {!hoveredNode.isTarget && (
              <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>
                Double-click to explore this node
              </div>
            )}
          </div>
        )
      })()}

      {/* Edge Tooltip */}
      {hoveredEdge && (
        <div
          style={{
            position: 'absolute',
            top: 70,
            right: 10,
            background: 'white',
            padding: '12px 16px',
            borderRadius: 8,
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            zIndex: 20
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
            Causal Effect
          </div>
          <div style={{
            fontSize: 18,
            fontWeight: 600,
            color: hoveredEdge.beta > 0 ? '#4CAF50' : '#F44336'
          }}>
            β = {hoveredEdge.beta > 0 ? '+' : ''}{hoveredEdge.beta.toFixed(3)}
          </div>
          <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>
            {hoveredEdge.beta > 0 ? 'Positive relationship' : 'Negative relationship'}
          </div>
        </div>
      )}
    </div>
  )
}

export default LocalView
