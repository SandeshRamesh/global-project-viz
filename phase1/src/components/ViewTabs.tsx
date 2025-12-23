/**
 * ViewTabs - Tab switcher for Global, Local, and Split views
 */

import type { ViewMode } from '../types'

interface ViewTabsProps {
  activeView: ViewMode
  onViewChange: (view: ViewMode) => void
  localTargetCount: number    // Number of targets in Local View
  onReset: () => void         // Reset view callback
}

/**
 * Tab switcher component with Global/Local/Split tabs and Reset button
 */
export function ViewTabs({
  activeView,
  onViewChange,
  localTargetCount,
  onReset
}: ViewTabsProps) {
  const hasTargets = localTargetCount > 0

  return (
    <div
      style={{
        position: 'absolute',
        top: 10,
        right: 10,
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        zIndex: 100
      }}
    >
      {/* Tab buttons */}
      <div
        style={{
          display: 'flex',
          background: 'white',
          borderRadius: 6,
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
          border: '1px solid #ddd',
          overflow: 'hidden'
        }}
      >
        {/* Global tab */}
        <button
          onClick={() => onViewChange('global')}
          style={{
            padding: '8px 16px',
            fontSize: 13,
            fontWeight: activeView === 'global' ? 600 : 400,
            cursor: 'pointer',
            border: 'none',
            background: activeView === 'global' ? '#3B82F6' : 'white',
            color: activeView === 'global' ? 'white' : '#555',
            transition: 'all 0.15s ease'
          }}
          title="Global View - Explore the hierarchy (G)"
        >
          Global
        </button>

        {/* Split tab */}
        <button
          onClick={() => onViewChange('split')}
          disabled={!hasTargets && activeView !== 'split'}
          style={{
            padding: '8px 16px',
            fontSize: 13,
            fontWeight: activeView === 'split' ? 600 : 400,
            cursor: !hasTargets && activeView !== 'split' ? 'not-allowed' : 'pointer',
            border: 'none',
            borderLeft: '1px solid #ddd',
            background: activeView === 'split' ? '#3B82F6' : 'white',
            color: activeView === 'split' ? 'white' : !hasTargets ? '#aaa' : '#555',
            opacity: !hasTargets && activeView !== 'split' ? 0.6 : 1,
            transition: 'all 0.15s ease'
          }}
          title={!hasTargets
            ? "Double-click a node to enable split view"
            : "Split View - See both views side by side (S)"
          }
        >
          Split
        </button>

        {/* Local tab */}
        <button
          onClick={() => onViewChange('local')}
          disabled={!hasTargets && activeView !== 'local'}
          style={{
            padding: '8px 16px',
            fontSize: 13,
            fontWeight: activeView === 'local' ? 600 : 400,
            cursor: !hasTargets && activeView !== 'local' ? 'not-allowed' : 'pointer',
            border: 'none',
            borderLeft: '1px solid #ddd',
            background: activeView === 'local' ? '#3B82F6' : 'white',
            color: activeView === 'local' ? 'white' : !hasTargets ? '#aaa' : '#555',
            opacity: !hasTargets && activeView !== 'local' ? 0.6 : 1,
            transition: 'all 0.15s ease',
            display: 'flex',
            alignItems: 'center',
            gap: 6
          }}
          title={!hasTargets
            ? "Double-click a node to view its causal pathways"
            : `Local View - ${localTargetCount} target${localTargetCount !== 1 ? 's' : ''} (L)`
          }
        >
          Local
          {hasTargets && (
            <span
              style={{
                background: activeView === 'local' ? 'rgba(255,255,255,0.3)' : '#3B82F6',
                color: 'white',
                fontSize: 11,
                padding: '1px 6px',
                borderRadius: 10,
                fontWeight: 600
              }}
            >
              {localTargetCount}
            </span>
          )}
        </button>
      </div>

      {/* Reset button */}
      <button
        onClick={onReset}
        style={{
          padding: '8px 16px',
          fontSize: 13,
          fontWeight: 'bold',
          cursor: 'pointer',
          border: '1px solid #ccc',
          borderRadius: 6,
          background: 'white',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
          color: '#555',
          transition: 'all 0.15s ease'
        }}
        title="Reset view to initial state (R or Home)"
        onMouseEnter={(e) => {
          e.currentTarget.style.background = '#f5f5f5'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'white'
        }}
      >
        Reset
      </button>
    </div>
  )
}

export default ViewTabs
