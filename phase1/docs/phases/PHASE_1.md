# Phase 1: MVP - Path 1 Foundation 🔄 CURRENT

**Timeline:** Weeks 1-4

**Objective:** Functional Global + Local Views with core interactions

**Target Users:** Path 1 (Explorer) - policy researchers, NGO workers, curious citizens

---

## Week 1: Global View - Radial Layout Engine

### Visual Structure
- [ ] Implement radial/solar layout (8 outcome sectors, 45° wedges each)
- [ ] Position L2 nodes (45 coarse domains) in inner ring
- [ ] Position L3 nodes (196 fine domains) in middle ring
- [ ] Position L4 nodes (569 groups) in outer ring
- [ ] Position L5 nodes (1,763 indicators) collapsed by default

### Edge Rendering
- [ ] Draw hierarchical edges (parent-child, thick 3px solid lines)
- [ ] Draw causal edges (indicator-indicator, thin 1px translucent)
- [ ] Implement edge bundling for causal edges (hierarchical bundling algorithm)
- [ ] Apply opacity based on edge strength (0.3 baseline, 1.0 for selected)

### Visual Encoding
- [ ] Color code by domain (7 colors: Education blue, Economic green, etc.)
- [ ] Sector glow backgrounds (8 outcome colors, opacity 0.12)
- [ ] Node size: Uniform 40px circles (no size encoding yet)
- [ ] Node border: 2px for groups, 1px for indicators

### Interactions
- [ ] Click node → expand/collapse children (animate in 300ms)
- [ ] Auto-frame on expand (pan/zoom to keep expanded nodes visible)
- [ ] Hover node → show tooltip (name, domain, SHAP, degree)
- [ ] Hover edge → show tooltip (beta coefficient, confidence interval)
- [ ] Pan canvas (mouse drag)
- [ ] Zoom canvas (scroll wheel, min 0.5x, max 3.0x)

### Deliverables
- [ ] `GlobalView.jsx` component
- [ ] `RadialLayout.js` algorithm (force-directed with sector constraints)
- [ ] `EdgeBundling.js` utility (Holten 2006 implementation)
- [ ] Basic CSS styling (domain color palette, hover states)

---

## Week 2: Local View - Sugiyama DAG Flowchart

### Visual Structure
- [ ] Implement Sugiyama layered layout (vertical, top-down)
- [ ] Layer 0: Selected root node (the "target")
- [ ] Layer 1: Direct children (up to 3 visible, "+N more" button)
- [ ] Layer 2: Grandchildren (up to 3 per parent)
- [ ] Layer 3+: Further descendants (recursive expansion)

### Path Highlighting
- [ ] Dashed gold line from selected node to root (breadcrumb path)
- [ ] Parent ghost navigation (click ghost → move up one level)
- [ ] Highlight path from Global View selection (preserve context)

### Edge Rendering
- [ ] Sankey-style edge width (2-10px scaled by cumulative impact %)
- [ ] Magnitude filter (hide edges with cumulative impact <10%)
- [ ] Bezier curves (smooth vertical flow)

### Interactions
- [ ] Click node → make it new root (re-render flowchart)
- [ ] Click "+N more" → expand hidden children (accordion)
- [ ] Hover node → show summary stats (children count, SHAP sum)
- [ ] Double-click node → return to Global View focused on this node

### Deliverables
- [ ] `LocalView.jsx` component
- [ ] `SugiyamaLayout.js` algorithm (dagre.js wrapper)
- [ ] `PathHighlighter.js` utility (breadcrumb tracking)
- [ ] Transition animation between Global ↔ Local (500ms slide)

---

## Week 3: Navigation & State Management

### View Switcher
- [ ] Toggle button: Global ↔ Local (top nav bar)
- [ ] Overlay drawer transition (Global 60% left, Local 40% right slide-in)
- [ ] Preserve state when switching (selected node, zoom level, filters)

### Breadcrumb System
- [ ] Display full expansion path (L0 → L1 → L2 → ... → selected node)
- [ ] Click breadcrumb → collapse back to that level
- [ ] Sync breadcrumb across Global and Local Views

### Quick Actions Panel
- [ ] Appears on node selection (floating panel, right side)
- [ ] Actions: "Switch to Local View", "Collapse All", "Find Paths To...", "Show Stats"
- [ ] Context-aware (different actions for outcomes vs indicators)

### State Management
- [ ] Zustand store for app state (current view, selected node, expanded set)
- [ ] URL sync (share links preserve state: `?view=local&node=NW.HCA.MALE.TO`)
- [ ] Local storage for user preferences (last view, filter settings)

### Deliverables
- [ ] `NavigationBar.jsx` (view switcher, breadcrumb)
- [ ] `QuickActionsPanel.jsx` (contextual actions)
- [ ] `appStore.js` (Zustand state management)
- [ ] `urlSync.js` (URL parameter handling)

---

## Week 4: Filters & Search

### Global View Filters
- [ ] Domain filter (7 checkboxes: toggle domains on/off)
- [ ] SHAP threshold slider (0.0-1.0, default 0.0001 to hide bottom 50%)
- [ ] Causal edge strength slider (0-100%, default 30%)
- [ ] Top N drivers filter (radio: All, Top 5, Top 10, Top 20)

### Local View Filters
- [ ] Magnitude threshold slider (5-50%, default 10% cumulative impact)
- [ ] Max children per layer (slider: 3-10, default 3)
- [ ] Path depth limit (slider: 2-6 levels, default 4)

### Search
- [ ] Autocomplete search bar (fuzzy match on 1,763 indicator names)
- [ ] Search results panel (shows matches, click to navigate)
- [ ] Search by domain (dropdown filter in search)
- [ ] Search by SHAP range (advanced: "SHAP > 0.01")

### Performance
- [ ] Debounced filter updates (300ms delay to avoid lag)
- [ ] Memoized layout computation (cache positions when filters change)
- [ ] WebWorker for search indexing (don't block main thread)

### Deliverables
- [ ] `FilterPanel.jsx` (collapsible sidebar, all filter controls)
- [ ] `SearchBar.jsx` (autocomplete, fuzzy matching)
- [ ] `filterUtils.js` (apply filters to graph data)
- [ ] `searchIndex.js` (Fuse.js fuzzy search)

---

## Final Integration

### Testing
- [ ] Cross-browser testing (Chrome, Firefox, Safari, Edge)
- [ ] Mobile responsiveness check (tablet landscape minimum)
- [ ] Performance profiling (60fps target, <2s initial load)
- [ ] Accessibility audit (keyboard navigation, screen reader labels)

### Documentation
- [ ] User guide (quick start, 3-minute video walkthrough)
- [ ] Keyboard shortcuts cheat sheet
- [ ] Troubleshooting FAQ

### Deployment
- [ ] Deploy to argonanalytics.com
- [ ] Setup analytics (Plausible privacy-focused tracking)
- [ ] Social media preview cards (OpenGraph meta tags)
- [ ] Google Analytics goals (track engagement: time on site, views switched)

### Deliverables
- [ ] Live site at argonanalytics.com
- [ ] GitHub release v1.0.0
- [ ] User guide page (`/guide`)
- [ ] Public announcement (LinkedIn, Twitter, academic mailing lists)

---

## Success Metrics

- [ ] <2s initial load time
- [ ] 60fps interactions
- [ ] <5 usability issues in testing (n=10 users)
- [ ] 100+ unique visitors in week 1
