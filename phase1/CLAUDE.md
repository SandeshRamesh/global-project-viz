# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a React + TypeScript + Vite application that visualizes semantic hierarchies using D3.js in a concentric ring layout. This version only supports the v2.1 data format with 6 hierarchical rings.

**Live Demo**: https://sandeshramesh.github.io/global-project-viz/

## Build and Development

```bash
npm run dev       # Start Vite dev server (http://localhost:5173)
npm run build     # Compile TypeScript and build for production
npm run preview   # Preview production build
npm run lint      # Run ESLint
npm run deploy    # Build and deploy to GitHub Pages
```

## Git Workflow

- `master` - Stable releases
- `dev` - Active development branch
- `gh-pages` - Built static files for GitHub Pages (auto-managed)

## Directory Structure

```
phase1/
├── docs/                    # Documentation
├── public/
│   └── data/                # Graph data files
│       ├── importance/      # SHAP importance computation outputs
│       ├── precompute/      # Precomputed graph variants
│       └── v2_1_visualization_final.json  # Primary data file
├── scripts/                 # Python utilities
│   ├── compute_shap_importance.py  # SHAP aggregation script
│   └── optimize_layout.py          # Layout optimization simulation
├── src/
│   ├── components/          # React components
│   ├── layouts/             # Layout algorithms
│   │   └── RadialLayout.ts  # Overlap-free radial layout with collision detection
│   ├── types/               # TypeScript interfaces
│   │   └── index.ts
│   ├── styles/              # CSS files
│   ├── App.tsx              # Main application component
│   └── main.tsx             # Entry point
├── vite.config.ts           # Vite config with GitHub Pages base path
└── package.json
```

## Architecture

### Data Format

v2.1 format with 6 rings:
- **Ring 0**: Root (single central node)
- **Ring 1**: Outcomes (9 Quality of Life categories)
- **Ring 2**: Coarse Domains
- **Ring 3**: Fine Domains
- **Ring 4**: Indicator Groups
- **Ring 5**: Indicators (1763 total)

Primary data file: `/public/data/v2_1_visualization_final.json`

### Node Data Structure

`RawNodeV21` interface in `src/types/index.ts`:
- `layer` (0-5): Ring position
- `node_type`: 'root' | 'outcome_category' | 'coarse_domain' | 'fine_domain' | 'indicator'
- `parent` / `children`: Hierarchical relationships
- `importance`: Normalized SHAP importance (0-1) for node sizing
- `shap_raw`: Raw aggregated SHAP value before normalization
- `domain` / `subdomain`: Categorization fields

### Layout Configuration

Fixed values in `src/App.tsx` (tuned for fully expanded view):

```typescript
// Ring gap (uniform spacing between all rings)
const DEFAULT_RING_GAP = 150  // Ring N is at radius N * 150px

// Node size multipliers per ring
const NODE_SIZE_MULTIPLIERS = [1.0, 1.5, 2.4, 1.4, 0.8, 0.7]

// Base size ranges (before multiplier, uses SHAP importance)
const BASE_SIZE_RANGES = [
  { min: 12, max: 12 },   // Ring 0: Root - fixed
  { min: 3, max: 18 },    // Ring 1: Outcomes
  { min: 2, max: 14 },    // Ring 2: Coarse Domains
  { min: 2, max: 12 },    // Ring 3: Fine Domains
  { min: 1.5, max: 10 },  // Ring 4: Indicator Groups
  { min: 1, max: 8 },     // Ring 5: Indicators
]
```

### Node Sizing Algorithm

Nodes are sized by SHAP importance using area-proportional scaling:
```typescript
size = min + (max - min) * sqrt(importance)
```
This ensures visual area (πr²) is proportional to importance value.

SHAP aggregation (computed by `scripts/compute_shap_importance.py`):
- Ring 5 indicators: Use raw SHAP values
- Rings 4-1: Sum of children's SHAP values
- Normalized to 0-1 range using global max

### Text Visibility

Labels appear/disappear per-ring based on zoom level:
- Effective font size = fontSize × zoomScale
- Ring shows labels if >50% would be readable (≥6px effective size)
- Ring 5 text is 35% of base size, Ring 4 is 70%

### Collision Detection

`RadialLayout.ts` detects overlaps using actual importance-based node sizes:
- Uses same sizing formula as rendering
- Reports in stats panel (should be 0 or minimal sub-pixel overlaps)

## Important Constants

Defined at the top of `App.tsx`:

- `RING_LABELS`: Names for each ring level
- `DEFAULT_RING_GAP`: 150px uniform spacing
- `NODE_SIZE_MULTIPLIERS`: Per-ring size scaling [1.0, 1.5, 2.4, 1.4, 0.8, 0.7]
- `BASE_SIZE_RANGES`: Min/max node sizes before multiplier
- `DOMAIN_COLORS`: Color mapping for 9 domains:
  - Health (#E91E63), Education (#FF9800), Economic (#4CAF50)
  - Governance (#9C27B0), Environment (#00BCD4), Demographics (#795548)
  - Security (#F44336), Development (#3F51B5), Research (#009688)

## UI Panels

- **Title header** (top center): Title and instructions
- **Stats panel** (top left): Visible/total nodes, outcomes, drivers, overlap count
- **Ring breakdown** (left): Node count per ring with expand/collapse buttons
- **Domain legend** (top right): Color-coded with counts
- **Hover tooltip** (bottom center): Node details on hover

## Deployment

GitHub Pages deployment:
```bash
npm run deploy  # Builds and pushes to gh-pages branch
```

The `vite.config.ts` sets `base: '/global-project-viz/'` for correct asset paths on GitHub Pages.
