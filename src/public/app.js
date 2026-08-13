// State
let currentPage = 1;
let currentQuery = '';
let totalCards = 0;
let totalPages = 0;
const PAGE_SIZE = 20;

// Filter state
const filters = {};

// Currently displayed card ID (for versions refresh)
let currentCardId = null;

// Collection state — keyed by oracle_id, value = quantity
let collection = {};
let collectionCount = 0;

// DOM elements
const searchInput = document.getElementById('search-input');
const searchButton = document.getElementById('search-button');
const cardsGrid = document.getElementById('cards-grid');
const loading = document.getElementById('loading');
const errorMessage = document.getElementById('error-message');
const resultsInfo = document.getElementById('results-info');
const totalCardsEl = document.getElementById('total-cards');
const currentPageInfo = document.getElementById('current-page-info');
const activeFiltersEl = document.getElementById('active-filters');
const pagination = document.getElementById('pagination');
const prevPage = document.getElementById('prev-page');
const nextPage = document.getElementById('next-page');
const pageIndicator = document.getElementById('page-indicator');

// Filter elements
const filterToggle = document.getElementById('filter-toggle');
const filterPanel = document.getElementById('filter-panel');
const filterType = document.getElementById('filter-type');
const filterSubtype = document.getElementById('filter-subtype');
const filterCmc = document.getElementById('filter-cmc');
const filterRarity = document.getElementById('filter-rarity');
const filterFormat = document.getElementById('filter-format');
const filterPower = document.getElementById('filter-power');
const filterToughness = document.getElementById('filter-toughness');
const colorBtns = document.querySelectorAll('.color-btn');
const applyFiltersBtn = document.getElementById('apply-filters');
const clearFiltersBtn = document.getElementById('clear-filters');

// Modal elements
const cardModal = document.getElementById('card-modal');
const modalOverlay = document.getElementById('modal-overlay');
const modalClose = document.getElementById('modal-close');
const modalBody = document.getElementById('modal-body');

// Collection elements
const collectionToggle = document.getElementById('collection-toggle');
const collectionPanel = document.getElementById('collection-panel');
const moxfieldUsername = document.getElementById('moxfield-username');
const moxfieldFetchBtn = document.getElementById('moxfield-fetch-btn');
const moxfieldApiKey = document.getElementById('moxfield-apikey');
const moxfieldSyncBtn = document.getElementById('moxfield-sync-btn');
const collectionImport = document.getElementById('collection-import');
const collectionImportBtn = document.getElementById('collection-import-btn');
const collectionClearBtn = document.getElementById('collection-clear-btn');
const collectionStatus = document.getElementById('collection-status');
const collectionStats = document.getElementById('collection-stats');
const collectionStatsRow = document.getElementById('collection-stats-row');

// Event listeners
searchButton.addEventListener('click', () => performSearch(1));
searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') performSearch(1);
});
prevPage.addEventListener('click', () => {
  if (currentPage > 1) performSearch(currentPage - 1);
});
nextPage.addEventListener('click', () => {
  if (currentPage < totalPages) performSearch(currentPage + 1);
});
modalOverlay.addEventListener('click', closeModal);
modalClose.addEventListener('click', closeModal);

// Filter toggle
filterToggle.addEventListener('click', () => {
  filterPanel.classList.toggle('hidden');
  filterToggle.classList.toggle('active');
});

// Color button toggles
colorBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    btn.classList.toggle('selected');
  });
});

// Apply / Clear filters
applyFiltersBtn.addEventListener('click', () => performSearch(1));
clearFiltersBtn.addEventListener('click', () => {
  // Reset all filter controls
  filterType.value = '';
  filterSubtype.value = '';
  filterCmc.value = '';
  filterRarity.value = '';
  filterFormat.value = '';
  filterPower.value = '';
  filterToughness.value = '';
  colorBtns.forEach(b => b.classList.remove('selected'));
  performSearch(1);
});

// Close modal on Escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
});

