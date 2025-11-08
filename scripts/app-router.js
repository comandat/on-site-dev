// scripts/app-router.js
import { autoConnectToPrinter } from './printer-handler.js';
import { initCommandsPage } from './main.js';
import { initPalletsPage } from './pallets.js';
import { initProductsPage } from './products.js';
import { initProductDetailPage } from './product-detail.js';
import { initAddProductPage } from './add-product.js';

import { AppState } from './data.js';
import { showToast } from './printer-handler.js';

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
                initProductDetailPage(context);
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
    
    document.querySelectorAll('#footer-scan-trigger').forEach(button => {
        button.classList.remove('text-[var(--primary-color)]');
        button.classList.add('text-gray-500', 'hover:text-[var(--primary-color)]');
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

// --- START MODIFICARE: Logica Scanner-ului ---

const SCAN_WEBHOOK_URL = 'https://automatizare.comandat.ro/webhook-test/find-product-by-lpn';
let html5QrCode = null;

/**
 * Callback-ul de succes la scanare
 */
async function onScanSuccess(decodedText, decodedResult) {
    // Oprește scanerul
    stopScanner();
    showToast('Cod scanat. Se caută produsul...');

    try {
        // 1. Apelează webhook-ul (presupunem că LPN-ul este trimis ca query param)
        const response = await fetch(`${SCAN_WEBHOOK_URL}?lpn=${decodedText}`, {
            method: 'GET',
        });

        if (!response.ok) throw new Error('Eroare de rețea sau LPN negăsit.');

        const productsData = await response.json();
        if (!productsData || productsData.length === 0) {
            throw new Error('Produsul nu a fost găsit (răspuns gol).');
        }

        const productInfo = productsData[0];
        const productSku = productInfo["Product SKU"]; // Cheia de legătură

        if (!productSku) {
            throw new Error('Răspunsul API nu conține "Product SKU".');
        }

        // 2. Caută produsul în AppState
        const allCommands = AppState.getCommands();
        let foundProduct = null;
        let foundCommandId = null;

        for (const command of allCommands) {
            const product = command.products.find(p => p.id === productSku);
            if (product) {
                foundProduct = product;
                foundCommandId = command.id;
                break; // Am găsit comanda și produsul
            }
        }

        // 3. Navighează
        if (foundProduct && foundCommandId) {
            sessionStorage.setItem('currentCommandId', foundCommandId);
            sessionStorage.setItem('currentProductId', foundProduct.id);
            // Asigură-te că setezi și manifestSku pentru coerența navigației
            sessionStorage.setItem('currentManifestSku', foundProduct.manifestsku || 'No ManifestSKU');
            
            showToast('Produs găsit! Se deschide...');
            router.navigateTo('product-detail');
        } else {
            // Cazul: API-ul a găsit produsul, dar el nu există în AppState (comenzile curente)
            throw new Error('Produsul nu există în comenzile încărcate.');
        }

    } catch (error) {
        console.error('Eroare la procesarea LPN:', error);
        showToast(error.message, 5000);
    }
}

function onScanFailure(error) {
    // Nu face nimic, e normal (doar înseamnă că nu a găsit un cod încă)
}

/**
 * Pornește interfața de scanare
 */
function startScanner() {
    const scannerContainer = document.getElementById('scanner-container');
    if (!scannerContainer) return;

    scannerContainer.classList.remove('hidden');
    
    // Inițializează scanner-ul dacă nu este deja
    if (!html5QrCode) {
        html5QrCode = new Html5Qrcode("reader");
    }
    
    // --- START MODIFICARE AICI ---

    // Configurația pentru scanner
    const config = { 
        fps: 10
        // AM ELIMINAT 'qrbox'. Fără el, scanner-ul va folosi tot ecranul,
        // ceea ce este mult mai bun pentru coduri de bare.
    };

    // Solicităm direct camera din spate (environment)
    // Acest mod este superior căutării după "back" în etichetă.
    html5QrCode.start(
        { facingMode: "environment" }, // Solicită camera din spate
        config,
        onScanSuccess,
        onScanFailure
    ).catch(err => {
        // Dacă 'environment' eșuează (ex: pe un desktop sau o eroare), încercăm camera default
        console.warn("Camera 'environment' nu a putut fi pornită, se încearcă camera default:", err);
        html5QrCode.start(
            undefined, // Lasă biblioteca să aleagă camera default
            config,
            onScanSuccess,
            onScanFailure
        ).catch(err2 => {
            console.error("Eroare la pornirea scannerului (și pe default):", err2);
            showToast("Nu s-a putut porni camera.", 3000);
            stopScanner(); // Închide modal-ul dacă pornirea eșuează
        });
    });
    
    // --- FINAL MODIFICARE AICI ---
}

/**
 * Oprește scanner-ul și închide modal-ul
 */
function stopScanner() {
    const scannerContainer = document.getElementById('scanner-container');
    if (scannerContainer) scannerContainer.classList.add('hidden');

    if (html5QrCode && html5QrCode.isScanning) {
        html5QrCode.stop().catch(err => {
            console.error("Eroare la oprirea scannerului:", err);
        });
    }
}

/**
 * Inițializează listener-ii pentru scanner
 */
function initScannerHandler() {
    const closeScannerButton = document.getElementById('close-scanner-button');
    if (closeScannerButton) {
        closeScannerButton.addEventListener('click', stopScanner);
    }

    // Adaugă un listener global pe body care prinde click-urile
    // pe ORICARE buton de scanare (fiindcă sunt mai multe)
    document.body.addEventListener('click', (e) => {
        const scanButton = e.target.closest('#footer-scan-trigger');
        if (scanButton) {
            e.preventDefault();
            startScanner();
        }
    });
}

// --- FINAL MODIFICARE: Logica Scanner-ului ---


// --- Inițializarea aplicației ---
document.addEventListener('DOMContentLoaded', () => {
    // Colectează toate elementele paginii
    document.querySelectorAll('[data-page]').forEach(page => {
        pages[page.dataset.page] = page;
    });

    // Încearcă reconectarea automată la imprimantă
    autoConnectToPrinter();
    
    // Inițializează noul handler pentru scanner
    initScannerHandler();

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
