# Workspace premium visual assets (WS.17)

Drop realistic **WebP** images here. The app wires them in automatically:
each cover renders a `<img>` overlay that, **if the file exists**, covers the
existing CSS scene/glyph; **if the file is missing** the image removes itself
(`onerror`) and the original CSS scene/glyph shows as a graceful fallback.

No remote URLs, no generated images — only local WebP placed in this folder.

## Expected files

Real estate (by property type — `ptype` in the portfolio tool):

| File                            | Property type (ES) |
|---------------------------------|--------------------|
| `realestate_apartment.webp`     | Piso (`flat`)      |
| `realestate_house.webp`         | Casa (`house`)     |
| `realestate_chalet.webp`        | Chalet (`chalet`)  |
| `realestate_commercial.webp`    | Local (`local`)    |
| `realestate_office.webp`        | Oficina (`office`) |
| `realestate_industrial.webp`    | Nave (`warehouse`) |
| `realestate_garage.webp`        | Garaje (`garage`)  |

Templates (Plantillas cards):

- `template_budget.webp`
- `template_assets.webp`
- `template_receivables.webp`
- `template_goals.webp`
- `template_scenarios.webp`
- `template_trading_journal.webp` (Plantillas › Diario de operaciones, cat `journal`)

Tools (Herramientas covers):

- `tool_compound.webp`
- `tool_loans.webp`
- `tool_financial.webp`
- `tool_investment.webp`

## Recommendations

- Format: WebP, sRGB.
- Suggested size: ~640×420 (covers are scaled with `object-fit: cover`).
- Keep each file small (target < 80 KB) for performance.
- A user-uploaded property photo always wins over `realestate_*` covers.
