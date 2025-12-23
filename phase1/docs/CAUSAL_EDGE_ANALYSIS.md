# Causal Edge Analysis Report

## Executive Summary

| Metric | Value |
|--------|-------|
| Total causal edges | 7,368 |
| Meaningful edges (\|β\| ≤ 100) | 7,218 (98%) |
| Feedback loops | **0** (DAG - no cycles) |
| Within-sector edges | 1,720 (24%) |
| Cross-sector edges | 5,498 (76%) |

**Key Findings:**
1. Graph is a DAG - no feedback loops to worry about
2. Most edges are cross-sector (76%) - Local View will show rich connections
3. Most nodes are "sinks" (many inputs, few outputs)
4. Beta distribution is right-skewed: median = 0.29, 90th percentile = 1.79

---

## 1. Beta Distribution Analysis

### Percentile Distribution

| Percentile | Beta Value |
|------------|------------|
| 10th | 0.13 |
| 25th | 0.17 |
| **50th (Median)** | **0.29** |
| 75th | 0.63 |
| 90th | 1.79 |
| 95th | 3.71 |
| 99th | 30.03 |

### Distribution by Range

| Beta Range | Edge Count | Percentage |
|------------|------------|------------|
| 0.0 - 0.1 | 216 | 3.0% |
| 0.1 - 0.25 | 2,964 | **41.1%** |
| 0.25 - 0.5 | 1,821 | 25.2% |
| 0.5 - 1.0 | 1,037 | 14.4% |
| 1.0 - 2.0 | 536 | 7.4% |
| 2.0 - 5.0 | 363 | 5.0% |
| 5.0 - 10.0 | 115 | 1.6% |
| 10.0 - 100.0 | 166 | 2.3% |

### Threshold Recommendations

| Filter Goal | Threshold | Edges Shown |
|-------------|-----------|-------------|
| Top 10% only | \|β\| ≥ 1.79 | 722 edges |
| Top 25% | \|β\| ≥ 0.63 | 1,806 edges |
| Top 50% | \|β\| ≥ 0.29 | 3,609 edges |
| All meaningful | \|β\| ≥ 0.08 | 7,218 edges |

**Recommendation:** Default threshold = **0.5** (shows ~2,200 strongest edges, 30%)

---

## 2. Sample Target Node Analysis

### Top Nodes by Edge Count

| Node | Inputs | Outputs | Ring |
|------|--------|---------|------|
| Civil Society Organizations in Universities | 212 | 0 | 5 |
| Executive Legitimacy Performance Data | 143 | 1 | 5 |
| Full-Time Teachers in Middle School | 140 | 0 | 5 |
| Executive Legitimacy Ideology | 139 | 0 | 5 |
| Household spending on goods/services | 131 | 0 | 5 |
| Armed Conflict Minimum Severity | 121 | 1 | 5 |
| High School Student Support Programs | 111 | 2 | 5 |

**Pattern:** Most high-traffic nodes are **sinks** (many inputs, 0-2 outputs). This simplifies Local View layout.

### Sample Target: Civil Society Organizations in Universities

- **Ring:** 5
- **Outcome:** Governance & Democracy
- **Inputs:** 212 (0 outputs)

**Inputs by sector:**
| Sector | Edge Count | Avg \|β\| |
|--------|------------|-----------|
| Education & Knowledge | 79 | 2.32 |
| Governance & Democracy | 39 | 4.91 |
| Environment & Sustainability | 24 | 1.64 |
| Income & Living Standards | 18 | 2.73 |
| Equality & Fairness | 18 | 5.56 |
| Employment & Work | 9 | 10.74 |
| Health & Longevity | 7 | 13.75 |

**Top 5 inputs:**
1. Human Capital Index → β = +84.80
2. Elite Political Activity on Social Media → β = +52.30
3. Boys' Expected Years in Primary School → β = +52.21
4. Access to Justice by Economic Class → β = +36.98
5. One-Sided Social Media Narratives → β = +36.68

---

## 3. Feedback Loop Analysis

**Result: Zero feedback loops detected.**

The causal graph is a pure DAG (Directed Acyclic Graph). This means:
- No circular dependencies (A→B→A)
- Layout algorithm can use standard topological sorting
- No need for special cycle-breaking logic

---

## 4. Cross-Sector Flow Matrix

### Edge Count by Sector Pair

```
From \ To          Edu   Emp   Env   Equ   Gov   Hea   Inc   Inf   Saf
─────────────────────────────────────────────────────────────────────
Education          956    55   168   119   409    67    81    78    61
Employment          86    20    42    36    71    26    37    26     8
Environment        337    53   129    72   154   108   119    98    24
Equality           147    18    73    52    72     4    42    56    12
Governance         311    39   100   110   255    10    62    60    23
Health             131    11    23    27    71    38    29    10     8
Income             283    43   133    89   137   144   127    77    26
Infrastructure     249    46   115    63    86    35    74   143    19
Safety              31     -    16     3    17     6    14     8     -
```

