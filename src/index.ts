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

// Prepared statements — cached for reuse across requests
const stmtGetAll = db.prepare('SELECT oracle_id, name, quantity FROM cards ORDER BY name');
const stmtUpsert = db.prepare('INSERT INTO cards (oracle_id, name, quantity) VALUES (?, ?, ?) ON CONFLICT(oracle_id) DO UPDATE SET quantity = quantity + excluded.quantity');
const stmtReplace = db.prepare('INSERT OR REPLACE INTO cards (oracle_id, name, quantity) VALUES (?, ?, ?)');
const stmtClear = db.prepare('DELETE FROM cards');
const stmtDelete = db.prepare('DELETE FROM cards WHERE oracle_id = ?');

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

// POST /api/collection/import — import cards from resolved data
// body: { mode: "replace" | "merge", cards: [{ name, quantity, set? }] }
// Resolves names to oracle_ids, then stores in DB.
// mode "replace" clears the table first; mode "merge" adds to existing quantities.
app.post('/api/collection/import', express.json(), async (req, res) => {
  try {
    const { mode, cards } = req.body as { mode: 'replace' | 'merge'; cards: { name: string; quantity: number; set?: string }[] };
    if (!['replace', 'merge'].includes(mode)) {
      return res.status(400).json({ error: 'mode must be "replace" or "merge"' });
    }
    if (!Array.isArray(cards) || cards.length === 0) {
      return res.status(400).json({ error: 'cards array is required and must not be empty' });
    }

    // Resolve each card name to oracle_id via Scryfall
    const resolved: { oracle_id: string; name: string; quantity: number }[] = [];
    const errors: string[] = [];

    for (const entry of cards) {
      try {
        let query = `!"${entry.name}"`;
        if (entry.set) {
          query += ` e:${entry.set}`;
        }
        const response = await fetch(
          `https://api.scryfall.com/cards/search?q=${encodeURIComponent(query)}&unique=prints`,
          { headers: SCRYFALL_HEADERS }
        );
        if (!response.ok) {
          errors.push(`Could not resolve "${entry.name}"`);
          continue;
        }
        const data = (await response.json()) as ScryfallResponse;
        const oracleMap = new Map<string, { name: string; oracle_id: string }>();
        for (const card of data.data) {
          const oid = card.oracle_id || '';
          if (oid && !oracleMap.has(oid)) {
            oracleMap.set(oid, { name: card.name, oracle_id: oid });
          }
        }
        const first = oracleMap.values().next().value;
        if (first) {
          resolved.push({ ...first, quantity: entry.quantity });
        } else {
          errors.push(`No oracle_id found for "${entry.name}"`);
        }
      } catch {
        errors.push(`Error resolving "${entry.name}"`);
      }
    }

    // Write to DB in a transaction
    transaction(() => {
      if (mode === 'replace') {
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

    const total = resolved.reduce((s, c) => s + c.quantity, 0);
    res.json({ imported: resolved.length, totalCards: total, errors });
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

// Fallback: serve index.html for all other routes
app.get('/{*path}', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`MTG Cards app listening on http://localhost:${PORT}`);
});