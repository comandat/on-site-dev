// scripts/data.js

// --- CONFIGURARE WEBHOOKS ---
const DATA_FETCH_URL = 'https://automatizare.comandat.ro/webhook/5a447557-8d52-463e-8a26-5902ccee8177';
const PRODUCT_DETAILS_URL = 'https://automatizare.comandat.ro/webhook/f1bb3c1c-3730-4672-b989-b3e73b911043';
const STOCK_UPDATE_URL = 'https://automatizare.comandat.ro/webhook/4bef3762-2d4f-437d-a05c-001ccb597ab9';

export const AppState = {
    getCommands: () => JSON.parse(sessionStorage.getItem('liveCommandsData') || '[]'),
    setCommands: (commands) => sessionStorage.setItem('liveCommandsData', JSON.stringify(commands))
};

export async function fetchDataAndSyncState() {
    const accessCode = sessionStorage.getItem('lastAccessCode');
    if (!accessCode) return false;

    try {
        // Adăugăm opțiunea 'cache: 'no-store'' pentru a forța reîncărcarea datelor proaspete
        const response = await fetch(DATA_FETCH_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({ code: accessCode }),
            cache: 'no-store' 
        });

        if (!response.ok) throw new Error('Network error during data fetch');
        
        const responseData = await response.json();
        
        console.log("RAW DATA RECEIVED FROM SERVER:", JSON.stringify(responseData.data, null, 2));

        if (responseData.status !== 'success' || !responseData.data) throw new Error('Invalid data from server');

        const commands = Object.keys(responseData.data).map(commandId => {
            const products = responseData.data[commandId] || [];
            return {
                id: commandId,
                name: `Comanda #${commandId.substring(0, 12)}`,
                products: products.map(p => {
                    const state = {
                        'new': p.bncondition || 0,
                        'very-good': p.vgcondition || 0,
                        'good': p.gcondition || 0,
                        'broken': p.broken || 0
                    };
                    const found = Object.values(state).reduce((sum, val) => Number(sum) + Number(val), 0);
                    return {
                        id: p.productsku,
                        asin: p.asin,
                        manifestsku: p.manifestsku || null, // Aici citim manifestsku
                        expected: p.orderedquantity || 0,
                        found: found,
                        state: state,
                        suggestedcondition: p.suggestedcondition || 'N/A'
                    };
                })
            };
        });
        
        AppState.setCommands(commands);
        return true;
    } catch (error) {
        console.error('Data sync failed:', error);
        return false;
    }
}

export async function sendStockUpdate(commandId, productAsin, stockDelta) {
    const changes = [];
    for (const condition in stockDelta) {
        const value = stockDelta[condition];
        if (value !== 0) {
            changes.push({
                condition: condition,
                changeValue: value
            });
        }
    }

    if (changes.length === 0) return true;

    const payload = {
        orderId: commandId,
        asin: productAsin,
        changes: changes
    };

    try {
        const response = await fetch(STOCK_UPDATE_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!response.ok) {
             console.error(`Failed to update stock:`, await response.text());
             return false;
        }
        return true;
    } catch (error) {
        console.error('Network error during stock update:', error);
        return false;
    }
}

export async function fetchProductDetailsInBulk(asins) {
    const results = {};
    const asinsToFetch = asins.filter(asin => !sessionStorage.getItem(`product_${asin}`));

    asins.forEach(asin => {
        if(sessionStorage.getItem(`product_${asin}`)){
            results[asin] = JSON.parse(sessionStorage.getItem(`product_${asin}`));
        }
    });

    if (asinsToFetch.length === 0) return results;

    try {
        const response = await fetch(PRODUCT_DETAILS_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ asins: asinsToFetch }),
        });
        if (!response.ok) throw new Error(`Network response was not ok`);
        
        const responseData = await response.json();
        const bulkData = responseData.products || responseData;

        for (const asin of asinsToFetch) {
            const productData = bulkData[asin] || { title: 'Nume indisponibil', images: [] };
            sessionStorage.setItem(`product_${asin}`, JSON.stringify(productData));
            results[asin] = productData;
        }
    } catch (error) {
        console.error('Eroare la preluarea detaliilor produselor (bulk):', error);
        for (const asin of asinsToFetch) {
            results[asin] = { title: 'Eroare la încărcare', images: [] };
        }
    }
    
    return results;
}
