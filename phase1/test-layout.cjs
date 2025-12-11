const fs = require('fs');
const data = JSON.parse(fs.readFileSync('public/data/v2_1_visualization_final.json', 'utf8'));

// Ring configs (base values - will be auto-computed)
const RING_CONFIGS = [
  { radius: 0, nodeSize: 15, label: 'Root' },
  { radius: 180, nodeSize: 12, label: 'Outcomes' },
  { radius: 380, nodeSize: 8, label: 'Coarse Domains' },
  { radius: 650, nodeSize: 6, label: 'Fine Domains' },
  { radius: 1000, nodeSize: 5, label: 'Indicator Groups' },
  { radius: 1450, nodeSize: 3, label: 'Indicators' },
];
const NODE_PADDING = 2;
const MIN_RING_GAP = 80;

// Build tree structure
const nodeById = new Map();
const childrenByParent = new Map();
data.nodes.forEach(n => {
  nodeById.set(String(n.id), n);
  if (n.parent !== undefined) {
    const pk = String(n.parent);
    if (!childrenByParent.has(pk)) childrenByParent.set(pk, []);
    childrenByParent.get(pk).push(n);
  }
});

const maxLayer = Math.max(...data.nodes.map(n => n.layer));

// Count nodes per layer
const nodeCountByLayer = new Map();
data.nodes.forEach(n => {
  nodeCountByLayer.set(n.layer, (nodeCountByLayer.get(n.layer) || 0) + 1);
});

// Build subtree info for hierarchical analysis
function buildSubtreeInfo(nodeId) {
  const node = nodeById.get(nodeId);
  const children = childrenByParent.get(nodeId) || [];
  const childInfos = children.map(c => buildSubtreeInfo(String(c.id)));

  const descendantCountByLayer = new Map();
  for (let i = 0; i <= maxLayer; i++) descendantCountByLayer.set(i, 0);
  descendantCountByLayer.set(node.layer, 1);

  for (const ci of childInfos) {
    for (const [layer, count] of ci.descendantCountByLayer) {
      descendantCountByLayer.set(layer, (descendantCountByLayer.get(layer) || 0) + count);
    }
  }

  return { id: nodeId, layer: node.layer, descendantCountByLayer, children: childInfos };
}

// Compute required radius for even distribution
function computeRequiredRadiusForEvenDistribution(nodeCount, nodeSize, nodePadding) {
  if (nodeCount <= 1) return 0;
  const minArcDistance = nodeSize * 2 + nodePadding;
  const requiredCircumference = nodeCount * minArcDistance;
  return requiredCircumference / (2 * Math.PI);
}

