/**
 * Benchmark: D3 Cluster Layout Performance
 *
 * Tests whether D3's cluster layout is fast enough for our hierarchical visualization.
 *
 * Run with: npx tsx scripts/benchmark_d3_cluster.ts
 */

import * as d3 from 'd3'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

// Types
interface RawNode {
  id: string | number
  label: string
  layer: number
  parent?: string | number
  children?: (string | number)[]
  importance?: number
  shap_importance?: number
}

interface GraphData {
  nodes: RawNode[]
}

interface HierarchyNode {
  id: string
  layer: number
  importance: number
  children?: HierarchyNode[]
}

interface BenchmarkResult {
  node_count: number
  iterations: number
  avg_time_ms: number
  min_time_ms: number
  max_time_ms: number
  std_dev_ms: number
  separation_calls: number
}

interface BenchmarkReport {
  timestamp: string
  small_graph: BenchmarkResult
  medium_graph: BenchmarkResult
  large_graph: BenchmarkResult
  naive_baseline: BenchmarkResult
  performance_comparison: {
    d3_vs_naive_ratio: number
    acceptable: boolean
  }
  passes_performance_targets: boolean
  recommendation: string
  reasoning: string
}

// Performance targets (ms)
const TARGETS = {
  small: 10,
  medium: 50,
  large: 200
}

/**
 * Load graph data from JSON file
 */
function loadGraphData(): GraphData {
  const dataPath = join(process.cwd(), 'public/data/v2_1_visualization_final.json')
  const raw = readFileSync(dataPath, 'utf-8')
  return JSON.parse(raw)
}

/**
 * Build hierarchy structure from flat node list
 */
function buildHierarchy(nodes: RawNode[]): HierarchyNode {
  const nodeMap = new Map<string, HierarchyNode>()

  // Create hierarchy nodes
  for (const node of nodes) {
    nodeMap.set(String(node.id), {
      id: String(node.id),
      layer: node.layer,
      importance: node.importance ?? node.shap_importance ?? 0.5,
      children: []
    })
  }

  // Link parent-child relationships
  for (const node of nodes) {
    if (node.parent !== undefined) {
      const parent = nodeMap.get(String(node.parent))
      const child = nodeMap.get(String(node.id))
      if (parent && child) {
        parent.children!.push(child)
      }
    }
  }

  // Find root
  const root = nodeMap.get('root') || nodeMap.values().next().value
  return root
}

/**
 * Filter hierarchy to only include nodes up to a certain depth or count
 */
function filterHierarchy(root: HierarchyNode, maxNodes: number): HierarchyNode {
  let nodeCount = 0

  function clone(node: HierarchyNode, depth: number): HierarchyNode | null {
    if (nodeCount >= maxNodes) return null
    nodeCount++

    const cloned: HierarchyNode = {
      id: node.id,
      layer: node.layer,
      importance: node.importance
    }

    if (node.children && node.children.length > 0) {
      const clonedChildren: HierarchyNode[] = []
      for (const child of node.children) {
        const clonedChild = clone(child, depth + 1)
        if (clonedChild) clonedChildren.push(clonedChild)
      }
      if (clonedChildren.length > 0) {
        cloned.children = clonedChildren
      }
    }

    return cloned
  }

  return clone(root, 0)!
}

/**
 * Count nodes in hierarchy
 */
function countNodes(root: HierarchyNode): number {
  let count = 1
  if (root.children) {
    for (const child of root.children) {
      count += countNodes(child)
    }
  }
  return count
}

/**
 * Compute SHAP-based node size (simulates real calculation)
 */
function computeSHAPSize(importance: number, layer: number): number {
  const baseRanges = [
    { min: 12, max: 12 },
    { min: 3, max: 18 },
    { min: 2, max: 14 },
    { min: 2, max: 12 },
    { min: 1.5, max: 10 },
    { min: 1, max: 8 }
  ]
  const multipliers = [1.0, 1.5, 2.4, 1.4, 0.8, 0.7]

  const range = baseRanges[layer] || { min: 2, max: 8 }
  const mult = multipliers[layer] || 1
  const min = range.min * mult
  const max = range.max * mult

  return min + (max - min) * Math.sqrt(importance)
}

/**
 * Run D3 cluster layout benchmark
 */
