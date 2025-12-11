const fs = require('fs');
const data = JSON.parse(fs.readFileSync('public/data/v2_1_visualization_final.json', 'utf8'));

// Build parent-child map
const childrenByParent = new Map();
data.nodes.forEach(n => {
  if (n.parent !== undefined) {
    const parentKey = String(n.parent);
    if (!childrenByParent.has(parentKey)) childrenByParent.set(parentKey, []);
    childrenByParent.get(parentKey).push(n);
  }
});

// For each outcome (layer 1), count descendants at each layer
const outcomes = data.nodes.filter(n => n.layer === 1);
console.log('Descendants per outcome by layer:');
outcomes.forEach(outcome => {
  const countByLayer = {1: 1, 2: 0, 3: 0, 4: 0, 5: 0};

  function countDescendants(nodeId) {
    const children = childrenByParent.get(String(nodeId)) || [];
    children.forEach(child => {
      countByLayer[child.layer] = (countByLayer[child.layer] || 0) + 1;
      countDescendants(child.id);
    });
  }
  countDescendants(outcome.id);

  const total = Object.values(countByLayer).reduce((a,b) => a+b, 0);
  console.log(outcome.label + ': L2=' + countByLayer[2] + ', L3=' + countByLayer[3] + ', L4=' + countByLayer[4] + ', L5=' + countByLayer[5] + ' (total=' + total + ')');
});

// Total at each layer
console.log('\nTotals by layer:');
const totals = {};
data.nodes.forEach(n => {
  totals[n.layer] = (totals[n.layer] || 0) + 1;
});
console.log(totals);

// Calculate angular extent needed for each outcome's subtree
const RING_RADII = [0, 180, 380, 650, 1087, 2245];
const NODE_SIZES = [15, 12, 8, 6, 5, 3];
const PADDING = 2;

console.log('\nAngular space analysis (per outcome):');
console.log('Full circle = 2π = 6.28 radians = 360°');

let totalRequired = 0;
outcomes.forEach(outcome => {
  const countByLayer = {2: 0, 3: 0, 4: 0, 5: 0};
  function countDescendants(nodeId) {
    const children = childrenByParent.get(String(nodeId)) || [];
    children.forEach(child => {
      countByLayer[child.layer] = (countByLayer[child.layer] || 0) + 1;
      countDescendants(child.id);
    });
  }
  countDescendants(outcome.id);

  // Find max required extent across all layers
  let maxExtent = 0;
  let constrainingLayer = 0;
  for (let layer = 2; layer <= 5; layer++) {
    const count = countByLayer[layer];
    const radius = RING_RADII[layer];
    const nodeSize = NODE_SIZES[layer];
    const minArc = nodeSize * 2 + PADDING;
    const extent = (count * minArc) / radius;
    if (extent > maxExtent) {
      maxExtent = extent;
      constrainingLayer = layer;
    }
  }
  totalRequired += maxExtent;
  const degrees = (maxExtent * 180 / Math.PI).toFixed(1);
  console.log(outcome.label + ': ' + maxExtent.toFixed(3) + ' rad (' + degrees + '°) - constrained by L' + constrainingLayer);
});

console.log('\nTotal required: ' + totalRequired.toFixed(3) + ' rad (' + (totalRequired * 180 / Math.PI).toFixed(1) + '°)');
console.log('Available: 6.283 rad (360°)');
if (totalRequired <= 2 * Math.PI) {
  console.log('Fits: YES');
} else {
  console.log('Fits: NO - needs ' + (totalRequired / (2 * Math.PI) * 100).toFixed(0) + '% of circle');
}