// Compute optimal ring radii with overcommitment scaling
function computeOptimalRingRadii() {
  // Build subtree info
  const roots = data.nodes.filter(n => n.parent === undefined);
  const subtreeInfos = roots.map(r => buildSubtreeInfo(String(r.id)));

  // Get first-level subtrees (children of root)
  let firstLevelSubtrees = [];
  if (subtreeInfos.length === 1 && subtreeInfos[0].children.length > 0) {
    firstLevelSubtrees = subtreeInfos[0].children;
  } else {
    firstLevelSubtrees = subtreeInfos;
  }

  // First pass: compute base radii
  const baseRings = [];
  let currentRadius = 0;

  for (let layer = 0; layer < RING_CONFIGS.length; layer++) {
    const ringConfig = RING_CONFIGS[layer];
    const nodeCount = nodeCountByLayer.get(layer) || 0;
    const requiredRadius = computeRequiredRadiusForEvenDistribution(nodeCount, ringConfig.nodeSize, NODE_PADDING);

    let radius = Math.max(requiredRadius, ringConfig.radius, layer === 0 ? 0 : currentRadius + MIN_RING_GAP);
    if (layer === 0 && nodeCount <= 1) radius = 0;

    baseRings.push({
      radius,
      nodeSize: ringConfig.nodeSize,
      nodeCount,
      requiredRadius
    });
    currentRadius = radius;
  }

  // Second pass: compute overcommitment factor
  let totalRequiredExtent = 0;

  for (const subtree of firstLevelSubtrees) {
    let maxExtent = 0;
    for (let layer = 0; layer <= maxLayer && layer < baseRings.length; layer++) {
      const count = subtree.descendantCountByLayer.get(layer) || 0;
      const ring = baseRings[layer];
      if (ring.radius > 0 && count > 0) {
        const minSpacing = ring.nodeSize * 2 + NODE_PADDING;
        const extent = (count * minSpacing) / ring.radius;
        maxExtent = Math.max(maxExtent, extent);
      }
    }
    totalRequiredExtent += maxExtent;
  }

  const overcommitmentFactor = totalRequiredExtent / (2 * Math.PI);
  const scaleFactor = Math.max(1, overcommitmentFactor);

  console.log('Overcommitment analysis:');
  console.log('  Total required extent: ' + totalRequiredExtent.toFixed(3) + ' rad (' + (totalRequiredExtent * 180 / Math.PI).toFixed(1) + '°)');
  console.log('  Available: 6.283 rad (360°)');
  console.log('  Overcommitment factor: ' + overcommitmentFactor.toFixed(3));
  console.log('  Scale factor: ' + scaleFactor.toFixed(3));
  console.log('');

  // Third pass: scale radii
  const computedRings = [];
  currentRadius = 0;

  for (let layer = 0; layer < baseRings.length; layer++) {
    const base = baseRings[layer];
    let radius = base.radius * scaleFactor;

    if (layer > 0) {
      radius = Math.max(radius, currentRadius + MIN_RING_GAP);
    }

    if (layer === 0 && base.nodeCount <= 1) {
      radius = 0;
    }

    computedRings.push({
      radius,
      nodeSize: base.nodeSize,
      nodeCount: base.nodeCount,
      requiredRadius: base.requiredRadius * scaleFactor
    });
    currentRadius = radius;
  }

  return computedRings;
}

const computedRings = computeOptimalRingRadii();

console.log('Computed ring radii (after scaling):');
computedRings.forEach((r, i) => {
  console.log('  Ring ' + i + ': ' + r.radius.toFixed(0) + 'px (' + r.nodeCount + ' nodes)');
});
console.log('');

// Build tree nodes with nodeCountByLayer
const treeNodes = new Map();
data.nodes.forEach(n => {
  treeNodes.set(String(n.id), {
    id: String(n.id),
    rawNode: n,
    children: [],
    subtreeLeafCount: 0,
    nodeCountByLayer: new Map()
  });
});

// Link children
const roots = [];
data.nodes.forEach(n => {
  const tn = treeNodes.get(String(n.id));
  if (n.parent !== undefined) {
    const parent = treeNodes.get(String(n.parent));
    if (parent) parent.children.push(tn);
  } else {
    roots.push(tn);
  }
});

// Compute subtree stats
function computeStats(node) {
  node.nodeCountByLayer = new Map();
  for (let i = 0; i <= maxLayer; i++) node.nodeCountByLayer.set(i, 0);
  node.nodeCountByLayer.set(node.rawNode.layer, 1);

  if (node.children.length === 0) {
    node.subtreeLeafCount = 1;
    return 1;
  }

  let leafTotal = 0;
  for (const child of node.children) {
    leafTotal += computeStats(child);
    for (const [layer, count] of child.nodeCountByLayer) {
      node.nodeCountByLayer.set(layer, (node.nodeCountByLayer.get(layer) || 0) + count);
    }
  }
  node.subtreeLeafCount = leafTotal;
  return leafTotal;
}

roots.forEach(r => computeStats(r));

// Position nodes
const positionedNodes = [];

function computeMinAngularExtent(nodeCount, ringConfig) {
  if (nodeCount === 0 || ringConfig.radius === 0) return 0;
  const minArcDistance = ringConfig.nodeSize * 2 + NODE_PADDING;
  return (nodeCount * minArcDistance) / ringConfig.radius;
}

