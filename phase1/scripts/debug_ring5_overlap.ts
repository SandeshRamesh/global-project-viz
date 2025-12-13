/**
 * Debug script to analyze Ring 5 overlap issues
 * Run with: node --loader ts-node/esm scripts/debug_ring5_overlap.ts
 */

import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Load the data
const dataPath = path.join(__dirname, '../public/data/v2_1_visualization_final.json')
const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'))

interface RawNode {
  id: number | string
  label: string
  layer: number
  parent?: number | string
  importance?: number
  children?: (number | string)[]
}

interface SimNode {
  id: string
  ring: number
  importance: number
  parentId: string | null
  childIds: string[]
  angle?: number
  x?: number
  y?: number
  angularExtent?: number
}

// Config matching App.tsx
const RING_RADII = [0, 150, 300, 450, 600, 750]
const NODE_PADDING = 7

const SIZE_RANGES: Record<number, { min: number; max: number }> = {
  0: { min: 12, max: 12 },
  1: { min: 4, max: 20 },
  2: { min: 3, max: 16 },
  3: { min: 2, max: 12 },
  4: { min: 1.5, max: 8 },
  5: { min: 1, max: 6 },
}

function getNodeSize(ring: number, importance: number): number {
  const range = SIZE_RANGES[ring] || { min: 2, max: 8 }
  return range.min + (range.max - range.min) * Math.sqrt(importance)
}

function calculateNodeAngularSpace(nodeSize: number, radius: number, padding: number): number {
  if (radius === 0) return Math.PI * 2
  const minArcLength = nodeSize * 2 + padding
  return minArcLength / radius
}

// Build node map
const nodeMap = new Map<string, SimNode>()
const nodes: RawNode[] = data.nodes

for (const node of nodes) {
  const id = String(node.id)
  nodeMap.set(id, {
    id,
    ring: node.layer,
    importance: node.importance ?? 0,
    parentId: node.parent !== undefined ? String(node.parent) : null,
    childIds: (node.children || []).map(c => String(c))
  })
}

// Find ring 5 nodes grouped by their ring 4 parent
const ring5ByParent = new Map<string, SimNode[]>()
const ring4Nodes: SimNode[] = []

for (const node of nodeMap.values()) {
  if (node.ring === 4) {
    ring4Nodes.push(node)
  }
  if (node.ring === 5 && node.parentId) {
    if (!ring5ByParent.has(node.parentId)) {
      ring5ByParent.set(node.parentId, [])
    }
    ring5ByParent.get(node.parentId)!.push(node)
  }
}

console.log('=== RING 5 ANALYSIS ===\n')
console.log(`Total Ring 4 (Indicator Groups): ${ring4Nodes.length}`)
console.log(`Total Ring 5 (Indicators): ${Array.from(ring5ByParent.values()).flat().length}`)

// Analyze each ring 4 parent
const ring5Radius = RING_RADII[5]
const ring5Circumference = 2 * Math.PI * ring5Radius
console.log(`\nRing 5 radius: ${ring5Radius}px`)
console.log(`Ring 5 circumference: ${ring5Circumference.toFixed(0)}px`)

// Find problematic parents (too many children for their angular extent)
interface ParentAnalysis {
  parentId: string
  parentLabel: string
  childCount: number
  totalSpaceNeeded: number
  avgChildSize: number
  minChildSize: number
  maxChildSize: number
}

const analyses: ParentAnalysis[] = []

for (const [parentId, children] of ring5ByParent) {
  const parent = nodeMap.get(parentId)
  if (!parent) continue

  const parentNode = nodes.find(n => String(n.id) === parentId)
  const parentLabel = parentNode?.label || 'Unknown'

  // Calculate space needed for these children
  let totalSpaceNeeded = 0
  let minSize = Infinity
  let maxSize = 0

  for (const child of children) {
    const size = getNodeSize(5, child.importance)
    const space = calculateNodeAngularSpace(size, ring5Radius, NODE_PADDING)
    totalSpaceNeeded += space
    minSize = Math.min(minSize, size)
    maxSize = Math.max(maxSize, size)
  }

  analyses.push({
    parentId,
    parentLabel,
    childCount: children.length,
    totalSpaceNeeded,
    avgChildSize: (minSize + maxSize) / 2,
    minChildSize: minSize,
    maxChildSize: maxSize
  })
}

// Sort by child count descending
analyses.sort((a, b) => b.childCount - a.childCount)

console.log('\n=== TOP 20 LARGEST INDICATOR GROUPS (Ring 4 parents) ===\n')
console.log('Parent Label                          | Children | Space Needed (rad) | Node Sizes')
console.log('--------------------------------------|----------|-------------------|------------')

for (let i = 0; i < Math.min(20, analyses.length); i++) {
  const a = analyses[i]
  const label = a.parentLabel.substring(0, 37).padEnd(37)
  const count = String(a.childCount).padStart(8)
  const space = a.totalSpaceNeeded.toFixed(3).padStart(17)
  const sizes = `${a.minChildSize.toFixed(1)}-${a.maxChildSize.toFixed(1)}`
  console.log(`${label} | ${count} | ${space} | ${sizes}`)
}

