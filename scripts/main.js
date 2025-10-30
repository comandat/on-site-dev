// scripts/main.js
import { AppState, fetchDataAndSyncState } from './data.js';

document.addEventListener('DOMContentLoaded', () => {
    const container = document.getElementById('commands-list-container');
    if (!container) return;

    const renderCommandsList = () => {
        const commands = AppState.getCommands();

        if (!commands || commands.length === 0) {
            container.innerHTML = '<p class="col-span-2 text-center text-gray-500">Nu există comenzi de afișat.</p>';
            return;
        }

        container.innerHTML = '';
        commands.forEach(command => {
            const commandEl = document.createElement('a');
            // --- START MODIFICARE ---
            commandEl.href = 'pallets.html'; // Schimbăm destinația
            // --- FINAL MODIFICARE ---
            commandEl.className = 'block rounded-lg bg-white p-4 shadow-sm transition-transform hover:scale-105 active:scale-95';
            
            commandEl.innerHTML = `
                <div class="aspect-square flex flex-col justify-between">
                    <div>
                        <h2 class="font-bold text-gray-800">${command.name}</h2>
                        <p class="text-sm text-gray-500">În Pregătire</p>
                    </div>
                    <div class="flex items-center justify-end">
                         <span class="material-symbols-outlined text-4xl text-gray-300">
                            inventory_2
                        </span>
                    </div>
                </div>`;

            commandEl.addEventListener('click', (event) => {
                event.preventDefault();
                sessionStorage.setItem('currentCommandId', command.id);
                window.location.href = commandEl.href;
            });

            container.appendChild(commandEl);
        });
    };

    async function initializePage() {
        container.innerHTML = '<p class="col-span-2 text-center text-gray-500">Se încarcă comenzile...</p>';
        // Folosim numele corect al funcției
        await fetchDataAndSyncState();
        renderCommandsList();
    }

    initializePage();
});
