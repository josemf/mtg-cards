import express from 'express';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';

// ── SQLite collection store ──────────────────────────────────────────────────
const DB_PATH = path.join(__dirname, '..', 'collection.db');
const db = new DatabaseSync(DB_PATH);
db.exec(`CREATE TABLE IF NOT EXISTS cards (
  oracle_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1
)`);
db.exec(`CREATE TABLE IF NOT EXISTS card_cache (
  oracle_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  data TEXT NOT NULL,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);

// Prepared statements — cached for reuse across requests
const stmtGetAll = db.prepare('SELECT oracle_id, name, quantity FROM cards ORDER BY name');
const stmtUpsert = db.prepare('INSERT INTO cards (oracle_id, name, quantity) VALUES (?, ?, ?) ON CONFLICT(oracle_id) DO UPDATE SET quantity = quantity + excluded.quantity');
const stmtReplace = db.prepare('INSERT OR REPLACE INTO cards (oracle_id, name, quantity) VALUES (?, ?, ?)');
const stmtClear = db.prepare('DELETE FROM cards');
const stmtDelete = db.prepare('DELETE FROM cards WHERE oracle_id = ?');
const stmtCacheUpsert = db.prepare('INSERT OR REPLACE INTO card_cache (oracle_id, name, data) VALUES (?, ?, ?)');

// Run DB operations inside a transaction helper
function transaction<T>(fn: () => T): T {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

interface ScryfallCard {
  id: string;
  name: string;
  released_at?: string;
  type_line?: string;
  oracle_text?: string;
  flavor_text?: string;
  mana_cost?: string;
  power?: string;
  toughness?: string;
  loyalty?: string;
  defense?: string;
  image_uris?: {
    small: string;
    normal: string;
    large: string;
    png: string;
    art_crop: string;
    border_crop: string;
  };
  card_faces?: Array<{
    name: string;
    mana_cost?: string;
    type_line?: string;
    oracle_text?: string;
    flavor_text?: string;
    power?: string;
    toughness?: string;
    image_uris?: {
      small: string;
      normal: string;
      large: string;
      png: string;
      art_crop: string;
      border_crop: string;
    };
  }>;
  prices?: Record<string, string | null>;
  set_name?: string;
  set_code?: string;
  collector_number?: string;
  rarity?: string;
  cmc?: number;
  colors?: string[];
  color_identity?: string[];
  keywords?: string[];
  produced_mana?: string[];
  legalities?: Record<string, string>;
  set_id?: string;
  oracle_id?: string;
}

interface ScryfallResponse {
  object: string;
  total_cards: number;
  has_more: boolean;
  data: ScryfallCard[];
  next_page?: string;
}

const SCRYFALL_HEADERS = {
  'User-Agent': 'MTGCardsApp/1.0 (https://github.com/josemf/mtg-cards)',
  'Accept': 'application/json',
};

// ── Exponential backoff fetch ────────────────────────────────────────────────
async function fetchWithBackoff(url: string, options: RequestInit, maxRetries = 5): Promise<Response> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const response = await fetch(url, options);
    if (response.ok) return response;
    if (response.status === 429) {
      const retryAfter = parseInt(response.headers.get('retry-after') || '1', 10);
      const delay = Math.pow(2, attempt) * 1000 + retryAfter * 1000;
      console.warn(`Rate limited, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
      await new Promise(r => setTimeout(r, delay));
      continue;
    }
    return response;
  }
  throw new Error(`Scryfall request failed after ${maxRetries} retries: ${url}`);
}

// ── Import progress tracking ─────────────────────────────────────────────────
interface ImportProgress {
  total: number;
  processed: number;
  errors: string[];
  status: 'running' | 'complete' | 'error';
}
const importJobs = new Map<string, ImportProgress>();

// ── Insert cards into card_cache ─────────────────────────────────────────────
function cacheCards(cardData: { oracle_id: string; name: string; data: string }[]) {
  const insert = db.prepare('INSERT OR REPLACE INTO card_cache (oracle_id, name, data) VALUES (?, ?, ?)');
  for (const c of cardData) {
    insert.run(c.oracle_id, c.name, c.data);
  }
}

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, 'public')));

