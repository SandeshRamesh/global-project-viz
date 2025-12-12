/**
 * LayoutControls - Right-side panel for adjusting layout parameters
 *
 * Controls:
 * - Ring gap: uniform spacing between all rings
 * - Per-ring node size multipliers
 */

import { memo } from 'react'

interface LayoutControlsProps {
  ringGap: number
  onRingGapChange: (gap: number) => void
  nodeSizeMultipliers: number[]
  onNodeSizeMultiplierChange: (ring: number, multiplier: number) => void
  ringLabels: string[]
}

const RING_LABELS_SHORT = ['Root', 'Outcomes', 'Coarse', 'Fine', 'Groups', 'Indicators']

function LayoutControls({
  ringGap,
  onRingGapChange,
  nodeSizeMultipliers,
  onNodeSizeMultiplierChange,
  ringLabels
}: LayoutControlsProps) {
  return (
    <div style={{
      position: 'absolute',
      top: 320,
      right: 10,
      background: 'white',
      padding: 12,
      borderRadius: 4,
      boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
      width: 200,
      fontSize: 12
    }}>
      <div style={{ fontWeight: 'bold', marginBottom: 12, fontSize: 13 }}>Layout Controls</div>

      {/* Ring Gap Slider */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
          <span>Ring Gap</span>
          <span style={{ color: '#666' }}>{ringGap}px</span>
        </div>
        <input
          type="range"
          min={50}
          max={300}
          step={10}
          value={ringGap}
          onChange={(e) => onRingGapChange(Number(e.target.value))}
          style={{ width: '100%' }}
        />
      </div>

      {/* Divider */}
      <div style={{ borderTop: '1px solid #eee', marginBottom: 12 }} />

      {/* Per-Ring Node Size Multipliers */}
      <div style={{ fontWeight: 'bold', marginBottom: 8, fontSize: 11, color: '#666' }}>
        Node Size Multipliers
      </div>

      {nodeSizeMultipliers.map((multiplier, ring) => (
        <div key={ring} style={{ marginBottom: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
            <span style={{ fontSize: 11 }}>
              {ring}: {ringLabels[ring] || RING_LABELS_SHORT[ring]}
            </span>
            <span style={{ color: '#666', fontSize: 11 }}>{multiplier.toFixed(1)}x</span>
          </div>
          <input
            type="range"
            min={0.5}
            max={3}
            step={0.1}
            value={multiplier}
            onChange={(e) => onNodeSizeMultiplierChange(ring, Number(e.target.value))}
            style={{ width: '100%' }}
          />
        </div>
      ))}

      {/* Reset Button */}
      <button
        onClick={() => {
          onRingGapChange(150)
          const defaults = [1.0, 1.5, 2.4, 1.4, 0.8, 0.7]
          for (let i = 0; i < 6; i++) {
            onNodeSizeMultiplierChange(i, defaults[i])
          }
        }}
        style={{
          width: '100%',
          padding: '6px 12px',
          marginTop: 8,
          fontSize: 11,
          cursor: 'pointer',
          border: '1px solid #ccc',
          borderRadius: 3,
          background: '#f5f5f5'
        }}
      >
        Reset to Defaults
      </button>
    </div>
  )
}

export default memo(LayoutControls)
