import express from 'express';
import path from 'path';

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

// API endpoint: sync Moxfield collection using API key
// Accepts { username, apiKey } and proxies authenticated requests to Moxfield's API
app.post('/api/moxfield/sync', express.json(), async (req, res) => {
  try {
    const { username, apiKey } = req.body;
    if (!username || !apiKey) {
      return res.status(400).json({ error: 'Username and API key are required' });
    }

    const authHeaders = {
      'Accept': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'User-Agent': 'MTGCardsApp/1.0',
    };

    // Step 1: Fetch the user's collections
    const collectionsRes = await fetch(
      `https://api.moxfield.com/v2/users/${encodeURIComponent(username)}/collections`,
      { headers: authHeaders }
    );

    if (collectionsRes.status === 401 || collectionsRes.status === 403) {
      return res.status(401).json({ error: 'Invalid API key or unauthorized. Check your Moxfield API key.' });
    }

    if (collectionsRes.status === 404) {
      return res.status(404).json({ error: `Moxfield user "${username}" not found` });
    }

    if (!collectionsRes.ok) {
      const text = await collectionsRes.text();
      // Check if it's a Cloudflare block
      if (text.includes('Cloudflare') || text.includes('Attention Required')) {
        return res.status(502).json({ error: 'Moxfield API is behind Cloudflare and cannot be reached from this server. Try using the Import feature instead.' });
      }
      return res.status(collectionsRes.status).json({ error: `Moxfield API error: ${collectionsRes.status}` });
    }

    let collectionsData: any;
    try {
      collectionsData = await collectionsRes.json();
    } catch {
      return res.status(502).json({ error: 'Moxfield returned unexpected data (possibly a Cloudflare block). Try using the Import feature instead.' });
    }

    // collectionsData could be an array of collections or an object with collections
    const collections = Array.isArray(collectionsData) ? collectionsData : (collectionsData.collections || collectionsData.data || []);

    if (collections.length === 0) {
      return res.json({ username, cards: [], note: 'No collections found for this user.' });
    }

    // Step 2: Fetch cards from each collection
    const allCards: Record<string, { name: string; oracle_id: string; quantity: number }> = {};
    let totalCards = 0;
    const collectionNames: string[] = [];

    for (const collection of collections) {
      const collId = collection.id || collection.publicId;
      const collName = collection.name || collection.displayName || 'Unknown';
      collectionNames.push(collName);

      if (!collId) continue;

      // Fetch cards page by page
      let page = 1;
      let hasMore = true;
      while (hasMore) {
        const cardsRes = await fetch(
          `https://api.moxfield.com/v2/collections/${encodeURIComponent(collId)}/cards?page=${page}&pageSize=100`,
          { headers: authHeaders }
        );

        if (!cardsRes.ok) break;

        let cardsData: any;
        try {
          cardsData = await cardsRes.json();
        } catch {
          break;
        }

        const cardEntries = cardsData.data || cardsData.cards || cardsData;
        for (const entry of cardEntries) {
          const cardName = entry.name || entry.card?.name;
          const oracleId = entry.oracleId || entry.oracle_id || entry.card?.oracle_id || entry.card?.oracleId;
          const qty = entry.quantity || entry.count || 1;

          if (cardName && oracleId) {
            const key = oracleId;
            if (allCards[key]) {
              allCards[key].quantity += qty;
            } else {
              allCards[key] = { name: cardName, oracle_id: oracleId, quantity: qty };
            }
            totalCards += qty;
          }
        }

        hasMore = Boolean(cardsData.hasMore || cardsData.has_more);
        page++;
      }
    }

    const cards = Object.values(allCards);

    res.json({
      username,
      collections: collectionNames,
      cards,
      totalCards,
    });
  } catch (error) {
    console.error('Error syncing Moxfield collection:', error);
    res.status(500).json({ error: 'Failed to sync Moxfield collection. The API may be blocked by Cloudflare.' });
  }
});

// API endpoint: proxy to Moxfield public API to fetch a user's profile
app.get('/api/collection/:username', async (req, res) => {
  try {
    const { username } = req.params;

    const profileRes = await fetch(`https://api.moxfield.com/v2/users/${encodeURIComponent(username)}`, {
      headers: { 'Accept': 'application/json' },
    });

    if (!profileRes.ok) {
      if (profileRes.status === 404) {
        return res.status(404).json({ error: `Moxfield user "${username}" not found` });
      }
      return res.status(profileRes.status).json({ error: 'Failed to fetch Moxfield profile' });
    }

    res.json({
      username,
      found: true,
      note: 'Profile found. To sync your collection, enter your Moxfield API key below.',
      public_url: `https://www.moxfield.com/users/${username}`,
    });
  } catch (error) {
    console.error('Error fetching Moxfield collection:', error);
    res.status(500).json({ error: 'Failed to fetch Moxfield collection' });
  }
});

// API endpoint: resolve a list of card names to Scryfall oracle_ids
app.post('/api/resolve-cards', express.json(), async (req, res) => {
  try {
    const { cards } = req.body as { cards: { name: string; quantity: number; set?: string }[] };
    if (!Array.isArray(cards)) {
      return res.status(400).json({ error: 'Invalid cards array' });
    }

    const resolved: ResolvedCard[] = [];
    const errors: string[] = [];

    for (const entry of cards) {
      try {
        // Build search query — exact match with optional set filter
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
        // Get unique oracle_ids and their printings
        const oracleMap = new Map<string, { name: string; oracle_id: string; set_name: string; set_code: string }>();
        for (const card of data.data) {
          const oid = card.oracle_id || '';
          if (oid && !oracleMap.has(oid)) {
            oracleMap.set(oid, {
              name: card.name,
              oracle_id: oid,
              set_name: card.set_name || '',
              set_code: card.set_code || '',
            });
          }
        }
        // Pick the first (primary) printing
        const firstEntry = oracleMap.values().next().value;
        if (firstEntry) {
          resolved.push({ ...firstEntry, quantity: entry.quantity });
        } else {
          errors.push(`No oracle_id found for "${entry.name}"`);
        }
      } catch {
        errors.push(`Error resolving "${entry.name}"`);
      }
    }

    res.json({ resolved, errors });
  } catch (error) {
    console.error('Error resolving cards:', error);
    res.status(500).json({ error: 'Failed to resolve cards' });
  }
});

interface MoxfieldCardEntry {
  name: string;
  oracle_id: string;
  quantity: number;
  set_name?: string;
  set_code?: string;
}

interface ResolvedCard {
  name: string;
  oracle_id: string;
  quantity: number;
  set_name: string;
  set_code: string;
}

// Fallback: serve index.html for all other routes
app.get('/{*path}', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`MTG Cards app listening on http://localhost:${PORT}`);
});