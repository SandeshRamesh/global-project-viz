#!/usr/bin/env python3
"""
Compute hierarchical SHAP importance for visualization node sizing.

This script:
1. Loads raw SHAP scores from B25 output
2. Aggregates SHAP values up the hierarchy (L5 -> L4 -> L3 -> L2 -> L1 -> L0)
3. Applies 50% floor rule to L1 outcomes
4. Normalizes to 0-1 range
5. Generates updated visualization data and validation reports
"""

import json
import pickle
import math
from pathlib import Path
from datetime import datetime
from collections import defaultdict
import statistics

# Paths
BASE_DIR = Path(__file__).parent.parent
DATA_DIR = BASE_DIR / "public" / "data"
OUTPUT_DIR = DATA_DIR / "importance"
SHAP_FILE = Path("/home/sandesh/Documents/Global_Project/v2.1/outputs/B25/B25_shap_scores.pkl")
VIZ_FILE = DATA_DIR / "v2_1_visualization_final.json"

# Config
FLOOR_PERCENTAGE = 0.5  # Outcomes must be at least 50% of max outcome


def load_data():
    """Load SHAP scores and visualization data."""
    print("Loading data...")

    # Load SHAP scores
    with open(SHAP_FILE, 'rb') as f:
        shap_scores = pickle.load(f)
    print(f"  Loaded {len(shap_scores)} SHAP scores")

    # Load visualization data
    with open(VIZ_FILE, 'r') as f:
        viz_data = json.load(f)
    print(f"  Loaded {len(viz_data['nodes'])} visualization nodes")

    return shap_scores, viz_data


def build_hierarchy(viz_data):
    """Build parent-child relationships from viz data."""
    nodes_by_id = {str(n['id']): n for n in viz_data['nodes']}
    children_by_parent = defaultdict(list)

    for node in viz_data['nodes']:
        if node.get('parent') is not None:
            parent_id = str(node['parent'])
            children_by_parent[parent_id].append(str(node['id']))

    return nodes_by_id, children_by_parent


def compute_hierarchical_shap(shap_scores, nodes_by_id, children_by_parent):
    """
    Compute SHAP values for all nodes in hierarchy.

    L5 (Indicators): Use shap_normalized from raw scores
    L4-L1: Sum of children's SHAP values
    L0: Sum of all L1 outcomes
    """
    print("\nComputing hierarchical SHAP values...")

    node_shap = {}  # id -> raw shap value (before normalization)

    # First, assign L5 indicator SHAP values
    l5_count = 0
    l5_missing = 0
    for node_id, node in nodes_by_id.items():
        if node['layer'] == 5:
            # Try to find SHAP score by node id
            if node_id in shap_scores:
                node_shap[node_id] = shap_scores[node_id].get('shap_normalized', 0)
                l5_count += 1
            else:
                node_shap[node_id] = 0
                l5_missing += 1

    print(f"  L5: {l5_count} with SHAP, {l5_missing} missing")

    # Aggregate up the hierarchy (L4 -> L3 -> L2 -> L1 -> L0)
    for layer in [4, 3, 2, 1, 0]:
        layer_nodes = [n for n in nodes_by_id.values() if n['layer'] == layer]
        for node in layer_nodes:
            node_id = str(node['id'])
            children = children_by_parent.get(node_id, [])
            if children:
                # Sum of children's SHAP values
                child_sum = sum(node_shap.get(c, 0) for c in children)
                node_shap[node_id] = child_sum
            else:
                # Leaf node without children at non-L5 layer (shouldn't happen often)
                node_shap[node_id] = node_shap.get(node_id, 0)

        layer_vals = [node_shap[str(n['id'])] for n in layer_nodes]
        if layer_vals:
            print(f"  L{layer}: count={len(layer_vals)}, sum={sum(layer_vals):.4f}, max={max(layer_vals):.4f}")

    return node_shap


def apply_outcome_floor(normalized_shap, nodes_by_id):
    """
    Apply 50% floor rule to L1 outcomes AFTER normalization.

    The floor ensures all outcomes have at least 50% of the max outcome's
    normalized importance, so no outcome appears too small visually.
    """
    print("\nApplying 50% floor to outcomes (post-normalization)...")

    # Get L1 outcomes
    outcomes = [n for n in nodes_by_id.values() if n['layer'] == 1]
    outcome_importance = {str(n['id']): normalized_shap[str(n['id'])] for n in outcomes}

    max_outcome = max(outcome_importance.values())
    floor_value = FLOOR_PERCENTAGE * max_outcome

    print(f"  Max outcome importance: {max_outcome:.4f}")
    print(f"  Floor value (50%): {floor_value:.4f}")

    boosted = {}  # outcome_id -> boost_factor

    for outcome_id, imp_val in outcome_importance.items():
        if imp_val < floor_value and imp_val > 0:
            boost_factor = floor_value / imp_val
            boosted[outcome_id] = boost_factor
            normalized_shap[outcome_id] = floor_value
            print(f"  Boosting {nodes_by_id[outcome_id]['label']}: {imp_val:.4f} -> {floor_value:.4f} ({boost_factor:.1f}x)")
        elif imp_val == 0:
            # Handle zero importance - set to floor value
            boosted[outcome_id] = float('inf')
            normalized_shap[outcome_id] = floor_value
            print(f"  Boosting {nodes_by_id[outcome_id]['label']}: 0 -> {floor_value:.4f} (from zero)")

    return normalized_shap, boosted


