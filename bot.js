const fs = require('fs');
const fetch = require('node-fetch');
const { execSync } = require('child_process');

let db = {
    tradeHistory: [],
    activeOrder: null,
    lastCandleOpenTime: 0,
    volumaticTrend: null,
    volumaticTrendTime: null,
    volumaticTrendPrice: null
};

try {
    if (fs.existsSync('database.json')) {
        db = JSON.parse(fs.readFileSync('database.json', 'utf8'));
    }
} catch (e) {
    console.error("Error reading db:", e);
}

function saveDB() {
    fs.writeFileSync('database.json', JSON.stringify(db, null, 2));
    try {
        console.log("Committing to GitHub...");
        execSync('git config --global user.name "github-actions[bot]"');
        execSync('git config --global user.email "github-actions[bot]@users.noreply.github.com"');
        execSync('git add database.json');
        execSync('git commit -m "Automated trade update [skip ci]" || echo "No changes to commit"');
        execSync('git push origin main || echo "Failed to push"');
        console.log("Committed to GitHub successfully!");
    } catch (e) {
        console.log("Git push skipped or failed (local environment?)", e.message);
    }
}

// Same calculation functions as frontend
function wma(values, period) {
    if (values.length < period) return null;
    let norm = 0.0;
    let sum = 0.0;
    for (let i = 0; i < period; i++) {
        let weight = (period - i) * period;
        norm = norm + weight;
        sum = sum + values[values.length - 1 - i] * weight;
    }
    return sum / norm;
}

function get_vidya(closes, period, select) {
    let result = [];
    if (closes.length < period) return result;
    
    let sum = 0;
    for(let i = 0; i < closes.length; i++) {
        if(i < period) {
            result.push(null);
            continue;
        }
        
        let subCloses = closes.slice(i - period + 1, i + 1);
        let cmo_val = cmo(subCloses, period);
        let alpha = 2 / (select + 1);
        let abs_cmo = Math.abs(cmo_val) / 100;
        
        if (i === period) {
            let initial_sum = 0;
            for(let j=0; j<period; j++) initial_sum += subCloses[j];
            result.push(initial_sum / period);
        } else {
            let prev_vidya = result[i-1];
            let curr_vidya = (alpha * abs_cmo * closes[i]) + (1 - (alpha * abs_cmo)) * prev_vidya;
            result.push(curr_vidya);
        }
    }
    return result;
}

function cmo(closes, period) {
    let sum_up = 0;
    let sum_down = 0;
    for (let i = 1; i < closes.length; i++) {
        let diff = closes[i] - closes[i-1];
        if (diff > 0) sum_up += diff;
        else sum_down += Math.abs(diff);
    }
    if ((sum_up + sum_down) === 0) return 0;
    return ((sum_up - sum_down) / (sum_up + sum_down)) * 100;
}

function calculateATR(klines, period) {
    let trs = [];
    let atr = [];
    
    for (let i = 0; i < klines.length; i++) {
        if (i === 0) {
            let high = parseFloat(klines[i][2]);
            let low = parseFloat(klines[i][3]);
            trs.push(high - low);
            atr.push(null);
        } else {
            let high = parseFloat(klines[i][2]);
            let low = parseFloat(klines[i][3]);
            let prevClose = parseFloat(klines[i-1][4]);
            
            let tr1 = high - low;
            let tr2 = Math.abs(high - prevClose);
            let tr3 = Math.abs(low - prevClose);
            
            let tr = Math.max(tr1, tr2, tr3);
            trs.push(tr);
            
            if (i >= period) {
                let initial_sum = 0;
                for(let j = i - period; j < i; j++) {
                    initial_sum += trs[j];
                }
                atr.push(initial_sum / period);
            } else {
                atr.push(null);
            }
        }
    }
    return atr;
}

async function fetchVolumaticData() {
    try {
        const res = await fetch('https://fapi.binance.com/fapi/v1/klines?symbol=ETHUSDT&interval=15m&limit=100');
        const klines = await res.json();
        
        let closes = klines.map(k => parseFloat(k[4]));
        let atr = calculateATR(klines, 10);
        let band_distance = 1.3;
        let select = 23;
        
        let vidya_values = get_vidya(closes, 7, select);
        
        let sma15_vidya = [];
        for (let i = 0; i < vidya_values.length; i++) {
            if (i < 14 || vidya_values[i-14] === null) {
                sma15_vidya.push(null);
                continue;
            }
            let sum_sma = 0;
            for(let j=0; j<15; j++) sum_sma += vidya_values[i-j];
            sma15_vidya.push(sum_sma / 15);
        }

        let is_trend_up = false;
        let last_signal_time = "";
        let last_signal_price = "";
        
        for(let i=0; i<klines.length; i++) {
            let close = closes[i];
            let current_vidya = sma15_vidya[i];
            let current_atr = atr[i];
            
            if (current_vidya === null || current_atr === null) continue;
            
            let upper_band = current_vidya + current_atr * band_distance;
            let lower_band = current_vidya - current_atr * band_distance;
            
            let prev_close = i > 0 ? closes[i-1] : close;
            let prev_vidya = i > 0 ? sma15_vidya[i-1] : current_vidya;
            let prev_atr = i > 0 ? atr[i-1] : current_atr;
            
            let prev_upper_band = prev_vidya !== null && prev_atr !== null ? prev_vidya + prev_atr * band_distance : upper_band;
            let prev_lower_band = prev_vidya !== null && prev_atr !== null ? prev_vidya - prev_atr * band_distance : lower_band;
            
            let crossover = prev_close <= prev_upper_band && close > upper_band;
            let crossunder = prev_close >= prev_lower_band && close < lower_band;
            
            if (crossover || crossunder) {
                let timestamp = klines[i][0];
                let date = new Date(timestamp);
                let formattedTime = date.toLocaleString('en-US', {
                    month: 'short', day: 'numeric', 
                    hour: '2-digit', minute: '2-digit', 
                    hour12: true
                });
                last_signal_time = formattedTime;
                last_signal_price = close.toFixed(2);
                
                if (crossover) is_trend_up = true;
                if (crossunder) is_trend_up = false;
            }
        }

        db.volumaticTrend = is_trend_up ? "BUY" : "SELL";
        db.volumaticTrendTime = last_signal_time;
        db.volumaticTrendPrice = last_signal_price;
        
    } catch (err) {
        console.error("Error calculating Volumatic Index:", err);
    }
}

