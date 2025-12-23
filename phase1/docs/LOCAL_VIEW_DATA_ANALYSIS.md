# Local View Data Analysis

## Executive Summary

**Key Finding:** The visualization file (`v2_1_visualization_final.json`) already contains 7,368 causal edges with beta coefficients. These can be aggregated on-demand to create synthetic edges between Ring 1-3 nodes.

| Metric | Value |
|--------|-------|
| Total nodes | 2,583 |
| Hierarchical edges | 2,582 |
| Causal edges | 7,368 |
| Edges with moderators | 0 (in viz), 1,309 (in full causal file) |
| Computation time (all outcomes) | ~5ms |
| Memory for synthetic edges | ~13KB |

**Recommendation:** Use **on-demand computation** (not precomputation). It's fast enough (<5ms) and avoids memory overhead.

---

## 1. Edge Data Structure

### Schema

```typescript
interface HierarchicalEdge {
  source: string;       // Parent node ID
  target: string;       // Child node ID
  weight: 1.0;          // Always 1.0 for hierarchy
  relationship: 'hierarchical';
}

interface CausalEdge {
  source: string;       // Source indicator ID
  target: string;       // Target indicator ID
  weight: number;       // Beta coefficient (effect size)
  relationship: 'causal';
}
```

### Sample Causal Edge

```json
{
  "source": "NY.GDP.PCAP.KD",
  "target": "SP.DYN.LE00.IN",
  "weight": 0.4532,
  "relationship": "causal"
}
```

### File Location

Primary data file: `/public/data/v2_1_visualization_final.json`

Full causal graph (with moderators): `/public/data/causal_graph_v2_FINAL.json`

---

## 2. Node-to-Indicator Mapping

### Hierarchy Structure

```
Ring 0: Root (1 node)
   └── Ring 1: Outcomes (9 nodes)
         └── Ring 2: Coarse Domains (45 nodes)
               └── Ring 3: Fine Domains (196 nodes)
                     └── Ring 4: Indicator Groups (569 nodes)
                           └── Ring 5: Raw Indicators (1,763 nodes)
```

### Parent-Child Relationships

Each node has a `parent` field pointing to its parent:

```typescript
interface Node {
  id: string;
  label: string;
  layer: number;        // Ring number (0-5)
  parent?: string;      // Parent node ID
  children?: string[];  // Child node IDs (Ring 0-4 only)
  // ...
}
```

### Example: Finding Indicators Under an Outcome

```typescript
// Health & Longevity (Ring 1) → Ring 5 indicators
const healthOutcome = nodes.find(n => n.label === 'Health & Longevity');
const healthIndicators = getDescendants(healthOutcome.id, targetRing: 5);
// Result: 116 indicators
```

---

## 3. Edge Statistics

### Distribution by Ring

| Edge Type | Count | Percentage |
|-----------|-------|------------|
| Ring 0 → Ring 1 | 9 | 0.1% |
| Ring 1 → Ring 2 | 45 | 0.5% |
| Ring 2 → Ring 3 | 196 | 2.0% |
| Ring 3 → Ring 4 | 569 | 5.7% |
| Ring 4 → Ring 4 | 60 | 0.6% |
| Ring 4 → Ring 5 | 2,379 | 23.9% |
| Ring 5 → Ring 4 | 561 | 5.6% |
| Ring 5 → Ring 5 | 6,124 | 61.5% |
| **Total** | **9,950** | 100% |

### Causal vs Hierarchical

- **Hierarchical edges:** 2,582 (parent→child relationships)
- **Causal edges:** 7,368 (indicator→indicator relationships)

### Causal Edges by Ring

| Source Ring | Target Ring | Count |
|-------------|-------------|-------|
| Ring 4 | Ring 4 | 60 |
| Ring 4 | Ring 5 | ~700 |
| Ring 5 | Ring 4 | 561 |
| Ring 5 | Ring 5 | 6,124 |

**Key Finding:** There are NO causal edges between Ring 0-3 nodes. All causal relationships are at the indicator level (Ring 4-5).