function benchmarkD3Cluster(
  root: HierarchyNode,
  iterations: number,
  ringGap: number = 150
): BenchmarkResult {
  let separationCalls = 0
  const times: number[] = []

  // Create d3 hierarchy once (this part is shared)
  const hierarchy = d3.hierarchy(root)

  for (let i = 0; i < iterations; i++) {
    separationCalls = 0

    const start = performance.now()

    // Create cluster layout
    const cluster = d3.cluster<HierarchyNode>()
      .size([2 * Math.PI, 1]) // Angular layout
      .separation((a, b) => {
        separationCalls++

        // Realistic separation function
        const sizeA = computeSHAPSize(a.data.importance, a.depth)
        const sizeB = computeSHAPSize(b.data.importance, b.depth)
        const ringRadius = a.depth * ringGap

        if (ringRadius === 0) return 1

        const minArc = sizeA + sizeB + 10 // 10px padding
        const angularSeparation = minArc / ringRadius

        // Normalize to 0-1 range for cluster layout
        return angularSeparation / (2 * Math.PI) * 10
      })

    // Run layout
    cluster(hierarchy)

    // Convert to x,y coordinates (simulates what we'd do in rendering)
    hierarchy.each(node => {
      const angle = node.x // Already in radians from cluster
      const radius = node.depth * ringGap
      node.x = radius * Math.cos(angle)
      node.y = radius * Math.sin(angle)
    })

    const end = performance.now()
    times.push(end - start)
  }

  const avg = times.reduce((a, b) => a + b, 0) / times.length
  const min = Math.min(...times)
  const max = Math.max(...times)
  const variance = times.reduce((sum, t) => sum + (t - avg) ** 2, 0) / times.length
  const stdDev = Math.sqrt(variance)

  return {
    node_count: countNodes(root),
    iterations,
    avg_time_ms: Math.round(avg * 100) / 100,
    min_time_ms: Math.round(min * 100) / 100,
    max_time_ms: Math.round(max * 100) / 100,
    std_dev_ms: Math.round(stdDev * 100) / 100,
    separation_calls: separationCalls
  }
}

/**
 * Naive baseline: just evenly distribute nodes around circles
 */
function benchmarkNaiveLayout(
  root: HierarchyNode,
  iterations: number,
  ringGap: number = 150
): BenchmarkResult {
  const times: number[] = []

  // Flatten hierarchy
  const nodes: Array<{ id: string; layer: number; importance: number }> = []
  function flatten(node: HierarchyNode) {
    nodes.push({ id: node.id, layer: node.layer, importance: node.importance })
    if (node.children) {
      for (const child of node.children) {
        flatten(child)
      }
    }
  }
  flatten(root)

  for (let i = 0; i < iterations; i++) {
    const start = performance.now()

    // Group by layer
    const byLayer = new Map<number, typeof nodes>()
    for (const node of nodes) {
      if (!byLayer.has(node.layer)) byLayer.set(node.layer, [])
      byLayer.get(node.layer)!.push(node)
    }

    // Position nodes
    const positioned: Array<{ id: string; x: number; y: number }> = []
    for (const [layer, layerNodes] of byLayer) {
      const radius = layer * ringGap
      const angleStep = (2 * Math.PI) / layerNodes.length

      layerNodes.forEach((node, idx) => {
        const angle = idx * angleStep - Math.PI / 2
        positioned.push({
          id: node.id,
          x: radius * Math.cos(angle),
          y: radius * Math.sin(angle)
        })
      })
    }

    const end = performance.now()
    times.push(end - start)
  }

  const avg = times.reduce((a, b) => a + b, 0) / times.length
  const min = Math.min(...times)
  const max = Math.max(...times)
  const variance = times.reduce((sum, t) => sum + (t - avg) ** 2, 0) / times.length
  const stdDev = Math.sqrt(variance)

  return {
    node_count: nodes.length,
    iterations,
    avg_time_ms: Math.round(avg * 100) / 100,
    min_time_ms: Math.round(min * 100) / 100,
    max_time_ms: Math.round(max * 100) / 100,
    std_dev_ms: Math.round(stdDev * 100) / 100,
    separation_calls: 0
  }
}

/**
 * Main benchmark runner
 */
