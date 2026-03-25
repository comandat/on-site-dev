import { AppState, fetchDataAndSyncState, sendStockUpdate, fetchProductDetailsInBulk } from './data.js';
import { router } from './app-router.js';
import { isPrinterConnected, discoverAndConnect, printLabel, showToast, preCacheProductLabels } from './printer-handler.js';

const TITLE_UPDATE_URL = 'https://automatizare.comandat.ro/webhook/0d61e5a2-2fb8-4219-b80a-a75999dd32fc';

let currentCommandId = null, currentProductId = null, currentProduct = null;
let swiper = null, pressTimer = null, clickHandler = null;
let stockStateAtModalOpen = {}, stockStateInModal = {};
let pageElements = {};

const getLatestProductData = () => 
    AppState.getCommands().find(c => c.id === currentCommandId)?.products.find(p => p.id === currentProductId);

const calculateDelta = (before, after) => 
    Object.keys(before).reduce((acc, key) => {
        const diff = (Number(after[key]) || 0) - (Number(before[key]) || 0);
        return diff !== 0 ? { ...acc, [key]: diff } : acc;
    }, {});

const renderPageContent = () => {
    currentProduct = getLatestProductData();
    if (!currentProduct) return;

    const { expected, suggestedcondition, found, state } = currentProduct;
    pageElements.expectedStock.textContent = expected;
    pageElements.suggestedCondition.textContent = suggestedcondition;
    pageElements.totalFound.textContent = found;

    Object.entries(state).forEach(([condition, val]) => {
        const el = document.querySelector(`[data-summary="${condition}"]`);
        if (el) el.textContent = val;
    });

    const setAsNewBtn = document.getElementById('set-as-new-button');
    if (setAsNewBtn) {
        setAsNewBtn.classList.toggle('hidden', Number(expected) !== 1 || Number(found) !== 0);
    }
};

const renderProductDetails = async (productAsin) => {
    pageElements.title.textContent = 'Se încarcă...';
    pageElements.asin.textContent = '...';

    const details = (await fetchProductDetailsInBulk([productAsin]))[productAsin];
    pageElements.title.textContent = details?.title || 'Nume indisponibil';
    pageElements.asin.textContent = productAsin || 'ASIN indisponibil';

    const images = details?.images || [];
    pageElements.imageWrapper.innerHTML = images.length === 0 
        ? `<div class="swiper-slide bg-gray-200 flex items-center justify-center"><span class="material-symbols-outlined text-gray-400 text-6xl">hide_image</span></div>`
        : images.map(img => `<div class="swiper-slide" style="background-image: url('${img}')"></div>`).join('');

    if (swiper) swiper.destroy(true, true);
    swiper = new Swiper('#image-swiper-container', { pagination: { el: '.swiper-pagination' } });
};

const handleTitleEdit = async () => {
    if (!currentProduct?.asin) return showToast('Eroare: ASIN-ul produsului lipsește.');
    
    const currentTitle = pageElements.title.textContent;
    const newTitle = prompt("Introduceți noul titlu:", currentTitle)?.trim();
    
    if (!newTitle || newTitle === currentTitle) return showToast('Modificare anulată.', 2000);
    
    pageElements.editTitleButton.disabled = true;
    showToast('Se salvează noul titlu...');
    
    try {
        const response = await fetch(TITLE_UPDATE_URL, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ asin: currentProduct.asin, title: newTitle })
        });
        const result = await response.json();
        if (result.status === 'success') {
            sessionStorage.removeItem(`product_${currentProduct.asin}`);
            showToast('Titlu salvat. Se reîncarcă detaliile...');
            await initializePageContent();
        } else throw new Error(result.message || 'Eroare de la server.');
    } catch (error) {
        showToast(`Eroare: ${error.message}`, 4000);
    } finally {
        pageElements.editTitleButton.disabled = false;
    }
};

