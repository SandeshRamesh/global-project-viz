#!/usr/bin/env python3
"""
Optimize layout parameters to maximize node sizes while minimizing ring radii and collisions.
Uses actual importance-based node sizing (matching App.tsx getSize function).
"""

import json
import math
from dataclasses import dataclass
from typing import Dict, List, Tuple

# Load data
with open('public/data/v2_1_visualization_final.json') as f:
    data = json.load(f)

nodes = data['nodes']
node_by_id = {str(n['id']): n for n in nodes}

# Build hierarchy
children_by_parent: Dict[str, List[str]] = {}
for n in nodes:
    if n.get('parent') is not None:
        parent_id = str(n['parent'])
        if parent_id not in children_by_parent:
            children_by_parent[parent_id] = []
        children_by_parent[parent_id].append(str(n['id']))

# Count nodes per layer
nodes_per_layer = {}
for n in nodes:
    layer = n['layer']
    nodes_per_layer[layer] = nodes_per_layer.get(layer, 0) + 1

print("Nodes per layer:", nodes_per_layer)

@dataclass
class RingConfig:
    radius: float
    min_size: float
    max_size: float

def get_actual_node_size(node: dict, config: RingConfig) -> float:
    """
    Compute actual node size based on importance.
    Uses area-proportional sizing: radius = min + (max - min) * sqrt(importance)
    Must match getSize() in App.tsx and getActualNodeSize() in RadialLayout.ts
    """
    importance = node.get('importance', 0) or 0
    return config.min_size + (config.max_size - config.min_size) * math.sqrt(importance)

def build_subtree_info(node_id: str, max_layer: int) -> Dict[int, int]:
    node = node_by_id[node_id]
    counts = {i: 0 for i in range(max_layer + 1)}
    counts[node['layer']] = 1
    for child_id in children_by_parent.get(node_id, []):
        child_counts = build_subtree_info(child_id, max_layer)
        for layer, count in child_counts.items():
            counts[layer] += count
    return counts

# Cache subtree info
max_layer = max(n['layer'] for n in nodes)
subtree_cache = {}
for n in nodes:
    subtree_cache[str(n['id'])] = build_subtree_info(str(n['id']), max_layer)

def compute_collisions_with_actual_sizes(ring_configs: List[RingConfig], node_padding: float = 2) -> Tuple[int, List[dict]]:
    """
    Compute collisions using ACTUAL importance-based node sizes (not max sizes).
    Returns (collision_count, list_of_collision_details)
    """
    root = next(n for n in nodes if n['layer'] == 0)
    root_id = str(root['id'])
    outcome_ids = children_by_parent.get(root_id, [])

    def get_required_extent(node_id: str) -> float:
        """Get angular extent needed for subtree using MAX sizes (for layout spacing)"""
        subtree_counts = subtree_cache[node_id]
        max_extent = 0
        for layer, count in subtree_counts.items():
            if layer < len(ring_configs) and count > 0:
                cfg = ring_configs[layer]
                if cfg.radius > 0:
                    # Use max size for spacing calculation (layout algorithm)
                    node_spacing = cfg.max_size * 2 + node_padding
                    extent = (count * node_spacing) / cfg.radius
                    max_extent = max(max_extent, extent)
        return max_extent

    outcome_extents = {oid: get_required_extent(oid) for oid in outcome_ids}
    total_extent = sum(outcome_extents.values())

    positioned = []

    def position_subtree(node_id: str, start_angle: float, angular_extent: float):
        node = node_by_id[node_id]
        layer = node['layer']
        cfg = ring_configs[layer]
        center_angle = start_angle + angular_extent / 2
        x = cfg.radius * math.cos(center_angle)
        y = cfg.radius * math.sin(center_angle)
        # Use ACTUAL importance-based size
        size = get_actual_node_size(node, cfg)
        positioned.append({
            'id': node_id,
            'layer': layer,
            'x': x,
            'y': y,
            'size': size,
            'importance': node.get('importance', 0) or 0
        })

        child_ids = children_by_parent.get(node_id, [])
        if child_ids:
            child_extents = [get_required_extent(cid) for cid in child_ids]
            total_child = sum(child_extents)
            scale = angular_extent / max(total_child, 0.0001)
            child_start = start_angle
            for i, cid in enumerate(child_ids):
                position_subtree(cid, child_start, child_extents[i] * scale)
                child_start += child_extents[i] * scale

    # Position root
    root_cfg = ring_configs[0]
    positioned.append({
        'id': root_id,
        'layer': 0,
        'x': 0,
        'y': 0,
        'size': get_actual_node_size(root, root_cfg),
        'importance': root.get('importance', 0) or 0
    })

    # Position outcomes
    scale = (2 * math.pi) / max(total_extent, 0.0001)
    current_angle = -math.pi / 2
    for oid in outcome_ids:
        extent = outcome_extents[oid] * scale
        position_subtree(oid, current_angle, extent)
        current_angle += extent

    # Count collisions using ACTUAL node sizes
    collisions = 0
    collision_details = []
    nodes_by_layer = {}
    for p in positioned:
        layer = p['layer']
        if layer not in nodes_by_layer:
            nodes_by_layer[layer] = []
        nodes_by_layer[layer].append(p)

    OVERLAP_TOLERANCE = 0.5  # Match RadialLayout.ts

    for layer, layer_nodes in nodes_by_layer.items():
        for i in range(len(layer_nodes)):
            for j in range(i + 1, len(layer_nodes)):
                n1, n2 = layer_nodes[i], layer_nodes[j]
                dx = n1['x'] - n2['x']
                dy = n1['y'] - n2['y']
                dist = math.sqrt(dx*dx + dy*dy)
                # Actual collision: sum of actual radii (not max sizes)
                min_dist = n1['size'] + n2['size'] - OVERLAP_TOLERANCE
                if dist < min_dist:
                    collisions += 1
                    collision_details.append({
                        'layer': layer,
                        'distance': dist,
                        'min_distance': min_dist,
                        'gap': dist - min_dist,
                        'size1': n1['size'],
                        'size2': n2['size']
                    })

    return collisions, collision_details

