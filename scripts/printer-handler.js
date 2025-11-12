// scripts/printer-handler.js

// Acest modul gestionează starea conexiunii Bluetooth
// Variabilele de stare sunt definite aici și persistă atâta timp cât pagina app.html este deschisă

let niimbotCharacteristic = null;
let isConnecting = false;
let printerDevice = null;

// --- START MODIFICARE ---
// Adăugăm un cache pentru pachetele de date pre-generate
let printPacketCache = {
    asin: null,
    packets: {} // Aici vom stoca 'new', 'very-good', 'good'
};
// --- FINAL MODIFICARE ---


/**
 * Afișează un mesaj scurt (toast) în partea de jos a ecranului.
 */
export function showToast(message, duration = 3000) {
    const toast = document.createElement('div');
    toast.textContent = message;
    toast.className = 'fixed bottom-20 left-1/2 -translate-x-1/2 bg-gray-800 text-white px-4 py-2 rounded-lg shadow-lg z-50 animate-slide-down';
    toast.style.animationDuration = '0.3s';
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.classList.replace('animate-slide-down', 'animate-slide-up');
        toast.style.animationDirection = 'reverse';
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

/**
 * Verifică dacă imprimanta este conectată.
 */
export function isPrinterConnected() {
    return niimbotCharacteristic !== null && printerDevice && printerDevice.gatt.connected;
}

/**
 * Creează pachetul de date specific Niimbot.
 */
export function createNiimbotPacket(type, data = []) {
    const dataBytes = Array.isArray(data) ? data : [data];
    const checksum = (dataBytes.reduce((acc, byte) => acc ^ byte, type ^ dataBytes.length)) & 0xFF;
    const packet = [0x55, 0x55, type, dataBytes.length, ...dataBytes, checksum, 0xAA, 0xAA];
    return new Uint8Array(packet);
}

/**
 * Se conectează la un dispozitiv Bluetooth (imprimantă).
 */
export async function connectToDevice(device, statusCallback) {
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

/**
 * Caută și se conectează la o nouă imprimantă.
 */
export async function discoverAndConnect(statusCallback) {
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

// --- START MODIFICARE: Extragem logica "grea" într-o funcție separată ---

/**
 * Partea "grea": Generează pachetele de date pentru o etichetă.
 * Aceasta este funcția care consumă timp (creare QR, canvas, bitmap).
 */
async function generateLabelPackets(productCode, conditionLabel) {
    const textToPrint = `${productCode}${conditionLabel}`;
    
    // Dimensiunile fizice
    const labelWidth = 240;
    const labelHeight = 120;
    
    // Creare canvas invizibil
    const canvas = document.createElement('canvas');
    canvas.width = labelHeight; // Inversat pentru rotație
    canvas.height = labelWidth; // Inversat pentru rotație
    const ctx = canvas.getContext('2d');
    
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate(90 * Math.PI / 180); // Rotim contextul
    const verticalOffset = 10;
    
    // Generare QR
    const qr = qrcode(0, 'M');
    qr.addData(textToPrint);
    qr.make();
    const qrImg = new Image();
    qrImg.src = qr.createDataURL(6, 2);
    
    // Așteptăm ca imaginea QR să se încarce (acesta este un pas async)
    await new Promise(resolve => { qrImg.onload = resolve; });
    
    // Desenare QR pe canvas
    const qrSize = 85; 
    ctx.drawImage(qrImg, -labelWidth / 2 + 15, -labelHeight / 2 + 18 + verticalOffset, qrSize, qrSize);
    
    // Desenare Text pe canvas
    ctx.fillStyle = 'white';
    ctx.font = 'bold 24px Arial';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const line1 = textToPrint.substring(0, 6);
    const line2 = textToPrint.substring(6);
    ctx.fillText(line1, -labelWidth / 2 + qrSize + 30, -15 + verticalOffset);
    ctx.fillText(line2, -labelWidth / 2 + qrSize + 30, 15 + verticalOffset);
    ctx.restore();
    
    // Conversia imaginii din canvas în pachete de date (bitmap)
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const imagePackets = [];
    const widthInBytes = Math.ceil(canvas.width / 8);
    
    // Aceasta este bucla "grea" de conversie
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
    
    return imagePackets; // Returnăm pachetele de date gata generate
}
// --- FINAL MODIFICARE ---


/**
 * Printează o etichetă.
 * (Modificată pentru a folosi cache-ul)
 */
export async function printLabel(productCode, conditionLabel, quantity = 1) {
    if (!isPrinterConnected()) throw new Error("Imprimanta nu este conectată.");

    // --- START MODIFICARE: Folosim cache-ul ---
    
    // Mapăm conditionLabel (CN, FB, B) la cheia din cache (new, very-good, good)
    const conditionKeyMap = { 'CN': 'new', 'FB': 'very-good', 'B': 'good' };
    const cacheKey = conditionKeyMap[conditionLabel];
    
    if (!cacheKey) {
        throw new Error(`Condiție necunoscută pentru printare: ${conditionLabel}`);
    }

    const writeAndDelay = async (packet, ms = 40) => {
        await niimbotCharacteristic.writeValueWithoutResponse(packet);
        await new Promise(res => setTimeout(res, ms));
    };

    try {
        let imagePackets;
        
        // 1. Verificăm cache-ul
        if (printPacketCache.asin === productCode && printPacketCache.packets[cacheKey]) {
            // Folosim pachetele din cache. Acest pas e instantaneu.
            imagePackets = printPacketCache.packets[cacheKey];
        } else {
            // Cache-ul e invalid sau gol (pre-caching-ul a eșuat sau nu s-a terminat)
            // Generăm pachetele "acum" (varianta lentă)
            showToast(`Generez datele pt ${productCode}...`);
            imagePackets = await generateLabelPackets(productCode, conditionLabel);
            // Stocăm în cache pentru viitor
            printPacketCache.asin = productCode;
            printPacketCache.packets[cacheKey] = imagePackets;
        }

        // 2. Trimitere comenzi (partea "ușoară" și rapidă)
        const canvasWidth = 120; // Trebuie să știm asta
        const canvasHeight = 240; // Și asta
        
        await writeAndDelay(createNiimbotPacket(0x21, [3]));
        await writeAndDelay(createNiimbotPacket(0x23, [1]));
        await writeAndDelay(createNiimbotPacket(0x01, [1]));
        await writeAndDelay(createNiimbotPacket(0x03, [1]));
        
        const dimensionData = [(canvasHeight >> 8) & 0xFF, canvasHeight & 0xFF, (canvasWidth >> 8) & 0xFF, canvasWidth & 0xFF];
        await writeAndDelay(createNiimbotPacket(0x13, dimensionData));
        await writeAndDelay(createNiimbotPacket(0x15, [0, quantity]));
        
        // Trimiterea efectivă a pachetelor de imagine
        for (const packet of imagePackets) {
            await writeAndDelay(packet, 20); 
        }

        await writeAndDelay(createNiimbotPacket(0xE3, [1]));
        await writeAndDelay(createNiimbotPacket(0xF3, [1]));
        
    // --- FINAL MODIFICARE ---

    } catch (error) {
        console.error(`Eroare critică la printarea etichetei: ${productCode}${conditionLabel}`, error);
        throw error;
    }
}

// --- START MODIFICARE: Adăugăm funcția de pre-caching ---
/**
 * Funcție publică pentru a pre-genera etichete în fundal.
 * Va fi apelată de pe pagina produsului.
 * @param {string} asin - ASIN-ul produsului curent
 */
export async function preCacheProductLabels(asin) {
    // Dacă ASIN-ul e deja în cache, nu facem nimic
    if (printPacketCache.asin === asin && printPacketCache.packets['new']) {
        console.log("Etichetele sunt deja în cache pentru", asin);
        return;
    }
    
    // Resetăm cache-ul
    printPacketCache = { asin: asin, packets: {} };
    console.log(`Încep pre-caching pentru ASIN: ${asin}...`);

    // Definim mapările
    const conditionMap = {
        'new': 'CN',
        'very-good': 'FB',
        'good': 'B'
    };

    try {
        // Generăm în serie pentru a nu stresa browser-ul
        for (const key in conditionMap) {
            const conditionLabel = conditionMap[key];
            // Rulăm generarea
            const packets = await generateLabelPackets(asin, conditionLabel);
            // Salvăm în cache
            printPacketCache.packets[key] = packets;
            // Așteptăm un pic pentru a lăsa UI-ul să respire
            await new Promise(res => setTimeout(res, 50));
        }
        console.log(`Pre-caching finalizat pentru ASIN: ${asin}`);
    } catch (error) {
        console.error(`Eroare la pre-caching-ul etichetelor: ${error}`);
        // Resetăm cache-ul în caz de eroare
        printPacketCache = { asin: null, packets: {} };
    }
}
// --- FINAL MODIFICARE ---


/**
 * Încearcă să se reconecteze automat la ultima imprimantă cunoscută.
 */
export async function autoConnectToPrinter() {
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
