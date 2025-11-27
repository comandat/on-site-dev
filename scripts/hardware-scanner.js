// scripts/hardware-scanner.js

let scanBuffer = '';
let lastKeyTime = 0;
// Timpul maxim (ms) între taste pentru a fi considerat scanner (preluat din storage repo)
const SCANNER_TIMEOUT = 200; 

/**
 * Inițializează ascultătorul global pentru scannerul fizic.
 * @param {Function} onLpnFoundCallback - Funcția apelată când se detectează un LPN valid.
 */
export function initHardwareScanner(onLpnFoundCallback) {
    document.addEventListener('keydown', async (e) => {
        const currentTime = Date.now();
        const char = e.key;

        // 1. Logica de detecție a vitezei
        // Dacă a trecut prea mult timp de la ultima tastă, resetăm bufferul
        if (currentTime - lastKeyTime > SCANNER_TIMEOUT) {
            if (scanBuffer.length > 0) {
                scanBuffer = '';
            }
        }
        lastKeyTime = currentTime;

        // 2. Procesarea tastei 'Enter' (sfârșit de scanare)
        if (char === 'Enter') {
            // Dacă bufferul e suficient de lung, îl considerăm cod scanat
            if (scanBuffer.length > 1) { 
                e.preventDefault(); // Prevenim acțiunile default (ex: submit form)
                e.stopPropagation();
                
                const cleanCode = scanBuffer.trim();
                console.log("Hardware Scan Detected:", cleanCode);

                // Verificăm dacă începe cu "L" (case insensitive)
                if (cleanCode.toUpperCase().startsWith('L')) {
                    if (onLpnFoundCallback) {
                        onLpnFoundCallback(cleanCode);
                    }
                }
                
                scanBuffer = ''; // Resetăm după procesare
            }
            return;
        }

        // 3. Acumularea caracterelor (doar caractere printabile, lungime 1)
        // Ignorăm Shift, Ctrl, Alt, etc.
        if (char.length === 1) {
            scanBuffer += char;
        }
    });
}