---

## 4. Beta Coefficient Analysis

### Distribution

| Percentile | Beta Value |
|------------|------------|
| Min | 0.0750 |
| 25th | 0.1731 |
| 50th (Median) | 0.2922 |
| 75th | 0.6763 |
| 90th | 2.2708 |
| 95th | 6.6351 |
| 99th | 41,322,653 |
| Max | 1.7 trillion |

### Outlier Handling

**Problem:** Some beta values are extreme (up to trillions), likely due to unit scale issues.

**Solution:** Filter to `|β| ≤ 100` for aggregation:
- Captures 98% of edges (7,218 of 7,368)
- Removes data quality outliers
- Results in meaningful aggregated values

---

## 5. Sample Queries

### Query 1: Get All Edges

```typescript
const vizData = await fetch('/data/v2_1_visualization_final.json').then(r => r.json());
const allEdges = vizData.edges;
console.log('Total edges:', allEdges.length);  // 9,950
console.log('Sample edge:', allEdges[0]);
```

### Query 2: Find Indicators Under an Outcome

```typescript
function getDescendants(nodeId: string, targetRing?: number): Node[] {
  const descendants: Node[] = [];
  const queue = [nodeId];

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    for (const node of nodes) {
      if (node.parent === currentId) {
        if (targetRing === undefined || node.layer === targetRing) {
          descendants.push(node);
        }
        queue.push(node.id);
      }
    }
  }
  return descendants;
}

const healthOutcome = nodes.find(n => n.label === 'Health & Longevity');
const healthIndicators = getDescendants(healthOutcome.id, 5);
console.log('Health indicators:', healthIndicators.length);  // 116
```

### Query 3: Find Edges INTO an Indicator

```typescript
const lifeExpectancy = nodes.find(n => n.label.includes('Life Expectancy'));
const incomingEdges = allEdges.filter(e => e.target === lifeExpectancy.id);
console.log('Edges into Life Expectancy:', incomingEdges.length);
```

### Query 4: Check for High-Level Causal Edges

```typescript
const highLevelEdges = causalEdges.filter(e => {
  const source = nodeById.get(e.source);
  const target = nodeById.get(e.target);
  return source.layer <= 3 && target.layer <= 3;
});
console.log('Ring 0-3 causal edges:', highLevelEdges.length);  // 0
```

---

## 6. Aggregation Strategy

### Recommended: On-Demand with Caching

```typescript
interface SyntheticEdge {
  source: string;      // Ring 1-3 node ID
  target: string;      // Ring 1-3 node ID
  edgeCount: number;   // Number of indicator edges
  sumBeta: number;     // Sum of |β| values
  avgBeta: number;     // Average |β|
}

class SyntheticEdgeCache {
  private cache = new Map<string, SyntheticEdge[]>();
  private indicatorToOutcome = new Map<string, string>();

  constructor(nodes: Node[]) {
    // Precompute indicator→outcome mapping (1.2ms)
    for (const node of nodes) {
      if (node.layer >= 4) {
        const outcome = this.getAncestorAtRing(node.id, 1);
        if (outcome) {
          this.indicatorToOutcome.set(node.id, outcome.id);
        }
      }
    }
  }

  getSyntheticEdges(targetNode: Node): SyntheticEdge[] {
    if (this.cache.has(targetNode.id)) {
      return this.cache.get(targetNode.id)!;
    }

    // Compute on-demand (~0.5ms per outcome)
    const descendants = this.getDescendants(targetNode.id, 5);
    const descendantIds = new Set(descendants.map(d => d.id));

    const edgesBySource = new Map<string, { count: number; sumBeta: number }>();

    for (const edge of causalEdges) {
      if (descendantIds.has(edge.target) && Math.abs(edge.weight) <= 100) {
        const sourceOutcome = this.indicatorToOutcome.get(edge.source);
        if (sourceOutcome && sourceOutcome !== targetNode.id) {
          const existing = edgesBySource.get(sourceOutcome) || { count: 0, sumBeta: 0 };
          existing.count++;
          existing.sumBeta += Math.abs(edge.weight);
          edgesBySource.set(sourceOutcome, existing);
        }
      }
    }

    const result: SyntheticEdge[] = [];
    for (const [sourceId, data] of edgesBySource) {
      result.push({
        source: sourceId,
        target: targetNode.id,
        edgeCount: data.count,
        sumBeta: data.sumBeta,
        avgBeta: data.sumBeta / data.count
      });
    }

    this.cache.set(targetNode.id, result);
    return result;
  }
}
```