// Now simulate the actual layout to see angular extents
console.log('\n=== SIMULATING LAYOUT ===\n')

// Build tree structure
interface TreeNode {
  id: string
  ring: number
  importance: number
  children: TreeNode[]
  parent: TreeNode | null
  subtreeLeafCount: number
}

const treeNodeMap = new Map<string, TreeNode>()

for (const node of nodeMap.values()) {
  treeNodeMap.set(node.id, {
    id: node.id,
    ring: node.ring,
    importance: node.importance,
    children: [],
    parent: null,
    subtreeLeafCount: 0
  })
}

// Build relationships
let root: TreeNode | null = null
for (const node of nodeMap.values()) {
  const treeNode = treeNodeMap.get(node.id)!
  if (node.parentId) {
    const parent = treeNodeMap.get(node.parentId)
    if (parent) {
      parent.children.push(treeNode)
      treeNode.parent = parent
    }
  } else {
    root = treeNode
  }
}

// Compute leaf counts
function computeLeafCount(node: TreeNode): number {
  if (node.children.length === 0) {
    node.subtreeLeafCount = 1
    return 1
  }
  let total = 0
  for (const child of node.children) {
    total += computeLeafCount(child)
  }
  node.subtreeLeafCount = total
  return total
}

if (root) {
  computeLeafCount(root)
}

// Simulate positioning
interface PositionedNode {
  id: string
  ring: number
  startAngle: number
  angularExtent: number
  childCount: number
}

const positioned: PositionedNode[] = []

function simulatePosition(
  node: TreeNode,
  startAngle: number,
  angularExtent: number
): void {
  positioned.push({
    id: node.id,
    ring: node.ring,
    startAngle,
    angularExtent,
    childCount: node.children.length
  })

  if (node.children.length === 0) return

  const childRing = node.ring + 1
  if (childRing > 5) return

  const childRadius = RING_RADII[childRing]

  // Calculate child space needs
  const childSpaceNeeds = node.children.map(child => {
    const size = getNodeSize(childRing, child.importance)
    return calculateNodeAngularSpace(size, childRadius, NODE_PADDING)
  })

  const totalNeeded = childSpaceNeeds.reduce((a, b) => a + b, 0)

  // Distribute space
  let childExtents: number[]
  if (totalNeeded <= angularExtent) {
    // Excess - distribute equally
    const excess = angularExtent - totalNeeded
    const perChild = excess / node.children.length
    childExtents = childSpaceNeeds.map(min => min + perChild)
  } else {
    // Compress
    const ratio = angularExtent / totalNeeded
    childExtents = childSpaceNeeds.map(min => min * ratio)
  }

  // Center on parent midpoint
  const midAngle = startAngle + angularExtent / 2
  const totalChildExtent = childExtents.reduce((a, b) => a + b, 0)
  let currentAngle = midAngle - totalChildExtent / 2

  for (let i = 0; i < node.children.length; i++) {
    simulatePosition(node.children[i], currentAngle, childExtents[i])
    currentAngle += childExtents[i]
  }
}

if (root) {
  simulatePosition(root, -Math.PI / 2, Math.PI * 2)
}

// Analyze ring 4 nodes and their angular extents
const ring4Positioned = positioned.filter(p => p.ring === 4)
ring4Positioned.sort((a, b) => b.childCount - a.childCount)

console.log('=== RING 4 ANGULAR EXTENTS (sorted by child count) ===\n')
console.log('Ring 4 Node ID | Children | Angular Extent (deg) | Space per child (deg)')
console.log('---------------|----------|---------------------|---------------------')

for (let i = 0; i < Math.min(20, ring4Positioned.length); i++) {
  const p = ring4Positioned[i]
  const extentDeg = (p.angularExtent * 180 / Math.PI).toFixed(2)
  const perChild = p.childCount > 0
    ? ((p.angularExtent / p.childCount) * 180 / Math.PI).toFixed(3)
    : 'N/A'

  console.log(`${p.id.padEnd(14)} | ${String(p.childCount).padStart(8)} | ${extentDeg.padStart(19)} | ${perChild.padStart(20)}`)
}

// Find ring 5 nodes with smallest angular extents (most compressed)
const ring5Positioned = positioned.filter(p => p.ring === 5)
ring5Positioned.sort((a, b) => a.angularExtent - b.angularExtent)

console.log('\n=== RING 5 NODES WITH SMALLEST ANGULAR EXTENTS ===\n')
console.log('Node ID        | Angular Extent (deg) | Arc Length at 750px')
console.log('---------------|---------------------|--------------------')

for (let i = 0; i < Math.min(20, ring5Positioned.length); i++) {
  const p = ring5Positioned[i]
  const extentDeg = (p.angularExtent * 180 / Math.PI).toFixed(4)
  const arcLength = (p.angularExtent * ring5Radius).toFixed(2)

  console.log(`${p.id.padEnd(14)} | ${extentDeg.padStart(19)} | ${arcLength.padStart(19)}`)
}

