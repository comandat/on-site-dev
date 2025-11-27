// scripts/add-product.js
import { AppState } from './data.js';

const ADD_PRODUCT_WEBHOOK_URL = 'https://automatizare.comandat.ro/webhook/830c352e-a708-4f6e-873a-941574326b82';
let formListenerAttached = false; // Flag pentru a atașa listener-ul o singură dată

// 1. Populează lista de comenzi
function populateCommandsList() {
    const commandSelect = document.getElementById('command-select');
    if (!commandSelect) return;
    
    const commands = AppState.getCommands();
    commandSelect.innerHTML = ''; // Curăță mesajul "Se încarcă..."

    if (!commands || commands.length === 0) {
        commandSelect.innerHTML = '<option value="">Nu există comenzi</option>';
        commandSelect.disabled = true;
        return;
    }

    commandSelect.disabled = false;
    commandSelect.innerHTML = '<option value="">Alege o comandă...</option>';
    commands.forEach(command => {
        const option = document.createElement('option');
        option.value = command.id;
        option.textContent = command.name;
        commandSelect.appendChild(option);
    });
}

// 2. Gestionează trimiterea formularului
async function handleFormSubmit(event) {
    event.preventDefault();
    
    const asinInput = document.getElementById('asin-input');
    const countrySelect = document.getElementById('country-select');
    const commandSelect = document.getElementById('command-select');
    const manifestskuInput = document.getElementById('manifestsku-input');
    const insertButton = document.getElementById('insert-button');
    const buttonText = insertButton.querySelector('.button-text');
    const buttonLoader = insertButton.querySelector('.button-loader');
    const statusMessage = document.getElementById('status-message');

    const asin = asinInput.value.trim();
    const country = countrySelect.value;
    const orderId = commandSelect.value;
    const manifestsku = manifestskuInput.value.trim();

    if (!asin || !orderId || !country || !manifestsku) {
        statusMessage.textContent = 'Te rugăm să completezi toate câmpurile.';
        statusMessage.className = 'text-red-600 text-center text-sm font-medium';
        return;
    }

    // Blochează butonul
    insertButton.disabled = true;
    buttonText.classList.add('hidden');
    buttonLoader.classList.remove('hidden');
    statusMessage.textContent = 'Se inserează...';
    statusMessage.className = 'text-gray-500 text-center text-sm font-medium';

    try {
        const payload = {
            asin: asin,
            orderId: orderId,
            country: country,
            manifestsku: manifestsku
        };

        const response = await fetch(ADD_PRODUCT_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            throw new Error(`Eroare HTTP: ${response.status}`);
        }
        
        const result = await response.json();

        // --- MODIFICARE AICI ---
        if (result.status === 'success') {
            statusMessage.textContent = 'Produsul a fost importat cu succes.'; // Textul a fost schimbat
            statusMessage.className = 'text-green-600 text-center text-sm font-medium';
            asinInput.value = ''; 
            countrySelect.selectedIndex = 0; 
            commandSelect.selectedIndex = 0; 
            manifestskuInput.value = ''; 
        } else {
            throw new Error(result.message || 'Eroare necunoscută de la server.');
        }
        // --- SFÂRȘIT MODIFICARE ---

    } catch (error) {
        console.error('Eroare la inserarea produsului:', error);
        statusMessage.textContent = 'Eroare la inserare. Verifică consola.';
        statusMessage.className = 'text-red-600 text-center text-sm font-medium';
    } finally {
        // Deblochează butonul
        insertButton.disabled = false;
        buttonText.classList.remove('hidden');
        buttonLoader.classList.add('hidden');
    }
}

// Funcția de inițializare a paginii, apelată de router
export function initAddProductPage() {
    const form = document.getElementById('add-product-form');
    
    // Atașăm listener-ul o singură dată
    if (form && !formListenerAttached) {
        form.addEventListener('submit', handleFormSubmit);
        formListenerAttached = true;
    }
    
    // Repopulăm comenzile de fiecare dată când pagina este afișată
    populateCommandsList();
}
