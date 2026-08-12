import express from 'express';
import path from 'path';

interface ScryfallCard {
  id: string;
  name: string;
  type_line?: string;
  oracle_text?: string;
  flavor_text?: string;
  mana_cost?: string;
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
  prices?: Record<string, string | null>;
  set_name?: string;
  collector_number?: string;
  rarity?: string;
  cmc?: number;
  colors?: string[];
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

// API endpoint: proxy card search to Scryfall
app.get('/api/cards', async (req, res) => {
  try {
    const { q = '', page = '1' } = req.query;
    const scryfallPage = Math.ceil(Number(page) / 8); // 8 client pages per Scryfall page

    const searchQuery = q
      ? encodeURIComponent(q as string)
      : 's:lea'; // Default to Limited Edition Alpha

    const response = await fetch(
      `https://api.scryfall.com/cards/search?q=${searchQuery}&page=${scryfallPage}`,
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

// Fallback: serve index.html for all other routes
app.get('/{*path}', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`MTG Cards app listening on http://localhost:${PORT}`);
});