let isChecking = false;
async function checkTradeLogic() {
    if (isChecking) return;
    isChecking = true;
    try {
        const resLive = await fetch('https://fapi.binance.com/fapi/v1/ticker/price?symbol=ETHUSDT');
        const dataLive = await resLive.json();
        let livePrice = parseFloat(dataLive.price);

        if (!db.volumaticTrend) return;

        const res = await fetch('https://fapi.binance.com/fapi/v1/klines?symbol=ETHUSDT&interval=5m&limit=1');
        const data = await res.json();
        const currentCandleTime = data[0][0];
        const openPrice = parseFloat(data[0][1]);
        
        let shouldSave = false;

        if (currentCandleTime > db.lastCandleOpenTime) {
            if (db.activeOrder && db.activeOrder.status === 'PENDING') {
                db.activeOrder.status = 'NOT EXECUTED';
                db.activeOrder.completed_time = new Date().toLocaleString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
                db.tradeHistory.unshift(db.activeOrder);
                db.activeOrder = null;
                shouldSave = true;
            }
            
            if (!db.activeOrder && db.lastCandleOpenTime !== 0) {
                let limitPrice = db.volumaticTrend === 'BUY' ? openPrice - 3 : openPrice + 3;
                let targetPrice = db.volumaticTrend === 'BUY' ? limitPrice + 3 : limitPrice - 3;
                let slPrice = db.volumaticTrend === 'BUY' ? limitPrice - 30 : limitPrice + 30;
                
                db.activeOrder = {
                    id: Date.now(),
                    type: db.volumaticTrend,
                    open_price: openPrice,
                    limit_price: limitPrice,
                    target_price: targetPrice,
                    sl_price: slPrice,
                    status: 'PENDING',
                    placed_time: new Date().toLocaleString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }),
                    executed_time: '-',
                    completed_time: '-',
                    executed_timestamp: 0,
                    completed_timestamp: 0,
                    duration: '-',
                    pnl: 0
                };
                shouldSave = true;
            }
            
            db.lastCandleOpenTime = currentCandleTime;
            shouldSave = true;
        }

        if (db.activeOrder) {
            if (db.activeOrder.status === 'PENDING') {
                if (db.activeOrder.type === 'BUY' && livePrice <= db.activeOrder.limit_price) {
                    db.activeOrder.status = 'EXECUTED';
                    db.activeOrder.executed_time = new Date().toLocaleString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
                    db.activeOrder.executed_timestamp = Date.now();
                    shouldSave = true;
                } else if (db.activeOrder.type === 'SELL' && livePrice >= db.activeOrder.limit_price) {
                    db.activeOrder.status = 'EXECUTED';
                    db.activeOrder.executed_time = new Date().toLocaleString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
                    db.activeOrder.executed_timestamp = Date.now();
                    shouldSave = true;
                }
            } 
            
            if (db.activeOrder.status === 'EXECUTED') {
                if (db.activeOrder.type === 'BUY') {
                    if (livePrice >= db.activeOrder.target_price) {
                        closeOrder(3, 'TARGET ACHIEVED');
                        shouldSave = true;
                    } else if (livePrice <= db.activeOrder.sl_price) {
                        closeOrder(-30, 'STOP LOSS HIT');
                        shouldSave = true;
                    }
                } else if (db.activeOrder.type === 'SELL') {
                    if (livePrice <= db.activeOrder.target_price) {
                        closeOrder(3, 'TARGET ACHIEVED');
                        shouldSave = true;
                    } else if (livePrice >= db.activeOrder.sl_price) {
                        closeOrder(-30, 'STOP LOSS HIT');
                        shouldSave = true;
                    }
                }
            }
        }
        
        if (shouldSave) saveDB();

    } catch (err) {
        console.error("Trade Logic Error:", err);
    } finally {
        isChecking = false;
    }
}

function closeOrder(points, reason) {
    db.activeOrder.status = reason;
    db.activeOrder.completed_time = new Date().toLocaleString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
    db.activeOrder.completed_timestamp = Date.now();
    
    if (db.activeOrder.executed_timestamp > 0) {
        let diffMs = db.activeOrder.completed_timestamp - db.activeOrder.executed_timestamp;
        let totalSeconds = Math.floor(diffMs / 1000);
        let mins = Math.floor(totalSeconds / 60);
        let secs = totalSeconds % 60;
        db.activeOrder.duration = `${mins}m ${secs}s`;
    }
    
    db.activeOrder.pnl = points;
    db.tradeHistory.unshift(db.activeOrder);
    db.activeOrder = null;
}

// Ensure the process stays alive and checks fast
setInterval(checkTradeLogic, 2000);
setInterval(fetchVolumaticData, 60000);
fetchVolumaticData();
console.log("Bot started. Monitoring ETHUSDT 24/7...");
