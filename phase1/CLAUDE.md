# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a React + TypeScript + Vite application that visualizes semantic hierarchies using D3.js in a concentric ring layout. This version only supports the v2.1 data format with 6 hierarchical rings.

## Build and Development

```bash
npm run dev       # Start Vite dev server (http://localhost:5173)
npm run build     # Compile TypeScript and build for production
npm run preview   # Preview production build
npm run lint      # Run ESLint
```

## Architecture

### Data Format

This app only supports v2.1 format with 6 rings:
- **Ring 0**: Root (single central node)
- **Ring 1**: Outcomes (9 Quality of Life categories)
- **Ring 2**: Coarse Domains
- **Ring 3**: Fine Domains
- **Ring 4**: Indicator Groups
- **Ring 5**: Indicators

Primary data file: `/public/v2_1_graph.json`

Additional precomputed graphs are in `/public/precompute/` with naming convention:
`graph_{nodes}n_{layers}l_{scoring}.json` (e.g., `graph_0100n_05l_composite.json`)

### Node Data Structure

**v2.1 nodes** (`RawNodeV21` interface in `App.tsx`):
- `layer` (0-5): Ring position
- `node_type`: 'root' | 'outcome_category' | 'coarse_domain' | 'fine_domain' | 'indicator'
- `parent` / `children`: Hierarchical relationships
- `shap_importance`, `in_degree`, `out_degree`: Node metrics
- `domain` / `subdomain`: Categorization fields

### Rendering Pipeline

The entire visualization is contained in `src/App.tsx`. The `loadAndRender()` callback orchestrates:

1. **Data Loading**: Fetches JSON from `DATA_FILE` constant
2. **Layer Grouping**: Groups nodes by their `layer` field into `nodesByLayer`
3. **Parent-Child Mapping**: Builds `childrenByParent` map for hierarchical positioning
4. **Layer-by-Layer Positioning**:
   - Layer 0: Root at center (0,0)
   - Layer 1: Outcomes evenly distributed in circle
   - Layers 2-5: Positioned radially near parent nodes with decreasing angular spread
5. **D3 Rendering**: SVG with zoom/pan, ring circles, structural edges, colored nodes

**Key rendering concepts:**
- Nodes positioned in polar coordinates (radius from ring, angle from parent)
- `nodeMap`: Map<string, PositionedNode> for edge construction
- `structuralEdges`: Array of parent-child connections forming tree skeleton

### D3 Visualization Details

- Zoom/pan: Scale extent 0.05x to 4x
- Edge styling: Width and opacity decrease with depth (thicker for rings 0-2)
- Node colors: Gold for outcomes, blue for drivers, domain-specific colors for indicators
- Node sizes: 15px (root) → 12px (outcomes) → 8px → 6px → 5px → 3px (indicators)
- Labels: Only shown for Ring 1 (Outcomes)

### State Management

React state in `App.tsx`:
- `selectedNode`: Currently selected node for detail panel
- `stats`: Node/edge counts, outcomes, drivers
- `ringStats`: Array of {label, count} per ring
- `domainCounts`: Record<domain, count> for legend

## Important Constants

All defined at the top of `App.tsx`:

- `RING_CONFIGS`: Array defining radius and label for each of the 6 rings
- `DATA_FILE`: Path to the JSON data file (currently `/v2_1_graph.json`)
- `DOMAIN_COLORS`: Color mapping for 9 domain categories:
  - Health (#E91E63), Education (#FF9800), Economic (#4CAF50)
  - Governance (#9C27B0), Environment (#00BCD4), Demographics (#795548)
  - Security (#F44336), Development (#3F51B5), Research (#009688)

## UI Panels

- Title header (top center)
- Stats panel (top left): Totals for nodes, edges, outcomes, drivers
- Ring breakdown (left): Node count per ring
- Domain legend (top right): Color-coded with counts
- Node detail panel (bottom center): Appears on node click, shows label, description, domain tags
