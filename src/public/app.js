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
const collectionImportBtn = document.getElementById('collection-import-btn');
const collectionClearBtn = document.getElementById('collection-clear-btn');
const collectionStatus = document.getElementById('collection-status');
const collectionStats = document.getElementById('collection-stats');
const collectionStatsRow = document.getElementById('collection-stats-row');
const collectionOnlyToggle = document.getElementById('collection-only-toggle');
// Provider system
const providerBtns = document.querySelectorAll('.provider-btn');
const providerPanels = {
  moxfield: document.getElementById('provider-moxfield'),
  manabox: document.getElementById('provider-manabox'),
  manual: document.getElementById('provider-manual'),
};
const moxfieldCsvInput = document.getElementById('moxfield-csv-input');
const manaboxCsvInput = document.getElementById('manabox-csv-input');
const manualTextarea = document.getElementById('manual-textarea');
// Confirmation modal
const confirmModal = document.getElementById('confirm-modal');
const confirmOverlay = document.getElementById('confirm-overlay');
const confirmCancelBtn = document.getElementById('confirm-cancel-btn');
const confirmOkBtn = document.getElementById('confirm-ok-btn');

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

// Collection-only toggle — re-filter on change
collectionOnlyToggle.addEventListener('change', () => {
  if (currentQuery) performSearch(1);
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

// Load collection from server on startup
loadCollection();

// Collection panel toggle
collectionToggle.addEventListener('click', () => {
  collectionPanel.classList.toggle('hidden');
  collectionToggle.classList.toggle('active');
});

// Provider selector
let activeProvider = 'moxfield';

providerBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    providerBtns.forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    const provider = btn.dataset.provider;
    activeProvider = provider;
    Object.entries(providerPanels).forEach(([id, el]) => {
      el.classList.toggle('hidden', id !== provider);
    });
  });
});

// Single Import button — shows confirmation (for replace-style provider imports),
// then parses + sends. Manual text import merges non-destructively, no confirm.
collectionImportBtn.addEventListener('click', () => {
  // Validate input based on active provider
  let hasData = false;
  if (activeProvider === 'moxfield') {
    hasData = moxfieldCsvInput.files.length > 0;
  } else if (activeProvider === 'manabox') {
    hasData = manaboxCsvInput.files.length > 0;
  } else if (activeProvider === 'manual') {
    hasData = manualTextarea.value.trim().length > 0;
  }
  if (!hasData) {
    setCollectionStatus('No data to import — select a file or paste cards', 'error');
    return;
  }
  if (activeProvider === 'manual') {
    doImport();
  } else {
    confirmModal.classList.remove('hidden');
  }
});

confirmCancelBtn.addEventListener('click', () => confirmModal.classList.add('hidden'));
confirmOverlay.addEventListener('click', () => confirmModal.classList.add('hidden'));

confirmOkBtn.addEventListener('click', async () => {
  confirmModal.classList.add('hidden');
  await doImport();
});

async function doImport() {
  let cards;
  if (activeProvider === 'moxfield') {
    const file = moxfieldCsvInput.files[0];
    if (!file) return;
    const text = await file.text();
    cards = parseMoxfieldCsv(text);
    if (cards.length === 0) {
      setCollectionStatus('No cards found in CSV', 'error');
      return;
    }
    await importToServer(cards, 'replace');
  } else if (activeProvider === 'manabox') {
    const file = manaboxCsvInput.files[0];
    if (!file) return;
    const text = await file.text();
    cards = parseManaboxCsv(text);
    if (cards.length === 0) {
      setCollectionStatus('No cards found in CSV', 'error');
      return;
    }
    await importToServer(cards, 'replace');
  } else if (activeProvider === 'manual') {
    const text = manualTextarea.value.trim();
    if (!text) return;
    cards = parseCollectionText(text);
    if (cards.length === 0) {
      setCollectionStatus('No cards found to import', 'error');
      return;
    }
    await importToServer(cards, 'merge');
  }
}