// Build a Scryfall search query string from the user's search term and filters.
function buildSearchQuery(q: string, filters: Record<string, string>): string {
  const parts: string[] = [];

  if (q.trim()) {
    parts.push(q.trim());
  }

  // Card type (Creature, Instant, Sorcery, etc.)
  if (filters.type) {
    parts.push(`t:${filters.type}`);
  }

  // Creature subtype / creature type
  if (filters.subtype) {
    parts.push(`t:${filters.subtype}`);
  }

  // Color filter (e.g. w for white, ub for blue-black)
  if (filters.colors) {
    parts.push(`c:${filters.colors}`);
  }

  // Mana value (converted mana cost)
  if (filters.cmc) {
    const cmc = filters.cmc;
    if (cmc === '7+') {
      parts.push('cmc>=7');
    } else {
      parts.push(`cmc=${cmc}`);
    }
  }

  // Rarity
  if (filters.rarity) {
    parts.push(`r:${filters.rarity}`);
  }

  // Format legality
  if (filters.format) {
    parts.push(`f:${filters.format}`);
  }

  // Power
  if (filters.power) {
    parts.push(`pow=${filters.power}`);
  }

  // Toughness
  if (filters.toughness) {
    parts.push(`tou=${filters.toughness}`);
  }

  // If no search term or filters, default to a broad browse
  if (parts.length === 0) {
    return 's:lea'; // Limited Edition Alpha
  }

  return parts.join(' ');
}

// API endpoint: proxy card search to Scryfall
app.get('/api/cards', async (req, res) => {
  try {
    const { q = '', page = '1' } = req.query;
    const scryfallPage = Math.ceil(Number(page) / 8); // 8 client pages per Scryfall page

    const filters: Record<string, string> = {};
    for (const key of ['type', 'subtype', 'colors', 'cmc', 'rarity', 'format', 'power', 'toughness']) {
      const value = req.query[key];
      if (typeof value === 'string' && value) {
        filters[key] = value;
      }
    }

    const searchQuery = buildSearchQuery(q as string, filters);

    const response = await fetch(
      `https://api.scryfall.com/cards/search?q=${encodeURIComponent(searchQuery)}&page=${scryfallPage}`,
      { headers: SCRYFALL_HEADERS }
    );
    const data = (await response.json()) as ScryfallResponse;

    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    // Scryfall returns up to 175 cards per page. We slice to simulate smaller pages.
    const scryfallPageSize = 175;
    const clientPageSize = 20;
    const clientPage = Number(page);
    const startIndex = (clientPage - 1) % 8 * clientPageSize;
    const sliced = data.data.slice(startIndex, startIndex + clientPageSize);

    // Compute total client pages: each full Scryfall page (175 cards) yields 8
    // client pages; the final partial page yields however many it actually has.
    const totalScryfallPages = Math.ceil(data.total_cards / scryfallPageSize);
    const lastPageCards = data.total_cards - (totalScryfallPages - 1) * scryfallPageSize;
    const totalPages = (totalScryfallPages - 1) * 8 + Math.ceil(lastPageCards / clientPageSize);

    res.json({
      ...data,
      data: sliced,
      total_cards: data.total_cards,
      has_more: data.has_more || (startIndex + clientPageSize < scryfallPageSize),
      total_pages: totalPages,
      search_query: searchQuery,
    });
  } catch (error) {
    console.error('Error fetching from Scryfall:', error);
    res.status(500).json({ error: 'Failed to fetch cards from Scryfall' });
  }
});

// API endpoint: get card details by id
app.get('/api/cards/:id', async (req, res) => {
  try {
    const response = await fetch(`https://api.scryfall.com/cards/${req.params.id}`, {
      headers: SCRYFALL_HEADERS,
    });
    const data = (await response.json()) as ScryfallCard;

    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    res.json(data);
  } catch (error) {
    console.error('Error fetching card details:', error);
    res.status(500).json({ error: 'Failed to fetch card details' });
  }
});

