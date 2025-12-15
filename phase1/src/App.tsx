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
  resolveOverlaps,
  type LayoutConfig,
  type LayoutNode
} from './layouts/RadialLayout'
import {
  ViewportAwareLayout,
  createViewportLayout
} from './layouts/ViewportScales'

/**
 * Semantic hierarchy visualization with concentric rings - v2.1 only
 * 6 rings: Root → Outcomes → Coarse Domains → Fine Domains → Indicator Groups → Indicators
 *
 * Features:
 * - Click to expand/collapse node children
 * - Hover to see node details
 * - Starts with only root visible, expand to explore hierarchy
 * - Adjustable ring radii via sliders
 * - Node sizes represent SHAP importance directly (area ∝ importance)
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

// Average character width as fraction of font size (for text width estimation)
const AVG_CHAR_WIDTH_RATIO = 0.55

// Note: getAdaptiveSpacing, calculateDynamicRadii, getNodeRadius, isNodeFloored
// are now provided by ViewportAwareLayout instance

/**
 * Generate ring configs from individual radii
 * nodeSize is a placeholder - actual sizing uses viewport-aware calculations
 */
function generateRingConfigs(radii: number[], maxNodeRadius: number = 20) {
  return RING_LABELS.map((label, i) => ({
    radius: radii[i] || i * 150,
    nodeSize: maxNodeRadius,  // Placeholder, actual sizing is viewport-aware
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

// Node padding for layout (used by RadialLayout, but actual spacing is adaptive)
const DEFAULT_NODE_PADDING = 2  // Base padding, actual spacing is adaptive

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
    childIds: (raw.children || []).map(c => String(c)),  // Use raw data for all children
    hasChildren: (raw.children?.length || 0) > 0  // Use raw data to check if expandable
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
  const prevVisibleNodeIdsRef = useRef<Set<string>>(new Set())
  const nodePositionsRef = useRef<Map<string, { x: number; y: number; parentId: string | null }>>(new Map())
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
  const [fps, setFps] = useState<number>(0)

  // Viewport-aware layout engine
  const viewportLayoutRef = useRef<ViewportAwareLayout | null>(null)
  const [layoutValues, setLayoutValues] = useState<ReturnType<ViewportAwareLayout['getLayoutValues']> | null>(null)

  // Initialize viewport layout on mount
  useEffect(() => {
    const width = window.innerWidth
    const height = window.innerHeight
    const dpr = window.devicePixelRatio || 1

    viewportLayoutRef.current = createViewportLayout(width, height, dpr, 1, 100)
    viewportLayoutRef.current.logParameters()
    setLayoutValues(viewportLayoutRef.current.getLayoutValues())
  }, [])

  // Handle window resize
  useEffect(() => {
    const handleResize = () => {
      if (!viewportLayoutRef.current) return

      const width = window.innerWidth
      const height = window.innerHeight

      viewportLayoutRef.current.updateContext({ width, height })
      setLayoutValues(viewportLayoutRef.current.getLayoutValues())

      console.log('[Viewport Resize] New dimensions:', width, 'x', height)
      viewportLayoutRef.current.logParameters()
    }

    // Debounce resize handler
    let resizeTimeout: ReturnType<typeof setTimeout>
    const debouncedResize = () => {
      clearTimeout(resizeTimeout)
      resizeTimeout = setTimeout(handleResize, 300)
    }

    window.addEventListener('resize', debouncedResize)
    return () => {
      window.removeEventListener('resize', debouncedResize)
      clearTimeout(resizeTimeout)
    }
  }, [])

  // Layout configuration
  const nodePadding = DEFAULT_NODE_PADDING
  // Ring radii are calculated dynamically based on visible nodes
  // Initial values are placeholders that get replaced on first layout computation
  const [ringRadii, setRingRadii] = useState<number[]>([0, 100, 180, 260, 340, 420])

  const ringConfigs = useMemo(
    () => generateRingConfigs(ringRadii),
    [ringRadii]
  )

  // Expansion state - tracks which nodes have their children visible
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set())

  // Track last expansion action for auto-zoom
  const pendingZoomRef = useRef<{ nodeId: string; action: 'expand' | 'collapse' } | null>(null)
  const isAnimatingZoomRef = useRef(false)

  // Raw data (fetched once, cached)
  const [rawData, setRawData] = useState<GraphDataV21 | null>(null)

  // All nodes from layout (stored for filtering)
  const [allNodes, setAllNodes] = useState<ExpandableNode[]>([])
  const [allEdges, setAllEdges] = useState<StructuralEdge[]>([])
  const [computedRingsState, setComputedRingsState] = useState<Array<{ radius: number; nodeSize: number; label?: string }>>([])

  // Toggle expansion of a node
  const toggleExpansion = useCallback((nodeId: string) => {
    if (!rawData) return
    const nodeById = new Map(rawData.nodes.map(n => [String(n.id), n]))

    setExpandedNodes(prev => {
      const next = new Set(prev)
      const wasExpanded = next.has(nodeId)

      if (wasExpanded) {
        // Collapse: remove this node and all descendants from expanded set
        next.delete(nodeId)
        // Also collapse all descendants (use rawData for full tree)
        const collapseDescendants = (id: string) => {
          const node = nodeById.get(id)
          if (node?.children) {
            for (const childId of node.children) {
              const childIdStr = String(childId)
              next.delete(childIdStr)
              collapseDescendants(childIdStr)
            }
          }
        }
        collapseDescendants(nodeId)
        // Record collapse for auto-zoom
        pendingZoomRef.current = { nodeId, action: 'collapse' }
      } else {
        next.add(nodeId)
        // Record expansion for auto-zoom
        pendingZoomRef.current = { nodeId, action: 'expand' }
      }
      return next
    })
  }, [rawData])

  // Expand all nodes
  const expandAll = useCallback(() => {
    if (!rawData) return
    // Use rawData to get ALL nodes (not just visible ones)
    const allExpandable = rawData.nodes
      .filter(n => n.children && n.children.length > 0)
      .map(n => String(n.id))
    setExpandedNodes(new Set(allExpandable))
  }, [rawData])

  // Collapse all nodes
  const collapseAll = useCallback(() => {
    setExpandedNodes(new Set())
  }, [])

  // Reset view: collapse all and reset zoom to initial state
  const resetView = useCallback(() => {
    // Collapse all nodes
    setExpandedNodes(new Set())
    // Clear stored transform so next render calculates initial zoom
    currentTransformRef.current = null
    // If we have the zoom behavior and SVG, programmatically reset
    if (zoomRef.current && svgRef.current) {
      const svg = d3.select(svgRef.current)
      const width = window.innerWidth
      const height = window.innerHeight
      // Reset to center with scale 1 (will be recalculated on next render)
      const initialTransform = d3.zoomIdentity.translate(width / 2, height / 2).scale(1)
      svg.transition().duration(300).call(zoomRef.current.transform, initialTransform)
    }
  }, [])

  // Keyboard shortcuts for reset view (R or Home)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return

      if (e.key === 'r' || e.key === 'R' || e.key === 'Home') {
        e.preventDefault()
        resetView()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [resetView])

  // FPS counter (dev mode only)
  useEffect(() => {
    if (!import.meta.env.DEV) return

    let frameCount = 0
    let lastTime = performance.now()
    let animationId: number

    const measureFps = () => {
      frameCount++
      const currentTime = performance.now()
      const elapsed = currentTime - lastTime

      // Update FPS every 500ms
      if (elapsed >= 500) {
        setFps(Math.round((frameCount * 1000) / elapsed))
        frameCount = 0
        lastTime = currentTime
      }

      animationId = requestAnimationFrame(measureFps)
    }

    animationId = requestAnimationFrame(measureFps)
    return () => cancelAnimationFrame(animationId)
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
    if (!rawData) return
    const nodeById = new Map(rawData.nodes.map(n => [String(n.id), n]))

    setExpandedNodes(prev => {
      const next = new Set(prev)
      // Remove all nodes in this ring and their descendants (use rawData for full tree)
      rawData.nodes
        .filter(n => n.layer === ring)
        .forEach(n => {
          const nodeId = String(n.id)
          next.delete(nodeId)
          // Also collapse descendants
          const collapseDescendants = (id: string) => {
            const node = nodeById.get(id)
            if (node?.children) {
              for (const childId of node.children) {
                const childIdStr = String(childId)
                next.delete(childIdStr)
                collapseDescendants(childIdStr)
              }
            }
          }
          collapseDescendants(nodeId)
        })
      return next
    })
  }, [rawData])

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

  // Fetch data once on mount
  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const response = await fetch(DATA_FILE)
      if (!response.ok) throw new Error(`Failed to load: ${response.status}`)
      const data: GraphDataV21 = await response.json()
      setRawData(data)

      // Count domains for legend (from indicators, layer 5)
      const counts: Record<string, number> = {}
      data.nodes.forEach(n => {
        if (n.layer === 5 && n.domain) {
          counts[n.domain] = (counts[n.domain] || 0) + 1
        }
      })
      setDomainCounts(counts)

      setLoading(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load')
      setLoading(false)
    }
  }, [])

  // Compute layout whenever expansion state changes
  // Layout is computed on VISIBLE nodes only, so nodes spread when siblings are collapsed
  // Ring radii are calculated DYNAMICALLY based on visible node count
  const computeLayout = useCallback(() => {
    if (!rawData || !viewportLayoutRef.current) return

    const vLayout = viewportLayoutRef.current

    // Determine which nodes are visible based on expansion state
    const visibleNodeIds = new Set<string>()
    const nodeById = new Map(rawData.nodes.map(n => [String(n.id), n]))

    // Root is always visible
    const rootNode = rawData.nodes.find(n => n.layer === 0)
    if (rootNode) {
      visibleNodeIds.add(String(rootNode.id))

      // Recursively add visible children
      const addVisibleChildren = (nodeId: string) => {
        if (expandedNodes.has(nodeId)) {
          const node = nodeById.get(nodeId)
          if (node?.children) {
            for (const childId of node.children) {
              const childIdStr = String(childId)
              visibleNodeIds.add(childIdStr)
              addVisibleChildren(childIdStr)
            }
          }
        }
      }
      addVisibleChildren(String(rootNode.id))
    }

    // Filter to visible nodes only
    const visibleRawNodes = rawData.nodes.filter(n => visibleNodeIds.has(String(n.id)))

    // Update viewport layout with current visible node count
    vLayout.updateContext({ visibleNodes: visibleRawNodes.length })
    const currentLayoutValues = vLayout.getLayoutValues()
    setLayoutValues(currentLayoutValues)

    // Group nodes by ring for radius calculation
    const nodesByRing = new Map<number, Array<{ importance?: number }>>()
    visibleRawNodes.forEach(n => {
      if (!nodesByRing.has(n.layer)) nodesByRing.set(n.layer, [])
      nodesByRing.get(n.layer)!.push({ importance: n.importance })
    })

    // Calculate DYNAMIC ring radii using viewport-aware layout
    const dynamicRadii = vLayout.calculateRingRadii(nodesByRing, 6)

    // Update ringRadii state so sliders reflect current values
    setRingRadii(dynamicRadii)

    // Generate ring configs from dynamic radii
    const dynamicRingConfigs = generateRingConfigs(dynamicRadii)

    // Build layout config with dynamic radii and viewport-aware sizing
    const layoutConfig: LayoutConfig = {
      rings: dynamicRingConfigs,
      nodePadding,
      startAngle: -Math.PI / 2,
      totalAngle: 2 * Math.PI,
      minRingGap: currentLayoutValues.ringGap,
      useFixedRadii: true,
      // Pass viewport-aware sizing parameters
      sizeRange: currentLayoutValues.sizeRange,
      baseSpacing: currentLayoutValues.baseSpacing,
      spacingScaleFactor: 0.3,  // Scale factor remains constant
      maxSpacing: currentLayoutValues.maxSpacing
    }

    // Compute layout using ring-independent angular positioning algorithm
    // Each ring positions independently - children spread to fill available space
    // Pass expandedNodes for smart lateral-first sector filling of outcomes
    const layoutResult = computeRadialLayout(visibleRawNodes, layoutConfig, expandedNodes)
    const { computedRings } = layoutResult

    // Log computed ring radii
    console.log('Dynamic ring radii:', dynamicRadii.map((r, i) =>
      `Ring ${i}: ${r.toFixed(0)}px`
    ).join(', '))

    // Post-process: resolve any remaining overlaps by pushing nodes apart
    resolveOverlaps(layoutResult.nodes, computedRings, nodePadding, 50)

    // Detect any overlaps after resolution
    const overlaps = detectOverlaps(layoutResult.nodes, computedRings, nodePadding)
    if (overlaps.length > 0) {
      console.warn(`Found ${overlaps.length} overlapping node pairs after resolution:`, overlaps.slice(0, 10))
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

    // Compute ring stats using dynamicRingConfigs
    const computedRingStats = dynamicRingConfigs.map((ring, i) => ({
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
  }, [rawData, nodePadding, expandedNodes])  // Removed ringConfigs - now calculated inside

  // Render visible nodes and edges (called when expansion state changes)
  const renderVisualization = useCallback(() => {
    if (!svgRef.current || visibleNodes.length === 0 || !viewportLayoutRef.current || !layoutValues) return

    const vLayout = viewportLayoutRef.current
    const svg = d3.select(svgRef.current)

    // Detect exiting nodes for collapse animation
    const currentVisibleIds = new Set(visibleNodes.map(n => n.id))
    const exitingNodeIds = new Set<string>()
    prevVisibleNodeIdsRef.current.forEach(id => {
      if (!currentVisibleIds.has(id)) exitingNodeIds.add(id)
    })

    // If there are exiting nodes, animate them out before clearing
    if (exitingNodeIds.size > 0) {
      const exitingNodes = svg.selectAll('circle.node')
        .filter(function() {
          const id = d3.select(this).attr('data-id')
          return id ? exitingNodeIds.has(id) : false
        })

      // Animate exiting nodes toward parent position while shrinking
      exitingNodes
        .transition()
        .duration(200)
        .ease(d3.easeCubicIn)
        .attr('cx', function() {
          const id = d3.select(this).attr('data-id')
          if (id) {
            const nodeData = nodePositionsRef.current.get(id)
            if (nodeData?.parentId) {
              const parentData = nodePositionsRef.current.get(nodeData.parentId)
              if (parentData) return parentData.x
            }
          }
          return d3.select(this).attr('cx')  // Fallback to current position
        })
        .attr('cy', function() {
          const id = d3.select(this).attr('data-id')
          if (id) {
            const nodeData = nodePositionsRef.current.get(id)
            if (nodeData?.parentId) {
              const parentData = nodePositionsRef.current.get(nodeData.parentId)
              if (parentData) return parentData.y
            }
          }
          return d3.select(this).attr('cy')
        })
        .attr('r', 0)
        .style('opacity', 0)

      // Animate exiting edges
      svg.selectAll('line')
        .filter(function() {
          const line = d3.select(this)
          const x2 = parseFloat(line.attr('x2'))
          const y2 = parseFloat(line.attr('y2'))
          // Check if target position matches an exiting node
          for (const id of exitingNodeIds) {
            const pos = nodePositionsRef.current.get(id)
            if (pos && Math.abs(pos.x - x2) < 1 && Math.abs(pos.y - y2) < 1) {
              return true
            }
          }
          return false
        })
        .transition()
        .duration(200)
        .ease(d3.easeCubicIn)
        .attr('x2', function() { return d3.select(this).attr('x1') })
        .attr('y2', function() { return d3.select(this).attr('y1') })
        .style('opacity', 0)

      // Animate exiting labels
      svg.selectAll('text.node-label')
        .filter(function() {
          const id = d3.select(this).attr('data-id')
          return id ? exitingNodeIds.has(id) : false
        })
        .transition()
        .duration(150)
        .style('opacity', 0)
    }

    // Clear after short delay if animating, otherwise immediate
    const clearDelay = exitingNodeIds.size > 0 ? 200 : 0

    setTimeout(() => {
      svg.selectAll('*').remove()
      renderContent()
    }, clearDelay)

    function renderContent() {

    const width = window.innerWidth
    const height = window.innerHeight
    svg.attr('width', width).attr('height', height)

    const g = svg.append('g')
      .attr('class', 'graph-container')
      .style('will-change', 'transform')  // Hint browser to optimize transforms

    // Zoom level thresholds for CSS-based label visibility
    // Aggressive hiding - need to zoom in to see text
    const getZoomClass = (scale: number): string => {
      if (scale < 1.0) return 'zoom-xs'      // Only Ring 0-1
      if (scale < 1.6) return 'zoom-sm'      // Ring 0-2
      if (scale < 2.5) return 'zoom-md'      // Ring 0-3
      if (scale < 4.0) return 'zoom-lg'      // Ring 0-4
      return 'zoom-xl'                        // All labels including Ring 5
    }

    // Zoom - preserve transform across re-renders
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.05, 20])
      .on('zoom', (event) => {
        // Instant transform update (keeps panning smooth)
        g.attr('transform', event.transform)
        currentTransformRef.current = event.transform

        // Update zoom class for CSS-based label visibility (single DOM write)
        const zoomClass = getZoomClass(event.transform.k)
        g.attr('class', `graph-container ${zoomClass}`)
      })

    zoomRef.current = zoom
    svg.call(zoom)

    // Only set initial zoom if no transform exists yet and not animating
    if (isAnimatingZoomRef.current) {
      // Don't interfere with ongoing zoom animation
      console.log('[Render] Skipping transform restore - animation in progress')
    } else if (currentTransformRef.current) {
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

    // Detect new nodes for enter animation (used by edges, nodes, and labels)
    const prevVisibleIds = prevVisibleNodeIdsRef.current
    const currentVisibleIds = new Set(visibleNodes.map(n => n.id))
    const newNodeIds = new Set<string>()
    currentVisibleIds.forEach(id => {
      if (!prevVisibleIds.has(id)) newNodeIds.add(id)
    })

    // Get parent position for animating new nodes from
    const getParentPosition = (node: ExpandableNode): { x: number; y: number } => {
      if (node.parentId) {
        const parentPos = nodePositionsRef.current.get(node.parentId)
        if (parentPos) return parentPos
        const parent = visibleNodes.find(n => n.id === node.parentId)
        if (parent) return { x: parent.x, y: parent.y }
      }
      return { x: 0, y: 0 }
    }

    // Draw structural edges (tree skeleton)
    // Edges to new nodes animate from source to target
    const edgesGroup = g.append('g')
      .attr('class', 'structural-edges')

    edgesGroup.selectAll('line')
      .data(visibleEdges)
      .enter()
      .append('line')
      .attr('x1', d => nodeMap.get(d.sourceId)?.x || 0)
      .attr('y1', d => nodeMap.get(d.sourceId)?.y || 0)
      .attr('x2', d => {
        // New edges start at source position
        if (newNodeIds.has(d.targetId)) return nodeMap.get(d.sourceId)?.x || 0
        return nodeMap.get(d.targetId)?.x || 0
      })
      .attr('y2', d => {
        if (newNodeIds.has(d.targetId)) return nodeMap.get(d.sourceId)?.y || 0
        return nodeMap.get(d.targetId)?.y || 0
      })
      .attr('stroke', '#ccc')
      .attr('stroke-width', d => vLayout.getEdgeThickness(d.sourceRing))
      .attr('stroke-opacity', d => {
        // New edges start invisible
        if (newNodeIds.has(d.targetId)) return 0
        return vLayout.getEdgeOpacity(d.sourceRing)
      })
      .style('pointer-events', 'none')
      // Animate edges to new nodes
      .filter(d => newNodeIds.has(d.targetId))
      .transition()
      .duration(300)
      .ease(d3.easeCubicOut)
      .attr('x2', d => nodeMap.get(d.targetId)?.x || 0)
      .attr('y2', d => nodeMap.get(d.targetId)?.y || 0)
      .attr('stroke-opacity', d => vLayout.getEdgeOpacity(d.sourceRing))

    // Node styling - all nodes colored by domain
    const getColor = (n: ExpandableNode): string => {
      if (n.ring === 0) return '#78909C' // Muted blue-grey for root
      return DOMAIN_COLORS[n.semanticPath.domain] || '#9E9E9E'
    }

    // Pre-compute percentiles for border thickness (within-ring ranking)
    const nodesByRing = new Map<number, ExpandableNode[]>()
    visibleNodes.forEach(n => {
      if (!nodesByRing.has(n.ring)) nodesByRing.set(n.ring, [])
      nodesByRing.get(n.ring)!.push(n)
    })

    const getPercentileInRing = (node: ExpandableNode): number => {
      const ringNodes = nodesByRing.get(node.ring) || []
      if (ringNodes.length <= 1) return 1
      const sorted = ringNodes.map(n => n.importance).sort((a, b) => b - a)
      const rank = sorted.findIndex(imp => imp <= node.importance)
      return 1 - (rank / sorted.length)
    }

    const getBorderWidth = (node: ExpandableNode): number => {
      const percentile = getPercentileInRing(node)
      let baseWidth: number
      if (percentile >= 0.95) baseWidth = 2      // Top 5%
      else if (percentile >= 0.75) baseWidth = 1.5 // Top 25%
      else if (percentile >= 0.50) baseWidth = 1   // Top 50%
      else baseWidth = 0.75                        // Bottom 50%

      // Scale stroke proportionally for small nodes (max 50% of radius)
      const radius = getSize(node)
      return Math.min(baseWidth, radius * 0.5)
    }

    /**
     * Get node size using viewport-aware scale - area proportional to importance.
     * Same importance = same area across ALL rings (statistical truth).
     */
    const getSize = (n: ExpandableNode): number => {
      return vLayout.getNodeRadius(n.importance || 0)
    }

    /**
     * Check if node is at floor size
     */
    const isNodeFloored = (importance: number): boolean => {
      return vLayout.isNodeFloored(importance)
    }

    // Create node lookup map for event delegation
    const nodeDataMap = new Map<string, ExpandableNode>()
    visibleNodes.forEach(n => nodeDataMap.set(n.id, n))

    // Draw nodes with enter animation
    // Size = global importance (statistical truth)
    // Border thickness = within-ring percentile (navigability aid)
    // Border color = domain color (solid) or gray (dashed, if floored)
    g.selectAll('circle.node')
      .data(visibleNodes)
      .enter()
      .append('circle')
      .attr('class', 'node')
      .attr('data-id', d => d.id)
      .attr('cx', d => newNodeIds.has(d.id) ? getParentPosition(d).x : d.x)
      .attr('cy', d => newNodeIds.has(d.id) ? getParentPosition(d).y : d.y)
      .attr('r', d => newNodeIds.has(d.id) ? 0 : getSize(d))
      .attr('fill', d => getColor(d))
      .attr('stroke', d => isNodeFloored(d.importance) ? '#999' : (DOMAIN_COLORS[d.semanticPath.domain] || '#9E9E9E'))
      .attr('stroke-width', d => {
        const radius = getSize(d)
        if (isNodeFloored(d.importance)) return Math.min(1, radius * 0.5)
        return getBorderWidth(d)
      })
      .attr('stroke-dasharray', d => isNodeFloored(d.importance) ? '2,2' : 'none')
      .style('cursor', d => d.hasChildren ? 'pointer' : 'default')
      .style('opacity', d => newNodeIds.has(d.id) ? 0 : 1)
      // Animate new nodes from parent position to final position
      .filter(d => newNodeIds.has(d.id))
      .transition()
      .duration(300)
      .ease(d3.easeCubicOut)
      .attr('cx', d => d.x)
      .attr('cy', d => d.y)
      .attr('r', d => getSize(d))
      .style('opacity', 1)

    // Update refs for next render
    prevVisibleNodeIdsRef.current = currentVisibleIds
    visibleNodes.forEach(n => {
      nodePositionsRef.current.set(n.id, { x: n.x, y: n.y, parentId: n.parentId })
    })

    // Event delegation: single handlers on parent <g> instead of per-node
    // This reduces ~7,500 event listeners to just 3
    g.on('click', (event) => {
      const target = event.target as Element
      if (target.classList.contains('node')) {
        event.stopPropagation()
        const nodeId = target.getAttribute('data-id')
        if (nodeId) {
          const node = nodeDataMap.get(nodeId)
          if (node?.hasChildren) {
            toggleExpansion(node.id)
          }
        }
      }
    })
    .on('mouseenter', (event) => {
      const target = event.target as Element
      if (target.classList.contains('node')) {
        const nodeId = target.getAttribute('data-id')
        if (nodeId) {
          const node = nodeDataMap.get(nodeId)
          if (node) {
            const radius = getSize(node)
            const baseStroke = isNodeFloored(node.importance) ? Math.min(1, radius * 0.5) : getBorderWidth(node)
            const hoverStroke = Math.min(baseStroke + 1, radius * 0.8)
            d3.select(target)
              .attr('r', radius * 1.3)
              .attr('stroke-width', hoverStroke)
            setHoveredNode(node)
          }
        }
      }
    }, true)  // Use capture phase for mouseenter
    .on('mouseleave', (event) => {
      const target = event.target as Element
      if (target.classList.contains('node')) {
        const nodeId = target.getAttribute('data-id')
        if (nodeId) {
          const node = nodeDataMap.get(nodeId)
          if (node) {
            const radius = getSize(node)
            const baseStroke = isNodeFloored(node.importance) ? Math.min(1, radius * 0.5) : getBorderWidth(node)
            d3.select(target)
              .attr('r', radius)
              .attr('stroke-width', baseStroke)
            setHoveredNode(null)
          }
        }
      }
    }, true)  // Use capture phase for mouseleave

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
    // Text size is purely importance-based (no ring scaling) with user-adjustable multiplier
    // Labels that would cross into the next ring are wrapped into two lines
    const labelPositions = new Map<string, { x: number; y: number; anchor: string; rotation: number; fontSize: number; lines: string[] }>()

    // Helper: estimate text width
    const estimateTextWidth = (text: string, fontSize: number) => text.length * fontSize * AVG_CHAR_WIDTH_RATIO

    // Helper: split label at middle word
    const splitLabel = (label: string): string[] => {
      const words = label.split(' ')
      if (words.length <= 1) return [label]
      const midPoint = Math.ceil(words.length / 2)
      return [
        words.slice(0, midPoint).join(' '),
        words.slice(midPoint).join(' ')
      ]
    }

    // Get next ring radius for collision detection
    const getNextRingRadius = (ring: number): number => {
      const nextRing = ring + 1
      if (nextRing < ringRadii.length) return ringRadii[nextRing]
      return Infinity // No next ring, no constraint
    }

    for (const d of labelNodes) {
      const nodeSize = getSize(d)
      const importance = d.importance ?? 0
      // Text size using viewport-aware calculation with ring-based scaling
      const fontSize = vLayout.getFontSize(importance, d.ring)
      const label = d.label || ''

      if (d.ring <= 1) {
        // Center/inner rings: labels below node, check if width crosses next ring
        const offset = nodeSize + fontSize * 0.5 + 4
        const textWidth = estimateTextWidth(label, fontSize)
        const nodeRadius = Math.sqrt(d.x * d.x + d.y * d.y)
        const nextRingRadius = getNextRingRadius(d.ring)

        // Check if text would extend into next ring (for centered text, check half-width on each side)
        const textEndRadius = nodeRadius + offset + fontSize // Approximate vertical extent
        const needsWrap = textEndRadius > nextRingRadius - 5 || textWidth > (nextRingRadius - nodeRadius) * 1.5

        const lines = needsWrap && label.includes(' ') ? splitLabel(label) : [label]
        labelPositions.set(d.id, { x: d.x, y: d.y + offset, anchor: 'middle', rotation: 0, fontSize, lines })
      } else {
        // Outer rings: radial labels
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

        // Calculate if text would cross into next ring
        const nodeRadius = Math.sqrt(d.x * d.x + d.y * d.y)
        const nextRingRadius = getNextRingRadius(d.ring)
        const textWidth = estimateTextWidth(label, fontSize)

        // For radial text, the end extends outward from the node
        const textEndRadius = nodeRadius + offset + textWidth
        const needsWrap = textEndRadius > nextRingRadius - 5

        const lines = needsWrap && label.includes(' ') ? splitLabel(label) : [label]
        labelPositions.set(d.id, { x: labelX, y: labelY, anchor, rotation, fontSize, lines })
      }
    }

    // Set initial zoom class for CSS-based label visibility
    const initialZoomClass = getZoomClass(currentScale)
    g.attr('class', `graph-container ${initialZoomClass}`)

    // Render labels - CSS handles visibility based on zoom level
    // Don't set inline opacity - let CSS control visibility to avoid override issues
    g.selectAll('text.node-label')
      .data(labelNodes)
      .enter()
      .append('text')
      .attr('class', 'node-label')
      .each(function(d) {
        const pos = labelPositions.get(d.id)!
        const textEl = d3.select(this)
          .attr('x', pos.x)
          .attr('y', pos.y)
          .attr('text-anchor', pos.anchor)
          .attr('transform', pos.rotation !== 0 ? `rotate(${pos.rotation}, ${pos.x}, ${pos.y})` : null)
          .attr('font-size', pos.fontSize)
          .attr('font-weight', d.ring <= 1 ? 'bold' : 'normal')
          .attr('fill', '#333')
          .attr('data-ring', d.ring)
          .style('pointer-events', 'none')

        // Render single or multi-line text
        if (pos.lines.length === 1) {
          textEl.text(pos.lines[0])
        } else {
          // Multi-line: use tspans, stack vertically
          const lineHeight = pos.fontSize * 1.1
          pos.lines.forEach((line, i) => {
            textEl.append('tspan')
              .attr('x', pos.x)
              .attr('dy', i === 0 ? 0 : lineHeight)
              .text(line)
          })
        }
      })
    } // end renderContent

  }, [visibleNodes, visibleEdges, computedRingsState, ringConfigs, expandedNodes, toggleExpansion, ringRadii, layoutValues])

  // Fetch data once on mount
  useEffect(() => {
    fetchData()
  }, [fetchData])

  // Recompute layout when rawData or ringRadii changes
  useEffect(() => {
    computeLayout()
  }, [computeLayout])

  // Re-render when visible nodes change (expansion state changes)
  useEffect(() => {
    renderVisualization()
  }, [renderVisualization])

  // Auto-zoom on expand/collapse
  useEffect(() => {
    if (!pendingZoomRef.current || !zoomRef.current || !svgRef.current || visibleNodes.length === 0) return

    const { nodeId, action } = pendingZoomRef.current

    // Find the node that was expanded/collapsed
    const targetNode = visibleNodes.find(n => n.id === nodeId)
    if (!targetNode) return

    if (action === 'expand') {
      // For expand, we need to wait until children are actually visible
      const directChildren = visibleNodes.filter(n => n.parentId === nodeId)
      if (targetNode.hasChildren && directChildren.length === 0) {
        // Children not yet in visibleNodes, wait for next update
        return
      }
    }

    // Clear the pending action now that we're ready to process
    pendingZoomRef.current = null

    const svg = d3.select(svgRef.current)
    const zoom = zoomRef.current
    const width = window.innerWidth
    const height = window.innerHeight
    const currentTransform = currentTransformRef.current || d3.zoomIdentity

    // Delay to let render complete
    setTimeout(() => {
      // Find nodes for the subtree that was just expanded/collapsed
      const getSubtreeNodes = (rootId: string): ExpandableNode[] => {
        const result: ExpandableNode[] = []
        const rootNode = visibleNodes.find(n => n.id === rootId)
        if (rootNode) result.push(rootNode)

        const addDescendants = (parentId: string) => {
          visibleNodes.filter(n => n.parentId === parentId).forEach(child => {
            result.push(child)
            addDescendants(child.id)
          })
        }
        addDescendants(rootId)
        return result
      }

      // Only include the subtree that was just expanded - ignore root and ring outlines
      const relevantNodes = getSubtreeNodes(nodeId)
      if (relevantNodes.length <= 1) return  // Just the node itself, no children to zoom to

      // Calculate center of the subtree (ignore bounding box size for zoom)
      const xs = relevantNodes.map(n => n.x)
      const ys = relevantNodes.map(n => n.y)
      const centerX = (Math.min(...xs) + Math.max(...xs)) / 2
      const centerY = (Math.min(...ys) + Math.max(...ys)) / 2

      // Keep current zoom - just pan to center the subtree
      // Only zoom in slightly if we're very zoomed out
      const currentScale = currentTransform.k
      let newScale = currentScale

      if (action === 'expand' && currentScale < 0.8) {
        // If very zoomed out, zoom in a bit to see detail
        newScale = 0.8
      }
      // Cap at reasonable max
      newScale = Math.min(newScale, 3)

      // Calculate translation to center the relevant content
      const newX = width / 2 - centerX * newScale
      const newY = height / 2 - centerY * newScale

      const newTransform = d3.zoomIdentity.translate(newX, newY).scale(newScale)

      // Animate using manual interpolation for smoother results
      isAnimatingZoomRef.current = true
      const startTransform = currentTransform
      const duration = 400
      const startTime = performance.now()

      const animate = (currentTime: number) => {
        const elapsed = currentTime - startTime
        const t = Math.min(elapsed / duration, 1)
        // Ease out cubic
        const eased = 1 - Math.pow(1 - t, 3)

        const interpolatedK = startTransform.k + (newTransform.k - startTransform.k) * eased
        const interpolatedX = startTransform.x + (newTransform.x - startTransform.x) * eased
        const interpolatedY = startTransform.y + (newTransform.y - startTransform.y) * eased

        const interpolatedTransform = d3.zoomIdentity.translate(interpolatedX, interpolatedY).scale(interpolatedK)

        // Apply transform directly to the g element and update zoom
        svg.select('g.graph-container').attr('transform', interpolatedTransform.toString())
        currentTransformRef.current = interpolatedTransform

        if (t < 1) {
          requestAnimationFrame(animate)
        } else {
          // Sync zoom behavior state at the end
          svg.call(zoom.transform, newTransform)
          currentTransformRef.current = newTransform
          isAnimatingZoomRef.current = false
        }
      }

      requestAnimationFrame(animate)
    }, 100)  // Delay to let render complete
  }, [visibleNodes, expandedNodes])

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

      {/* Loading Screen */}
      {loading && (
        <div className="loading-screen">
          <div className="loading-spinner" />
          <div className="loading-text">Loading 2,583 nodes...</div>
          <div className="loading-subtext">Quality of Life Semantic Hierarchy</div>
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="loading-screen">
          <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
          <div style={{ color: '#e53935', fontSize: 16, fontWeight: 'bold' }}>Failed to load data</div>
          <div style={{ color: '#666', fontSize: 13, marginTop: 8 }}>{error}</div>
        </div>
      )}

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

      {/* Reset View Button - Top right */}
      <button
        onClick={resetView}
        style={{
          position: 'absolute',
          top: 10,
          right: 10,
          padding: '8px 16px',
          fontSize: 13,
          fontWeight: 'bold',
          cursor: 'pointer',
          border: '1px solid #ccc',
          borderRadius: 4,
          background: 'white',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
          zIndex: 100
        }}
        title="Reset view to initial state (R or Home)"
      >
        Reset View
      </button>

      <svg ref={svgRef} style={{ width: '100%', height: '100%' }} />

      {/* FPS Counter (dev mode only) */}
      {import.meta.env.DEV && fps > 0 && (
        <div style={{
          position: 'absolute',
          bottom: 10,
          left: 10,
          padding: '4px 8px',
          fontSize: 11,
          fontFamily: 'monospace',
          background: fps >= 50 ? 'rgba(76, 175, 80, 0.9)' : fps >= 30 ? 'rgba(255, 152, 0, 0.9)' : 'rgba(244, 67, 54, 0.9)',
          color: 'white',
          borderRadius: 4,
          zIndex: 100
        }}>
          {fps} FPS
        </div>
      )}

      {/* Hover tooltip panel */}
      {hoveredNode && layoutValues && viewportLayoutRef.current && (() => {
        const vLayout = viewportLayoutRef.current!
        const { sizeRange } = layoutValues

        // Compute global and local ranks for tooltip
        const sortedGlobal = allNodes.map(n => n.importance).sort((a, b) => b - a)
        const globalRank = sortedGlobal.findIndex(imp => imp <= hoveredNode.importance) + 1

        const ringNodes = allNodes.filter(n => n.ring === hoveredNode.ring)
        const sortedRing = ringNodes.map(n => n.importance).sort((a, b) => b - a)
        const ringRank = sortedRing.findIndex(imp => imp <= hoveredNode.importance) + 1
        const ringPercentile = ((1 - ringRank / ringNodes.length) * 100).toFixed(0)

        // Check if node is at floor size using viewport-aware calculation
        const floored = vLayout.isNodeFloored(hoveredNode.importance)
        const targetArea = sizeRange.minArea + hoveredNode.importance * sizeRange.scaleFactor
        const targetRadius = Math.sqrt(targetArea / Math.PI)

        return (
          <div style={{
            position: 'absolute', bottom: 20, left: '50%', transform: 'translateX(-50%)',
            background: 'white', padding: '12px 16px', borderRadius: 8,
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)', maxWidth: 500, zIndex: 100,
            pointerEvents: 'none'
          }}>
            {/* Badge row: ring, domain, subdomain, special status */}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
              <span style={{ padding: '2px 8px', borderRadius: 4, backgroundColor: '#eee', fontSize: 11 }}>
                {ringConfigs[hoveredNode.ring]?.label || `Ring ${hoveredNode.ring}`}
              </span>
              {hoveredNode.semanticPath.domain && (
                <span style={{ padding: '2px 8px', borderRadius: 4, backgroundColor: DOMAIN_COLORS[hoveredNode.semanticPath.domain] || '#9E9E9E', color: 'white', fontSize: 11, fontWeight: 'bold' }}>
                  {hoveredNode.semanticPath.domain}
                </span>
              )}
              {hoveredNode.semanticPath.subdomain && hoveredNode.semanticPath.subdomain !== hoveredNode.semanticPath.domain && (
                <span style={{ padding: '2px 8px', borderRadius: 4, backgroundColor: '#f0f0f0', fontSize: 11, color: '#555' }}>
                  {hoveredNode.semanticPath.subdomain}
                </span>
              )}
              {hoveredNode.isOutcome && (
                <span style={{ padding: '2px 8px', borderRadius: 4, backgroundColor: '#9C27B0', color: 'white', fontSize: 11 }}>
                  Outcome
                </span>
              )}
              {hoveredNode.isDriver && (
                <span style={{ padding: '2px 8px', borderRadius: 4, backgroundColor: '#4CAF50', color: 'white', fontSize: 11 }}>
                  Driver
                </span>
              )}
              {floored && (
                <span style={{ padding: '2px 8px', borderRadius: 4, backgroundColor: '#999', color: 'white', fontSize: 11 }}>
                  Min size
                </span>
              )}
            </div>

            {/* Node name */}
            <div style={{ fontWeight: 'bold', fontSize: 14, marginBottom: 6 }}>{hoveredNode.label}</div>

            {/* Stats grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px', fontSize: 11, color: '#444', marginBottom: 8 }}>
              <div><strong>Global Rank:</strong> #{globalRank} of {allNodes.length}</div>
              <div><strong>Importance:</strong> {(hoveredNode.importance * 100).toFixed(2)}%</div>
              <div><strong>Ring Rank:</strong> #{ringRank} of {ringNodes.length}</div>
              <div><strong>Percentile:</strong> Top {ringPercentile}%</div>
              <div><strong>Connections:</strong> {hoveredNode.degree}</div>
              <div><strong>Children:</strong> {hoveredNode.childIds.length}</div>
            </div>

            {/* Expand/collapse hint */}
            {hoveredNode.hasChildren && (
              <div style={{ fontSize: 11, color: expandedNodes.has(hoveredNode.id) ? '#2196F3' : '#666', marginBottom: 6 }}>
                {expandedNodes.has(hoveredNode.id)
                  ? `Click to collapse ${hoveredNode.childIds.length} children`
                  : `Click to expand ${hoveredNode.childIds.length} children`}
              </div>
            )}

            {/* Description */}
            {hoveredNode.description && (
              <div style={{ fontSize: 12, color: '#666', borderTop: '1px solid #eee', paddingTop: 6 }}>
                {hoveredNode.description}
              </div>
            )}

            {/* Floor size note (smaller, less prominent) */}
            {floored && (
              <div style={{ fontSize: 10, color: '#888', fontStyle: 'italic', marginTop: 4 }}>
                Size: {targetRadius.toFixed(1)}px → {sizeRange.minRadius.toFixed(1)}px (floored)
              </div>
            )}
          </div>
        )
      })()}
    </div>
  )
}

export default App
