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
  type LayoutNode,
  type TextConfig
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

  // Track collapse animation to prevent second render from overriding delayed rotation
  const collapseAnimationRef = useRef<{ inProgress: boolean; endTime: number }>({ inProgress: false, endTime: 0 })

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

  // Calculate initial zoom transform to fit content
  const calculateInitialTransform = useCallback((nodes: ExpandableNode[]) => {
    const width = window.innerWidth
    const height = window.innerHeight
    const nodesWithPosition = nodes.filter(n => n.x !== 0 || n.y !== 0)
    const maxRadius = nodesWithPosition.length > 0
      ? Math.max(...nodesWithPosition.map(n => Math.sqrt(n.x * n.x + n.y * n.y)))
      : 100
    const scale = Math.min(width, height) / (Math.max(maxRadius * 2.5, 200))
    return d3.zoomIdentity.translate(width / 2, height / 2).scale(scale)
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
      // Calculate initial zoom for collapsed state (just root node at origin)
      const rootOnly = allNodes.filter(n => n.ring === 0)
      const initialTransform = calculateInitialTransform(rootOnly)
      svg.transition().duration(300).call(zoomRef.current.transform, initialTransform)
    }
  }, [allNodes, calculateInitialTransform])

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

    // Count expanded Ring 1 branches for text boost calculation
    const expandedBranchCount = visibleRawNodes.filter(
      n => n.layer === 1 && expandedNodes.has(String(n.id))
    ).length

    // Build text config for text-aware spacing
    const textConfig: TextConfig = {
      expandedBranchCount,
      minReadableSize: 3,
      maxBoostedSize: 5,
      minFontSize: currentLayoutValues.textMinSize,
      maxFontSize: currentLayoutValues.textMaxSize
    }

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
      maxSpacing: currentLayoutValues.maxSpacing,
      // Pass text config for text-aware spacing
      textConfig
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
    const width = window.innerWidth
    const height = window.innerHeight
    svg.attr('width', width).attr('height', height)

    // Get or create persistent container with layered groups for z-ordering
    let g = svg.select<SVGGElement>('g.graph-container')
    if (g.empty()) {
      g = svg.append('g')
        .attr('class', 'graph-container')
        .style('will-change', 'transform')
      // Create layer groups in correct z-order (first = back, last = front)
      g.append('g').attr('class', 'layer-rings')
      g.append('g').attr('class', 'layer-edges')
      g.append('g').attr('class', 'layer-nodes')
      g.append('g').attr('class', 'layer-labels')
    }

    // Get layer references
    const ringsLayer = g.select<SVGGElement>('g.layer-rings')
    const edgesLayer = g.select<SVGGElement>('g.layer-edges')
    const nodesLayer = g.select<SVGGElement>('g.layer-nodes')
    const labelsLayer = g.select<SVGGElement>('g.layer-labels')

    // Zoom level thresholds for CSS-based label visibility
    const getZoomClass = (scale: number): string => {
      if (scale < 1.0) return 'zoom-xs'
      if (scale < 1.6) return 'zoom-sm'
      if (scale < 2.5) return 'zoom-md'
      if (scale < 4.0) return 'zoom-lg'
      return 'zoom-xl'
    }

    // Setup zoom behavior (only once)
    if (!zoomRef.current) {
      const zoom = d3.zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.05, 20])
        .on('zoom', (event) => {
          g.attr('transform', event.transform)
          currentTransformRef.current = event.transform
          const zoomClass = getZoomClass(event.transform.k)
          g.attr('class', `graph-container ${zoomClass}`)
        })
      zoomRef.current = zoom
      svg.call(zoom)

      // Initial view - use shared calculation
      const initialTransform = calculateInitialTransform(visibleNodes)
      svg.call(zoom.transform, initialTransform)
      currentTransformRef.current = initialTransform
    }

    // Restore transform if not animating
    if (!isAnimatingZoomRef.current && currentTransformRef.current) {
      g.attr('transform', currentTransformRef.current.toString())
    }

    // === HELPER FUNCTIONS ===
    const getColor = (n: ExpandableNode): string => {
      if (n.ring === 0) return '#78909C'
      return DOMAIN_COLORS[n.semanticPath.domain] || '#9E9E9E'
    }

    const getSize = (n: ExpandableNode): number => {
      return vLayout.getNodeRadius(n.importance || 0)
    }

    const isNodeFloored = (importance: number): boolean => {
      return vLayout.isNodeFloored(importance)
    }

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
      if (percentile >= 0.95) baseWidth = 2
      else if (percentile >= 0.75) baseWidth = 1.5
      else if (percentile >= 0.50) baseWidth = 1
      else baseWidth = 0.75
      const radius = getSize(node)
      return Math.min(baseWidth, radius * 0.5)
    }

    const getParentPosition = (node: ExpandableNode): { x: number; y: number } => {
      if (node.parentId) {
        // Check NEW positions first (from current layout) so enter nodes
        // start from parent's final position after rotation
        const parent = visibleNodes.find(n => n.id === node.parentId)
        if (parent) return { x: parent.x, y: parent.y }
        // Fall back to previous positions for edge cases
        const parentPos = nodePositionsRef.current.get(node.parentId)
        if (parentPos) return parentPos
      }
      return { x: 0, y: 0 }
    }

    // Detect new vs existing vs exiting nodes
    const prevVisibleIds = prevVisibleNodeIdsRef.current
    const currentVisibleIds = new Set(visibleNodes.map(n => n.id))
    const newNodeIds = new Set<string>()
    const movingNodeIds = new Set<string>()
    const exitingNodeIds = new Set<string>()
    currentVisibleIds.forEach(id => {
      if (!prevVisibleIds.has(id)) {
        newNodeIds.add(id)
      } else {
        movingNodeIds.add(id)
      }
    })
    prevVisibleIds.forEach(id => {
      if (!currentVisibleIds.has(id)) {
        exitingNodeIds.add(id)
      }
    })

    // Determine animation timing based on expand vs collapse:
    // EXPAND sequence: Rotation → Nodes/Edges enter → Text appears
    // COLLAPSE sequence: Text disappears → Nodes/Edges exit → Rotation
    const isCollapsing = exitingNodeIds.size > 0
    const hasRotation = movingNodeIds.size > 0

    const rotationDuration = 300
    const enterExitDuration = 300
    const textFadeDuration = 150
    const exitDuration = 200  // Duration for nodes/edges collapsing

    // Timing for EXPAND: rotation first, then enter, then text
    const expandEnterDelay = hasRotation ? rotationDuration : 0
    const expandTextDelay = expandEnterDelay + enterExitDuration

    // Timing for COLLAPSE: text first, then exit, then rotation
    // Sequence: Text fades (0-150ms) → Nodes collapse (150-350ms) → Rotation starts after collapse complete
    const collapseTextDelay = 0  // Text disappears immediately
    const collapseExitDelay = textFadeDuration  // Exit after text fades (150ms)
    const collapseExitEndTime = collapseExitDelay + exitDuration  // When collapse finishes (350ms)
    const collapseRotationDelay = collapseExitEndTime + 100  // Start rotation after collapse + buffer (450ms)

    // Build node map
    const nodeMap = new Map<string, ExpandableNode>()
    visibleNodes.forEach(n => nodeMap.set(n.id, n))

    // === RING CIRCLES (static, recreate each time) ===
    ringsLayer.selectAll('circle.ring-outline').remove()
    ringsLayer.selectAll('text.ring-label').remove()

    const visibleRings = new Set(visibleNodes.map(n => n.ring))
    computedRingsState.slice(1).forEach((ring, i) => {
      const ringIndex = i + 1
      if (!visibleRings.has(ringIndex)) return

      ringsLayer.append('circle')
        .attr('class', 'ring-outline')
        .attr('cx', 0)
        .attr('cy', 0)
        .attr('r', ring.radius)
        .attr('fill', 'none')
        .attr('stroke', '#e5e5e5')
        .attr('stroke-width', 1.5)

      ringsLayer.append('text')
        .attr('class', 'ring-label')
        .attr('x', 0)
        .attr('y', -ring.radius - 12)
        .attr('text-anchor', 'middle')
        .attr('font-size', 12)
        .attr('font-weight', 'bold')
        .attr('fill', '#888')
        .text(`${ring.label || ringConfigs[ringIndex]?.label || ''}`)
    })

    // === EDGES with enter/update/exit ===
    const edgeKey = (d: StructuralEdge) => `${d.sourceId}-${d.targetId}`
    const edgeSelection = edgesLayer.selectAll<SVGLineElement, StructuralEdge>('line.edge')
      .data(visibleEdges, edgeKey)

    // Exit edges (COLLAPSE: after text disappears, before rotation)
    edgeSelection.exit()
      .transition()
      .delay(collapseExitDelay)
      .duration(exitDuration)
      .attr('x2', function() { return d3.select(this).attr('x1') })
      .attr('y2', function() { return d3.select(this).attr('y1') })
      .style('opacity', 0)
      .remove()

    // Track collapse animation state to prevent re-renders from overriding
    const now = Date.now()
    if (isCollapsing && exitingNodeIds.size > 0) {
      // Start of collapse animation - mark it and set end time
      const totalCollapseTime = collapseRotationDelay + rotationDuration
      collapseAnimationRef.current = { inProgress: true, endTime: now + totalCollapseTime }
      // Schedule cleanup after animation completes
      setTimeout(() => {
        collapseAnimationRef.current = { inProgress: false, endTime: 0 }
      }, totalCollapseTime + 50)
    }

    // Check if we're in the middle of a collapse animation (from a previous render)
    const inCollapseAnimation = collapseAnimationRef.current.inProgress && now < collapseAnimationRef.current.endTime

    // Update edges (animate to new positions)
    // COLLAPSE: delay rotation until after exit; EXPAND: rotate immediately
    // Skip if we're in a collapse animation and this is a subsequent render (no exiting nodes)
    const rotationDelay = isCollapsing ? collapseRotationDelay : 0
    const shouldSkipRotation = inCollapseAnimation && !isCollapsing

    if (!shouldSkipRotation) {
      edgeSelection
        .transition('rotation')
        .delay(rotationDelay)
        .duration(rotationDuration)
        .ease(d3.easeCubicOut)
        .attr('x1', d => nodeMap.get(d.sourceId)?.x || 0)
        .attr('y1', d => nodeMap.get(d.sourceId)?.y || 0)
        .attr('x2', d => nodeMap.get(d.targetId)?.x || 0)
        .attr('y2', d => nodeMap.get(d.targetId)?.y || 0)
    }

    // Enter edges (EXPAND: after rotation completes)
    edgeSelection.enter()
      .append('line')
      .attr('class', 'edge')
      .attr('x1', d => nodeMap.get(d.sourceId)?.x || 0)
      .attr('y1', d => nodeMap.get(d.sourceId)?.y || 0)
      .attr('x2', d => nodeMap.get(d.sourceId)?.x || 0)
      .attr('y2', d => nodeMap.get(d.sourceId)?.y || 0)
      .attr('stroke', '#ccc')
      .attr('stroke-width', d => vLayout.getEdgeThickness(d.sourceRing))
      .attr('stroke-opacity', 0)
      .style('pointer-events', 'none')
      .transition()
      .delay(expandEnterDelay)
      .duration(enterExitDuration)
      .ease(d3.easeCubicOut)
      .attr('x2', d => nodeMap.get(d.targetId)?.x || 0)
      .attr('y2', d => nodeMap.get(d.targetId)?.y || 0)
      .attr('stroke-opacity', d => vLayout.getEdgeOpacity(d.sourceRing))

    // === NODES with enter/update/exit ===
    const nodeSelection = nodesLayer.selectAll<SVGCircleElement, ExpandableNode>('circle.node')
      .data(visibleNodes, d => d.id)

    // Exit nodes (COLLAPSE: after text disappears, before rotation)
    nodeSelection.exit()
      .each(function() {
        const el = d3.select(this)
        const id = el.attr('data-id')
        if (id) {
          const nodeData = nodePositionsRef.current.get(id)
          const parentPos = nodeData?.parentId ? nodePositionsRef.current.get(nodeData.parentId) : null
          el.transition()
            .delay(collapseExitDelay)
            .duration(exitDuration)
            .ease(d3.easeCubicIn)
            .attr('cx', parentPos?.x ?? el.attr('cx'))
            .attr('cy', parentPos?.y ?? el.attr('cy'))
            .attr('r', 0)
            .style('opacity', 0)
            .remove()
        }
      })

    // Update nodes (animate to new positions)
    // COLLAPSE: delay rotation until after exit; EXPAND: rotate immediately
    // Skip if we're in a collapse animation and this is a subsequent render
    if (!shouldSkipRotation) {
      nodeSelection
        .transition('rotation')
        .delay(rotationDelay)
        .duration(rotationDuration)
        .ease(d3.easeCubicOut)
        .attr('cx', d => d.x)
        .attr('cy', d => d.y)
        .attr('r', d => getSize(d))
        .attr('fill', d => getColor(d))
    }

    // Enter nodes (EXPAND: after rotation completes)
    nodeSelection.enter()
      .append('circle')
      .attr('class', 'node')
      .attr('data-id', d => d.id)
      .attr('cx', d => getParentPosition(d).x)
      .attr('cy', d => getParentPosition(d).y)
      .attr('r', 0)
      .attr('fill', d => getColor(d))
      .attr('stroke', d => isNodeFloored(d.importance) ? '#999' : (DOMAIN_COLORS[d.semanticPath.domain] || '#9E9E9E'))
      .attr('stroke-width', d => {
        const radius = getSize(d)
        if (isNodeFloored(d.importance)) return Math.min(1, radius * 0.5)
        return getBorderWidth(d)
      })
      .attr('stroke-dasharray', d => isNodeFloored(d.importance) ? '2,2' : 'none')
      .style('cursor', d => d.hasChildren ? 'pointer' : 'default')
      .style('opacity', 0)
      .transition()
      .delay(expandEnterDelay)
      .duration(enterExitDuration)
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

    // === EVENT DELEGATION ===
    const nodeDataMap = new Map<string, ExpandableNode>()
    visibleNodes.forEach(n => nodeDataMap.set(n.id, n))

    // Remove old handlers and add new ones
    g.on('click', null).on('mouseenter', null).on('mouseleave', null)

    g.on('click', (event) => {
      const target = event.target as Element
      if (target.classList.contains('node')) {
        event.stopPropagation()
        const nodeId = target.getAttribute('data-id')
        if (nodeId) {
          const node = nodeDataMap.get(nodeId)
          if (node?.hasChildren) {
            // Root node (ring 0): reset view if expanded, normal expand if collapsed
            if (node.ring === 0 && expandedNodes.has(node.id)) {
              resetView()
            } else {
              toggleExpansion(node.id)
            }
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
    }, true)
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
    }, true)

    // === LABELS with enter/update/exit ===
    const labelNodes = visibleNodes.filter(n => {
      if (n.ring === 0) return true
      if (n.parentId && expandedNodes.has(n.parentId)) return true
      return false
    })

    // Helper functions for labels
    const estimateTextWidth = (text: string, fontSize: number) => text.length * fontSize * AVG_CHAR_WIDTH_RATIO
    /**
     * Split label into N lines, distributing words evenly
     */
    const splitIntoLines = (label: string, numLines: number): string[] => {
      const words = label.split(' ')
      if (words.length <= 1 || numLines <= 1) return [label]

      const wordsPerLine = Math.ceil(words.length / numLines)
      const lines: string[] = []

      for (let i = 0; i < words.length; i += wordsPerLine) {
        lines.push(words.slice(i, i + wordsPerLine).join(' '))
      }

      return lines
    }

    /**
     * Determine optimal line count for a label based on available space
     * Prefers fewer lines, only uses more if needed to avoid collision
     */
    const getOptimalLines = (
      label: string,
      fontSize: number,
      availableWidth: number,
      isHorizontal: boolean
    ): string[] => {
      if (!label.includes(' ')) return [label]

      const lineHeight = fontSize * 1.1

      // Try 1 line
      const width1 = estimateTextWidth(label, fontSize)
      if (width1 <= availableWidth) {
        return [label]
      }

      // Try 2 lines
      const lines2 = splitIntoLines(label, 2)
      const maxWidth2 = Math.max(...lines2.map(l => estimateTextWidth(l, fontSize)))
      const height2 = lineHeight * 2
      if (isHorizontal) {
        // For horizontal text, check width fits
        if (maxWidth2 <= availableWidth) {
          return lines2
        }
      } else {
        // For radial text, height (along radius) matters more
        if (maxWidth2 <= availableWidth || height2 <= availableWidth) {
          return lines2
        }
      }

      // Use 3 lines as last resort
      return splitIntoLines(label, 3)
    }
    const getNextRingRadius = (ring: number): number => {
      const nextRing = ring + 1
      if (nextRing < ringRadii.length) return ringRadii[nextRing]
      return Infinity
    }

    // Calculate text boost for branch exploration
    // When exploring few branches, boost small text into readable range (3-5px)
    // Smoothly transition to original sizes as more branches expand
    const MIN_READABLE_SIZE = 3
    const MAX_BOOSTED_SIZE = 5

    // Count expanded Ring 1 nodes (outcomes being explored)
    const expandedOutcomes = visibleNodes.filter(n => n.ring === 1 && expandedNodes.has(n.id))
    const expandedCount = expandedOutcomes.length

    // Boost factor: 1.0 at 1 branch, decreasing to 0.0 at 5+ branches
    // Linear interpolation: 1 branch = 1.0, 2 = 0.75, 3 = 0.5, 4 = 0.25, 5+ = 0.0
    const boostFactor = expandedCount <= 0 ? 0 : Math.max(0, 1 - (expandedCount - 1) / 4)

    /**
     * Apply readability boost to font size
     * - Ring 0-1: No boost (constant text size for QoL and Outcomes)
     * - Text >= MIN_READABLE_SIZE: no change
     * - Text < MIN_READABLE_SIZE: boost into MIN_READABLE_SIZE to MAX_BOOSTED_SIZE range
     * - Boost strength controlled by boostFactor (based on expanded branch count)
     */
    const applyTextBoost = (baseSize: number, ring: number): number => {
      // Ring 0 (QoL) and Ring 1 (Outcomes) always use base size - no boost
      if (ring <= 1) {
        return baseSize
      }

      if (boostFactor === 0 || baseSize >= MIN_READABLE_SIZE) {
        return baseSize
      }

      // Map small text (0 to MIN_READABLE_SIZE) into boosted range (MIN to MAX)
      // Preserve relative ordering: smaller base = smaller boosted
      const ratio = baseSize / MIN_READABLE_SIZE  // 0 to 1
      const boostedSize = MIN_READABLE_SIZE + ratio * (MAX_BOOSTED_SIZE - MIN_READABLE_SIZE)

      // Blend between original and boosted based on boostFactor
      return baseSize + (boostedSize - baseSize) * boostFactor
    }

    // Compute label positions
    const labelPositions = new Map<string, { x: number; y: number; anchor: string; rotation: number; fontSize: number; lines: string[] }>()
    for (const d of labelNodes) {
      const nodeSize = getSize(d)
      const importance = d.importance ?? 0
      const label = d.label || ''

      // Calculate font size based on ring
      let fontSize: number
      if (d.ring === 0) {
        // Ring 0 (QoL): Importance-based, no boost
        fontSize = vLayout.getFontSize(importance, d.ring)
      } else if (d.ring === 1) {
        // Ring 1 (Outcomes): Narrower range (4-8px scaled by viewport)
        const baseMax = vLayout.getFontSize(1, 1)  // Get viewport-scaled maximum
        const scaleFactor = baseMax / 16  // Normalize to ~1.0 on 1080p
        const ring1Min = 4 * scaleFactor
        const ring1Max = 8 * scaleFactor
        fontSize = ring1Min + (ring1Max - ring1Min) * Math.sqrt(importance)
      } else {
        // Ring 2+: Importance-based with boost
        const baseFontSize = vLayout.getFontSize(importance, d.ring)
        fontSize = applyTextBoost(baseFontSize, d.ring)
      }

      if (d.ring <= 1) {
        // Ring 0-1: Constant text - no wrapping, no boost
        // Dynamic padding: larger nodes need more space
        const basePadding = Math.max(4, nodeSize * 0.2)
        const offset = nodeSize + fontSize * 0.6 + basePadding

        // Always single line for Ring 0-1 (QoL and Outcomes)
        const lines = [label]

        labelPositions.set(d.id, { x: d.x, y: d.y + offset, anchor: 'middle', rotation: 0, fontSize, lines })
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
        const nodeRadius = Math.sqrt(d.x * d.x + d.y * d.y)
        const nextRingRadius = getNextRingRadius(d.ring)

        // Available radial space for text
        const availableSpace = nextRingRadius - nodeRadius - offset - 5

        const lines = getOptimalLines(label, fontSize, availableSpace, false)
        labelPositions.set(d.id, { x: labelX, y: labelY, anchor, rotation, fontSize, lines })
      }
    }

    // Labels with enter/update/exit for proper animation timing
    const currentScale = currentTransformRef.current?.k ?? 1
    const initialZoomClass = getZoomClass(currentScale)
    g.attr('class', `graph-container ${initialZoomClass}`)

    // Minimum effective size for readability (font-size * zoom)
    // Set to 3 so boosted 3px text is visible at 1x zoom
    const MIN_EFFECTIVE_SIZE = 3

    /**
     * Check if a label should be visible based on font size and zoom
     * Ring 0-1 always visible, others require minimum effective size
     */
    const isLabelVisible = (ring: number, fontSize: number, zoomScale: number): boolean => {
      if (ring <= 1) return true  // Root and outcomes always visible
      const effectiveSize = fontSize * zoomScale
      return effectiveSize >= MIN_EFFECTIVE_SIZE
    }

    /**
     * Update all label visibility based on current zoom
     * Always sets explicit opacity (1 or 0) to avoid CSS conflicts
     */
    const updateLabelVisibility = (zoomScale: number) => {
      labelsLayer.selectAll<SVGTextElement, ExpandableNode>('text.node-label')
        .style('opacity', function() {
          const ring = parseInt(d3.select(this).attr('data-ring') || '0')
          const fontSize = parseFloat(d3.select(this).attr('data-fontsize') || '0')
          return isLabelVisible(ring, fontSize, zoomScale) ? 1 : 0
        })
    }

    // Update zoom handler to use dynamic visibility
    if (zoomRef.current) {
      zoomRef.current.on('zoom', (event) => {
        g.attr('transform', event.transform)
        currentTransformRef.current = event.transform
        const zoomClass = getZoomClass(event.transform.k)
        g.attr('class', `graph-container ${zoomClass}`)
        // Update label visibility based on actual font sizes
        updateLabelVisibility(event.transform.k)
      })
    }

    const labelSelection = labelsLayer.selectAll<SVGTextElement, ExpandableNode>('text.node-label')
      .data(labelNodes, d => d.id)

    // Exit labels (COLLAPSE: fade out first, before nodes collapse)
    labelSelection.exit()
      .transition()
      .delay(collapseTextDelay)
      .duration(textFadeDuration)
      .style('opacity', 0)
      .remove()

    // Update labels (move with rotation, update font-size for boost changes)
    // Skip if we're in a collapse animation and this is a subsequent render
    if (!shouldSkipRotation) {
      labelSelection.each(function(d) {
        const pos = labelPositions.get(d.id)
        if (pos) {
          const textEl = d3.select(this)

          // Update data-fontsize for visibility calculations
          textEl.attr('data-fontsize', pos.fontSize)

          textEl
            .transition('rotation')
            .delay(rotationDelay)
            .duration(rotationDuration)
            .attr('x', pos.x)
            .attr('y', pos.y)
            .attr('font-size', pos.fontSize)
            .attr('transform', pos.rotation !== 0 ? `rotate(${pos.rotation}, ${pos.x}, ${pos.y})` : null)

          // Also update tspans (for multi-line labels) - they have their own x attribute
          textEl.selectAll('tspan')
            .transition('rotation')
            .delay(rotationDelay)
            .duration(rotationDuration)
            .attr('x', pos.x)
        }
      })

      // Update visibility after font sizes change
      updateLabelVisibility(currentScale)
    }

    // Enter labels (EXPAND: fade in last, after nodes appear)
    labelSelection.enter()
      .append('text')
      .attr('class', 'node-label')
      .attr('data-id', d => d.id)
      .attr('data-ring', d => d.ring)
      .attr('data-fontsize', d => labelPositions.get(d.id)?.fontSize ?? 0)
      .style('opacity', 0)
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
          .style('pointer-events', 'none')

        if (pos.lines.length === 1) {
          textEl.text(pos.lines[0])
        } else {
          const lineHeight = pos.fontSize * 1.1
          pos.lines.forEach((line, i) => {
            textEl.append('tspan')
              .attr('x', pos.x)
              .attr('dy', i === 0 ? 0 : lineHeight)
              .text(line)
          })
        }
      })
      .transition()
      .delay(expandTextDelay)
      .duration(textFadeDuration)
      .style('opacity', function(d) {
        // Fade in only if visible at current zoom
        // Always use explicit opacity (1 or 0) to avoid CSS conflicts
        const pos = labelPositions.get(d.id)
        if (!pos) return 0
        return isLabelVisible(d.ring, pos.fontSize, currentScale) ? 1 : 0
      })

  }, [visibleNodes, visibleEdges, computedRingsState, ringConfigs, expandedNodes, toggleExpansion, resetView, ringRadii, layoutValues, calculateInitialTransform])

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

    // No camera change when expanding root (ring 0)
    if (action === 'expand' && targetNode.ring === 0) {
      pendingZoomRef.current = null
      return
    }

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
      /**
       * Find the Ring 1 ancestor of a node (walk up the tree)
       */
      const getRing1Ancestor = (node: ExpandableNode): ExpandableNode | null => {
        if (node.ring === 1) return node
        if (node.ring === 0) return null // Root has no Ring 1 ancestor

        // Walk up the tree to find Ring 1 ancestor
        let current = node
        while (current.ring > 1 && current.parentId) {
          const parent = visibleNodes.find(n => n.id === current.parentId)
          if (!parent) break
          current = parent
        }
        return current.ring === 1 ? current : null
      }

      /**
       * Get all descendants of a node (entire subtree)
       */
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

      let centerX: number
      let centerY: number

      if (action === 'expand') {
        // EXPAND: Center between root (0,0) and the ENTIRE branch from Ring 1 forward
        // Find the Ring 1 ancestor first, then get all its descendants
        const clickedNode = visibleNodes.find(n => n.id === nodeId)
        if (!clickedNode) return

        const ring1Ancestor = getRing1Ancestor(clickedNode)
        const branchRootId = ring1Ancestor ? ring1Ancestor.id : nodeId

        // Get all nodes in the entire branch from Ring 1 forward
        const branchNodes = getSubtreeNodes(branchRootId)
        if (branchNodes.length === 0) return

        const allXs = branchNodes.map(n => n.x)
        const allYs = branchNodes.map(n => n.y)

        // Find the bounding box of entire branch
        const branchMinX = Math.min(...allXs)
        const branchMaxX = Math.max(...allXs)
        const branchMinY = Math.min(...allYs)
        const branchMaxY = Math.max(...allYs)

        // Include root (0,0) in bounds to keep QoL visible
        const boundsMinX = Math.min(0, branchMinX)
        const boundsMaxX = Math.max(0, branchMaxX)
        const boundsMinY = Math.min(0, branchMinY)
        const boundsMaxY = Math.max(0, branchMaxY)

        centerX = (boundsMinX + boundsMaxX) / 2
        centerY = (boundsMinY + boundsMaxY) / 2
      } else {
        // COLLAPSE: Center between root (0,0) and the collapsed node
        // The collapsed node is now the "frontier" of that branch
        const collapsedNode = visibleNodes.find(n => n.id === nodeId)
        if (!collapsedNode) return

        // Center between root (0,0) and the collapsed node
        const boundsMinX = Math.min(0, collapsedNode.x)
        const boundsMaxX = Math.max(0, collapsedNode.x)
        const boundsMinY = Math.min(0, collapsedNode.y)
        const boundsMaxY = Math.max(0, collapsedNode.y)

        centerX = (boundsMinX + boundsMaxX) / 2
        centerY = (boundsMinY + boundsMaxY) / 2
      }

      // Calculate zoom to fit entire branch (from Ring 1) with padding
      const currentScale = currentTransform.k
      let newScale = currentScale

      if (action === 'expand') {
        // Get the bounding box dimensions of entire branch from Ring 1 (including root at 0,0)
        const clickedNode = visibleNodes.find(n => n.id === nodeId)
        if (clickedNode) {
          const ring1Ancestor = getRing1Ancestor(clickedNode)
          const branchRootId = ring1Ancestor ? ring1Ancestor.id : nodeId
          const branchNodes = getSubtreeNodes(branchRootId)

          const allXs = branchNodes.map(n => n.x)
          const allYs = branchNodes.map(n => n.y)

          const boundsMinX = Math.min(0, ...allXs)
          const boundsMaxX = Math.max(0, ...allXs)
          const boundsMinY = Math.min(0, ...allYs)
          const boundsMaxY = Math.max(0, ...allYs)

          const boundsWidth = boundsMaxX - boundsMinX
          const boundsHeight = boundsMaxY - boundsMinY

          // Calculate scale needed to fit with padding (10% margin on each side)
          const padding = 0.1
          const scaleX = width * (1 - 2 * padding) / Math.max(boundsWidth, 1)
          const scaleY = height * (1 - 2 * padding) / Math.max(boundsHeight, 1)
          const fitScale = Math.min(scaleX, scaleY)

          // Use the smaller of current scale or fit scale (zoom out if needed to fit)
          // But don't zoom in beyond current scale just to fit
          if (fitScale < currentScale) {
            newScale = fitScale
          } else if (currentScale < 0.8) {
            // If very zoomed out, zoom in a bit to see detail
            newScale = Math.min(0.8, fitScale)
          }
        }
      }
      // Cap at reasonable bounds
      newScale = Math.max(0.1, Math.min(newScale, 3))

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
