// scripts/search-handler.js
import { AppState, fetchProductDetailsInBulk } from './data.js';

document.addEventListener('DOMContentLoaded', () => {
    // --- START: Search functionality for product-detail.html ---
    const searchTriggerButton = document.getElementById('search-trigger-button');
    const searchOverlay = document.getElementById('search-overlay');
    const productDetailPage = document.getElementById('product-detail-page');

    if (searchTriggerButton && searchOverlay && productDetailPage) {
        const closeSearch = () => {
            searchOverlay.classList.add('hidden');
            searchOverlay.innerHTML = '';
            productDetailPage.style.filter = 'none';
        };

        const selectProduct = (commandId, productId) => {
            sessionStorage.setItem('currentCommandId', commandId);
            sessionStorage.setItem('currentProductId', productId);
            window.location.reload();
        };

        const openSearch = async () => {
            productDetailPage.style.filter = 'blur(5px)';
            searchOverlay.classList.remove('hidden');
            searchOverlay.innerHTML = `
                <div class="absolute inset-0 bg-gray-900 bg-opacity-50" id="search-bg"></div>
                <div class="relative w-full max-w-md p-4 mx-auto mt-16 bg-white rounded-xl shadow-lg animate-slide-down" style="animation-duration: 0.3s;">
                    <div class="flex items-center">
                        <span class="material-symbols-outlined text-gray-400 absolute left-7">search</span>
                        <input type="text" id="search-input" placeholder="Caută după nume sau ASIN..." class="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
                        <button id="close-search-btn" class="ml-2 p-2 text-gray-500 hover:text-gray-800">
                            <span class="material-symbols-outlined">close</span>
                        </button>
                    </div>
                    <div id="search-results-container" class="mt-4 max-h-96 overflow-y-auto">
                        <p class="text-gray-500 text-center">Introduceți cel puțin 2 caractere.</p>
                    </div>
                </div>
            `;

            const searchInput = document.getElementById('search-input');
            const resultsContainer = document.getElementById('search-results-container');
            const closeButton = document.getElementById('close-search-btn');
            const searchBg = document.getElementById('search-bg');

            closeButton.addEventListener('click', closeSearch);
            searchBg.addEventListener('click', closeSearch);
            searchInput.focus();

            const allCommands = AppState.getCommands();
            if (!allCommands || allCommands.length === 0) {
                resultsContainer.innerHTML = '<p class="text-gray-500 text-center">Nu există comenzi pentru a căuta produse.</p>';
                return;
            }

            let allProducts = [];
            allCommands.forEach(command => {
                command.products.forEach(product => {
                    allProducts.push({ ...product, commandId: command.id, commandName: command.name });
                });
            });

            const asins = allProducts.map(p => p.asin);
            const productDetails = await fetchProductDetailsInBulk(asins);

            allProducts = allProducts.map(p => ({
                ...p,
                details: productDetails[p.asin] || { title: 'Nume indisponibil', images: [] }
            }));

            searchInput.addEventListener('input', () => {
                const query = searchInput.value.toLowerCase().trim();
                if (query.length < 2) {
                    resultsContainer.innerHTML = '<p class="text-gray-500 text-center">Introduceți cel puțin 2 caractere.</p>';
                    return;
                }

                const filteredProducts = allProducts.filter(p =>
                    p.details.title.toLowerCase().includes(query) ||
                    p.asin.toLowerCase().includes(query)
                );

                if (filteredProducts.length === 0) {
                    resultsContainer.innerHTML = '<p class="text-gray-500 text-center">Niciun produs găsit.</p>';
                    return;
                }

                // --- START MODIFICARE ---
                resultsContainer.innerHTML = filteredProducts.map(product => `
                    <div class="flex items-center gap-4 p-2 transition-colors rounded-lg cursor-pointer hover:bg-gray-100 search-result-item" data-command-id="${product.commandId}" data-product-id="${product.id}">
                        <img alt="${product.details.title}" class="h-12 w-12 rounded-md object-cover bg-gray-200" src="${product.details.images[0] || ''}" />
                        <div class="flex-1 min-w-0">
                            <p class="font-medium text-gray-900 line-clamp-2">${product.details.title}</p>
                            <p class="text-sm text-gray-500">Comanda: ${product.commandName.replace('Comanda #', '#')}</p>
                            <p class="text-xs text-gray-400 font-mono truncate">${product.asin}</p>
                        </div>
                    </div>
                `).join('');
                // --- FINAL MODIFICARE ---

                document.querySelectorAll('.search-result-item').forEach(item => {
                    item.addEventListener('click', () => {
                        const cmdId = item.dataset.commandId;
                        const prodId = item.dataset.productId;
                        selectProduct(cmdId, prodId);
                    });
                });
            });
        };

        searchTriggerButton.addEventListener('click', openSearch);

        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('search') === 'true') {
            openSearch();
            // Clean up the URL
            const newUrl = window.location.pathname;
            window.history.replaceState({}, document.title, newUrl);
        }
    }
    // --- END: Search functionality for product-detail.html ---


    // --- START: Redirection logic from other pages ---
    const footerSearchButton = document.getElementById('footer-search-trigger');
    // If we are on a page that is NOT product-detail, and we have a footer search button, set it to redirect.
    if (footerSearchButton && !searchOverlay) {
        footerSearchButton.addEventListener('click', (event) => {
            event.preventDefault();
            // Redirect to product-detail.html and trigger the search overlay.
            window.location.href = 'product-detail.html?search=true';
        });
    }
    // --- END: Redirection logic ---
});
