# Phase 1 MVP: Global + Local Views

## Core Philosophy
**Phase 1 Goal:** Perfect the "understanding" layer
**V3.0 Goal:** Add the "action" layer on top

User mental model:
1. **Explore** (Global View) → "What matters?"
2. **Understand** (Local View) → "How does it work?"
3. **Act** (Simulation - V3.0) → "What should I change?"

---

## Progress Tracker

### Foundations ✅ COMPLETE
- [x] Radial layout with dynamic ring sizing
- [x] SHAP-based node importance (area = importance)
- [x] Overlap-free positioning (adaptive spacing algorithm)
- [x] Click expand/collapse
- [x] Pan and zoom (min 0.1x, max 20x)
- [x] Domain color coding (9 colors)
- [x] Viewport-aware scaling system
- [x] Basic hover tooltips (nodes)

---

## Implementation Phases (Ordered by Ease + Foundation)

### Tier 1: Quick Wins (1-2 days each)
**Goal:** Immediate UX improvements, performance foundation

#### 1.1 Loading Screen ✅
- [x] Show spinner + "Loading 2,583 nodes..."
- [x] Avoid blank screen on initial load
- [ ] Progress bar for data fetch (deferred - requires streaming)

#### 1.2 Reset View Button ✅
- [x] Always visible (top-right corner)
- [x] Returns to initial zoom/pan (all outcomes visible, none expanded)
- [x] Keyboard shortcut: `R` or `Home`

#### 1.3 Basic Rotation on First Expand ~~SKIPPED~~
- ~~Not needed - smart sector filling already prioritizes right-side placement~~

#### 1.4 Performance Foundations ✅
- [x] Debounced zoom/pan → **Replaced with CSS-based visibility (zero JS overhead)**
- [x] FPS counter (dev mode only, color-coded: green ≥50, yellow ≥30, red <30)
- [x] Ring 5 labels removed (1,763 text elements eliminated - too small to read)
- [x] CSS zoom classes control label visibility per ring (single DOM write vs 7000+ ops)

---

### Tier 2: Core Polish (2-3 days each)
**Goal:** Make Global View feel alive and responsive

#### 2.1 Smooth Expand/Collapse Animations ✅
- [x] Nodes animate from parent position with scale 0→1 and opacity 0→1
- [x] Duration: 300ms ease-out (cubic)
- [x] Edges animate from source to target position
- [x] Labels fade in with 150ms delay after nodes
- [ ] ~~Rings shift smoothly~~ (deferred - adds complexity)

#### 2.2 Hover States ~~SKIPPED~~
- ~~Already have node expand on hover - sufficient for now~~

#### 2.3 Visual Feedback (Partial) ✅
- [x] Collapsing: nodes shrink to r=0 with opacity fade (200ms)
- [x] Edges retract back to source on collapse
- [x] Labels fade out on collapse
- [ ] ~~Click flash, spinner~~ (deferred - not critical)

#### 2.4 Auto-Zoom on Expand ✅
- [x] When user expands: smoothly zoom + pan to frame expanded subtree
- [x] Target: expanded nodes fill ~70% of viewport (capped at 4x zoom)
- [x] Duration: 500ms ease-in-out (cubic)
- [x] On collapse: zoom out to show parent + siblings context (capped at 2x)

#### 2.5 Rich Tooltips (Partial) ✅
- [x] Node tooltip: name, domain, subdomain, importance, rank, connections, children, driver/outcome status
- [x] Stats grid layout (2-column)
- [x] No delay (instant), fixed bottom-center position
- [ ] ~~Edge tooltip~~ (deferred - need causal edges first)
- [ ] ~~Smart positioning~~ (deferred - fixed position works well)

---

### Tier 3: Major Features (1 week each)
**Goal:** Complete navigation and causal visualization

#### 3.1 Smart Sector Filling (Plan Exists)
**Priority order for expanded outcomes:**
1. Right lateral band (0° ±45°) - First expanded outcomes go here
2. Left lateral band (180° ±45°) - When right band is full
3. Top sector (90°) - Overflow
4. Bottom sector (270°) - Final overflow

- [ ] Implement `assignExpandedOutcomeAngles()` function
- [ ] Implement `fillBandsSequentially()` with constraint-based packing
- [ ] Distribute collapsed outcomes in remaining angular space
- [ ] Test with various subtree sizes

#### 3.2 Search & Navigation
- [ ] Autocomplete search bar (fuzzy match with Fuse.js)
- [ ] Top 5 matches as you type
- [ ] Jump behavior: expand path to node, zoom to frame it
- [ ] Search by domain filter dropdown
- [ ] Recent searches history (last 5)

#### 3.3 Causal Edges in Global View
- [ ] Toggle: "Show Causal Edges" (checkbox, default OFF)
- [ ] Style: thin (0.5px), translucent (0.15 opacity), dashed
- [ ] Edge hover → highlight full path
- [ ] Filter by edge strength slider (|β| > threshold)

