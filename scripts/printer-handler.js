// scripts/printer-handler.js

// Acest modul gestionează starea conexiunii Bluetooth
// Variabilele de stare sunt definite aici și persistă atâta timp cât pagina app.html este deschisă

let niimbotCharacteristic = null;
let isConnecting = false;
let printerDevice = null;

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

/**
 * Printează o etichetă.
 */
export async function printLabel(productCode, conditionLabel, quantity = 1) {
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