// Load collection from localStorage on startup
loadCollection();

// Collection panel toggle
collectionToggle.addEventListener('click', () => {
  collectionPanel.classList.toggle('hidden');
  collectionToggle.classList.toggle('active');
});

// Moxfield username fetch — verify the user exists via their profile page
// We do this from the frontend (browser) since the browser can handle Cloudflare.
// The backend can't reach moxfield.com reliably (Cloudflare blocks non-browser requests).
moxfieldFetchBtn.addEventListener('click', async () => {
  const username = moxfieldUsername.value.trim();
  if (!username) {
    setCollectionStatus('Please enter a Moxfield username', 'error');
    return;
  }
  setCollectionStatus('Checking Moxfield profile...', '');
  try {
    // Try the backend proxy first (works if the server IP isn't blocked)
    const res = await fetch(`/api/collection/${encodeURIComponent(username)}`);
    const data = await res.json();
    if (res.ok && data.found) {
      setCollectionStatus(`Profile found: ${data.public_url}. Enter your API key and click Sync.`, 'muted');
      return;
    }
    // Backend couldn't verify — try from the browser directly
    const directRes = await fetch(`https://www.moxfield.com/users/${encodeURIComponent(username)}`, {
      method: 'HEAD',
      mode: 'no-cors',
    });
    // With no-cors we can't read the status, but if it doesn't throw, the user likely exists
    setCollectionStatus(
      `Could not verify through server (Cloudflare). Enter your API key and click Sync to test directly.`,
      'muted'
    );
  } catch (err) {
    // Browser check also failed — just let the user try syncing
    setCollectionStatus('Enter your API key and click Sync to connect.', 'muted');
  }
});

// Moxfield API key sync
moxfieldSyncBtn.addEventListener('click', async () => {
  const username = moxfieldUsername.value.trim();
  const apiKey = moxfieldApiKey.value.trim();
  if (!username) {
    setCollectionStatus('Enter your Moxfield username first', 'error');
    return;
  }
  if (!apiKey) {
    setCollectionStatus('Enter your Moxfield API key', 'error');
    return;
  }
  setCollectionStatus('Syncing collection from Moxfield...', '');
  try {
    const res = await fetch('/api/moxfield/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, apiKey }),
    });
    const data = await res.json();

    if (!res.ok) {
      setCollectionStatus(data.error || 'Sync failed', 'error');
      return;
    }

    // Merge synced cards into collection
    if (data.cards && data.cards.length > 0) {
      let added = 0;
      for (const card of data.cards) {
        const key = card.oracle_id;
        const current = collection[key] || 0;
        collection[key] = current + card.quantity;
        added += card.quantity;
      }

      collectionCount = Object.values(collection).reduce((sum, qty) => sum + (Number(qty) || 0), 0);
      saveCollection();
      updateCollectionUI();

      const collNames = data.collections ? data.collections.join(', ') : '';
      setCollectionStatus(`✅ Synced ${added} cards from ${data.totalCards} total${collNames ? ' (' + collNames + ')' : ''}`, '');

      refreshOwnedBadges();
      if (!cardModal.classList.contains('hidden') && currentCardId) {
        refreshModalOwned();
      }
    } else {
      setCollectionStatus(data.note || 'No cards found in collection', 'muted');
    }
  } catch (err) {
    setCollectionStatus('Error syncing collection', 'error');
  }
});

// Import collection from textarea
collectionImportBtn.addEventListener('click', () => {
  const text = collectionImport.value.trim();
  if (!text) {
    setCollectionStatus('Paste your cards first', 'error');
    return;
  }
  importCollection(text);
});