// API endpoint: get all printings (versions) of a card by name
app.get('/api/cards/:id/versions', async (req, res) => {
  try {
    // First fetch the card to get its name
    const cardResponse = await fetch(`https://api.scryfall.com/cards/${req.params.id}`, {
      headers: SCRYFALL_HEADERS,
    });
    const card = (await cardResponse.json()) as ScryfallCard;

    if (!cardResponse.ok) {
      return res.status(cardResponse.status).json(card);
    }

    // Use the exact-match syntax (!) to find all printings of the same card
    const versionsResponse = await fetch(
      `https://api.scryfall.com/cards/search?q=${encodeURIComponent(`!"${card.name}"`)}&unique=prints`,
      { headers: SCRYFALL_HEADERS }
    );
    const versions = (await versionsResponse.json()) as ScryfallResponse;

    if (!versionsResponse.ok) {
      return res.status(versionsResponse.status).json(versions);
    }

    // Sort versions by release date (oldest first)
    const sorted = [...versions.data].sort((a, b) => {
      const dateA = a.released_at ?? '';
      const dateB = b.released_at ?? '';
      return dateA.localeCompare(dateB);
    });

    res.json({ ...versions, data: sorted, card_name: card.name });
  } catch (error) {
    console.error('Error fetching card versions:', error);
    res.status(500).json({ error: 'Failed to fetch card versions' });
  }
});

// ── Collection API ────────────────────────────────────────────────────────────

// GET /api/collection — return all cards from the SQLite database
app.get('/api/collection', (_req, res) => {
  try {
    const cards = stmtGetAll.all() as { oracle_id: string; name: string; quantity: number }[];
    res.json({ cards });
  } catch (error) {
    console.error('Error reading collection:', error);
    res.status(500).json({ error: 'Failed to read collection' });
  }
});

