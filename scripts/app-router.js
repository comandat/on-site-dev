// scripts/app-router.js
import { autoConnectToPrinter } from './printer-handler.js';
import { initCommandsPage } from './main.js';
import { initPalletsPage } from './pallets.js';
import { initProductsPage } from './products.js';
import { initProductDetailPage } from './product-detail.js';
import { initAddProductPage } from './add-product.js';
import { initSearchHandler } from './search-handler.js';

let openSearchFunction = () => {};
let pages = {};

/**
 * Funcția centrală de navigare.
 * @param {string} pageId - ID-ul paginii (ex: 'commands', 'pallets')
 * @param {object} context - Date suplimentare de trimis paginii (ex: { search: true })
 */
function navigateTo(pageId, context = {}) {
    // Ascunde toate paginile
    Object.values(pages).forEach(page => page.classList.add('hidden'));

    // Găsește și afișează pagina țintă
    const targetPage = pages[pageId];
    if (targetPage) {
        targetPage.classList.remove('hidden');
        window.scrollTo(0, 0); // Resetează scroll-ul
        
        // Setează hash-ul pentru a permite navigarea back/forward
        window.location.hash = pageId;

        // Rulează funcția de inițializare specifică paginii
        switch (pageId) {
            case 'commands':
                initCommandsPage();
                break;
            case 'pallets':
                initPalletsPage();
                break;
            case 'products':
                initProductsPage();
                break;
            case 'product-detail':
                initProductDetailPage(context, openSearchFunction);
                break;
            case 'add-product':
                initAddProductPage();
                break;
        }
        
        // Actualizează starea activă a footer-ului
        updateFooterActiveState(pageId);

    } else {
        console.warn(`Pagina cu ID-ul '${pageId}' nu a fost găsită.`);
    }
}

/**
 * Actualizează care buton din footer este marcat ca "activ".
 */
function updateFooterActiveState(activePageId) {
    document.querySelectorAll('footer [data-nav]').forEach(button => {
        const page = button.dataset.nav;
        const icon = button.querySelector('.material-symbols-outlined');
        const text = button.querySelector('.text-xs');

        // Reset
        button.classList.remove('text-[var(--primary-color)]');
        button.classList.add('text-gray-500', 'hover:text-[var(--primary-color)]');

        // Set active
        if (page === activePageId || (activePageId.includes('product') && page === 'products')) {
             button.classList.add('text-[var(--primary-color)]');
             button.classList.remove('text-gray-500', 'hover:text-[var(--primary-color)]');
        }
        // Cazul special pentru comenzi/paleți/produse
        if (['commands', 'pallets', 'products', 'product-detail'].includes(activePageId) && page === 'commands') {
             button.classList.add('text-[var(--primary-color)]');
             button.classList.remove('text-gray-500', 'hover:text-[var(--primary-color)]');
        }
    });
}


/**
 * Gestionează încărcarea paginii pe baza hash-ului din URL.
 */
function handleHashChange() {
    const pageId = window.location.hash.substring(1);
    if (pageId && pages[pageId]) {
        navigateTo(pageId);
    } else {
        // Pagină implicită
        navigateTo('commands');
    }
}

// Expune router-ul pentru a fi folosit de alte module
export const router = {
    navigateTo
};

// --- Inițializarea aplicației ---
document.addEventListener('DOMContentLoaded', () => {
    // Colectează toate elementele paginii
    document.querySelectorAll('[data-page]').forEach(page => {
        pages[page.dataset.page] = page;
    });

    // Încearcă reconectarea automată la imprimantă
    autoConnectToPrinter();

    // Inițializează handler-ul de căutare (care returnează funcția openSearch)
    openSearchFunction = initSearchHandler(navigateTo);

    // Adaugă listener global pentru butoanele de navigație [data-nav] (ex: footere)
    document.body.addEventListener('click', (e) => {
        const navButton = e.target.closest('[data-nav]');
        if (navButton) {
            e.preventDefault();
            const targetPage = navButton.dataset.nav;
            navigateTo(targetPage);
        }
    });

    // Gestionează navigarea prin butoanele back/forward ale browser-ului
    window.addEventListener('hashchange', handleHashChange);
    
    // Încarcă pagina inițială
    handleHashChange();
});