// Clear collection
collectionClearBtn.addEventListener('click', () => {
  if (collectionCount === 0) return;
  if (!confirm('Clear your entire collection?')) return;
  collection = {};
  collectionCount = 0;
  collectionImport.value = '';
  saveCollection();
  updateCollectionUI();
  setCollectionStatus('Collection cleared', '');
  // Refresh card display if there are cards showing
  const cards = document.querySelectorAll('.card-item');
  if (cards.length > 0) {
    cards.forEach(el => {
      const badge = el.querySelector('.owned-badge');
      if (badge) badge.remove();
    });
  }
  // Refresh modal if open
  if (!cardModal.classList.contains('hidden') && currentCardId) {
    const modalOwned = document.querySelector('.modal-owned-info');
    if (modalOwned) modalOwned.remove();
  }
});

// Initial load
performSearch(1);

// Collect current filter values into an object
function getFilters() {
  const f = {};

  const type = filterType.value;
  if (type) f.type = type;

  const subtype = filterSubtype.value.trim();
  if (subtype) f.subtype = subtype;

  const cmc = filterCmc.value;
  if (cmc) f.cmc = cmc;

  const rarity = filterRarity.value;
  if (rarity) f.rarity = rarity;

  const format = filterFormat.value;
  if (format) f.format = format;

  const power = filterPower.value;
  if (power) f.power = power;

  const toughness = filterToughness.value;
  if (toughness) f.toughness = toughness;

  // Colors: collect selected color buttons
  const selectedColors = [];
  colorBtns.forEach(btn => {
    if (btn.classList.contains('selected')) {
      selectedColors.push(btn.dataset.color);
    }
  });
  if (selectedColors.length > 0) {
    f.colors = selectedColors.join('');
  }

  return f;
}

// Build a human-readable summary of active filters
function getFilterSummary() {
  const parts = [];
  if (filterType.value) {
    const label = filterType.options[filterType.selectedIndex].text;
    parts.push(`Type: ${label}`);
  }
  const selectedColors = [];
  colorBtns.forEach(btn => {
    if (btn.classList.contains('selected')) {
      selectedColors.push(btn.textContent);
    }
  });
  if (selectedColors.length > 0) parts.push(`Colors: ${selectedColors.join(', ')}`);
  if (filterCmc.value) parts.push(`CMC: ${filterCmc.value}`);
  if (filterRarity.value) parts.push(`Rarity: ${filterRarity.options[filterRarity.selectedIndex].text}`);
  if (filterFormat.value) parts.push(`Format: ${filterFormat.options[filterFormat.selectedIndex].text}`);
  if (filterSubtype.value.trim()) parts.push(`Type: ${filterSubtype.value.trim()}`);
  if (filterPower.value) parts.push(`Power: ${filterPower.value}`);
  if (filterToughness.value) parts.push(`Toughness: ${filterToughness.value}`);
  return parts.join(' · ');
}

async function performSearch(page) {
  const query = searchInput.value.trim();
  currentQuery = query;
  currentPage = page;

  // Show loading, hide results and error
  loading.classList.remove('hidden');
  errorMessage.classList.add('hidden');
  cardsGrid.innerHTML = '';
  resultsInfo.classList.add('hidden');
  pagination.classList.add('hidden');

  try {
    const currentFilters = getFilters();
    const params = new URLSearchParams({
      q: query,
      page: String(page),
    });

    // Append filter params
    for (const [key, value] of Object.entries(currentFilters)) {
      params.set(key, value);
    }

    const response = await fetch(`/api/cards?${params}`);

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.details || 'No cards found. Try a different search.');
    }

    const data = await response.json();

    totalCards = data.total_cards || 0;
    totalPages = data.total_pages || 1;
    const cards = data.data || [];

    if (cards.length === 0) {
      throw new Error('No cards found. Try a different search.');
    }

    renderCards(cards);
    renderPagination();
    renderResultsInfo();
  } catch (err) {
    errorMessage.textContent = err.message;
    errorMessage.classList.remove('hidden');
  } finally {
    loading.classList.add('hidden');
  }
}

