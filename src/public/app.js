// State
let currentPage = 1;
let currentQuery = '';
let totalCards = 0;
let totalPages = 0;
const PAGE_SIZE = 20;

// DOM elements
const searchInput = document.getElementById('search-input');
const searchButton = document.getElementById('search-button');
const cardsGrid = document.getElementById('cards-grid');
const loading = document.getElementById('loading');
const errorMessage = document.getElementById('error-message');
const resultsInfo = document.getElementById('results-info');
const totalCardsEl = document.getElementById('total-cards');
const currentPageInfo = document.getElementById('current-page-info');
const pagination = document.getElementById('pagination');
const prevPage = document.getElementById('prev-page');
const nextPage = document.getElementById('next-page');
const pageIndicator = document.getElementById('page-indicator');

// Modal elements
const cardModal = document.getElementById('card-modal');
const modalOverlay = document.getElementById('modal-overlay');
const modalClose = document.getElementById('modal-close');
const modalBody = document.getElementById('modal-body');

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

// Close modal on Escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
});

// Initial load
performSearch(1);

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
    const params = new URLSearchParams({
      q: query,
      page: String(page),
    });

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

    const imageUrl = card.image_uris?.normal || card.image_uris?.small || null;
    const cardName = card.name || 'Unknown';
    const typeLine = card.type_line || '';
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
  }
}

async function showCardDetail(cardId) {
  try {
    const response = await fetch(`/api/cards/${cardId}`);
    if (!response.ok) throw new Error('Failed to load card details');

    const card = await response.json();
    renderCardDetail(card);
    cardModal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  } catch (err) {
    errorMessage.textContent = err.message;
    errorMessage.classList.remove('hidden');
  }
}

function renderCardDetail(card) {
  const imageUrl = card.image_uris?.normal || card.image_uris?.large || card.image_uris?.small || null;
  const manaCost = card.mana_cost || '';
  const power = card.power;
  const toughness = card.toughness;
  const oracleText = card.oracle_text || '';
  const flavorText = card.flavor_text || '';
  const prices = card.prices || {};
  const collectorNumber = card.collector_number || '';
  const rarity = card.rarity || '';
  const setCode = card.set_name || '';

  let html = '<div class="modal-card-layout">';

  // Image
  if (imageUrl) {
    html += `<img class="modal-card-image" src="${imageUrl}" alt="${escapeHtml(card.name)}">`;
  }

  html += '<div class="modal-card-details">';

  // Name
  html += `<div class="modal-card-name">${escapeHtml(card.name)}</div>`;

  // Mana cost
  if (manaCost) {
    html += `<div class="modal-card-mana">${manaCost}</div>`;
  }

  // Type line
  html += `<div class="modal-card-type">${escapeHtml(card.type_line || '')}</div>`;

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

  // Power / Toughness
  if (power !== undefined && toughness !== undefined) {
    html += `<div class="modal-card-stats">⚔ ${power} / ${toughness}</div>`;
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

  html += '</div></div>';

  modalBody.innerHTML = html;
}

function closeModal() {
  cardModal.classList.add('hidden');
  document.body.style.overflow = '';
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}