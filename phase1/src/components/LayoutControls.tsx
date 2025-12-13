/**
 * LayoutControls - Compact panel for adjusting ring radii
 */

import React, { memo } from 'react'

interface LayoutControlsProps {
  ringRadii: number[]
  onRingRadiusChange: (ring: number, radius: number) => void
  ringLabels: string[]
}

const SHORT_LABELS = ['Root', 'Out', 'Coarse', 'Fine', 'Groups', 'Ind']

function LayoutControls({
  ringRadii,
  onRingRadiusChange,
  ringLabels
}: LayoutControlsProps) {
  return (
    <div style={{
      position: 'absolute',
      top: 320,
      right: 10,
      background: 'white',
      padding: 10,
      borderRadius: 4,
      boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
      fontSize: 11
    }}>
      <div style={{ fontWeight: 'bold', marginBottom: 8, fontSize: 12 }}>Ring Radii</div>

      {/* Compact grid of inputs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'auto 60px', gap: '4px 8px', alignItems: 'center' }}>
        {ringRadii.map((radius, ring) => (
          <React.Fragment key={ring}>
            <span style={{ color: '#555', fontSize: 10 }} title={ringLabels[ring]}>
              {ring}: {SHORT_LABELS[ring]}
            </span>
            <input
              type="number"
              min={ring === 0 ? 0 : 50}
              step={10}
              value={radius}
              onChange={(e) => onRingRadiusChange(ring, Number(e.target.value) || 0)}
              disabled={ring === 0}
              style={{
                width: '100%',
                padding: '2px 4px',
                fontSize: 10,
                border: '1px solid #ccc',
                borderRadius: 2,
                textAlign: 'right',
                background: ring === 0 ? '#f5f5f5' : 'white'
              }}
            />
          </React.Fragment>
        ))}
      </div>

      {/* Reset Button */}
      <button
        onClick={() => {
          const defaults = [0, 150, 300, 450, 600, 750]
          for (let i = 0; i < ringRadii.length; i++) {
            onRingRadiusChange(i, defaults[i] || i * 150)
          }
        }}
        style={{
          width: '100%',
          padding: '4px 8px',
          marginTop: 8,
          fontSize: 10,
          cursor: 'pointer',
          border: '1px solid #ccc',
          borderRadius: 2,
          background: '#f5f5f5'
        }}
      >
        Reset (150px gaps)
      </button>
    </div>
  )
}

export default memo(LayoutControls)
