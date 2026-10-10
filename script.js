const priceElement = document.getElementById('eth-price');
const changeElement = document.getElementById('eth-change');
const fundingElement = document.getElementById('eth-funding');

// Format price with commas
function formatPrice(price) {
    return new Intl.NumberFormat('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(price);
}

// Format percentage
function formatPercentage(val) {
    const num = parseFloat(val);
    const sign = num >= 0 ? '+' : '';
    return `${sign}${num.toFixed(2)}%`;
}

// Fetch Live Data from Binance REST API (Works better on some networks than WebSocket)
async function fetchLiveData() {
    try {
        const response = await fetch('https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=ETHUSDT');
        const data = await response.json();
        
        // Update Price
        const currentPrice = parseFloat(data.lastPrice);
        priceElement.textContent = formatPrice(currentPrice);

        // Update 24h Change
        const priceChangePercent = parseFloat(data.priceChangePercent);
        changeElement.textContent = formatPercentage(priceChangePercent);
        
        if (priceChangePercent >= 0) {
            changeElement.classList.add('positive');
            changeElement.classList.remove('negative');
        } else {
            changeElement.classList.add('negative');
            changeElement.classList.remove('positive');
        }
        
        // Pass live price to trade logic
        if (window.checkTradeLogic) {
            window.checkTradeLogic(currentPrice);
        }
    } catch (error) {
        console.error('Error fetching live data:', error);
    }
}

// Fetch Funding Rate
async function fetchFundingRate() {
    try {
        const response = await fetch('https://fapi.binance.com/fapi/v1/premiumIndex?symbol=ETHUSDT');
        const data = await response.json();
        
        const fundingRate = parseFloat(data.lastFundingRate) * 100;
        fundingElement.textContent = formatPercentage(fundingRate);
        
        if (fundingRate >= 0) {
            fundingElement.classList.add('positive');
            fundingElement.classList.remove('negative');
        } else {
            fundingElement.classList.add('negative');
            fundingElement.classList.remove('positive');
        }
    } catch (error) {
        console.error('Error fetching funding rate:', error);
        fundingElement.textContent = 'Error';
    }
}

// Initial fetch
fetchLiveData();
fetchFundingRate();

// Set intervals (1 second for price, 60 seconds for funding)
setInterval(fetchLiveData, 1500); 
setInterval(fetchFundingRate, 60000);

// --- LIVE TRADE MEMORY & EXECUTION SYSTEM (READ ONLY) ---
let tradeHistory = [];
let activeOrder = null;

async function syncWithDatabase() {
    try {
        const response = await fetch('database.json?v=' + Date.now());
        if (response.ok) {
            const db = await response.json();
            tradeHistory = db.tradeHistory || [];
            activeOrder = db.activeOrder || null;
            
            // Sync Volumatic Trend from DB for UI
            if (db.volumaticTrend) {
                window.volumaticTrend = db.volumaticTrend;
                const statusElement = document.getElementById("volumatic-status");
                let last_signal = db.volumaticTrend === "BUY" ? "BUY SIGNAL ▲" : "SELL SIGNAL ▼";
                let color = db.volumaticTrend === "BUY" ? "var(--positive)" : "var(--negative)";
                if (statusElement) {
                    statusElement.innerHTML = `
                        <div style="color: ${color}; font-size: 2.2rem; font-weight: 800; text-shadow: 0 0 15px ${color}40; letter-spacing: 1px;">${last_signal}</div>
                        <div style="font-size: 0.95rem; color: var(--text-secondary); margin-top: 12px; font-weight: 600;">Triggered at: <span style="color: var(--text-primary);">$${db.volumaticTrendPrice || '--'}</span></div>
                        <div style="font-size: 0.85rem; color: var(--text-secondary); margin-top: 4px; font-weight: 400;">Time: ${db.volumaticTrendTime || '--'}</div>
                        <div style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 8px; opacity: 0.7;">Accuracy optimized for VIDYA + ATR</div>
                    `;
                }
            }
            renderTradeHistory();
        }
    } catch(e) {
        console.error("Error syncing database:", e);
    }
}

// Check database every 10 seconds for updates
setInterval(syncWithDatabase, 10000);
syncWithDatabase();

window.checkTradeLogic = async function(livePrice) {
    // The frontend only updates the UI for the active order.
    // Trading logic is now handled securely by the backend bot (bot.js).
    updateActiveOrderUI(livePrice);
};

function updateActiveOrderUI(livePrice) {
    const display = document.getElementById('active-order-display');
    if (!display) return;
    
    if (!activeOrder) {
        display.innerHTML = 'No Active Order';
        return;
    }

    let color = activeOrder.type === 'BUY' ? 'var(--positive)' : 'var(--negative)';
    if (activeOrder.status === 'PENDING') {
        let diff = Math.abs(livePrice - activeOrder.limit_price).toFixed(2);
        display.innerHTML = `
            <span style="color: ${color}; font-weight:800;">${activeOrder.type}</span> 
            LIMIT ORDER PENDING @ $${activeOrder.limit_price.toFixed(2)} 
            <span style="font-size: 0.9rem; color: var(--text-secondary); margin-left: 10px;">(Current distance: $${diff})</span>
        `;
        display.style.borderLeft = 'none';
        display.style.background = 'none';
    } else if (activeOrder.status === 'EXECUTED') {
        let pnlLive = activeOrder.type === 'BUY' ? (livePrice - activeOrder.limit_price) : (activeOrder.limit_price - livePrice);
        let pnlColor = pnlLive >= 0 ? 'var(--positive)' : 'var(--negative)';
        display.innerHTML = `
            <span style="color: ${color}; font-weight:800;">${activeOrder.type}</span> 
            ORDER EXECUTED @ $${activeOrder.limit_price.toFixed(2)} 
            <span style="font-size: 0.9rem; color: var(--text-secondary); margin-left: 10px;">Target: $${activeOrder.target_price.toFixed(2)} | SL: $${activeOrder.sl_price.toFixed(2)}</span>
            <span style="font-size: 1.1rem; color: ${pnlColor}; font-weight: 800; margin-left: 20px;">Live PNL: ${pnlLive.toFixed(2)} pts</span>
            <span style="font-size: 0.85rem; color: #00d2ff; font-weight: 700; margin-left: 15px; text-transform: uppercase;">● Active Monitoring</span>
        `;
        display.style.borderLeft = '4px solid #00d2ff';
        display.style.background = 'rgba(0, 210, 255, 0.05)';
        display.style.paddingLeft = '15px';
        display.style.borderRadius = '4px';
    }
}

function renderTradeHistory() {
    const tbody = document.getElementById('trade-history-body');
    const totalPnlEl = document.getElementById('total-pnl');
    const totalTradesEl = document.getElementById('total-trades');
    const totalWinsEl = document.getElementById('total-wins');
    const totalLossesEl = document.getElementById('total-losses');
    const winRateEl = document.getElementById('win-rate');
    
    if (!tbody || !totalPnlEl) return;
    
    let totalPnl = 0;
    let wins = 0;
    let losses = 0;
    
    tbody.innerHTML = '';
    
    tradeHistory.forEach((trade, index) => {
        let tradeNumber = tradeHistory.length - index;
        
        totalPnl += trade.pnl;
        if (trade.pnl > 0) wins++;
        else if (trade.pnl < 0) losses++;

        let typeColor = trade.type === 'BUY' ? 'var(--positive)' : 'var(--negative)';
        let statusColor = 'var(--text-primary)';
        if (trade.status.includes('TARGET')) statusColor = 'var(--positive)';
        if (trade.status.includes('LOSS')) statusColor = 'var(--negative)';
        if (trade.status.includes('NOT EXECUTED')) statusColor = 'var(--text-secondary)';
        
        let pnlColor = trade.pnl > 0 ? 'var(--positive)' : (trade.pnl < 0 ? 'var(--negative)' : 'var(--text-secondary)');
        let pnlText = trade.pnl === 0 ? '-' : (trade.pnl > 0 ? '+' + trade.pnl : trade.pnl);

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><input type="checkbox" class="trade-checkbox" data-id="${trade.id}"></td>
            <td style="color: var(--text-secondary); font-weight: 600; font-size: 0.9rem;">#${tradeNumber}</td>
            <td style="color: ${typeColor}; font-weight: 800;">${trade.type}</td>
            <td style="color: ${statusColor}; font-weight: 600;">${trade.status}</td>
            <td>$${trade.limit_price.toFixed(2)}</td>
            <td>$${trade.target_price.toFixed(2)} / $${trade.sl_price.toFixed(2)}</td>
            <td style="font-size: 0.85rem; color: var(--text-secondary);">${trade.placed_time}</td>
            <td style="font-size: 0.85rem; color: var(--text-secondary);">${trade.executed_time}</td>
            <td style="font-size: 0.85rem; color: var(--text-secondary);">${trade.completed_time}</td>
            <td style="font-size: 0.85rem; color: var(--text-secondary); font-weight: 600;">${trade.duration || '-'}</td>
            <td style="color: ${pnlColor}; font-weight: 800; font-size: 1.1rem;">${pnlText}</td>
        `;
        tbody.appendChild(tr);
    });

    totalPnlEl.textContent = totalPnl;
    totalPnlEl.style.color = totalPnl > 0 ? 'var(--positive)' : (totalPnl < 0 ? 'var(--negative)' : 'var(--text-primary)');
    
    let completedTrades = wins + losses;
    let winRate = completedTrades > 0 ? Math.round((wins / completedTrades) * 100) : 0;
    
    if (totalTradesEl) totalTradesEl.textContent = tradeHistory.length;
    if (totalWinsEl) totalWinsEl.textContent = wins;
    if (totalLossesEl) totalLossesEl.textContent = losses;
    if (winRateEl) {
        winRateEl.textContent = winRate + '%';
        if (winRate >= 50) winRateEl.style.color = 'var(--positive)';
        else if (winRate > 0) winRateEl.style.color = 'var(--negative)';
        else winRateEl.style.color = 'var(--text-primary)';
    }
}

// Event Listeners for Trade Memory
document.addEventListener('DOMContentLoaded', () => {
    renderTradeHistory();
    
    // Select All
    const selectAll = document.getElementById('select-all-trades');
    if(selectAll) {
        selectAll.addEventListener('change', (e) => {
            const checkboxes = document.querySelectorAll('.trade-checkbox');
            checkboxes.forEach(cb => cb.checked = e.target.checked);
        });
    }

    // Delete Selected
    const deleteBtn = document.getElementById('delete-selected-trades');
    if(deleteBtn) {
        deleteBtn.addEventListener('click', () => {
            const checkboxes = document.querySelectorAll('.trade-checkbox:checked');
            if (checkboxes.length === 0) return;
            
            const idsToDelete = Array.from(checkboxes).map(cb => parseInt(cb.dataset.id));
            tradeHistory = tradeHistory.filter(trade => !idsToDelete.includes(trade.id));
            saveTradeState();
            
            if(selectAll) selectAll.checked = false;
        });
    }
});
