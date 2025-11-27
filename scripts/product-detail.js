// scripts/product-detail.js
import { AppState, fetchDataAndSyncState, sendStockUpdate, fetchProductDetailsInBulk } from './data.js';
import { router } from './app-router.js';
import { isPrinterConnected, discoverAndConnect, printLabel, showToast, preCacheProductLabels } from './printer-handler.js';

const TITLE_UPDATE_URL = 'https://automatizare.comandat.ro/webhook/0d61e5a2-2fb8-4219-b80a-a75999dd32fc';

// --- START MODIFICARE: Funcție ajutătoare pentru Jurnale ---
/**
 * Scrie un mesaj în consolă cu un marcaj de timp precis (HH:MM:SS.ms)
 * @param {string} message - Mesajul de afișat
 */
function logWithTimestamp(message) {
    const now = new Date();
    const time = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}.${now.getMilliseconds().toString().padStart(3, '0')}`;
    console.log(`[${time}] ${message}`);
}
// --- FINAL MODIFICARE ---

// Variabilele de stare specifice paginii
let currentCommandId = null;
let currentProductId = null;
let currentProduct = null;
let swiper = null;
let stockStateAtModalOpen = {};
let stockStateInModal = {};
let pressTimer = null;
let clickHandler = null;

let pageElements = {};

function getLatestProductData() {
    logWithTimestamp("getLatestProductData: Start");
    const command = AppState.getCommands().find(c => c.id === currentCommandId);
    const product = command ? command.products.find(p => p.id === currentProductId) : null;
    logWithTimestamp("getLatestProductData: End");
    return product;
}

function renderPageContent() {
    logWithTimestamp("renderPageContent: Start");
    currentProduct = getLatestProductData();
    if (!currentProduct) {
        logWithTimestamp("renderPageContent: Produs negăsit. Stop.");
        return;
    }
    pageElements.expectedStock.textContent = currentProduct.expected;
    pageElements.suggestedCondition.textContent = currentProduct.suggestedcondition;
    pageElements.totalFound.textContent = currentProduct.found;
    for (const condition in currentProduct.state) {
        const element = document.querySelector(`[data-summary="${condition}"]`);
        if (element) element.textContent = currentProduct.state[condition];
    }
    logWithTimestamp("renderPageContent: End");
}

async function renderProductDetails(productAsin) {
    logWithTimestamp("renderProductDetails: Start");
    pageElements.title.textContent = 'Se încarcă...';
    pageElements.asin.textContent = '...';
    
    logWithTimestamp("renderProductDetails: Apel fetchProductDetailsInBulk...");
    const details = await fetchProductDetailsInBulk([productAsin]);
    logWithTimestamp("renderProductDetails: Răspuns primit de la fetchProductDetailsInBulk.");
    const productDetails = details[productAsin];

    pageElements.title.textContent = productDetails?.title || 'Nume indisponibil';
    pageElements.asin.textContent = productAsin || 'ASIN indisponibil';
    
    const images = productDetails?.images || [];
    pageElements.imageWrapper.innerHTML = '';

    if (images.length === 0) {
        pageElements.imageWrapper.innerHTML = `<div class="swiper-slide bg-gray-200 flex items-center justify-center"><span class="material-symbols-outlined text-gray-400 text-6xl">hide_image</span></div>`;
    } else {
        images.forEach(imageUrl => {
            const slide = document.createElement('div');
            slide.className = 'swiper-slide';
            slide.style.backgroundImage = `url('${imageUrl}')`;
            pageElements.imageWrapper.appendChild(slide);
        });
    }
    
    if (swiper) {
        swiper.destroy(true, true); // Distrugem instanța veche
    }
    swiper = new Swiper('#image-swiper-container', { 
        pagination: { el: '.swiper-pagination' } 
    });
    logWithTimestamp("renderProductDetails: End (Swiper creat)");
}

async function handleTitleEdit() {
    if (!currentProduct || !currentProduct.asin) {
        showToast('Eroare: ASIN-ul produsului lipsește.');
        return;
    }
    const currentTitle = pageElements.title.textContent;
    const newTitle = prompt("Introduceți noul titlu:", currentTitle);
    if (newTitle === null || newTitle.trim() === '' || newTitle.trim() === currentTitle) {
        showToast('Modificare anulată.', 2000);
        return;
    }
    pageElements.editTitleButton.disabled = true;
    showToast('Se salvează noul titlu...');
    try {
        const response = await fetch(TITLE_UPDATE_URL, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                asin: currentProduct.asin,
                title: newTitle.trim()
            })
        });
        if (!response.ok) throw new Error('Eroare de rețea la salvarea titlului.');
        const result = await response.json();
        if (result.status === 'success') {
            sessionStorage.removeItem(`product_${currentProduct.asin}`);
            showToast('Titlu salvat. Se reîncarcă detaliile...');
            await initializePageContent(); 
        } else {
            throw new Error(result.message || 'Eroare de la server.');
        }
    } catch (error) {
        console.error('Eroare la modificarea titlului:', error);
        showToast(`Eroare: ${error.message}`, 4000);
        pageElements.editTitleButton.disabled = false;
    }
}

async function handleSaveChanges() {
    logWithTimestamp("--- handleSaveChanges: START (Buton Salvează apăsat) ---");
    
    const saveButton = document.getElementById('save-btn');
    saveButton.disabled = true;
    saveButton.textContent = 'Se salvează...';
    
    const productAsinForPrinting = currentProduct.asin;
    
    if (typeof productAsinForPrinting !== 'string' || productAsinForPrinting.trim() === '') {
        const errorMessage = `EROARE: Imprimarea a fost oprită deoarece produsul curent (ID: ${currentProduct.id}) nu are un cod ASIN valid.`;
        alert(errorMessage); 
        saveButton.disabled = false;
        saveButton.textContent = 'Salvează';
        logWithTimestamp(`handleSaveChanges: Eroare, ASIN invalid. Stop.`);
        return;
    }

    const delta = {};
    let hasChanges = false;
    for (const condition in stockStateAtModalOpen) {
        const before = Number(stockStateAtModalOpen[condition]) || 0;
        const after = Number(stockStateInModal[condition]) || 0;
        const difference = after - before;
        if (difference !== 0) {
            delta[condition] = difference;
            hasChanges = true;
        }
    }
    
    logWithTimestamp("handleSaveChanges: Calcul delta finalizat.");

    if (!hasChanges) {
        hideModal();
        logWithTimestamp("handleSaveChanges: Fără modificări. Stop.");
        return;
    }

    logWithTimestamp("handleSaveChanges: Modificări detectate. Se continuă.");

    // --- START MODIFICARE: Rulare optimistă în paralel ---

    // 1. Pregătim coada de printare IMEDIAT
    const conditionMap = { 'new': 'CN', 'very-good': 'FB', 'good': 'B' };
    const printQueue = [];
    for (const condition in delta) {
        if (delta[condition] > 0 && conditionMap[condition]) {
            printQueue.push({
                code: productAsinForPrinting,
                conditionLabel: conditionMap[condition],
                quantity: delta[condition]
            });
        }
    }
    logWithTimestamp("handleSaveChanges: Coada de printare generată.");

    // 2. Închidem modal-ul (răspuns UI instantaneu)
    hideModal();
    logWithTimestamp("handleSaveChanges: Modal închis.");

    // 3. Pornim printarea (Task 1, rulează în fundal, FĂRĂ await)
    logWithTimestamp("handleSaveChanges: Inițiere Task 1 (Printare)...");
    (async () => {
        logWithTimestamp("Task 1 (Printare): Start");
        if (printQueue.length > 0) {
            const totalLabels = printQueue.reduce((sum, item) => sum + item.quantity, 0);
            showToast(`Se inițiază imprimarea pentru ${totalLabels} etichete...`);
            logWithTimestamp(`Task 1 (Printare): Total etichete: ${totalLabels}`);
            
            for (const item of printQueue) {
                try {
                    showToast(`Se printează ${item.quantity} etichete pentru ${item.code}`);
                    logWithTimestamp(`Task 1 (Printare): Apel 'printLabel' pentru ${item.code} (cant: ${item.quantity})...`);
                    
                    await printLabel(item.code, item.conditionLabel, item.quantity);
                    
                    logWithTimestamp(`Task 1 (Printare): Final 'printLabel' pentru ${item.code}.`);
                    await new Promise(resolve => setTimeout(resolve, 3000)); // Delay-ul între etichete
                    logWithTimestamp(`Task 1 (Printare): Pauză 3s terminată.`);
                } catch (e) {
                    showToast(`Eroare la imprimare. Procesul s-a oprit.`);
                    logWithTimestamp(`Task 1 (Printare): EROARE CRITICĂ: ${e.message}`);
                    console.error("Eroare la imprimare:", e);
                    return; 
                }
            }
            showToast(`S-a finalizat imprimarea.`);
            logWithTimestamp("Task 1 (Printare): Finalizat.");
        } else {
            logWithTimestamp("Task 1 (Printare): Coadă goală. Stop.");
        }
    })(); 

    // 4. Pornim salvarea și sincronizarea (Task 2, rulează în fundal)
    logWithTimestamp("handleSaveChanges: Inițiere Task 2 (Salvare & Sincronizare)...");
    (async () => {
        logWithTimestamp("Task 2 (Salvare): Start");
        try {
            logWithTimestamp("Task 2 (Salvare): Apel 'sendStockUpdate'...");
            const success = await sendStockUpdate(currentCommandId, productAsinForPrinting, delta);
            logWithTimestamp(`Task 2 (Salvare): Răspuns 'sendStockUpdate'. Succes: ${success}`);
            
            if (success) {
                logWithTimestamp("Task 2 (Salvare): Apel 'fetchDataAndSyncState'...");
                await fetchDataAndSyncState();
                logWithTimestamp("Task 2 (Salvare): Răspuns 'fetchDataAndSyncState'.");
                
                logWithTimestamp("Task 2 (Salvare): Apel 'renderPageContent'...");
                renderPageContent(); // Actualizăm UI-ul cu noile date
                logWithTimestamp("Task 2 (Salvare): Final 'renderPageContent'.");
            } else {
                alert('EROARE la salvarea datelor! Etichetele s-ar putea să se fi printat, dar datele nu s-au salvat. Vă rugăm verificați stocul.');
                logWithTimestamp("Task 2 (Salvare): EROARE. Salvare eșuată.");
            }
        } catch (error) {
            console.error("Eroare la salvare/sincronizare:", error);
            alert(`EROARE CRITICĂ la salvarea datelor: ${error.message}.`);
            logWithTimestamp(`Task 2 (Salvare): EROARE CRITICĂ: ${error.message}`);
        }
        logWithTimestamp("Task 2 (Salvare): Finalizat.");
    })();

    // --- FINAL MODIFICARE ---
    logWithTimestamp("--- handleSaveChanges: END (Funcția s-a terminat, task-urile rulează în fundal) ---");
}


function showPrinterModal() {
    pageElements.printerModal.classList.remove('hidden');
    pageElements.printerModal.innerHTML = `
        <div class="absolute bottom-0 w-full max-w-md mx-auto left-0 right-0 bg-white rounded-t-2xl shadow-lg p-4 animate-slide-down">
            <div class="text-center mb-4">
                <span class="material-symbols-outlined text-6xl text-blue-600">print</span>
                <h2 id="printer-status" class="text-gray-500 mt-2">Apasă pentru a te conecta</h2>
            </div>
            <div class="mt-6 space-y-3">
                <button id="connect-btn" class="w-full flex items-center justify-center gap-2 rounded-lg bg-blue-600 py-3 text-base font-bold text-white shadow-md hover:bg-blue-700">
                    <span class="material-symbols-outlined">bluetooth_searching</span>
                    Caută Imprimantă
                </button>
                <button id="close-printer-modal-btn" class="w-full mt-2 rounded-lg bg-gray-200 py-3 font-bold text-gray-700">Anulează</button>
            </div>
        </div>`;
    const connectBtn = document.getElementById('connect-btn');
    const closeBtn = document.getElementById('close-printer-modal-btn');
    const printerStatus = document.getElementById('printer-status');
    const statusCallback = (message) => {
        printerStatus.textContent = message;
        if (isPrinterConnected()) {
            hidePrinterModal();
            showModal();
        }
    };
    connectBtn.addEventListener('click', async () => {
        connectBtn.disabled = true;
        connectBtn.textContent = 'Se conectează...';
        await discoverAndConnect(statusCallback);
        connectBtn.disabled = false;
        connectBtn.textContent = 'Caută Imprimantă';
    });
    closeBtn.addEventListener('click', hidePrinterModal);
}

function hidePrinterModal() {
    const modalContent = pageElements.printerModal.querySelector('div');
    if (modalContent) {
        modalContent.classList.replace('animate-slide-down', 'animate-slide-up');
        setTimeout(() => {
            pageElements.printerModal.classList.add('hidden');
            pageElements.printerModal.innerHTML = '';
        }, 300);
    }
}

function showModal() {
    logWithTimestamp("showModal: Start");
    currentProduct = getLatestProductData();
    if (!currentProduct) return;
    stockStateAtModalOpen = { ...currentProduct.state };
    stockStateInModal = { ...currentProduct.state };
    pageElements.stockModal.innerHTML = `
        <div class="absolute bottom-0 w-full max-w-md mx-auto left-0 right-0 bg-white rounded-t-2xl shadow-lg p-4 animate-slide-down">
            <h3 class="text-xl font-bold text-center mb-4">Adaugă / Modifică Stoc</h3>
            ${createCounter('new', 'Ca Nou', stockStateInModal['new'])}
            ${createCounter('very-good', 'Foarte Bun', stockStateInModal['very-good'])}
            ${createCounter('good', 'Bun', stockStateInModal['good'])}
            ${createCounter('broken', 'Defect', stockStateInModal['broken'], true)}
            <div class="flex gap-3 mt-6">
                <button id="close-modal-btn" class="w-1/2 rounded-lg bg-gray-200 py-3 font-bold text-gray-700">Anulează</button>
                <button id="save-btn" class="w-1/2 rounded-lg bg-[var(--primary-color)] py-3 font-bold text-white">Salvează</button>
            </div>
        </div>`;
    addModalEventListeners();
    pageElements.stockModal.classList.remove('hidden');
    logWithTimestamp("showModal: End");
}

function hideModal() {
    logWithTimestamp("hideModal: Start");
    const modalContent = pageElements.stockModal.querySelector('div');
    if (modalContent) {
        modalContent.classList.replace('animate-slide-down', 'animate-slide-up');
        setTimeout(() => {
            pageElements.stockModal.classList.add('hidden');
            pageElements.stockModal.innerHTML = '';
        }, 300);
    }
    logWithTimestamp("hideModal: Animație pornită.");
}

function createCounter(id, label, value, isDanger = false) {
    return `
        <div class="flex items-center justify-between py-3 border-b">
            <span class="text-lg font-medium ${isDanger ? 'text-red-600' : 'text-gray-800'}">${label}</span>
            <div class="flex items-center gap-3">
                <button data-action="minus" data-target="${id}" class="control-btn rounded-full bg-gray-200 w-8 h-8 flex items-center justify-center text-lg font-bold select-none">-</button>
                <input type="number" id="count-${id}" value="${value}" class="text-xl font-bold w-16 text-center border-gray-300 rounded-md shadow-sm">
                <button data-action="plus" data-target="${id}" class="control-btn rounded-full bg-gray-200 w-8 h-8 flex items-center justify-center text-lg font-bold select-none">+</button>
            </div>
        </div>`;
}

function updateValue(target, newValue) {
    const cleanValue = Math.max(0, parseInt(newValue, 10) || 0);
    stockStateInModal[target] = cleanValue;
    document.getElementById(`count-${target}`).value = cleanValue;
}

function addModalEventListeners() {
    pageElements.stockModal.querySelectorAll('.control-btn').forEach(button => {
        const action = button.dataset.action;
        const target = button.dataset.target;
        clickHandler = () => {
            const currentValue = Number(stockStateInModal[target]) || 0;
            if (action === 'plus') updateValue(target, currentValue + 1);
            else updateValue(target, currentValue - 1);
        };
        const startPress = (e) => {
            e.preventDefault();
            button.removeEventListener('click', clickHandler);
            pressTimer = setTimeout(() => {
                if (action === 'minus') updateValue(target, 0);
                else if (action === 'plus') updateValue(target, currentProduct.expected);
            }, 3000);
        };
        const endPress = () => {
            clearTimeout(pressTimer);
            setTimeout(() => button.addEventListener('click', clickHandler), 50);
        };
        button.addEventListener('mousedown', startPress);
        button.addEventListener('mouseup', endPress);
        button.addEventListener('mouseleave', endPress);
        button.addEventListener('touchstart', startPress, { passive: false });
        button.addEventListener('touchend', endPress);
        button.addEventListener('click', clickHandler);
    });
    pageElements.stockModal.querySelectorAll('input[type="number"]').forEach(input => {
        input.addEventListener('input', () => {
            const target = input.id.replace('count-', '');
            updateValue(target, input.value);
        });
    });
    pageElements.stockModal.querySelector('#save-btn').addEventListener('click', handleSaveChanges);
    pageElements.stockModal.querySelector('#close-modal-btn').addEventListener('click', hideModal);
}

/**
 * Logica principală de inițializare a conținutului paginii.
 */
async function initializePageContent() {
    logWithTimestamp("initializePageContent: Start");
    currentCommandId = sessionStorage.getItem('currentCommandId');
    currentProductId = sessionStorage.getItem('currentProductId');
    
    if (!currentCommandId || !currentProductId) {
        router.navigateTo('commands');
        logWithTimestamp("initializePageContent: ID-uri lipsă. Navigare la 'commands'. Stop.");
        return;
    }
    
    logWithTimestamp("initializePageContent: Apel 'fetchDataAndSyncState'...");
    await fetchDataAndSyncState();
    logWithTimestamp("initializePageContent: Răspuns 'fetchDataAndSyncState'.");
    currentProduct = getLatestProductData();
    
    if (!currentProduct) {
        alert('Produsul nu a fost gasit');
        router.navigateTo('products');
        logWithTimestamp("initializePageContent: Produs negăsit. Navigare la 'products'. Stop.");
        return;
    }
    
    logWithTimestamp("initializePageContent: Apel 'renderPageContent'...");
    renderPageContent();
    logWithTimestamp("initializePageContent: Apel 'renderProductDetails'...");
    await renderProductDetails(currentProduct.asin);
    logWithTimestamp("initializePageContent: Răspuns 'renderProductDetails'.");
    
    // --- START MODIFICARE: Pre-caching etichete ---
    if (currentProduct.asin) {
        logWithTimestamp("initializePageContent: Apel 'preCacheProductLabels' (în fundal)...");
        // Pornim pre-generarea în fundal, FĂRĂ await
        // Acest lucru nu va bloca UI-ul
        preCacheProductLabels(currentProduct.asin);
    } else {
        logWithTimestamp("initializePageContent: Produs fără ASIN. Sar peste pre-caching.");
    }
    // --- FINAL MODIFICARE ---
    logWithTimestamp("initializePageContent: End");
}


/**
 * Funcția de inițializare a paginii, apelată de router.
 */
// --- START FIX: Am adăugat la loc parametrul openSearch ---
export async function initProductDetailPage(context = {}, openSearch) {
// --- FINAL FIX ---
    
    logWithTimestamp("initProductDetailPage: Start");
    // Caută elementele DOM o singură dată
    pageElements = {
        title: document.getElementById('product-detail-title'),
        asin: document.getElementById('product-detail-asin'),
        editTitleButton: document.getElementById('edit-title-button'),
        expectedStock: document.getElementById('expected-stock'),
        suggestedCondition: document.getElementById('suggested-condition'),
        totalFound: document.getElementById('total-found'),
        imageWrapper: document.getElementById('product-image-wrapper'),
        stockModal: document.getElementById('stock-modal'),
        printerModal: document.getElementById('printer-modal'),
        openModalButton: document.getElementById('open-stock-modal-button'),
        // --- START FIX: Am adăugat la loc butonul de căutare ---
        searchTriggerButton: document.getElementById('search-trigger-button')
        // --- FINAL FIX ---
    };

    // Setează listener-ii care trebuie setați o singură dată
    
    // Butonul de back
    document.getElementById('back-to-list-button').onclick = (e) => {
        e.preventDefault();
        router.navigateTo('products');
    };
    
    // Butonul de editare titlu
    pageElements.editTitleButton.onclick = handleTitleEdit;

    // --- START FIX: Am adăugat la loc listener-ul pentru Căutare ---
    if (pageElements.searchTriggerButton && openSearch) {
        pageElements.searchTriggerButton.onclick = openSearch;
    }
    // --- FINAL FIX ---
    
    // Fluxul de deschidere modal
    const openModalFlow = () => {
        logWithTimestamp("openModalFlow: Start");
        if (!isPrinterConnected()) { // Folosim funcția importată
            logWithTimestamp("openModalFlow: Imprimanta nu e conectată. Afișare modal imprimantă.");
            showPrinterModal();
        } else {
            logWithTimestamp("openModalFlow: Imprimanta conectată. Afișare modal stoc.");
            showModal();
        }
    };
    pageElements.openModalButton.onclick = openModalFlow;

    // Butonul Trimite ASIN
    const sendAsinButton = document.getElementById('send-asin-button');
    if (sendAsinButton) {
        sendAsinButton.onclick = async () => {
            if (!currentProduct || !currentProduct.asin) {
                showToast('ASIN-ul produsului nu este disponibil.', 4000);
                return;
            }
            sendAsinButton.disabled = true;
            sendAsinButton.textContent = 'Se trimite...';
            try {
                const response = await fetch('https://automatizare.comandat.ro/webhook/0d803fb8-60b5-476c-9608-e198fcc9d2a0', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ asin: currentProduct.asin }),
                });
                const responseData = await response.json();
                if (response.ok && responseData.status === 'success') {
                    showToast('Datele au fost actualizate!');
                    sessionStorage.removeItem(`product_${currentProduct.asin}`);
                    await initializePageContent(); 
                } else {
                    const errorMessage = responseData.message || 'Eroare necunoscută.';
                    showToast(`Eroare: ${errorMessage}`, 5000);
                }
            } catch (error) {
                showToast('Eroare de rețea. Vă rugăm încercați din nou.', 5000);
                console.error('Eroare la trimiterea ASIN-ului:', error);
            } finally {
                sendAsinButton.disabled = false;
                sendAsinButton.textContent = 'Trimite ASIN';
            }
        };
    }
    
    // Rulează logica de afișare a conținutului
    logWithTimestamp("initProductDetailPage: Apel 'initializePageContent'...");
    await initializePageContent();
    logWithTimestamp("initProductDetailPage: Răspuns 'initializePageContent'.");

    // --- START FIX: Am adăugat la loc logica de deschidere a căutării ---
    if (context.search === true && openSearch) {
        logWithTimestamp("initProductDetailPage: Context 'search=true' detectat. Deschidere căutare...");
        openSearch();
    }
    // --- FINAL FIX ---
    logWithZTimestamp("initProductDetailPage: End");
}
