// Theme toggle — local island wrapping `<ThemeToggle>` from the design
// system. This 3-line shape is the canonical "drop a tag, get a working
// System / Light / Dark picker" pattern.
//
// **Customize this file** to change the toggle. A few common moves:
//
//   - Swap to single-button cycle:    <ThemeToggle variant="cycle" />
//   - Hide the system option:         <ThemeToggle includeSystem={false} />
//   - Rename labels:                  <ThemeToggle labels={{ system: 'Auto' }} />
//   - Pass custom icons (any View):   <ThemeToggle icons={{ light: <Sun />, dark: <Moon /> }} />
//   - Build a completely custom UI:   replace this with `useTheme()` —
//     see the framework's "Theming & dark mode" recipe for the BYO-UI tier.
//
// Auto-imported: `island`. The wrapping island ships ~600 bytes
// gzipped — the design-system primitive plus this thin shell.

import { ThemeToggle } from '@place-ts/design'

export default island(() => <ThemeToggle />)