### Summary

- **Within-sector edges:** 1,720 (24%)
- **Cross-sector edges:** 5,498 (76%)

### Top 10 Cross-Sector Flows

| Source Sector | Target Sector | Edges | Σ\|β\| |
|---------------|---------------|-------|--------|
| Education | Governance | 409 | 365.8 |
| Environment | Education | 337 | 282.9 |
| Governance | Education | 311 | 386.4 |
| Income | Education | 283 | 943.1 |
| Infrastructure | Education | 249 | 380.9 |
| Education | Environment | 168 | 126.1 |
| Environment | Governance | 154 | 101.9 |
| Equality | Education | 147 | 1,309.5 |
| Income | Health | 144 | 122.7 |
| Income | Governance | 137 | 198.4 |

**Observation:** Education is the most connected sector (both as source and target).

---

## 5. Sample Local View Data

Created: `public/data/sample_local_view.json`

### Targets Selected

1. **Executive Legitimacy Performance Data Coverage**
   - Ring 5, Governance & Democracy
   - 141 inputs, 1 output

2. **Qualified Teachers - Lower Secondary (%)**
   - Ring 5, Education & Knowledge
   - 90 inputs, 1 output

### Data Statistics

| Metric | Value |
|--------|-------|
| Total nodes | 167 |
| Total edges | 233 |
| Input nodes | 163 |
| Target nodes | 2 |
| Output nodes | 2 |
| Beta range | 0.08 - 7.09 |

### Inputs by Sector

| Sector | Count |
|--------|-------|
| Education & Knowledge | 65 |
| Governance & Democracy | 21 |
| Environment & Sustainability | 18 |
| Income & Living Standards | 16 |
| Equality & Fairness | 15 |
| Infrastructure & Access | 13 |
| Employment & Work | 7 |
| Health & Longevity | 6 |
| Safety & Security | 2 |

---

## 6. Recommendations

### Default Beta Threshold

**Recommend: |β| ≥ 0.5**

- Shows top 30% of edges (~2,200)
- Filters noise while keeping meaningful relationships
- Users can adjust via slider (0.1 - 10.0 range)

### Typical Local View Complexity

For a Ring 5 indicator:
- **Inputs:** 50-150 edges (varies by node centrality)
- **Outputs:** 0-5 edges (most nodes are sinks)
- **Sectors represented:** 7-9 (almost always cross-sector)

### Visual Simplification

Since most nodes have 100+ inputs, suggest:
1. **Group by sector** in input layer
2. **Show top 10** strongest edges by default
3. **"+N more" button** to expand sector groups
4. **Sector filter checkboxes** to focus

### No Cycle Handling Needed

Graph is a DAG - standard Sugiyama layout works directly.

---

## 7. ASCII Local View Preview

```
╔═══════════════════════════════════════════════════════════════════╗
║                      LOCAL VIEW PREVIEW                           ║
╠═══════════════════════════════════════════════════════════════════╣
║                                                                   ║
║  INPUT LAYER (causes) - grouped by sector:                        ║
║                                                                   ║
║    Education (65 inputs)                                          ║
║      • Teacher Professional Autonomy         β=7.1                ║
║      • Gender Equality in Lower Secondary    β=5.8                ║
║      ... 63 more ...                                              ║
║                                                                   ║
║    Income (16 inputs)                                             ║
║      • Government Size in Economy            β=6.0                ║
║      • Investment Share of Economy           β=3.6                ║
║      ... 14 more ...                                              ║
║                                                                   ║
║                              │                                    ║
║                              ▼                                    ║
║  ┌────────────────────────────────────────────────────────┐       ║
║  │ Executive Legitimacy Performance Data Coverage         │       ║
║  │ Sector: Governance & Democracy                         │       ║
║  └────────────────────────────────────────────────────────┘       ║
║  ┌────────────────────────────────────────────────────────┐       ║
║  │ Qualified Teachers - Lower Secondary (%)               │       ║
║  │ Sector: Education & Knowledge                          │       ║
║  └────────────────────────────────────────────────────────┘       ║
║                              │                                    ║
║                              ▼                                    ║
║  OUTPUT LAYER (effects):                                          ║
║    • HIV and Sex Education Programs         β=0.34                ║
║    • Civil Society Organizations            β=0.18                ║
║                                                                   ║
╚═══════════════════════════════════════════════════════════════════╝
```

---

## 8. Implementation Notes

### Layout Strategy

Since nodes are mostly sinks (many inputs, few outputs):
- **3-layer layout** is optimal: Inputs → Target → Outputs
- No complex multi-level expansion needed
- Sector grouping on input layer reduces visual complexity

### Edge Rendering

- **Thickness:** Proportional to |β| (normalized to 1-10px)
- **Color:** Green for positive, red for negative
- **Hover:** Show exact beta, source indicator, target indicator

### Performance

- Average node: 100 inputs, 1 output
- At |β| ≥ 0.5 threshold: ~30 edges per target
- Rendering: No performance concerns at this scale
