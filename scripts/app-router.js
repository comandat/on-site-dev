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

const SCAN_WEBHOOK_URL = 'https://automatizare.comandat.ro/webhook/find-product-by-lpn';
let html5QrCode = null;

/**
 * Callback-ul de succes la scanare
 */
async function onScanSuccess(decodedText, decodedResult) {
    // Oprește scanerul
    stopScanner();
    showToast('Cod scanat. Se caută produsul...');

    try {
        // 1. Apelează webhook-ul
        const response = await fetch(`${SCAN_WEBHOOK_URL}?lpn=${decodedText}`, {
            method: 'GET',
        });

        if (!response.ok) throw new Error('Eroare de rețea sau LPN negăsit.');

        const productsData = await response.json();

        // --- START FIX ---
        // Verificăm dacă răspunsul este un array, are elemente, 
        // și primul element are cheia "Product SKU" (cazul LPN valid).
        
        let productInfo = null;
        
        if (Array.isArray(productsData) && productsData.length > 0 && productsData[0]["Product SKU"]) {
            // Cazul fericit: API-ul a returnat un array cu un produs valid pe prima poziție
            productInfo = productsData[0];
        } 
        // Cazul de rezervă: API-ul returnează un singur obiect (nu un array)
        else if (typeof productsData === 'object' && productsData !== null && !Array.isArray(productsData) && productsData["Product SKU"]) {
            productInfo = productsData;
        }

        // Dacă, după ambele verificări, tot nu avem un produs, aruncăm eroare.
        if (!productInfo) {
            console.error("Produsul nu a fost găsit în răspunsul API (LPN invalid?):", productsData);
            throw new Error('Produsul nu a fost găsit în API (LPN invalid?).');
        }

        const productSku = productInfo["Product SKU"];
        // --- END FIX ---


        // 2. Caută produsul în AppState
        // (Datele SUNT aici, încărcate de la login)
        const allCommands = AppState.getCommands();
        let foundProduct = null;
        let foundCommandId = null;

        for (const command of allCommands) {
            // p.id este mapat la p.productsku în data.js
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
            showToast(`Produsul (SKU: ...${productSku.slice(-6)}) nu e în comenzile curente.`, 5000);
            console.error('Produsul (SKU: ' + productSku + ') a fost găsit în API, dar nu există în comenzile încărcate în AppState.');
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
    
    // Configurația pentru scanner
    const config = { 
        fps: 10
        // Am eliminat 'qrbox' pentru a scana full-screen (mai bine pt coduri de bare)
    };

    // Solicităm direct camera din spate (environment)
    html5QrCode.start(
        { facingMode: "environment" }, // Solicită camera din spate
        config,
        onScanSuccess,
        onScanFailure
    ).catch(err => {
        // Dacă 'environment' eșuează (ex: pe un desktop), încercăm camera default
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