function renderCards(cards) {
  cardsGrid.innerHTML = '';

  for (const card of cards) {
    const cardEl = document.createElement('div');
    cardEl.className = 'card-item';

    // Store oracle_id for owned badge lookup
    if (card.oracle_id) {
      cardEl.dataset.oracleId = card.oracle_id;
    }

    // Use card_faces for double-faced cards (DFC)
    const imageUrl = card.image_uris?.normal
      || card.image_uris?.small
      || card.card_faces?.[0]?.image_uris?.normal
      || card.card_faces?.[0]?.image_uris?.small
      || null;
    const cardName = card.name || 'Unknown';
    const typeLine = card.type_line || card.card_faces?.[0]?.type_line || '';
    const setCode = card.set_name ? `📋 ${card.set_name}` : '';

    if (imageUrl) {
      const img = document.createElement('img');
      img.className = 'card-image';
      img.src = imageUrl;
      img.alt = cardName;
      img.loading = 'lazy';
      cardEl.appendChild(img);
    } else {
      const placeholder = document.createElement('div');
      placeholder.className = 'card-image-placeholder';
      placeholder.textContent = '🃏';
      cardEl.appendChild(placeholder);
    }

    const info = document.createElement('div');
    info.className = 'card-info';

    const nameEl = document.createElement('div');
    nameEl.className = 'card-name';
    nameEl.textContent = cardName;
    info.appendChild(nameEl);

    const typeEl = document.createElement('div');
    typeEl.className = 'card-type';
    typeEl.textContent = typeLine;
    info.appendChild(typeEl);

    if (setCode) {
      const setEl = document.createElement('div');
      setEl.className = 'card-set';
      setEl.textContent = setCode;
      info.appendChild(setEl);
    }

    cardEl.appendChild(info);
    cardEl.addEventListener('click', () => showCardDetail(card.id));

    // Add owned badge if card is in collection
    addOwnedBadge(cardEl, card);

    cardsGrid.appendChild(cardEl);
  }
}

function renderPagination() {
  if (totalPages <= 1) {
    pagination.classList.add('hidden');
    return;
  }

  pagination.classList.remove('hidden');
  prevPage.disabled = currentPage <= 1;
  nextPage.disabled = currentPage >= totalPages;
  pageIndicator.textContent = `Page ${currentPage} of ${totalPages}`;
}

function renderResultsInfo() {
  if (totalCards > 0) {
    resultsInfo.classList.remove('hidden');
    totalCardsEl.textContent = `📊 ${totalCards} cards found`;
    const start = (currentPage - 1) * PAGE_SIZE + 1;
    const end = Math.min(currentPage * PAGE_SIZE, totalCards);
    currentPageInfo.textContent = `Showing ${start}–${end}`;

    // Show active filters summary
    const summary = getFilterSummary();
    if (summary) {
      activeFiltersEl.textContent = `🔍 ${summary}`;
      activeFiltersEl.classList.remove('hidden');
    } else {
      activeFiltersEl.classList.add('hidden');
    }
  }
}

async function showCardDetail(cardId) {
  currentCardId = cardId;
  try {
    const response = await fetch(`/api/cards/${cardId}`);
    if (!response.ok) throw new Error('Failed to load card details');

    const card = await response.json();
    renderCardDetail(card);
    cardModal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';

    // Load versions after the modal is shown
    loadVersions(card);
  } catch (err) {
    errorMessage.textContent = err.message;
    errorMessage.classList.remove('hidden');
  }
}

