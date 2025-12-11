import { useState } from 'react'

interface RingConfig {
  radius: number
  nodeSize: number
  label: string
}

interface LayoutControlsProps {
  ringConfigs: RingConfig[]
  nodePadding: number
  onRingConfigChange: (configs: RingConfig[]) => void
  onNodePaddingChange: (padding: number) => void
}

/**
 * Interactive control panel for adjusting layout parameters
 * Provides sliders for node sizes and ring radii per layer
 */
export function LayoutControls({
  ringConfigs,
  nodePadding,
  onRingConfigChange,
  onNodePaddingChange
}: LayoutControlsProps) {
  const [isCollapsed, setIsCollapsed] = useState(false)

  const handleNodeSizeChange = (index: number, value: number) => {
    const newConfigs = [...ringConfigs]
    newConfigs[index] = { ...newConfigs[index], nodeSize: value }
    onRingConfigChange(newConfigs)
  }

  const handleRadiusChange = (index: number, value: number) => {
    const newConfigs = [...ringConfigs]
    newConfigs[index] = { ...newConfigs[index], radius: value }
    onRingConfigChange(newConfigs)
  }

  if (isCollapsed) {
    return (
      <div
        style={{
          position: 'absolute',
          top: 60,
          right: 250,
          background: 'white',
          padding: '8px 12px',
          borderRadius: 4,
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
          cursor: 'pointer',
          zIndex: 100
        }}
        onClick={() => setIsCollapsed(false)}
      >
        <span style={{ fontSize: 13, fontWeight: 'bold' }}>Layout Controls</span>
      </div>
    )
  }

  return (
    <div
      style={{
        position: 'absolute',
        top: 60,
        right: 250,
        background: 'white',
        padding: 16,
        borderRadius: 4,
        boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
        width: 320,
        maxHeight: 'calc(100vh - 100px)',
        overflowY: 'auto',
        zIndex: 100
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontWeight: 'bold', fontSize: 14 }}>Layout Controls</span>
        <button
          onClick={() => setIsCollapsed(true)}
          style={{
            background: 'none',
            border: 'none',
            fontSize: 16,
            cursor: 'pointer',
            color: '#999',
            padding: '0 4px'
          }}
        >
          -
        </button>
      </div>

      {/* Node Padding */}
      <div style={{ marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid #eee' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
          <span style={{ fontSize: 12, color: '#666' }}>Node Padding</span>
          <span style={{ fontSize: 12, fontWeight: 'bold' }}>{nodePadding}px</span>
        </div>
        <input
          type="range"
          min={0}
          max={20}
          step={1}
          value={nodePadding}
          onChange={(e) => onNodePaddingChange(Number(e.target.value))}
          style={{ width: '100%' }}
        />
      </div>

      {/* Per-ring controls */}
      {ringConfigs.map((config, index) => (
        <div
          key={index}
          style={{
            marginBottom: 16,
            paddingBottom: 12,
            borderBottom: index < ringConfigs.length - 1 ? '1px solid #eee' : 'none'
          }}
        >
          <div style={{ fontWeight: 'bold', fontSize: 12, marginBottom: 8, color: '#333' }}>
            Ring {index}: {config.label}
          </div>

          {/* Node Size Slider */}
          <div style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
              <span style={{ fontSize: 11, color: '#888' }}>Node Size</span>
              <span style={{ fontSize: 11, fontWeight: 'bold' }}>{config.nodeSize}px</span>
            </div>
            <input
              type="range"
              min={1}
              max={30}
              step={0.5}
              value={config.nodeSize}
              onChange={(e) => handleNodeSizeChange(index, Number(e.target.value))}
              style={{ width: '100%' }}
            />
          </div>

          {/* Ring Radius Slider (skip for ring 0 which is always at center) */}
          {index > 0 && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                <span style={{ fontSize: 11, color: '#888' }}>Base Radius</span>
                <span style={{ fontSize: 11, fontWeight: 'bold' }}>{config.radius}px</span>
              </div>
              <input
                type="range"
                min={50}
                max={3000}
                step={10}
                value={config.radius}
                onChange={(e) => handleRadiusChange(index, Number(e.target.value))}
                style={{ width: '100%' }}
              />
            </div>
          )}
        </div>
      ))}

      <div style={{ fontSize: 10, color: '#999', marginTop: 8 }}>
        Note: Radii are auto-adjusted to prevent overlap. Base values set minimum.
      </div>
    </div>
  )
}