function computeRequiredExtent(node) {
  let maxExtent = 0;
  for (const [layer, count] of node.nodeCountByLayer) {
    if (layer < computedRings.length && count > 0) {
      const extent = computeMinAngularExtent(count, computedRings[layer]);
      maxExtent = Math.max(maxExtent, extent);
    }
  }
  return maxExtent;
}

function positionSubtree(node, startAngle, angularExtent) {
  const layer = node.rawNode.layer;
  const ring = computedRings[layer];
  const centerAngle = startAngle + angularExtent / 2;

  const x = ring.radius * Math.cos(centerAngle);
  const y = ring.radius * Math.sin(centerAngle);

  positionedNodes.push({ id: node.id, layer, x, y, nodeSize: ring.nodeSize, angle: centerAngle, extent: angularExtent });

  if (node.children.length > 0) {
    const childExtents = [];
    let totalRequiredExtent = 0;

    for (const child of node.children) {
      const required = computeRequiredExtent(child);
      childExtents.push(required);
      totalRequiredExtent += required;
    }

    const scaleFactor = angularExtent / Math.max(totalRequiredExtent, 0.0001);

    let childStartAngle = startAngle;
    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i];
      const childAngularExtent = childExtents[i] * scaleFactor;
      positionSubtree(child, childStartAngle, childAngularExtent);
      childStartAngle += childAngularExtent;
    }
  }
}

// Position from root
const root = roots[0];
positionSubtree(root, -Math.PI / 2, 2 * Math.PI);

// Check for overlaps
function detectOverlaps() {
  const overlaps = [];
  const nodesByRing = new Map();

  for (const node of positionedNodes) {
    if (!nodesByRing.has(node.layer)) nodesByRing.set(node.layer, []);
    nodesByRing.get(node.layer).push(node);
  }

  for (const [layer, ringNodes] of nodesByRing) {
    const ring = computedRings[layer];
    const minDist = ring.nodeSize * 2 + NODE_PADDING;

    for (let i = 0; i < ringNodes.length; i++) {
      for (let j = i + 1; j < ringNodes.length; j++) {
        const n1 = ringNodes[i];
        const n2 = ringNodes[j];
        const dx = n1.x - n2.x;
        const dy = n1.y - n2.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < minDist) {
          overlaps.push({ n1: n1.id, n2: n2.id, layer, dist, minDist, gap: minDist - dist });
        }
      }
    }
  }

  return overlaps;
}

const overlaps = detectOverlaps();
console.log('Overlap check:');
console.log('  Total positioned nodes: ' + positionedNodes.length);
console.log('  Overlapping pairs: ' + overlaps.length);

if (overlaps.length > 0) {
  // Group overlaps by layer
  const overlapsByLayer = new Map();
  for (const o of overlaps) {
    overlapsByLayer.set(o.layer, (overlapsByLayer.get(o.layer) || 0) + 1);
  }
  console.log('  Overlaps per layer:');
  for (const [layer, count] of overlapsByLayer) {
    console.log('    Layer ' + layer + ': ' + count);
  }

  // Show worst overlaps
  overlaps.sort((a, b) => b.gap - a.gap);
  console.log('\n  Worst overlaps (largest gap):');
  for (let i = 0; i < Math.min(5, overlaps.length); i++) {
    const o = overlaps[i];
    console.log('    L' + o.layer + ': dist=' + o.dist.toFixed(2) + ' min=' + o.minDist + ' gap=' + o.gap.toFixed(2));
  }
}

// Analyze angular allocation for first-level subtrees
console.log('\nFirst-level subtree angular allocation:');
const outcomeNodes = positionedNodes.filter(n => n.layer === 1);
outcomeNodes.forEach(n => {
  const degrees = (n.extent * 180 / Math.PI).toFixed(1);
  const rawNode = nodeById.get(n.id);
  const label = rawNode ? rawNode.label.substring(0, 30) : n.id;
  console.log('  ' + label + ': ' + degrees + '°');
});