function renderCardDetail(card) {
  const imageUrl = card.image_uris?.normal
    || card.image_uris?.large
    || card.image_uris?.small
    || card.card_faces?.[0]?.image_uris?.normal
    || null;
  const manaCost = card.mana_cost || card.card_faces?.[0]?.mana_cost || '';
  const power = card.power || card.card_faces?.[0]?.power;
  const toughness = card.toughness || card.card_faces?.[0]?.toughness;
  const loyalty = card.loyalty;
  const oracleText = card.oracle_text || card.card_faces?.map(f => f.oracle_text).filter(Boolean).join('\n---\n') || '';
  const flavorText = card.flavor_text || '';
  const prices = card.prices || {};
  const collectorNumber = card.collector_number || '';
  const rarity = card.rarity || '';
  const setCode = card.set_name || '';
  const keywords = card.keywords || [];
  const legalities = card.legalities || {};

  let html = '<div class="modal-card-layout">';

  // Image
  if (imageUrl) {
    html += `<img class="modal-card-image" src="${imageUrl}" alt="${escapeHtml(card.name)}">`;
  }

  html += '<div class="modal-card-details">';

  // Hidden oracle_id for owned lookup
  html += `<span id="modal-oracle-id" style="display:none;">${card.oracle_id || ''}</span>`;

  // Name
  html += `<div class="modal-card-name">${escapeHtml(card.name)}</div>`;

  // Mana cost
  if (manaCost) {
    html += `<div class="modal-card-mana">${manaCost}</div>`;
  }

  // Type line
  html += `<div class="modal-card-type">${escapeHtml(card.type_line || card.card_faces?.[0]?.type_line || '')}</div>`;

  // Set / Collector number / Rarity
  html += `<div class="modal-card-set">${escapeHtml(setCode)} · #${collectorNumber} · ${rarity}</div>`;

  // Oracle text
  if (oracleText) {
    html += `<div class="modal-card-text">${escapeHtml(oracleText)}</div>`;
  }

  // Flavor text
  if (flavorText) {
    html += `<div class="modal-card-text" style="font-style: italic; color: var(--color-text-muted);">"${escapeHtml(flavorText)}"</div>`;
  }

  // Power / Toughness / Loyalty
  if (power !== undefined && toughness !== undefined) {
    html += `<div class="modal-card-stats">⚔ ${power} / ${toughness}</div>`;
  } else if (loyalty) {
    html += `<div class="modal-card-stats">❤ ${loyalty}</div>`;
  }

  // Keywords
  if (keywords.length > 0) {
    html += `<div style="margin-top:0.5rem;font-size:0.8rem;color:var(--color-text-muted);">${keywords.join(', ')}</div>`;
  }

  // Format legalities
  const legalFormats = Object.entries(legalities).filter(([_, status]) => status === 'legal').map(([fmt]) => fmt);
  if (legalFormats.length > 0) {
    html += `<div style="margin-top:0.5rem;font-size:0.8rem;color:var(--color-success);">✅ Legal in: ${legalFormats.join(', ')}</div>`;
  }

  // Prices
  const hasPrices = Object.values(prices).some(v => v !== null);
  if (hasPrices) {
    html += '<div class="modal-card-prices">';
    if (prices.usd) html += `<span class="price-tag">💰 $${prices.usd}</span>`;
    if (prices.usd_foil) html += `<span class="price-tag">✨ $${prices.usd_foil} foil</span>`;
    if (prices.eur) html += `<span class="price-tag">💶 €${prices.eur}</span>`;
    html += '</div>';
  }

  // Owned quantity — filled dynamically
  const ownedQty = card.oracle_id ? getOwnedQuantity(card.oracle_id) : 0;
  if (ownedQty > 0) {
    html += `<div class="modal-owned-info"><span style="color:var(--color-success);font-weight:600;">✅ You own ×${ownedQty}</span></div>`;
  }

  html += '</div></div>';

  // Versions section placeholder — will be filled by loadVersions()
  html += '<div id="versions-section" class="versions-section"><div class="versions-title">📋 All Printings</div><div class="versions-loading"><div class="spinner"></div> Loading versions...</div></div>';

  modalBody.innerHTML = html;
}

