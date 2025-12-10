# Phase 3: Academic Rigor - Path 3

**Timeline:** Weeks 7-8

**Objective:** Add transparency and reproducibility for researchers

**Target Users:** Path 3 (Validator) - skeptical journalists, fact-checkers, academic reviewers

---

## Transparency Panel

- [ ] "Show Methodology" button (right sidebar drawer)
- [ ] Per-node statistics display:
  - SHAP value (importance score)
  - Data quality (% observed vs imputed)
  - Sample size (n observations)
  - Source dataset (WDI, UNESCO, V-Dem, etc.)
- [ ] Per-edge statistics display:
  - Beta coefficient (effect size)
  - Confidence interval (95% CI)
  - P-value (significance)
  - Calculation method (backdoor adjustment, bootstrap, etc.)

---

## Data Export Suite

- [ ] "Download Data" button (multiple formats)
- [ ] Export options:
  - CSV: Full node list + edge list
  - JSON: Complete graph structure
  - SVG: Current view as vector graphic
  - PNG: High-res screenshot (for publications)
- [ ] Export includes metadata (filters applied, date accessed, version)

---

## Citation Generator

- [ ] "Cite This Work" popup (modal dialog)
- [ ] Formats provided:
  - BibTeX (LaTeX users)
  - APA 7th edition
  - MLA 9th edition
  - Chicago 17th edition
- [ ] Auto-populates current URL (for specific views/scenarios)

---

## Methodology Documentation

- [ ] `/methodology` page (separate from main app)
- [ ] Sections:
  - Phase A: Causal Discovery (GraNDAG algorithm)
  - Phase B: Semantic Hierarchy (clustering, promotion)
  - Known Limitations (honest disclosure)
- [ ] Downloadable as PDF (for offline reading)

---

## Sensitivity Analysis Runner (if time allows)

- [ ] "Run Sensitivity Test" button
- [ ] Options:
  - Exclude imputed data (re-run on observed only)
  - Exclude high-income countries (test on developing world)
  - Change saturation threshold (GDP $20K → $25K)
- [ ] Results comparison (original vs sensitivity test)

---

## Deliverables

- [ ] `TransparencyPanel.jsx` (stats sidebar)
- [ ] `ExportManager.js` (handles CSV/JSON/SVG/PNG generation)
- [ ] `CitationGenerator.jsx` (modal with copy-to-clipboard)
- [ ] `/methodology` page (Markdown content rendered)
- [ ] PDF export script (generate methodology PDF)

---

## Success Metrics

- [ ] 100% data export success rate
- [ ] Methodology page cited in academic paper
- [ ] Zero accessibility violations (WCAG AA)
