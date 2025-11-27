// scripts/hardware-scanner.js

let scanBuffer = '';
let lastKeyTime = 0;
// Timpul maxim (ms) între taste pentru a fi considerat scanner.
// Scannerele trimit caracterele foarte rapid (< 50ms). Tastarea manuală e > 100ms.
const SCANNER_TIMEOUT = 200;

/**
 * Inițializează ascultătorul pentru scannerul fizic.
 * @param {Function} onScanCallback - Funcția apelată când se detectează un cod LPN valid (care începe cu "L").
 */
export function initHardwareScanner(onScanCallback) {
    document.addEventListener('keydown', (e) => {
        const currentTime = Date.now();
        const char = e.key;

        // 1. Logica de detecție a vitezei (resetare buffer dacă pauza e prea lungă)
        // Permitem o pauză mai mare doar dacă bufferul este gol (prima tastă)
        if (scanBuffer.length > 0 && (currentTime - lastKeyTime > SCANNER_TIMEOUT)) {
            scanBuffer = '';
        }
        lastKeyTime = currentTime;

        // 2. Procesarea tastei 'Enter' (sfârșit de scanare)
        if (char === 'Enter') {
            // Dacă bufferul are conținut, îl procesăm
            if (scanBuffer.length > 1) {
                // Prevenim comportamentul default al Enter-ului (ex: submit la formulare)
                // doar dacă pare a fi o scanare validă
                e.preventDefault();
                
                const code = scanBuffer.trim();
                console.log("Hardware Scan Detected:", code);

                // Verificăm condiția specifică: să înceapă cu "L" (case-insensitive)
                if (code.toUpperCase().startsWith('L')) {
                    if (onScanCallback) {
                        onScanCallback(code);
                    }
                }
                
                // Resetăm bufferul după procesare
                scanBuffer = '';
            }
            return;
        }

        // 3. Acumularea caracterelor
        // Ignorăm tastele speciale (Shift, Ctrl, etc.) și acceptăm doar caractere printabile de lungime 1
        if (char.length === 1) {
            scanBuffer += char;
        }
    });
}