async function loadVersions(card) {
  try {
    const response = await fetch(`/api/cards/${card.id}/versions`);
    if (!response.ok) return;

    const data = await response.json();
    const versions = data.data || [];

    const versionsSection = document.getElementById('versions-section');
    if (!versionsSection) return;

    let html = '<div class="versions-title">📋 All Printings</div>';

    if (versions.length === 0) {
      html += '<div class="versions-loading">No other versions found.</div>';
      versionsSection.innerHTML = html;
      return;
    }

    html += '<div class="versions-grid">';

    for (const v of versions) {
      const img = v.image_uris?.small || v.card_faces?.[0]?.image_uris?.small || null;
      const isCurrent = v.id === card.id;
      const vOwned = v.oracle_id ? getOwnedQuantity(v.oracle_id) : 0;

      html += `<div class="version-item${isCurrent ? ' selected' : ''}" data-version-id="${v.id}">`;
      if (img) {
        html += `<img class="version-image" src="${img}" alt="${escapeHtml(v.name)}" loading="lazy">`;
      } else {
        html += `<div class="version-image" style="display:flex;align-items:center;justify-content:center;color:var(--color-text-muted);font-size:2rem;">🃏</div>`;
      }
      html += '<div class="version-info">';
      html += `<div class="version-set">${escapeHtml(v.set_name || '')} #${v.collector_number || ''}</div>`;
      html += `<div class="version-rarity">${v.rarity || ''}</div>`;
      if (vOwned > 0) {
        html += `<div class="version-owned-badge">×${vOwned}</div>`;
      }
      html += '</div></div>';
    }

    html += '</div>';
    versionsSection.innerHTML = html;

    // Add click handlers to version items
    versionsSection.querySelectorAll('.version-item').forEach(el => {
      el.addEventListener('click', () => {
        const versionId = el.dataset.versionId;
        if (versionId && versionId !== currentCardId) {
          showCardDetail(versionId);
        }
      });
    });
  } catch (err) {
    // Silently fail — versions are a bonus feature
  }
}

function closeModal() {
  cardModal.classList.add('hidden');
  document.body.style.overflow = '';
  currentCardId = null;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ====== COLLECTION FUNCTIONS ======

function loadCollection() {
  try {
    const saved = localStorage.getItem('mtg_collection');
    if (saved) {
      const parsed = JSON.parse(saved);
      // Support both old format (object) and new format
      if (parsed.cards && typeof parsed.cards === 'object') {
        collection = parsed.cards;
      } else if (typeof parsed === 'object') {
        collection = parsed;
      }
      collectionCount = Object.values(collection).reduce((sum, qty) => sum + (Number(qty) || 0), 0);
      updateCollectionUI();
    }
  } catch (e) {
    // Corrupted data, ignore
    collection = {};
    collectionCount = 0;
  }
}

function saveCollection() {
  try {
    localStorage.setItem('mtg_collection', JSON.stringify(collection));
  } catch (e) {
    // localStorage full or unavailable
  }
}

function updateCollectionUI() {
  if (collectionCount > 0) {
    collectionStats.textContent = `📦 ${collectionCount} cards in your collection`;
    collectionStatsRow.style.display = '';
  } else {
    collectionStatsRow.style.display = 'none';
  }
}

function setCollectionStatus(msg, type) {
  collectionStatus.textContent = msg;
  collectionStatus.style.color = type === 'error' ? 'var(--color-error)' : type === 'muted' ? 'var(--color-text-muted)' : 'var(--color-success)';
  if (msg) {
    collectionStatus.style.display = '';
  } else {
    collectionStatus.style.display = 'none';
  }
}

function parseCollectionText(text) {
  const entries = [];
  const lines = text.split('\n');

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) continue;

    // Try multiple formats:
    // "4 Llanowar Elves" or "4x Llanowar Elves"
    // "2 Llanowar Elves (FND)" or "2x Llanowar Elves (Foundations)"
    // "1 Card Name (SET) #123"
    // "3 Card Name (SET) 123a"

    let match;

    // Format: "4x Card Name (SET) #123" or "4 Card Name (SET) #123"
    match = line.match(/^(\d+)\s*x?\s+(.+?)(?:\s+\(([^)]+)\))?\s*(?:#\s*(\S+))?\s*$/);
    if (match) {
      const quantity = parseInt(match[1], 10) || 1;
      const name = match[2].trim();
      const set = match[3] ? match[3].trim() : '';
      entries.push({ name, quantity, set });
      continue;
    }

    // Fallback: treat whole line as card name, quantity = 1
    entries.push({ name: line, quantity: 1, set: '' });
  }

  return entries;
}