// POST /api/collection/import — import cards from resolved data (chunked)
// body: { mode: "replace" | "merge", cards: [...], jobId?: string, isFirst?: boolean, isLast?: boolean }
// Supports chunked upload: set jobId (same across chunks), isFirst=true on first chunk,
// isLast=true on final chunk. Monolithic calls (no jobId) behave as before.
app.post('/api/collection/import', express.json({ limit: '50mb' }), async (req, res) => {
  try {
    const { mode, cards, jobId, isFirst, isLast } = req.body as {
      mode: 'replace' | 'merge';
      cards: { name: string; quantity: number; scryfall_id?: string; set?: string }[];
      jobId?: string;
      isFirst?: boolean;
      isLast?: boolean;
    };
    if (!['replace', 'merge'].includes(mode)) {
      return res.status(400).json({ error: 'mode must be "replace" or "merge"' });
    }
    if (!Array.isArray(cards) || cards.length === 0) {
      return res.status(400).json({ error: 'cards array is required and must not be empty' });
    }

    // If chunked, set up progress tracking
    if (jobId) {
      // Clear existing progress for this job
      if (isFirst) {
        importJobs.set(jobId, { total: 0, processed: 0, errors: [], status: 'running' });
      }
      const job = importJobs.get(jobId);
      if (job) {
        job.total += cards.length;
      }
    }

    // Resolve each card to oracle_id via Scryfall.
    // Batches scryfall_id lookups via POST /cards/collection (up to 75 per call).
    // Name-only cards are deduplicated and resolved one by one with a delay.
    const resolved: { oracle_id: string; name: string; quantity: number }[] = [];
    const errors: string[] = [];

    // Split: cards with scryfall_id and cards without
    const withIds: { id: string; name: string; quantity: number }[] = [];
    const withoutIds: { name: string; quantity: number; set?: string }[] = [];

    for (const entry of cards) {
      if (entry.scryfall_id) {
        withIds.push({ id: entry.scryfall_id, name: entry.name, quantity: entry.quantity });
      } else {
        withoutIds.push({ name: entry.name, quantity: entry.quantity, set: entry.set });
      }
    }

    // Helper: process a chunk of /cards/collection responses
    async function resolveBatch(identifiers: { id: string; name: string; quantity: number }[]) {
      // Deduplicate by scryfall_id, summing quantities
      const byId = new Map<string, { name: string; quantity: number }>();
      for (const e of identifiers) {
        const existing = byId.get(e.id);
        if (existing) {
          existing.quantity += e.quantity;
        } else {
          byId.set(e.id, { name: e.name, quantity: e.quantity });
        }
      }
      const uniqueIds = Array.from(byId.entries());

      // Batch in chunks of 75 (Scryfall limit)
      for (let i = 0; i < uniqueIds.length; i += 75) {
        const chunk = uniqueIds.slice(i, i + 75);
        const payload = { identifiers: chunk.map(([id]) => ({ id })) };
        try {
          const response = await fetchWithBackoff('https://api.scryfall.com/cards/collection', {
            method: 'POST',
            headers: { ...SCRYFALL_HEADERS, 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          if (response.ok) {
            const data = await response.json() as { data: any[] };
            const idMap = new Map(data.data.map((c: any) => [c.id, c]));
            const toCache: { oracle_id: string; name: string; data: string }[] = [];
            for (const [id, { name, quantity }] of chunk) {
              const match = idMap.get(id);
              if (match) {
                resolved.push({ oracle_id: match.oracle_id, name: match.name, quantity });
                // Cache the full card data
                if (match.oracle_id) {
                  toCache.push({ oracle_id: match.oracle_id, name: match.name, data: JSON.stringify(match) });
                }
              } else {
                errors.push(`Scryfall returned no data for id "${id}" ("${name}")`);
              }
            }
            if (toCache.length > 0) cacheCards(toCache);
          } else {
            for (const [, { name }] of chunk) {
              errors.push(`Could not resolve scryfall_id for "${name}" (batch request failed)`);
            }
          }
        } catch {
          for (const [, { name }] of chunk) {
            errors.push(`Error resolving scryfall_id for "${name}"`);
          }
        }
        // Small delay to avoid rate limiting
        if (i + 75 < uniqueIds.length) await new Promise(r => setTimeout(r, 200));
      }
    }

    // Batch all scryfall_id lookups together
    await resolveBatch(withIds);

    // Resolve name-only cards, deduplicated by lowercase name
    if (withoutIds.length > 0) {
      const byName = new Map<string, { quantity: number; set?: string }>();
      for (const e of withoutIds) {
        const key = e.name.toLowerCase();
        const existing = byName.get(key);
        if (existing) {
          existing.quantity += e.quantity;
        } else {
          byName.set(key, { quantity: e.quantity, set: e.set });
        }
      }

      let idx = 0;
      for (const [lcName, { quantity, set }] of byName) {
        // Simple rate limiting: delay after every 10 requests
        if (idx > 0 && idx % 10 === 0) await new Promise(r => setTimeout(r, 200));
        idx++;

        try {
          let query = `!"${lcName}"`;
          if (set) {
            query += ` e:${set}`;
          }
          const response = await fetch(
            `https://api.scryfall.com/cards/search?q=${encodeURIComponent(query)}&unique=prints`,
            { headers: SCRYFALL_HEADERS }
          );
          if (!response.ok) {
            errors.push(`Could not resolve "${lcName}"`);
            continue;
          }
          const data = (await response.json()) as ScryfallResponse;
          const oracleMap = new Map<string, { name: string; oracle_id: string }>();
          const toCache: { oracle_id: string; name: string; data: string }[] = [];
          for (const card of data.data) {
            const oid = card.oracle_id || '';
            if (oid && !oracleMap.has(oid)) {
              oracleMap.set(oid, { name: card.name, oracle_id: oid });
              // Cache the full card data (first occurrence of each oracle_id)
              toCache.push({ oracle_id: oid, name: card.name, data: JSON.stringify(card) });
            }
          }
          const first = oracleMap.values().next().value;
          if (first) {
            resolved.push({ oracle_id: first.oracle_id, name: first.name, quantity });
            if (toCache.length > 0) cacheCards(toCache);
          } else {
            errors.push(`No oracle_id found for "${lcName}"`);
          }
        } catch {
          errors.push(`Error resolving "${lcName}"`);
        }
      }
    }

    // Write to DB in a transaction
    transaction(() => {
      if (mode === 'replace' && (!jobId || isFirst)) {
        stmtClear.run();
        for (const card of resolved) {
          stmtReplace.run(card.oracle_id, card.name, card.quantity);
        }
      } else {
        for (const card of resolved) {
          stmtUpsert.run(card.oracle_id, card.name, card.quantity);
        }
      }
    });

    // Update progress
    if (jobId) {
      const job = importJobs.get(jobId);
      if (job) {
        job.processed += resolved.length;
        job.errors.push(...errors);
        if (isLast) {
          job.status = 'complete';
        }
      }
    }

    // For chunked calls, return progress; for monolithic, return full result
    if (jobId) {
      const job = importJobs.get(jobId);
      res.json({
        jobId,
        processed: job?.processed ?? resolved.length,
        total: job?.total ?? resolved.length,
        chunkCards: resolved.length,
        status: job?.status ?? 'running',
        errors: errors.slice(0, 20), // limit error detail per chunk
      });
    } else {
      const total = resolved.reduce((s, c) => s + c.quantity, 0);
      res.json({ imported: resolved.length, totalCards: total, errors });
    }
  } catch (error) {
    console.error('Error importing collection:', error);
    res.status(500).json({ error: 'Failed to import collection' });
  }
});

// POST /api/collection/clear — delete all cards from the collection
app.post('/api/collection/clear', (_req, res) => {
  try {
    stmtClear.run();
    res.json({ cleared: true });
  } catch (error) {
    console.error('Error clearing collection:', error);
    res.status(500).json({ error: 'Failed to clear collection' });
  }
});

// POST /api/collection/delete — delete a single card by oracle_id
app.post('/api/collection/delete', express.json(), (req, res) => {
  try {
    const { oracle_id } = req.body as { oracle_id: string };
    if (!oracle_id) return res.status(400).json({ error: 'oracle_id required' });
    stmtDelete.run(oracle_id);
    res.json({ deleted: true });
  } catch (error) {
    console.error('Error deleting card:', error);
    res.status(500).json({ error: 'Failed to delete card' });
  }
});

// ── Backfill card_cache from existing collection ────────────────────────────
// POST /api/collection/cache-backfill — fills missing card_cache entries from
// the existing collection by fetching from Scryfall. Runs in chunks with progress.
app.post('/api/collection/cache-backfill', express.json(), async (req, res) => {
  try {
    const cards = stmtGetAll.all() as { oracle_id: string; name: string; quantity: number }[];
    const cacheCheck = db.prepare('SELECT 1 FROM card_cache WHERE oracle_id = ?');
    const missing = cards.filter(c => !cacheCheck.get(c.oracle_id));

    if (missing.length === 0) {
      return res.json({ cached: 0, total: cards.length, message: 'cache is already up to date' });
    }

    // Fetch missing cards from Scryfall in batches of 75
    let cached = 0;
    const errors: string[] = [];

    for (let i = 0; i < missing.length; i += 75) {
      const chunk = missing.slice(i, i + 75);
      const payload = { identifiers: chunk.map(c => ({ oracle_id: c.oracle_id })) };
      try {
        const response = await fetchWithBackoff('https://api.scryfall.com/cards/collection', {
          method: 'POST',
          headers: { ...SCRYFALL_HEADERS, 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (response.ok) {
          const data = await response.json() as { data: any[] };
          const toCache: { oracle_id: string; name: string; data: string }[] = [];
          for (const card of data.data) {
            if (card.oracle_id) {
              toCache.push({ oracle_id: card.oracle_id, name: card.name, data: JSON.stringify(card) });
            }
          }
          if (toCache.length > 0) {
            cacheCards(toCache);
            cached += toCache.length;
          }
        } else {
          errors.push(`Batch request failed at offset ${i}`);
        }
      } catch {
        errors.push(`Error fetching batch at offset ${i}`);
      }
      if (i + 75 < missing.length) await new Promise(r => setTimeout(r, 200));
    }

    res.json({ cached, total: cards.length, errors: errors.slice(0, 20) });
  } catch (error) {
    console.error('Error backfilling cache:', error);
    res.status(500).json({ error: 'Backfill failed' });
  }
});

// ── Import progress endpoint ─────────────────────────────────────────────────
app.get('/api/collection/import/status/:jobId', (req, res) => {
  const job = importJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

// Parse a comparison string like ">=3", "<=5", ">2", "<4", or "3" into {op, val}
function parseComparison(s: string): { op: string; val: number } {
  const match = s.match(/^([><]=?)(.+)$/);
  if (match) {
    return { op: match[1], val: parseFloat(match[2]) };
  }
  return { op: '=', val: parseFloat(s) };
}

// ── Local collection search ──────────────────────────────────────────────────
// Searches card_cache (full Scryfall card data cached during import) filtered
// to only cards the user owns (via JOIN with cards table). Returns same format
// as the Scryfall proxy so the frontend can use identical rendering.
// Only for "collection only" mode — full Scryfall search is still proxied.
app.get('/api/collection/search', (req, res) => {
  try {
    const query = (req.query.q as string || '').trim();
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const pageSize = 20;
    const offset = (page - 1) * pageSize;

    // Build WHERE clause from search query + optional filter params
    const conditions: string[] = [];
    const params: any[] = [];

    // Only show cards the user owns
    conditions.push('c.quantity > 0');

    // Full-text name search
    if (query) {
      const words = query.split(/\s+/).filter(Boolean);
      for (const word of words) {
        conditions.push('cc.name LIKE ?');
        params.push(`%${word}%`);
      }
    }

    // Type filter — searches type_line (handles "creature", "instant", "artifact", etc.)
    const typeFilter = req.query.type as string;
    if (typeFilter) {
      conditions.push("LOWER(json_extract(cc.data, '$.type_line')) LIKE ?");
      params.push(`%${typeFilter.toLowerCase()}%`);
    }

    // Subtype filter — also searches type_line (same as type, since Scryfall treats both as t:)
    const subtypeFilter = req.query.subtype as string;
    if (subtypeFilter) {
      conditions.push("LOWER(json_extract(cc.data, '$.type_line')) LIKE ?");
      params.push(`%${subtypeFilter.toLowerCase()}%`);
    }

    // Rarity filter
    const rarityFilter = req.query.rarity as string;
    if (rarityFilter) {
      conditions.push("LOWER(json_extract(cc.data, '$.rarity')) = ?");
      params.push(rarityFilter.toLowerCase());
    }

    // CMC filter — handles "7+", "5", etc.
    const cmcFilter = req.query.cmc as string;
    if (cmcFilter) {
      if (cmcFilter.endsWith('+')) {
        conditions.push('CAST(json_extract(cc.data, \'$.cmc\') AS REAL) >= ?');
        params.push(parseFloat(cmcFilter));
      } else {
        conditions.push('CAST(json_extract(cc.data, \'$.cmc\') AS REAL) = ?');
        params.push(parseFloat(cmcFilter));
      }
    }

    // Color filter — frontend sends concatenated letters like "WU" for white+blue
    const colorsFilter = req.query.colors as string;
    if (colorsFilter) {
      const colorLetters = colorsFilter.toUpperCase().split('').filter(c => /^[WUBRGC]$/.test(c));
      for (const cl of colorLetters) {
        conditions.push("json_extract(cc.data, '$.colors') LIKE ?");
        params.push(`%"${cl}"%`);
      }
    }

    // Format legality filter — searches the legalities JSON text
    // legalities is {"commander":"legal","standard":"not_legal",...}
    // We search the raw text for `"formatname":"legal"`
    const formatFilter = req.query.format as string;
    if (formatFilter) {
      const fmt = formatFilter.toLowerCase();
      conditions.push("cc.data LIKE ?");
      params.push(`%"${fmt}":"legal"%`);
    }

    // Power / toughness — support comparison operators (>=, <=, >, <) and exact match
    const powerFilter = req.query.power as string;
    if (powerFilter) {
      const { op, val } = parseComparison(powerFilter);
      conditions.push(`CAST(json_extract(cc.data, '$.power') AS REAL) ${op} ?`);
      params.push(val);
    }
    const toughnessFilter = req.query.toughness as string;
    if (toughnessFilter) {
      const { op, val } = parseComparison(toughnessFilter);
      conditions.push(`CAST(json_extract(cc.data, '$.toughness') AS REAL) ${op} ?`);
      params.push(val);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Count total matching cards
    const countStmt = db.prepare(`SELECT COUNT(*) as cnt FROM card_cache cc JOIN cards c ON c.oracle_id = cc.oracle_id ${whereClause}`);
    const { cnt: totalCards } = countStmt.get(...params) as { cnt: number };
    const totalPages = Math.ceil(totalCards / pageSize);

    // Fetch page
    const fetchStmt = db.prepare(`SELECT cc.data, c.quantity FROM card_cache cc JOIN cards c ON c.oracle_id = cc.oracle_id ${whereClause} ORDER BY cc.name LIMIT ? OFFSET ?`);
    const rows = fetchStmt.all(...params, pageSize, offset) as { data: string; quantity: number }[];

    // Parse JSON data and add owned quantity
    const cards = rows.map(row => {
      const card = JSON.parse(row.data);
      card.owned_quantity = row.quantity;
      return card;
    });

    res.json({
      object: 'list',
      total_cards: totalCards,
      total_pages: totalPages,
      has_more: page < totalPages,
      data: cards,
      search_query: query,
      source: 'local',
    });
  } catch (error) {
    console.error('Error searching collection:', error);
    res.status(500).json({ error: 'Failed to search collection' });
  }
});

// Fallback: serve index.html for all other routes (must be last)
app.get('/{*path}', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`MTG Cards app listening on http://localhost:${PORT}`);
});