// scripts/products.js
import { AppState, fetchDataAndSyncState, fetchProductDetailsInBulk } from './data.js';
import { router } from './app-router.js'; // Importăm router-ul

// Funcția este acum exportată pentru a fi apelată de router
export async function initProductsPage() {
    const container = document.getElementById('products-list-container');
    const commandId = sessionStorage.getItem('currentCommandId');
    
    // --- START MODIFICARE ---
    // Preluăm manifest-ul selectat
    const manifestSku = sessionStorage.getItem('currentManifestSku');
    
    // Actualizăm butonul "înapoi" și titlul
    const backButton = document.getElementById('back-to-pallets-button');
    const pageTitle = document.getElementById('products-page-title');

    if (pageTitle) {
        pageTitle.textContent = manifestSku ? `Produse - ${manifestSku.substring(0, 15)}...` : 'Produse';
    }
    
    // Modificăm listener-ul butonului de back să folosească router-ul
    if (backButton) {
        // Setăm listener pentru a curăța manifestSku la întoarcere
        // Folosim .onclick pentru a suprascrie listenerii anteriori și a evita dublarea
        backButton.onclick = (e) => {
            e.preventDefault();
            sessionStorage.removeItem('currentManifestSku');
            router.navigateTo('pallets');
        };
    }
    
    if (!manifestSku) {
        console.warn('Niciun manifest SKU selectat. Se afișează toate produsele.');
        // Opțional, ai putea redirecționa înapoi la paleți
        // router.navigateTo('pallets');
        // return;
    }
    // --- FINAL MODIFICARE ---

    // Funcția de randare rămâne în interiorul inițializatorului
    async function renderProductsList() {
        if (!container || !commandId) return;

        container.innerHTML = '<p class="p-4 text-center text-gray-500">Se actualizează...</p>';
        
        await fetchDataAndSyncState();

        const command = AppState.getCommands().find(c => c.id === commandId);
        if (!command || !command.products || command.products.length === 0) {
            container.innerHTML = '<p class="p-4 text-center text-gray-500">Comanda nu are produse.</p>';
            return;
        }

        // --- START MODIFICARE ---
        // Filtrăm produsele pe baza manifestSku-ului selectat
        const filteredProducts = command.products.filter(p => {
            if (manifestSku === 'No ManifestSKU') {
                return !p.manifestsku; // Potrivire pentru cele nule sau goale
            }
            return p.manifestsku === manifestSku;
        });

        if (filteredProducts.length === 0) {
            container.innerHTML = '<p class="p-4 text-center text-gray-500">Acest palet nu are produse.</p>';
            return;
        }

        const asins = filteredProducts.map(p => p.asin);
        // --- FINAL MODIFICARE ---
        
        const allProductDetails = await fetchProductDetailsInBulk(asins);
        
        container.innerHTML = '';

        // --- START MODIFICARE ---
        // Folosim `filteredProducts` în loc de `command.products`
        filteredProducts.forEach(product => {
        // --- FINAL MODIFICARE ---
            const details = allProductDetails[product.asin];
            const productName = details?.title || 'Nume indisponibil';
            const imageUrl = details?.images?.[0] || '';

            const productEl = document.createElement('a');
            productEl.href = `#`; // Nu mai folosim href
            productEl.className = 'flex items-center gap-4 bg-white p-4 transition-colors hover:bg-gray-50';
            
            productEl.innerHTML = `
                <img alt="${productName}" class="h-14 w-14 rounded-md object-cover bg-gray-200" src="${imageUrl}" />
                <div class="flex-1 min-w-0">
                    <p class="font-medium text-gray-900 line-clamp-2">${productName}</p>
                    <p class="text-sm text-gray-500">${product.found} din ${product.expected}</p>
                    <p class="text-xs text-gray-400 font-mono truncate">${product.asin}</p>
                </div>
                <span class="material-symbols-outlined text-gray-400">chevron_right</span>`;

            productEl.addEventListener('click', (event) => {
                event.preventDefault();
                sessionStorage.setItem('currentProductId', product.id);
                // --- START MODIFICARE ---
                // Folosim router-ul
                router.navigateTo('product-detail');
                // --- FINAL MODIFICARE ---
            });
            container.appendChild(productEl);
        });
    }

    await renderProductsList(); // Apelăm funcția de randare
}
