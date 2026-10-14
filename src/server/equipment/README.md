# Equipment Forge Runtime

`forge-runtime.js` owns server-authoritative equipment forging and repair.

- `POST /api/equipment/forge`: consumes the selected material and rolls on the server.
- `POST /api/equipment/repair`: consumes one repair gem and clears the damaged state.
- Failed normal/refine/elf forging damages and automatically unequips equipment.
- Light forge gems lose one existing forge level on failure without damage.
- All equipment and material changes use one `BEGIN IMMEDIATE` transaction.