#### 3.4 Edge Bundling
- [ ] Hierarchical edge bundling (Holten 2006)
- [ ] Groups edges that flow through similar paths
- [ ] Makes "data highways" visible

#### 3.5 Sector Glow Backgrounds
- [ ] 9 outcome sectors get subtle radial gradient fills
- [ ] Color: domain color at 0.08 opacity
- [ ] Helps orient "which outcome am I looking at?"

---

### Tier 4: Local View (2 weeks)
**Goal:** Users can explore causal pathways in detail

#### 4.1 Layout Implementation
- [ ] Sugiyama layered layout (hierarchical DAG)
- [ ] Horizontal layout (left-to-right flow)
- [ ] Layer 0: Selected node (root of local view)
- [ ] Layer 1-3+: Parents and grandparents (recursive)
- [ ] Node sizing: same SHAP-based sizing as Global View

#### 4.2 Edge Rendering
- [ ] Thickness = effect size (β coefficient magnitude)
- [ ] Color = sign (green = positive, red = negative, gray = neutral)
- [ ] Style: Bezier curves (smooth flow)
- [ ] Filter by effect size (hide |β| < 0.1 by default)

#### 4.3 Local View Interactions
- [ ] Click node → make it new root
- [ ] Breadcrumb navigation (Root > Outcome > Domain > ... > Current)
- [ ] "Show in Global View" button
- [ ] Collapse distant nodes (+N more button)
- [ ] Filter by effect size slider

#### 4.4 View Switching
- [ ] Toggle button: Global ↔ Local (top nav)
- [ ] Preserves selected node when switching
- [ ] Smooth slide transition (500ms)
- [ ] URL sync (?view=local&node=NODE_ID)

---

## Testing & Polish (Final Week)

### Visual Consistency
- [ ] Color palette accessibility (WCAG AA contrast)
- [ ] Colorblind-friendly (ColorBrewer palettes)
- [ ] Typography: 12px min for readability
- [ ] Consistent spacing in UI panels
- [ ] Loading states for all async actions

### Performance Validation
- [ ] Load time: <3 seconds to interactive
- [ ] Render: 60 FPS during interactions
- [ ] Memory: <500 MB RAM
- [ ] Bundle size: <2 MB gzipped

### User Testing
- [ ] Internal: expand all 9 outcomes (no overlaps)
- [ ] Internal: search 20 random indicators (all found)
- [ ] Friend testing: 5 people, task-based
- [ ] Advisor testing: methodology review

### Deployment
- [ ] Cross-browser testing (Chrome, Firefox, Safari, Edge)
- [ ] Mobile responsiveness (tablet landscape minimum)
- [ ] URL state preservation (shareable links)
- [ ] GitHub Pages deployment verified

---

## Phase 1 Complete Checklist

**User Can:**
- [ ] See all 2,583 nodes in radial layout
- [ ] Expand any outcome to see its full indicator tree
- [ ] Zoom and pan to explore dense areas
- [ ] Search for any indicator by name
- [ ] Switch to Local View to see causal pathways
- [ ] Hover nodes/edges to see detailed stats
- [ ] Toggle causal edges on/off in Global View
- [ ] Auto-frame on expand (camera follows focus)
- [ ] Navigate breadcrumbs (click to go back up hierarchy)
- [ ] Share links (URL preserves view state)

**System Performs:**
- [ ] Loads in <3 seconds
- [ ] Animates at 60 FPS
- [ ] Handles all 9 outcomes expanded simultaneously
- [ ] Zero console errors
- [ ] Works on desktop + tablet landscape

---

## Post-Phase 1: V3.0 Research Track

**V3.0 Goals (Months 3-6):**
- Country-specific graphs (217 separate causal structures)
- Intervention simulator backend (API: /simulate)
- Confidence intervals on all edges
- Temporal dynamics (lag structures, IRFs)

**Phase 2-4 (Post-V3.0):**
- Simulation Mode: Country selector, intervention sliders, scenario comparison
- Academic Transparency: Stats panel, methodology page, data export
- Advanced Features: Optimization mode, education mode, white-label

---

## Key Constants Reference

```typescript
// Domain Colors (9 outcomes)
DOMAIN_COLORS = {
  Health: '#E91E63',
  Education: '#FF9800',
  Economic: '#4CAF50',
  Governance: '#9C27B0',
  Environment: '#00BCD4',
  Demographics: '#795548',
  Security: '#F44336',
  Development: '#3F51B5',
  Research: '#009688'
}

// Ring Structure (6 rings)
Ring 0: Root (1 node)
Ring 1: Outcomes (9 nodes)
Ring 2: Coarse Domains (45 nodes)
Ring 3: Fine Domains (196 nodes)
Ring 4: Groups (569 nodes)
Ring 5: Indicators (1,763 nodes)

// Sector Bands (for smart sector filling)
RIGHT_BAND: 0° ±45° (90° total)
LEFT_BAND: 180° ±45° (90° total)
TOP_OVERFLOW: 90° ±22.5° (45° total)
BOTTOM_OVERFLOW: 270° ±22.5° (45° total)
```