const handleSaveChanges = () => {
    const saveButton = document.getElementById('save-btn');
    saveButton.disabled = true;
    saveButton.textContent = 'Se salvează...';
    
    const asin = currentProduct?.asin;
    if (!asin?.trim()) {
        alert(`EROARE: ASIN invalid.`);
        saveButton.disabled = false;
        saveButton.textContent = 'Salvează';
        return;
    }

    const delta = calculateDelta(stockStateAtModalOpen, stockStateInModal);
    if (Object.keys(delta).length === 0) return hideModal();

    const conditionMap = { 'new': 'CN', 'very-good': 'FB', 'good': 'B' };
    const printQueue = Object.entries(delta)
        .filter(([cond, qty]) => qty > 0 && conditionMap[cond])
        .map(([cond, quantity]) => ({ code: asin, conditionLabel: conditionMap[cond], quantity }));

    hideModal();

    (async () => {
        if (!printQueue.length) return;
        showToast(`Se inițiază imprimarea pentru ${printQueue.reduce((acc, item) => acc + item.quantity, 0)} etichete...`);
        for (const { code, conditionLabel, quantity } of printQueue) {
            try {
                showToast(`Se printează ${quantity} etichete pentru ${code}`);
                await printLabel(code, conditionLabel, quantity);
                await new Promise(res => setTimeout(res, 3000));
            } catch (e) {
                showToast(`Eroare la imprimare.`);
                return;
            }
        }
        showToast(`S-a finalizat imprimarea.`);
    })();

    (async () => {
        try {
            if (await sendStockUpdate(currentCommandId, currentProduct.id, asin, delta)) {
                await fetchDataAndSyncState();
                renderPageContent();
            } else alert('EROARE la salvarea datelor!');
        } catch (error) {
            alert(`EROARE CRITICĂ: ${error.message}`);
        }
    })();
};

const showPrinterModal = () => {
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
    connectBtn.onclick = async () => {
        connectBtn.disabled = true;
        connectBtn.textContent = 'Se conectează...';
        await discoverAndConnect(msg => {
            document.getElementById('printer-status').textContent = msg;
            if (isPrinterConnected()) {
                hidePrinterModal();
                showModal();
            }
        });
        connectBtn.disabled = false;
        connectBtn.textContent = 'Caută Imprimantă';
    };
    document.getElementById('close-printer-modal-btn').onclick = hidePrinterModal;
};

const hidePrinterModal = () => {
    const modalContent = pageElements.printerModal.querySelector('div');
    if (!modalContent) return;
    modalContent.classList.replace('animate-slide-down', 'animate-slide-up');
    setTimeout(() => {
        pageElements.printerModal.classList.add('hidden');
        pageElements.printerModal.innerHTML = '';
    }, 300);
};

const createCounter = (id, label, value, isDanger = false) => `
    <div class="flex items-center justify-between py-3 border-b">
        <span class="text-lg font-medium ${isDanger ? 'text-red-600' : 'text-gray-800'}">${label}</span>
        <div class="flex items-center gap-3">
            <button data-action="minus" data-target="${id}" class="control-btn rounded-full bg-gray-200 w-8 h-8 flex items-center justify-center text-lg font-bold select-none">-</button>
            <input type="number" id="count-${id}" value="${value}" class="text-xl font-bold w-16 text-center border-gray-300 rounded-md shadow-sm">
            <button data-action="plus" data-target="${id}" class="control-btn rounded-full bg-gray-200 w-8 h-8 flex items-center justify-center text-lg font-bold select-none">+</button>
        </div>
    </div>`;

const updateValue = (target, newValue) => {
    const cleanValue = Math.max(0, parseInt(newValue, 10) || 0);
    stockStateInModal[target] = cleanValue;
    document.getElementById(`count-${target}`).value = cleanValue;
};

const showModal = () => {
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
};

const hideModal = () => {
    const modalContent = pageElements.stockModal.querySelector('div');
    if (!modalContent) return;
    modalContent.classList.replace('animate-slide-down', 'animate-slide-up');
    setTimeout(() => {
        pageElements.stockModal.classList.add('hidden');
        pageElements.stockModal.innerHTML = '';
    }, 300);
};

