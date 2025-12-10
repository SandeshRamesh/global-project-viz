# Semantic Hierarchy Visualization v2.1

Interactive D3.js visualization of semantic hierarchies in a concentric ring layout.

## Features

- 6-ring hierarchical structure (Root → Outcomes → Coarse Domains → Fine Domains → Indicator Groups → Indicators)
- Interactive zoom and pan
- Color-coded domains
- Click nodes to view details
- Real-time statistics and ring breakdowns

## Quick Start

```bash
npm install
npm run dev
```

Open http://localhost:5173 in your browser.

## Build

```bash
npm run build
npm run preview
```

## Data Format

This version only supports v2.1 data format. The data file should be placed at `/public/v2_1_graph.json`.

See `CLAUDE.md` for detailed architecture documentation.
