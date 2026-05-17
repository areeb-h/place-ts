// Comparison table — feature matrix with a primary "place" column and
// N competitor columns. Cells accept short text or one of the symbol
// shorthands so the column reads at a glance.

interface Row {
  readonly feature: string
  readonly hint?: string
  readonly cells: readonly (string | boolean)[]
}

interface ComparisonTableProps {
  readonly columns: readonly string[]
  readonly rows: readonly Row[]
}

const renderCell = (value: string | boolean, isPrimary: boolean) => {
  if (value === true) {
    return <span class={`compare-cell yes${isPrimary ? ' primary' : ''}`}>✓</span>
  }
  if (value === false) {
    return <span class="compare-cell no">—</span>
  }
  return <span class={`compare-cell text${isPrimary ? ' primary' : ''}`}>{value}</span>
}

export const ComparisonTable = ({ columns, rows }: ComparisonTableProps) => (
  <div class="compare-wrap">
    <table class="compare">
      <thead>
        <tr>
          <th />
          {columns.map((c, i) => (
            <th class={i === 0 ? 'primary' : ''}>{c}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr>
            <th scope="row">
              <span class="compare-feature">{row.feature}</span>
              {row.hint ? <span class="compare-hint">{row.hint}</span> : null}
            </th>
            {row.cells.map((cell, i) => (
              <td>{renderCell(cell, i === 0)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
)