const addModalEventListeners = () => {
    pageElements.stockModal.querySelectorAll('.control-btn').forEach(btn => {
        const { action, target } = btn.dataset;
        const clickHnd = () => {
            const currentVal = Number(stockStateInModal[target]) || 0;
            updateValue(target, action === 'plus' ? currentVal + 1 : currentVal - 1);
        };
        const startPress = (e) => {
            e.preventDefault();
            btn.removeEventListener('click', clickHnd);
            pressTimer = setTimeout(() => updateValue(target, action === 'minus' ? 0 : currentProduct.expected), 3000);
        };
        const endPress = () => {
            clearTimeout(pressTimer);
            setTimeout(() => btn.addEventListener('click', clickHnd), 50);
        };
        
        btn.addEventListener('mousedown', startPress);
        btn.addEventListener('mouseup', endPress);
        btn.addEventListener('mouseleave', endPress);
        btn.addEventListener('touchstart', startPress, { passive: false });
        btn.addEventListener('touchend', endPress);
        btn.addEventListener('click', clickHnd);
    });

    pageElements.stockModal.querySelectorAll('input[type="number"]').forEach(input => 
        input.addEventListener('input', e => updateValue(e.target.id.replace('count-', ''), e.target.value))
    );
    
    document.getElementById('save-btn').onclick = handleSaveChanges;
    document.getElementById('close-modal-btn').onclick = hideModal;
};

const initializePageContent = async () => {
    currentCommandId = sessionStorage.getItem('currentCommandId');
    currentProductId = sessionStorage.getItem('currentProductId');
    
    if (!currentCommandId || !currentProductId) return router.navigateTo('commands');
    
    await fetchDataAndSyncState();
    currentProduct = getLatestProductData();
    
    if (!currentProduct) {
        alert('Produsul nu a fost gasit');
        return router.navigateTo('products');
    }
    
    renderPageContent();
    await renderProductDetails(currentProduct.asin);
    if (currentProduct.asin) preCacheProductLabels(currentProduct.asin);
};

export const initProductDetailPage = async (context = {}, openSearch) => {
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
        searchTriggerButton: document.getElementById('search-trigger-button')
    };

    document.getElementById('back-to-list-button').onclick = e => {
        e.preventDefault();
        router.navigateTo('products');
    };
    
    pageElements.editTitleButton.onclick = handleTitleEdit;
    if (pageElements.searchTriggerButton && openSearch) pageElements.searchTriggerButton.onclick = openSearch;
    pageElements.openModalButton.onclick = () => isPrinterConnected() ? showModal() : showPrinterModal();

    const setAsNewButton = document.getElementById('set-as-new-button');
    if (setAsNewButton) {
        setAsNewButton.onclick = async () => {
            if (!currentProduct?.asin) return showToast('ASIN indisponibil.', 4000);
            if (!isPrinterConnected()) return showToast('Atenție: Imprimanta nu este conectată!', 5000);

            setAsNewButton.disabled = true;
            setAsNewButton.textContent = 'Se procesează...';

            const asin = currentProduct.asin;
            
            (async () => {
                try {
                    showToast(`Se printează eticheta pentru ${asin}...`);
                    await printLabel(asin, 'CN', 1);
                    showToast('S-a finalizat imprimarea.');
                } catch {
                    showToast('Eroare la imprimare.');
                }
            })();

            (async () => {
                try {
                    if (await sendStockUpdate(currentCommandId, currentProduct.id, asin, { new: 1 })) {
                        await fetchDataAndSyncState();
                        renderPageContent();
                    } else alert('EROARE la salvarea datelor!');
                } catch (err) {
                    alert(`EROARE CRITICĂ: ${err.message}`);
                } finally {
                    setAsNewButton.disabled = false;
                    setAsNewButton.textContent = 'E Ca Nou';
                }
            })();
        };
    }
    
    await initializePageContent();
    if (context.search && openSearch) openSearch();
};