// Clear collection
collectionClearBtn.addEventListener('click', async () => {
  if (collectionCount === 0) return;
  if (!confirm('Clear your entire collection?')) return;
  try {
    const res = await fetch('/api/collection/clear', { method: 'POST' });
    if (!res.ok) throw new Error('clear failed');
    collection = {};
    collectionCount = 0;
    manualTextarea.value = '';
    updateCollectionUI();
    setCollectionStatus('Collection cleared', '');
    refreshOwnedBadges();
    if (!cardModal.classList.contains('hidden') && currentCardId) {
      refreshModalOwned();
    }
  } catch (err) {
    setCollectionStatus('Error clearing collection', 'error');
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

    // Route to local collection search or Scryfall proxy
    const collectionOnly = collectionOnlyToggle && collectionOnlyToggle.checked;
    const endpoint = collectionOnly ? '/api/collection/search' : `/api/cards?${params}`;

    const response = await fetch(endpoint);

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.details || 'No cards found. Try a different search.');
    }

    const data = await response.json();

    totalCards = data.total_cards || 0;
    totalPages = data.total_pages || 1;
    let cards = data.data || [];

    if (cards.length === 0) {
      throw new Error(collectionOnly
        ? 'No cards from your collection match this search. Try a different search or uncheck "Collection only".'
        : 'No cards found. Try a different search.');
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
    const collectionOnly = collectionOnlyToggle && collectionOnlyToggle.checked;
    totalCardsEl.textContent = collectionOnly
      ? `📊 ${totalCards} owned card${totalCards === 1 ? '' : 's'} found`
      : `📊 ${totalCards} cards found`;
    const start = (currentPage - 1) * PAGE_SIZE + 1;
    const end = Math.min(currentPage * PAGE_SIZE, totalCards);
    currentPageInfo.textContent = `Showing ${start}–${end}${collectionOnly ? ' (collection only)' : ''}`;

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

async function loadCollection() {
  try {
    const res = await fetch('/api/collection');
    if (!res.ok) throw new Error('fetch failed');
    const data = await res.json();
    collection = {};
    collectionCount = 0;
    for (const card of data.cards) {
      collection[card.oracle_id] = card.quantity;
      collectionCount += card.quantity;
    }
    updateCollectionUI();
  } catch (e) {
    // Server unreachable — start empty
    collection = {};
    collectionCount = 0;
  }
}

async function importToServer(cards, mode) {
  const CHUNK_SIZE = 100;
  const totalChunks = Math.ceil(cards.length / CHUNK_SIZE);

  // Show progress bar
  const progressBar = document.getElementById('import-progress');
  const progressContainer = document.getElementById('import-progress-container');
  const progressText = document.getElementById('import-progress-text');
  if (progressContainer) progressContainer.classList.remove('hidden');

  setCollectionStatus(`Importing ${cards.length} cards...`, '');
  const jobId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let totalProcessed = 0;
  let allErrors = [];

  try {
    for (let i = 0; i < cards.length; i += CHUNK_SIZE) {
      const chunk = cards.slice(i, i + CHUNK_SIZE);
      const chunkNum = Math.floor(i / CHUNK_SIZE) + 1;
      const percent = Math.round((i / cards.length) * 100);

      if (progressBar) progressBar.style.width = `${percent}%`;
      if (progressText) progressText.textContent = `Processing ${Math.min(i + CHUNK_SIZE, cards.length)} of ${cards.length} cards (chunk ${chunkNum}/${totalChunks})...`;

      const res = await fetch('/api/collection/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode,
          cards: chunk,
          jobId,
          isFirst: i === 0,
          isLast: i + CHUNK_SIZE >= cards.length,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCollectionStatus(data.error || 'Import failed', 'error');
        if (progressContainer) progressContainer.classList.add('hidden');
        return;
      }
      totalProcessed += data.chunkCards || 0;
      if (data.errors) allErrors.push(...data.errors);
    }

    // Complete
    if (progressBar) progressBar.style.width = '100%';
    if (progressText) progressText.textContent = 'Import complete!';

    // Reload collection from server
    await loadCollection();
    let msg = `✅ Imported ${totalProcessed} card${totalProcessed !== 1 ? 's' : ''}`;
    if (allErrors.length > 0) {
      msg += `. ${allErrors.length} card${allErrors.length !== 1 ? 's' : ''} could not be resolved`;
    }
    setCollectionStatus(msg, '');

    // Hide progress after a delay
    if (progressContainer) {
      setTimeout(() => progressContainer.classList.add('hidden'), 3000);
    }
    refreshOwnedBadges();
    if (!cardModal.classList.contains('hidden') && currentCardId) {
      refreshModalOwned();
    }
  } catch (err) {
    setCollectionStatus('Error importing collection', 'error');
    if (progressContainer) progressContainer.classList.add('hidden');
  }
}

// Parse a single CSV row handling quoted fields (commas inside quotes are preserved)
function parseCsvRow(line) {
  const cols = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      cols.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  cols.push(current.trim());
  return cols;
}

function parseMoxfieldCsv(text) {
  const lines = text.split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];

  const header = parseCsvRow(lines[0]).map(h => h.toLowerCase());
  const countIdx = header.indexOf('count');
  const nameIdx = header.indexOf('name');
  if (countIdx === -1 || nameIdx === -1) return [];

  const byName = {};
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvRow(lines[i]);
    const name = cols[nameIdx];
    if (!name) continue;
    const qty = parseInt(cols[countIdx], 10) || 1;
    const key = name.toLowerCase();
    if (byName[key]) {
      byName[key].quantity += qty;
    } else {
      // Don't pass set code — Moxfield's codes don't always match Scryfall's
      byName[key] = { name, quantity: qty };
    }
  }
  return Object.values(byName);
}

function parseManaboxCsv(text) {
  const lines = text.split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];

  const header = parseCsvRow(lines[0]).map(h => h.toLowerCase());
  const qtyIdx = header.indexOf('quantity');
  const nameIdx = header.indexOf('name');
  const scryfallIdx = header.indexOf('scryfall id');
  // Fallback column names
  const qtyIdx2 = header.indexOf('count');
  const nameIdx2 = header.indexOf('card');
  const qtyCol = qtyIdx !== -1 ? qtyIdx : qtyIdx2;
  const nameCol = nameIdx !== -1 ? nameIdx : nameIdx2;
  if (qtyCol === -1 || nameCol === -1) return [];

  const byScryfallId = {};
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvRow(lines[i]);
    const name = cols[nameCol];
    if (!name) continue;
    const qty = parseInt(cols[qtyCol], 10) || 1;
    const scryfallId = scryfallIdx !== -1 ? cols[scryfallIdx] : '';
    // Group by scryfall_id when available, else by name
    const key = scryfallId || name.toLowerCase();
    if (byScryfallId[key]) {
      byScryfallId[key].quantity += qty;
    } else {
      byScryfallId[key] = { name, quantity: qty };
      if (scryfallId) {
        byScryfallId[key].scryfall_id = scryfallId;
      }
    }
  }
  return Object.values(byScryfallId);
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