// Check for actual overlaps
console.log('\n=== CHECKING FOR OVERLAPS IN SIMULATION ===\n')

// Position all ring 5 nodes with actual x,y
interface Ring5Position {
  id: string
  importance: number
  angle: number
  x: number
  y: number
  size: number
}

const ring5Positions: Ring5Position[] = []

for (const p of ring5Positioned) {
  const node = nodeMap.get(p.id)!
  const midAngle = p.startAngle + p.angularExtent / 2
  const size = getNodeSize(5, node.importance)

  ring5Positions.push({
    id: p.id,
    importance: node.importance,
    angle: midAngle,
    x: ring5Radius * Math.cos(midAngle),
    y: ring5Radius * Math.sin(midAngle),
    size
  })
}

// Sort by angle
ring5Positions.sort((a, b) => a.angle - b.angle)

// Check adjacent pairs for overlap
let overlapCount = 0
const worstOverlaps: Array<{
  n1: string
  n2: string
  distance: number
  minDist: number
  overlap: number
}> = []

for (let i = 0; i < ring5Positions.length; i++) {
  const n1 = ring5Positions[i]
  const n2 = ring5Positions[(i + 1) % ring5Positions.length]

  const dx = n2.x - n1.x
  const dy = n2.y - n1.y
  const distance = Math.sqrt(dx * dx + dy * dy)
  const minDist = n1.size + n2.size + NODE_PADDING

  if (distance < minDist) {
    overlapCount++
    worstOverlaps.push({
      n1: n1.id,
      n2: n2.id,
      distance,
      minDist,
      overlap: minDist - distance
    })
  }
}

worstOverlaps.sort((a, b) => b.overlap - a.overlap)

console.log(`Total adjacent overlaps on Ring 5: ${overlapCount}`)
console.log('\n=== WORST 20 OVERLAPS ===\n')
console.log('Node 1         | Node 2         | Distance | Min Dist | Overlap')
console.log('---------------|----------------|----------|----------|--------')

for (let i = 0; i < Math.min(20, worstOverlaps.length); i++) {
  const o = worstOverlaps[i]
  console.log(`${o.n1.padEnd(14)} | ${o.n2.padEnd(14)} | ${o.distance.toFixed(2).padStart(8)} | ${o.minDist.toFixed(2).padStart(8)} | ${o.overlap.toFixed(2).padStart(6)}`)
}

// Find which parent these overlapping nodes belong to
console.log('\n=== PARENTS OF OVERLAPPING NODES ===\n')

const overlappingParents = new Map<string, number>()
for (const o of worstOverlaps) {
  const n1 = nodeMap.get(o.n1)
  const n2 = nodeMap.get(o.n2)
  if (n1?.parentId) {
    overlappingParents.set(n1.parentId, (overlappingParents.get(n1.parentId) || 0) + 1)
  }
  if (n2?.parentId && n2.parentId !== n1?.parentId) {
    overlappingParents.set(n2.parentId, (overlappingParents.get(n2.parentId) || 0) + 1)
  }
}

const sortedParents = Array.from(overlappingParents.entries())
  .sort((a, b) => b[1] - a[1])
  .slice(0, 10)

for (const [parentId, count] of sortedParents) {
  const parent = nodes.find(n => String(n.id) === parentId)
  const children = ring5ByParent.get(parentId)
  console.log(`Parent: ${parent?.label || parentId}`)
  console.log(`  - Overlapping nodes: ${count}`)
  console.log(`  - Total children: ${children?.length || 0}`)
  console.log('')
}

// Key insight: Check if overlaps happen BETWEEN different parents' children
console.log('\n=== CROSS-PARENT VS SAME-PARENT OVERLAPS ===\n')

let sameParent = 0
let crossParent = 0

for (const o of worstOverlaps) {
  const n1 = nodeMap.get(o.n1)
  const n2 = nodeMap.get(o.n2)
  if (n1?.parentId === n2?.parentId) {
    sameParent++
  } else {
    crossParent++
  }
}

console.log(`Same-parent overlaps: ${sameParent}`)
console.log(`Cross-parent overlaps: ${crossParent}`)

// This is KEY - if most overlaps are cross-parent, the issue is that
// adjacent Ring 4 parents' children are overlapping at the boundary
console.log('\n=== DIAGNOSIS ===\n')

if (crossParent > sameParent) {
  console.log('ISSUE IDENTIFIED: Most overlaps are CROSS-PARENT')
  console.log('This means Ring 4 siblings are positioned too close together,')
  console.log('causing their Ring 5 children to overlap at the boundaries.')
  console.log('')
  console.log('FIX: The algorithm needs to account for the TOTAL angular extent')
  console.log('needed by each Ring 4 node\'s children when positioning Ring 4 nodes.')
} else {
  console.log('Most overlaps are SAME-PARENT')
  console.log('This means individual Ring 4 parents have too many children')
  console.log('to fit in their allocated angular extent.')
  console.log('')
  console.log('FIX: Ring 4 parents need more angular space, which requires')
  console.log('propagating Ring 5 space requirements upward.')
}
