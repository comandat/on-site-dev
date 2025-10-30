// scripts/product-detail.js
import { AppState, fetchDataAndSyncState, sendStockUpdate, fetchProductDetailsInBulk } from './data.js';

// --- START MODIFICARE ---
const TITLE_UPDATE_URL = 'https://automatizare.comandat.ro/webhook/0d61e5a2-2fb8-4219-b80a-a75999dd32fc';
// --- FINAL MODIFICARE ---

document.addEventListener('DOMContentLoaded', () => {
    let niimbotCharacteristic = null;
    let isConnecting = false;
    let printerDevice = null;
    let currentCommandId = null;
    let currentProductId = null;
    let currentProduct = null;
    let swiper = null;
    let stockStateAtModalOpen = {};
    let stockStateInModal = {};
    let pressTimer = null;
    let clickHandler = null;

    const pageElements = {
        title: document.getElementById('product-detail-title'),
        // --- START MODIFICARE ---
        asin: document.getElementById('product-detail-asin'),
        editTitleButton: document.getElementById('edit-title-button'),
        // --- FINAL MODIFICARE ---
        expectedStock: document.getElementById('expected-stock'),
        suggestedCondition: document.getElementById('suggested-condition'),
        totalFound: document.getElementById('total-found'),
        imageWrapper: document.getElementById('product-image-wrapper'),
        stockModal: document.getElementById('stock-modal'),
        printerModal: document.getElementById('printer-modal'),
        openModalButton: document.getElementById('open-stock-modal-button'),
        footerPrinterButton: document.getElementById('footer-printer-button')
    };

    function showToast(message, duration = 3000) {
        const toast = document.createElement('div');
        toast.textContent = message;
        toast.className = 'fixed bottom-5 left-1/2 -translate-x-1/2 bg-gray-800 text-white px-4 py-2 rounded-lg shadow-lg z-50';
        document.body.appendChild(toast);
        setTimeout(() => {
            toast.remove();
        }, duration);
    }
    
    function isPrinterConnected() {
        return niimbotCharacteristic !== null && printerDevice && printerDevice.gatt.connected;
    }

    function createNiimbotPacket(type, data = []) {
        const dataBytes = Array.isArray(data) ? data : [data];
        const checksum = (dataBytes.reduce((acc, byte) => acc ^ byte, type ^ dataBytes.length)) & 0xFF;
        const packet = [0x55, 0x55, type, dataBytes.length, ...dataBytes, checksum, 0xAA, 0xAA];
        return new Uint8Array(packet);
    }

    async function connectToDevice(device, statusCallback) {
        if (isConnecting) return false;
        isConnecting = true;

        try {
            if (statusCallback) statusCallback(`Conectare la ${device.name}...`);
            const server = await device.gatt.connect();
            
            const services = await server.getPrimaryServices();
            let foundCharacteristic = null;
            for (const service of services) {
                const characteristics = await service.getCharacteristics();
                for (const char of characteristics) {
                    if (char.properties.writeWithoutResponse && char.properties.notify) {
                        foundCharacteristic = char;
                        break; 
                    }
                }
                if (foundCharacteristic) break;
            }

            if (!foundCharacteristic) throw new Error('Caracteristica necesară nu a fost găsită.');
            
            niimbotCharacteristic = foundCharacteristic;
            await niimbotCharacteristic.startNotifications();
            
            printerDevice = device;

            device.addEventListener('gattserverdisconnected', () => {
                showToast('Imprimanta a fost deconectată.');
                niimbotCharacteristic = null;
                printerDevice = null;
            });

            if (statusCallback) statusCallback(`Conectat la ${device.name}.`);
            isConnecting = false;
            return true;

        } catch (error) {
            if (statusCallback) statusCallback(`Eroare la conectare: ${error.message}`);
            isConnecting = false;
            return false;
        }
    }

    async function discoverAndConnect(statusCallback) {
        try {
            if (statusCallback) statusCallback('Se caută imprimante...');
            const device = await navigator.bluetooth.requestDevice({
                filters: [{ namePrefix: 'D' }],
                optionalServices: ['e7810a71-73ae-499d-8c15-faa9aef0c3f2', '49535343-fe7d-4ae5-8fa9-9fafd205e455']
            });
            return await connectToDevice(device, statusCallback);
        } catch(error) {
            if (statusCallback) statusCallback(`Eroare: ${error.message}`);
            return false;
        }
    }

    async function printLabel(productCode, conditionLabel, quantity = 1) {
        if (!isPrinterConnected()) throw new Error("Imprimanta nu este conectată.");

        const textToPrint = `${productCode}${conditionLabel}`;
        
        const writeAndDelay = async (packet, ms = 40) => {
            await niimbotCharacteristic.writeValueWithoutResponse(packet);
            await new Promise(res => setTimeout(res, ms));
        };

        try {
            const labelWidth = 240;
            const labelHeight = 120;
            const canvas = document.createElement('canvas');
            canvas.width = labelHeight;
            canvas.height = labelWidth;
            const ctx = canvas.getContext('2d');
            
            ctx.fillStyle = 'black';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.save();
            ctx.translate(canvas.width / 2, canvas.height / 2);
            ctx.rotate(90 * Math.PI / 180);
            const verticalOffset = 10;
            
            const qr = qrcode(0, 'M');
            qr.addData(textToPrint);
            qr.make();
            const qrImg = new Image();
            qrImg.src = qr.createDataURL(6, 2);
            await new Promise(resolve => { qrImg.onload = resolve; });
            
            const qrSize = 85; 
            ctx.drawImage(qrImg, -labelWidth / 2 + 15, -labelHeight / 2 + 18 + verticalOffset, qrSize, qrSize);
            ctx.fillStyle = 'white';
            ctx.font = 'bold 24px Arial';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            const line1 = textToPrint.substring(0, 6);
            const line2 = textToPrint.substring(6);
            ctx.fillText(line1, -labelWidth / 2 + qrSize + 30, -15 + verticalOffset);
            ctx.fillText(line2, -labelWidth / 2 + qrSize + 30, 15 + verticalOffset);
            ctx.restore();
            
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const imagePackets = [];
            const widthInBytes = Math.ceil(canvas.width / 8);
            for (let y = 0; y < canvas.height; y++) {
                let lineBytes = new Uint8Array(widthInBytes);
                for (let x = 0; x < canvas.width; x++) {
                    const pixelIndex = (y * canvas.width + x) * 4;
                    const pixelValue = imageData.data[pixelIndex] > 128 ? 1 : 0;
                    if (pixelValue === 1) {
                        lineBytes[Math.floor(x / 8)] |= (1 << (7 - (x % 8)));
                    }
                }
                const header = [(y >> 8) & 0xFF, y & 0xFF, 0, 0, 0, 1];
                const dataPayload = Array.from(new Uint8Array([...header, ...lineBytes]));
                imagePackets.push(createNiimbotPacket(0x85, dataPayload));
            }

            await writeAndDelay(createNiimbotPacket(0x21, [3]));
            await writeAndDelay(createNiimbotPacket(0x23, [1]));
            await writeAndDelay(createNiimbotPacket(0x01, [1]));
            await writeAndDelay(createNiimbotPacket(0x03, [1]));
            
            const dimensionData = [(canvas.height >> 8) & 0xFF, canvas.height & 0xFF, (canvas.width >> 8) & 0xFF, canvas.width & 0xFF];
            await writeAndDelay(createNiimbotPacket(0x13, dimensionData));
            await writeAndDelay(createNiimbotPacket(0x15, [0, quantity]));
            
            for (const packet of imagePackets) {
                await writeAndDelay(packet, 20); 
            }

            await writeAndDelay(createNiimbotPacket(0xE3, [1]));
            await writeAndDelay(createNiimbotPacket(0xF3, [1]));

        } catch (error) {
            console.error(`Eroare critică la printarea etichetei: ${textToPrint}`, error);
            throw error;
        }
    }

    function getLatestProductData() {
        const command = AppState.getCommands().find(c => c.id === currentCommandId);
        return command ? command.products.find(p => p.id === currentProductId) : null;
    }

    function renderPageContent() {
        currentProduct = getLatestProductData();
        if (!currentProduct) return;
        pageElements.expectedStock.textContent = currentProduct.expected;
        pageElements.suggestedCondition.textContent = currentProduct.suggestedcondition;
        pageElements.totalFound.textContent = currentProduct.found;
        for (const condition in currentProduct.state) {
            const element = document.querySelector(`[data-summary="${condition}"]`);
            if (element) element.textContent = currentProduct.state[condition];
        }
    }
    
    async function renderProductDetails(productAsin) {
        pageElements.title.textContent = 'Se încarcă...';
        // --- START MODIFICARE ---
        pageElements.asin.textContent = '...';
        // --- FINAL MODIFICARE ---
        
        const details = await fetchProductDetailsInBulk([productAsin]);
        const productDetails = details[productAsin];

        // --- START MODIFICARE ---
        pageElements.title.textContent = productDetails?.title || 'Nume indisponibil';
        pageElements.asin.textContent = productAsin || 'ASIN indisponibil';
        // --- FINAL MODIFICARE ---
        
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
            swiper.update();
        } else {
            swiper = new Swiper('#image-swiper-container', { pagination: { el: '.swiper-pagination' } });
        }
    }

    // --- START MODIFICARE ---
    // Funcție nouă pentru gestionarea modificării titlului
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
                // Șterge cache-ul pentru acest produs
                sessionStorage.removeItem(`product_${currentProduct.asin}`);
                // Reîncarcă pagina pentru a afișa noul titlu
                window.location.reload();
            } else {
                throw new Error(result.message || 'Eroare de la server.');
            }

        } catch (error) {
            console.error('Eroare la modificarea titlului:', error);
            showToast(`Eroare: ${error.message}`, 4000);
            pageElements.editTitleButton.disabled = false;
        }
    }
    // --- FINAL MODIFICARE ---

    async function handleSaveChanges() {
        const saveButton = document.getElementById('save-btn');
        saveButton.disabled = true;
        saveButton.textContent = 'Se salvează...';

        const productAsinForPrinting = currentProduct.asin;
        
        if (typeof productAsinForPrinting !== 'string' || productAsinForPrinting.trim() === '') {
            const errorMessage = `EROARE: Imprimarea a fost oprită deoarece produsul curent (ID: ${currentProduct.id}) nu are un cod ASIN valid.`;
            alert(errorMessage); 
            saveButton.disabled = false;
            saveButton.textContent = 'Salvează';
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

        if (!hasChanges) {
            hideModal();
            return;
        }

        const success = await sendStockUpdate(currentCommandId, productAsinForPrinting, delta);
        
        if (success) {
            await fetchDataAndSyncState();
            renderPageContent();

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
            
            hideModal();

            if (printQueue.length > 0) {
                const totalLabels = printQueue.reduce((sum, item) => sum + item.quantity, 0);
                showToast(`Se inițiază imprimarea pentru ${totalLabels} etichete...`);
                
                for (const item of printQueue) {
                    try {
                        showToast(`Se printează ${item.quantity} etichete pentru ${item.code}`);
                        await printLabel(item.code, item.conditionLabel, item.quantity);
                        await new Promise(resolve => setTimeout(resolve, 3000)); 
                    } catch (e) {
                        showToast(`Eroare la imprimare. Procesul s-a oprit.`);
                        console.error("Eroare la imprimare:", e);
                        return;
                    }
                }
                showToast(`S-a finalizat imprimarea.`);
            }

        } else {
            alert('Eroare la salvare! Vă rugăm încercați din nou.');
            saveButton.disabled = false;
            saveButton.textContent = 'Salvează';
        }
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
    }

    function hideModal() {
        const modalContent = pageElements.stockModal.querySelector('div');
        if (modalContent) {
            modalContent.classList.replace('animate-slide-down', 'animate-slide-up');
            setTimeout(() => {
                pageElements.stockModal.classList.add('hidden');
                pageElements.stockModal.innerHTML = '';
            }, 300);
        }
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

    async function initializePage() {
        currentCommandId = sessionStorage.getItem('currentCommandId');
        currentProductId = sessionStorage.getItem('currentProductId');
        if (!currentCommandId || !currentProductId) {
            window.location.href = 'main.html';
            return;
        }
        await fetchDataAndSyncState();
        currentProduct = getLatestProductData();
        if (!currentProduct) {
            alert('Produsul nu a fost gasit');
            window.location.href = 'products.html';
            return;
        }
        renderPageContent();
        await renderProductDetails(currentProduct.asin);
        
        // --- START MODIFICARE ---
        // Atașează listener-ul pentru butonul de editare titlu
        pageElements.editTitleButton.addEventListener('click', handleTitleEdit);
        // --- FINAL MODIFICARE ---
        
        const openModalFlow = () => {
            if (!isPrinterConnected()) {
                showPrinterModal();
            } else {
                showModal();
            }
        };

        pageElements.openModalButton.addEventListener('click', openModalFlow);
        pageElements.footerPrinterButton.addEventListener('click', openModalFlow);

        const sendAsinButton = document.getElementById('send-asin-button');
        if (sendAsinButton) {
            sendAsinButton.addEventListener('click', async () => {
                if (!currentProduct || !currentProduct.asin) {
                    showToast('ASIN-ul produsului nu este disponibil.', 4000);
                    return;
                }

                sendAsinButton.disabled = true;
                sendAsinButton.textContent = 'Se trimite...';

                try {
                    const response = await fetch('https://automatizare.comandat.ro/webhook/0d803fb8-60b5-476c-9608-e198fcc9d2a0', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({ asin: currentProduct.asin }),
                    });

                    const responseData = await response.json();

                    if (response.ok && responseData.status === 'success') {
                        showToast('Datele au fost actualizate!');
                        
                        // Ștergem detaliile vechi din cache
                        sessionStorage.removeItem(`product_${currentProduct.asin}`);
                        
                        // Reîmprospătăm datele (stoc, etc.)
                        await fetchDataAndSyncState(); 
                        renderPageContent();
                        
                        // Reîmprospătăm detaliile vizuale (titlu, imagini)
                        await renderProductDetails(currentProduct.asin);
                        
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
            });
        }
    }
    
    async function autoConnectToPrinter() {
        if (navigator.bluetooth && typeof navigator.bluetooth.getDevices === 'function') {
            try {
                const devices = await navigator.bluetooth.getDevices();
                if (devices.length > 0) {
                    const device = devices[0];
                    showToast(`Se reconectează la ${device.name}...`);
                    const success = await connectToDevice(device, (message) => console.log(message));
                    if (success) {
                        showToast("Imprimanta a fost reconectată automat.");
                    } else {
                        showToast("Reconectarea automată a eșuat.", 4000);
                    }
                }
            } catch(error) {
                console.error("Eroare la reconectarea automată:", error);
            }
        }
    }

    autoConnectToPrinter();
    initializePage();
});
