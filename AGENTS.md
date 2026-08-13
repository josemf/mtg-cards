# MTG Cards - KAN-28

## Data Store
- SQLite via `node:sqlite` (built-in Node 22). DB file at project root (`./collection.db`).
- Table: `cards` (oracle_id TEXT PK, name TEXT, quantity INTEGER)
- Prepared statements cached at startup.

## Collection Import
- **CSV import** (file upload) → client parses Moxfield CSV → sends `{mode:"replace", cards}` to `/api/collection/import`.
- **Manual text import** → client parses text → sends `{mode:"merge"|"replace", cards}` to same endpoint.
- Server resolves card names to Scryfall oracle_ids, then writes to DB in a transaction.
- Set codes from Moxfield CSVs not passed to Scryfall — exact name matching is more reliable.

## Collection API
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/collection` | All cards as `{cards: [{oracle_id, name, quantity}]}` |
| POST | `/api/collection/import` | Body: `{mode:"replace"|"merge", cards:[{name,quantity,set?}]}` |
| POST | `/api/collection/clear` | Delete all cards |
| POST | `/api/collection/delete` | Delete single card by `{oracle_id}` |

## Moxfield Research
- **No public API** (per FAQ). `api2.moxfield.com/v1/collections/search/{id}` works from server with a browser User-Agent, but only for public collections.
- **CSV export** supported. Format: `Count, Tradelist Count, Name, Edition, Condition, Language, Foil, Tags, Last Modified, Collector Number, Alter, Proxy, Purchase Price`.
- `api.moxfield.com` blocked by Cloudflare from server. `api2.moxfield.com` is more accessible for the collection search endpoint.