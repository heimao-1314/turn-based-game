# Economy Runtime

`redeem-code-runtime.js` owns database-backed redemption-code validation and claims.

- `redeem_codes` stores only a SHA-256 digest of the normalized code, rewards, limits, validity, and enabled state.
- `redeem_claims` enforces per-account limits through its primary key.
- Claims run inside `BEGIN IMMEDIATE` so a code cannot be over-issued under concurrent requests.

The runtime is injected with the database and the server-owned item catalog. It never trusts a client-supplied reward amount.
- `default-redeem-codes.js` seeds package-safe reward definitions into a fresh release database using code hashes; existing operational code settings are never overwritten.