async function importCollection(text) {
  const entries = parseCollectionText(text);
  if (entries.length === 0) {
    setCollectionStatus('No cards found to import', 'error');
    return;
  }

  setCollectionStatus(`Resolving ${entries.length} cards...`, '');

  try {
    const res = await fetch('/api/resolve-cards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cards: entries }),
    });
    const data = await res.json();

    if (!res.ok) {
      setCollectionStatus(data.error || 'Failed to resolve cards', 'error');
      return;
    }

    // Merge resolved cards into collection
    let added = 0;
    for (const card of data.resolved) {
      const key = card.oracle_id;
      const current = collection[key] || 0;
      collection[key] = current + card.quantity;
      added += card.quantity;
    }

    collectionCount = Object.values(collection).reduce((sum, qty) => sum + (Number(qty) || 0), 0);
    saveCollection();
    updateCollectionUI();

    let msg = `✅ Imported ${added} card${added !== 1 ? 's' : ''}`;
    if (data.errors && data.errors.length > 0) {
      msg += `. ${data.errors.length} card${data.errors.length !== 1 ? 's' : ''} could not be resolved`;
    }
    setCollectionStatus(msg, '');

    // Refresh owned badges on current grid
    refreshOwnedBadges();

    // Refresh modal if open
    if (!cardModal.classList.contains('hidden') && currentCardId) {
      refreshModalOwned();
    }
  } catch (err) {
    setCollectionStatus('Error importing collection', 'error');
  }
}

// Check if an oracle_id is owned; returns quantity
function getOwnedQuantity(oracleId) {
  if (!oracleId) return 0;
  return collection[oracleId] || 0;
}

// Add owned badge to a card element in the grid
function addOwnedBadge(cardEl, card) {
  const oid = card.oracle_id;
  if (!oid) return;
  const qty = getOwnedQuantity(oid);
  if (qty <= 0) return;

  const badge = document.createElement('div');
  badge.className = 'owned-badge';
  badge.textContent = `×${qty}`;
  // Insert at the top of the card
  cardEl.style.position = 'relative';
  cardEl.appendChild(badge);
}

// Refresh owned badges on all currently displayed cards
function refreshOwnedBadges() {
  // Remove existing badges
  document.querySelectorAll('.owned-badge').forEach(b => b.remove());

  // Re-add badges for cards that have oracle_id data
  const cardEls = document.querySelectorAll('.card-item');
  cardEls.forEach(el => {
    // Try to find oracle_id from data attribute
    const oid = el.dataset.oracleId;
    if (!oid) return;
    const qty = getOwnedQuantity(oid);
    if (qty <= 0) return;
    const badge = document.createElement('div');
    badge.className = 'owned-badge';
    badge.textContent = `×${qty}`;
    el.style.position = 'relative';
    el.appendChild(badge);
  });
}

// Add owned info to the modal
function refreshModalOwned() {
  const existing = document.querySelector('.modal-owned-info');
  if (existing) existing.remove();

  if (!currentCardId) return;

  // We need the oracle_id - fetch it from the current modal context
  const modalOracleIdEl = document.getElementById('modal-oracle-id');
  if (!modalOracleIdEl) return;

  const oid = modalOracleIdEl.textContent;
  const qty = getOwnedQuantity(oid);
  if (qty <= 0) return;

  const detailsEl = document.querySelector('.modal-card-details');
  if (!detailsEl) return;

  const ownedDiv = document.createElement('div');
  ownedDiv.className = 'modal-owned-info';
  ownedDiv.innerHTML = `<span style="color:var(--color-success);font-weight:600;">✅ You own ×${qty}</span>`;
  detailsEl.appendChild(ownedDiv);
}