async function runBenchmarks() {
  console.log('Loading graph data...')
  const data = loadGraphData()
  console.log(`Loaded ${data.nodes.length} nodes`)

  console.log('\nBuilding hierarchy...')
  const fullHierarchy = buildHierarchy(data.nodes)
  const fullCount = countNodes(fullHierarchy)
  console.log(`Full hierarchy: ${fullCount} nodes`)

  // Create test datasets
  console.log('\nCreating test datasets...')
  const smallHierarchy = filterHierarchy(fullHierarchy, 10)
  const mediumHierarchy = filterHierarchy(fullHierarchy, 50)
  const largeHierarchy = fullHierarchy // Full tree

  console.log(`Small: ${countNodes(smallHierarchy)} nodes`)
  console.log(`Medium: ${countNodes(mediumHierarchy)} nodes`)
  console.log(`Large: ${countNodes(largeHierarchy)} nodes`)

  const iterations = 100

  // Run benchmarks
  console.log('\n--- Running D3 Cluster Benchmarks ---\n')

  console.log('Small graph (10 nodes)...')
  const smallResult = benchmarkD3Cluster(smallHierarchy, iterations)
  console.log(`  Avg: ${smallResult.avg_time_ms}ms, Separation calls: ${smallResult.separation_calls}`)

  console.log('Medium graph (50 nodes)...')
  const mediumResult = benchmarkD3Cluster(mediumHierarchy, iterations)
  console.log(`  Avg: ${mediumResult.avg_time_ms}ms, Separation calls: ${mediumResult.separation_calls}`)

  console.log('Large graph (full tree)...')
  const largeResult = benchmarkD3Cluster(largeHierarchy, iterations)
  console.log(`  Avg: ${largeResult.avg_time_ms}ms, Separation calls: ${largeResult.separation_calls}`)

  // Naive baseline
  console.log('\n--- Running Naive Baseline ---\n')
  console.log('Large graph (full tree)...')
  const naiveResult = benchmarkNaiveLayout(largeHierarchy, iterations)
  console.log(`  Avg: ${naiveResult.avg_time_ms}ms`)

  // Analyze results
  const d3VsNaiveRatio = largeResult.avg_time_ms / naiveResult.avg_time_ms
  const ratioAcceptable = d3VsNaiveRatio < 5

  const passesSmall = smallResult.avg_time_ms < TARGETS.small
  const passesMedium = mediumResult.avg_time_ms < TARGETS.medium
  const passesLarge = largeResult.avg_time_ms < TARGETS.large
  const passesAll = passesSmall && passesMedium && passesLarge

  // Generate recommendation
  let recommendation: string
  let reasoning: string

  if (passesAll) {
    recommendation = 'Use D3 cluster'
    reasoning = `All performance targets met. Small: ${smallResult.avg_time_ms}ms < ${TARGETS.small}ms ✅, Medium: ${mediumResult.avg_time_ms}ms < ${TARGETS.medium}ms ✅, Large: ${largeResult.avg_time_ms}ms < ${TARGETS.large}ms ✅. D3 cluster is ${d3VsNaiveRatio.toFixed(1)}× slower than naive but acceptable.`
  } else if (passesSmall && passesMedium) {
    recommendation = 'Use D3 cluster with caution'
    reasoning = `Small and medium graphs pass targets, but large graph (${largeResult.avg_time_ms}ms) exceeds ${TARGETS.large}ms limit. Consider: (1) Use D3 cluster but warn users about full expansion, (2) Pre-filter visible nodes before layout, (3) Use custom algorithm for large graphs only.`
  } else {
    recommendation = 'Use custom algorithm'
    reasoning = `D3 cluster too slow. Small: ${smallResult.avg_time_ms}ms ${passesSmall ? '✅' : '❌'}, Medium: ${mediumResult.avg_time_ms}ms ${passesMedium ? '✅' : '❌'}, Large: ${largeResult.avg_time_ms}ms ${passesLarge ? '✅' : '❌'}. D3 cluster is ${d3VsNaiveRatio.toFixed(1)}× slower than naive.`
  }

  // Build report
  const report: BenchmarkReport = {
    timestamp: new Date().toISOString(),
    small_graph: smallResult,
    medium_graph: mediumResult,
    large_graph: largeResult,
    naive_baseline: naiveResult,
    performance_comparison: {
      d3_vs_naive_ratio: Math.round(d3VsNaiveRatio * 100) / 100,
      acceptable: ratioAcceptable
    },
    passes_performance_targets: passesAll,
    recommendation,
    reasoning
  }

  // Save report
  const reportPath = join(process.cwd(), 'public/data/d3_cluster_benchmark.json')
  writeFileSync(reportPath, JSON.stringify(report, null, 2))
  console.log(`\nReport saved to: ${reportPath}`)

  // Print summary
  console.log('\n' + '='.repeat(60))
  console.log('BENCHMARK RESULTS SUMMARY')
  console.log('='.repeat(60))
  console.log(`\nPerformance Targets:`)
  console.log(`  Small (<${TARGETS.small}ms):  ${smallResult.avg_time_ms}ms ${passesSmall ? '✅ PASS' : '❌ FAIL'}`)
  console.log(`  Medium (<${TARGETS.medium}ms): ${mediumResult.avg_time_ms}ms ${passesMedium ? '✅ PASS' : '❌ FAIL'}`)
  console.log(`  Large (<${TARGETS.large}ms): ${largeResult.avg_time_ms}ms ${passesLarge ? '✅ PASS' : '❌ FAIL'}`)
  console.log(`\nD3 vs Naive Ratio: ${d3VsNaiveRatio.toFixed(1)}× ${ratioAcceptable ? '(acceptable)' : '(too slow)'}`)
  console.log(`\n${'─'.repeat(60)}`)
  console.log(`RECOMMENDATION: ${recommendation}`)
  console.log(`${'─'.repeat(60)}`)
  console.log(`\n${reasoning}`)
  console.log('')
}

// Run
runBenchmarks().catch(console.error)