# Current configuration - Equal spacing with gap=150
print("\n=== Current Configuration (Equal spacing, gap=150px) ===")
current = [
    RingConfig(0 * 150, 12, 12),      # Ring 0: Root
    RingConfig(1 * 150, 3, 18),       # Ring 1: Outcomes
    RingConfig(2 * 150, 2, 14),       # Ring 2: Coarse Domains
    RingConfig(3 * 150, 2, 12),       # Ring 3: Fine Domains
    RingConfig(4 * 150, 1.5, 10),     # Ring 4: Indicator Groups
    RingConfig(5 * 150, 1, 8),        # Ring 5: Indicators
]
coll, details = compute_collisions_with_actual_sizes(current)
print(f"Collisions with actual sizes: {coll}")
print(f"Max radius: {max(c.radius for c in current)}")
if details:
    print(f"Collision details (first 5):")
    for d in details[:5]:
        print(f"  Layer {d['layer']}: gap={d['gap']:.2f}px, sizes={d['size1']:.1f}+{d['size2']:.1f}px")

# Base size ranges (matching App.tsx BASE_SIZE_RANGES)
size_ranges = [
    (12, 12),   # Ring 0
    (3, 18),    # Ring 1
    (2, 14),    # Ring 2
    (2, 12),    # Ring 3
    (1.5, 10),  # Ring 4
    (1, 8),     # Ring 5
]

# Optimization with equal spacing - test different gaps
print("\n=== Running Optimization (equal spacing, varying gap) ===")
results = []

# Test gaps from 100px to 400px
for gap in [100, 120, 140, 150, 160, 180, 200, 220, 250, 280, 300, 320, 350, 400]:
    configs = [
        RingConfig(i * gap, size_ranges[i][0], size_ranges[i][1])
        for i in range(6)
    ]

    collisions, _ = compute_collisions_with_actual_sizes(configs)
    max_radius = max(c.radius for c in configs)

    # Compute average actual node size
    total_size = 0
    count = 0
    for n in nodes:
        layer = n['layer']
        if layer < len(configs):
            cfg = configs[layer]
            total_size += get_actual_node_size(n, cfg)
            count += 1
    avg_actual_size = total_size / count if count > 0 else 0

    results.append({
        'gap': gap,
        'collisions': collisions,
        'max_radius': max_radius,
        'avg_actual_size': avg_actual_size,
        'configs': configs
    })

# Sort by collisions, then radius (smallest)
results.sort(key=lambda x: (x['collisions'], x['max_radius']))

print(f"Tested {len(results)} configurations\n")
print(f"{'Rank':<5} {'Coll':<6} {'MaxRad':<8} {'AvgSize':<8} {'Gap':<8}")
print("-" * 45)

for i, r in enumerate(results[:20]):
    print(f"{i+1:<5} {r['collisions']:<6} {r['max_radius']:<8.0f} {r['avg_actual_size']:<8.2f} {r['gap']:<8}")

# Find smallest radius with 0 collisions
zero_coll = [r for r in results if r['collisions'] == 0]
if zero_coll:
    best = min(zero_coll, key=lambda x: x['max_radius'])
    print(f"\n=== SMALLEST GAP WITH 0 COLLISIONS ===")
    print(f"Ring gap: {best['gap']}px")
    print(f"Max radius: {best['max_radius']:.0f}px")
    print(f"Avg actual node size: {best['avg_actual_size']:.2f}px")
    print("\nSet DEFAULT_RING_GAP in App.tsx to:", best['gap'])
else:
    print("\n=== NO CONFIGURATION WITH 0 COLLISIONS FOUND ===")
    # Find best compromise
    best = results[0]
    print(f"Best found: {best['collisions']} collisions at gap={best['gap']}px")

# Also show a few options for user to choose
print("\n=== OPTIONS FOR USER ===")
print("(Choose based on preference for compactness vs collision-free)")
for r in results[:10]:
    status = "0 collisions" if r['collisions'] == 0 else f"{r['collisions']} collisions"
    print(f"  gap={r['gap']}px: max_radius={r['max_radius']:.0f}px, {status}")
