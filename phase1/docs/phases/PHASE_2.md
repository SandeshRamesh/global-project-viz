# Phase 2: Practitioner Features - Path 4

**Timeline:** Weeks 5-6

**Objective:** Enable policy practitioners to run scenarios quickly

**Target Users:** Path 4 (Practitioner) - government officials, policy advisors, city planners

---

## Country Context System

- [ ] Country selector dropdown (217 countries)
- [ ] Load country-specific data values (indicators populate with actual numbers)
- [ ] Map integration (highlight selected country on world map)
- [ ] Regional comparison toggle (show regional averages)

---

## Pre-Built Scenario Library

- [ ] WHO Health Scenario (increase health expenditure +15%)
- [ ] World Bank Education Scenario (universal primary enrollment)
- [ ] IMF Economic Scenario (progressive taxation)
- [ ] UNEP Environment Scenario (renewable energy transition)
- [ ] Custom Scenario Builder (user-defined interventions)

---

## Simulation Mode (UI Only)

- [ ] "Run Simulation" button (triggers intervention propagation)
- [ ] Node glow feedback (red/green for decrease/increase)
- [ ] Intensity scaling (glow brightness = magnitude of change)
- [ ] Animated pulse during calculation (500ms loading state)
- [ ] Results summary panel (before/after comparison table)

**Note:** Actual simulation backend not required - this phase shows mock results or uses pre-computed scenarios from SHAP scores.

---

## Scenario Comparison

- [ ] Side-by-side scenario A vs B view (split screen Local View)
- [ ] Difference highlighting (nodes that change between scenarios)
- [ ] Export comparison (PowerPoint slide deck auto-generator)

---

## Deliverables

- [ ] `CountrySelector.jsx` (dropdown + map)
- [ ] `ScenarioLibrary.jsx` (pre-built scenarios panel)
- [ ] `SimulationRunner.jsx` (UI feedback system)
- [ ] `ComparisonView.jsx` (side-by-side layout)
- [ ] PowerPoint export template

---

## Success Metrics

- [ ] 5+ pre-built scenarios
- [ ] Scenario comparison functional
- [ ] PowerPoint export working