def normalize_shap(node_shap):
    """Normalize all SHAP values to 0-1 range."""
    print("\nNormalizing SHAP values...")

    max_shap = max(node_shap.values())
    print(f"  Global max SHAP: {max_shap:.4f}")

    normalized = {}
    for node_id, shap_val in node_shap.items():
        normalized[node_id] = shap_val / max_shap if max_shap > 0 else 0

    return normalized, max_shap


def generate_outputs(viz_data, normalized_shap, node_shap_raw, boosted, max_shap, nodes_by_id):
    """Generate all output files."""
    print("\nGenerating output files...")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    # 1. Update visualization data with importance
    updated_viz = viz_data.copy()
    updated_viz['nodes'] = []

    for node in viz_data['nodes']:
        node_id = str(node['id'])
        updated_node = node.copy()
        updated_node['importance'] = normalized_shap.get(node_id, 0)
        updated_node['shap_raw'] = node_shap_raw.get(node_id, 0)
        updated_viz['nodes'].append(updated_node)

    # Save updated viz file (in main data dir for visualization to use)
    output_viz_path = DATA_DIR / "v2_1_visualization_final.json"
    with open(output_viz_path, 'w') as f:
        json.dump(updated_viz, f, indent=2)
    print(f"  Updated: {output_viz_path}")

    # 2. Generate importance metadata
    node_importance = {}
    for node in updated_viz['nodes']:
        node_id = str(node['id'])
        node_importance[node_id] = {
            "shap_raw": node_shap_raw.get(node_id, 0),
            "shap_normalized": normalized_shap.get(node_id, 0),
            "layer": node['layer'],
            "is_outcome": node['layer'] == 1,
            "floor_adjusted": node_id in boosted
        }
        if node_id in boosted:
            node_importance[node_id]["boost_factor"] = boosted[node_id]

    metadata = {
        "importance_metric": "shap_hierarchical",
        "computation_date": datetime.now().isoformat()[:10],
        "normalization": {
            "method": "global_max",
            "max_value": max_shap,
            "floor_applied": True,
            "floor_percentage": FLOOR_PERCENTAGE
        },
        "node_importance": node_importance,
        "size_mapping": {
            "min_radius_px": 3,
            "max_radius_px": 15,
            "formula": "radius = min + (max - min) * sqrt(importance)"
        }
    }

    with open(OUTPUT_DIR / "viz_importance_metadata.json", 'w') as f:
        json.dump(metadata, f, indent=2)
    print(f"  Created: {OUTPUT_DIR / 'viz_importance_metadata.json'}")

    # 3. Generate validation report
    all_importances = list(normalized_shap.values())
    outcome_nodes = [n for n in updated_viz['nodes'] if n['layer'] == 1]

    outcome_importance = {}
    for n in sorted(outcome_nodes, key=lambda x: normalized_shap.get(str(x['id']), 0), reverse=True):
        node_id = str(n['id'])
        outcome_importance[n['label']] = {
            "raw_shap": node_shap_raw.get(node_id, 0),
            "normalized": normalized_shap.get(node_id, 0),
            "floor_adjusted": node_id in boosted,
            "rank": list(outcome_importance.keys()).__len__() + 1
        }
        if node_id in boosted:
            outcome_importance[n['label']]["boost_factor"] = boosted[node_id]

    validation = {
        "summary": {
            "total_nodes": len(updated_viz['nodes']),
            "nodes_with_importance": sum(1 for v in normalized_shap.values() if v > 0),
            "coverage_percentage": round(100 * sum(1 for v in normalized_shap.values() if v > 0) / len(updated_viz['nodes']), 1)
        },
        "outcome_importance": outcome_importance,
        "distribution": {
            "min": round(min(all_importances), 6),
            "max": round(max(all_importances), 6),
            "mean": round(statistics.mean(all_importances), 6),
            "median": round(statistics.median(all_importances), 6),
            "p25": round(sorted(all_importances)[len(all_importances)//4], 6),
            "p75": round(sorted(all_importances)[3*len(all_importances)//4], 6),
            "p95": round(sorted(all_importances)[int(0.95*len(all_importances))], 6)
        },
        "warnings": []
    }

    # Add warnings for heavily boosted outcomes
    for label, data in outcome_importance.items():
        if data.get('floor_adjusted') and data.get('boost_factor', 1) > 10:
            validation["warnings"].append(
                f"{label} boosted {data['boost_factor']:.0f}x to meet 50% floor"
            )

    with open(OUTPUT_DIR / "shap_importance_validation.json", 'w') as f:
        json.dump(validation, f, indent=2)
    print(f"  Created: {OUTPUT_DIR / 'shap_importance_validation.json'}")

    # 4. Generate human-readable summary
    summary_lines = [
        "# SHAP Importance Summary - Phase 1 MVP",
        "",
        f"Generated: {datetime.now().isoformat()[:10]}",
        "",
        "## Outcome Rankings (with 50% floor applied)",
        "",
        "| Rank | Outcome | Raw SHAP | Normalized | Floor Adjusted? |",
        "|------|---------|----------|------------|-----------------|"
    ]

    for label, data in outcome_importance.items():
        floor_adj = "Yes" if data['floor_adjusted'] else "No"
        if data.get('boost_factor'):
            floor_adj += f" ({data['boost_factor']:.0f}x)"
        summary_lines.append(
            f"| {data['rank']} | {label} | {data['raw_shap']:.4f} | {data['normalized']:.3f} | {floor_adj} |"
        )

    # Top indicators
    l5_nodes = [(str(n['id']), n['label'], normalized_shap.get(str(n['id']), 0))
                for n in updated_viz['nodes'] if n['layer'] == 5]
    l5_sorted = sorted(l5_nodes, key=lambda x: x[2], reverse=True)

    summary_lines.extend([
        "",
        "## Top 20 Indicators by SHAP",
        "",
        "| Rank | Indicator | Normalized |",
        "|------|-----------|------------|"
    ])

    for i, (node_id, label, imp) in enumerate(l5_sorted[:20], 1):
        summary_lines.append(f"| {i} | {label[:40]} | {imp:.4f} |")

    summary_lines.extend([
        "",
        "## Distribution Notes",
        "",
        f"- Total nodes: {validation['summary']['total_nodes']}",
        f"- Nodes with importance > 0: {validation['summary']['nodes_with_importance']}",
        f"- Mean importance: {validation['distribution']['mean']:.4f}",
        f"- Median importance: {validation['distribution']['median']:.4f}",
        f"- 95th percentile: {validation['distribution']['p95']:.4f}",
    ])

    with open(OUTPUT_DIR / "shap_importance_summary.md", 'w') as f:
        f.write('\n'.join(summary_lines))
    print(f"  Created: {OUTPUT_DIR / 'shap_importance_summary.md'}")

    return validation


def run_validation_checks(normalized_shap, nodes_by_id):
    """Run validation checks."""
    print("\nRunning validation checks...")

    checks = []

    # 1. All nodes have importance values
    all_have_values = all(node_id in normalized_shap for node_id in nodes_by_id.keys())
    checks.append(("All nodes have importance values", all_have_values))

    # 2. Range check
    in_range = all(0 <= v <= 1 for v in normalized_shap.values())
    checks.append(("All values in [0, 1] range", in_range))

    # 3. Check outcomes have values (no floor applied)
    outcomes = [n for n in nodes_by_id.values() if n['layer'] == 1]
    outcome_values = [normalized_shap.get(str(n['id']), 0) for n in outcomes]
    outcomes_have_values = len(outcome_values) == 9  # Should have 9 outcomes
    checks.append(("All 9 outcomes present", outcomes_have_values))

    # 4. Max value is 1.0
    has_max = max(normalized_shap.values()) == 1.0
    checks.append(("Max importance is 1.0", has_max))

    for name, passed in checks:
        status = "PASS" if passed else "FAIL"
        print(f"  [{status}] {name}")

    return all(passed for _, passed in checks)


def main():
    print("=" * 60)
    print("SHAP Importance Computation for Phase 1 MVP")
    print("=" * 60)

    # Load data
    shap_scores, viz_data = load_data()

    # Build hierarchy
    nodes_by_id, children_by_parent = build_hierarchy(viz_data)

    # Compute hierarchical SHAP
    node_shap_raw = compute_hierarchical_shap(shap_scores, nodes_by_id, children_by_parent)

    # Normalize to 0-1 (pure SHAP, no floor boosting)
    normalized_shap, max_shap = normalize_shap(node_shap_raw)

    # No floor boosting - pure SHAP values
    boosted = {}

    # Generate outputs
    validation = generate_outputs(viz_data, normalized_shap, node_shap_raw, boosted, max_shap, nodes_by_id)

    # Run validation
    all_passed = run_validation_checks(normalized_shap, nodes_by_id)

    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    print(f"Total nodes: {len(nodes_by_id)}")
    print(f"Nodes with importance > 0: {validation['summary']['nodes_with_importance']}")
    print(f"Outcomes boosted: {len(boosted)}")
    print(f"All validation checks: {'PASSED' if all_passed else 'FAILED'}")
    print(f"\nOutput directory: {OUTPUT_DIR}")

    return all_passed


if __name__ == "__main__":
    success = main()
    exit(0 if success else 1)