### Performance

| Operation | Time |
|-----------|------|
| Precompute indicator→outcome map | 1.2ms |
| Compute synthetic edges (1 outcome) | 0.5ms |
| Compute ALL synthetic edges (9 outcomes) | 4.8ms |
| Memory (71 synthetic edges) | ~13KB |

**Verdict:** On-demand computation is fast enough. No need for precomputation.

---

## 7. Synthetic Edge Results

### Health & Longevity Incoming

| Source Outcome | Edge Count | Σ\|β\| | Avg \|β\| |
|----------------|------------|--------|-----------|
| Income & Living Standards | 115 | 102.80 | 0.89 |
| Environment & Sustainability | 91 | 41.65 | 0.46 |
| Education & Knowledge | 43 | 143.88 | 3.35 |
| Health & Longevity (self) | 33 | 26.52 | 0.80 |
| Employment & Work | 23 | 9.49 | 0.41 |
| Infrastructure & Access | 22 | 16.50 | 0.75 |
| Governance & Democracy | 7 | 3.05 | 0.44 |
| Safety & Security | 6 | 1.61 | 0.27 |
| Equality & Fairness | 1 | 0.48 | 0.48 |

### All Outcomes Summary

Total synthetic edge pairs (outcome→outcome): **71**

---

## 8. Local View Implementation Recommendations

### Mode 1: High-Level View (Ring 1-3 selected)

When user clicks a Ring 1-3 node:
1. Compute synthetic edges on-demand (~0.5ms)
2. Display other outcomes/domains as sources
3. Edge thickness = `edgeCount` or `sumBeta`
4. Click edge → show breakdown

### Mode 2: Indicator View (Ring 4-5 selected)

When user clicks a Ring 4-5 node:
1. Return actual causal edges from `viz.edges`
2. Display source/target indicators directly
3. Edge thickness = `|beta|`

### Edge Rendering

```typescript
// Thickness based on edge count (normalized)
const maxCount = Math.max(...syntheticEdges.map(e => e.edgeCount));
const thickness = 2 + (edge.edgeCount / maxCount) * 8;  // 2-10px

// Color based on direction (all positive since aggregated absolute values)
const color = '#4CAF50';  // Green for positive aggregate
```

### Drill-Down Support

Store breakdown in synthetic edge for expandability:

```typescript
interface SyntheticEdge {
  // ... existing fields
  breakdown?: {
    sourceIndicator: string;
    targetIndicator: string;
    beta: number;
  }[];
}
```

---

## 9. Key Decisions Made

1. **Data Source:** Use `v2_1_visualization_final.json` (already has causal edges)
2. **Aggregation:** On-demand computation with lazy caching
3. **Outlier Handling:** Filter `|β| ≤ 100` (98% coverage)
4. **Aggregation Formula:** Sum of absolute betas (`Σ|β|`)
5. **Self-Loops:** Exclude (e.g., Health→Health indicators)
6. **Moderators:** Not included in viz file (available in full causal file if needed later)

---

## Appendix: Full Causal Graph

The full causal graph (`causal_graph_v2_FINAL.json`) contains additional data:

- 3,872 nodes (vs 2,583 in viz)
- 11,003 edges (vs 9,950 in viz)
- 21 causal layers (vs 6 rings)
- 1,309 edges with moderator effects

This could be used for advanced features later (moderator visualization, confidence intervals).
