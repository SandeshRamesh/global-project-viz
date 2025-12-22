/**
 * DEBUG SYSTEM
 *
 * Development: Shows detailed logs with category prefixes
 * Production: Zero overhead (functions are no-ops, tree-shaken by Vite)
 *
 * Usage:
 *   import { debug } from './utils/debug'
 *   debug.layout('Ring radii:', radii)
 *   debug.perf('Layout calculation')
 *   // ... code ...
 *   debug.perfEnd('Layout calculation')
 */

const IS_DEV = import.meta.env.DEV

// No-op function for production
const noop = (): void => {}

// Create bound console methods for development
const createLogger = (prefix: string) =>
  IS_DEV ? console.log.bind(console, `[${prefix}]`) : noop

const createWarn = (prefix: string) =>
  IS_DEV ? console.warn.bind(console, `[${prefix}]`) : noop

export const debug = {
  // Layout calculations (RadialLayout.ts)
  layout: createLogger('Layout'),
  layoutWarn: createWarn('Layout'),

  // Viewport scaling (ViewportScales.ts)
  viewport: createLogger('Viewport'),
  viewportWarn: createWarn('Viewport'),

  // Rendering (App.tsx)
  render: createLogger('Render'),
  renderWarn: createWarn('Render'),

  // Sector filling algorithm
  sector: createLogger('Sector'),

  // Space allocation
  space: createLogger('Space'),

  // Overlap detection
  overlap: createLogger('Overlap'),

  // Performance timing
  perf: IS_DEV ? console.time.bind(console) : noop,
  perfEnd: IS_DEV ? console.timeEnd.bind(console) : noop,

  // Generic debug (for misc logs)
  log: IS_DEV ? console.log.bind(console) : noop,
  warn: IS_DEV ? console.warn.bind(console) : noop,
}

export default debug
