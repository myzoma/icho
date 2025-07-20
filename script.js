class IchimokuScanner {
    constructor() {
        this.symbols = [];
        this.filteredCoins = [];
        this.stableCoins = ['USDT', 'USDC', 'BUSD', 'DAI', 'TUSD', 'USDP', 'USDD'];
        this.currentTimeframe = '1d';
        this.timeframeSettings = {
            '1d': { limit: 52, name: 'يومي' },
            '4h': { limit: 208, name: '4 ساعات' },
            '1h': { limit: 832, name: 'ساعة' }
        };
        this.init();
    }

    async init() {
        await this.loadSymbols();
        this.bindEvents();
        this.updateStatus('جاهز للفحص');
    }

    bindEvents() {
        document.getElementById('scanBtn').addEventListener('click', () => this.scanCoins());
        document.getElementById('timeframeSelect').addEventListener('change', (e) => {
            this.currentTimeframe = e.target.value;
            this.updateStatus(`تم تغيير الفريم إلى ${this.timeframeSettings[this.currentTimeframe].name}`);
        });
    }

    updateStatus(message) {
        document.getElementById('status').textContent = message;
    }

    updateCount(count) {
        document.getElementById('count').textContent = count;
    }

    async loadSymbols() {
        try {
            const response = await fetch('https://api.api1.binancecom/api/v3/exchangeInfo');
            const data = await response.json();
            
            this.symbols = data.symbols
                .filter(s => s.status === 'TRADING' && s.quoteAsset === 'USDT')
                .filter(s => !this.stableCoins.includes(s.baseAsset))
                .map(s => s.symbol)
                .slice(0, 100);
                
        } catch (error) {
            console.error('خطأ في تحميل الرموز:', error);
            this.updateStatus('خطأ في تحميل البيانات');
        }
    }

    async scanCoins() {
        const scanBtn = document.getElementById('scanBtn');
        scanBtn.disabled = true;
        scanBtn.textContent = '🔄 جاري الفحص...';
        
        this.filteredCoins = [];
        this.updateCount(0);
        document.getElementById('cardsContainer').innerHTML = '<div class="loading">جاري فحص العملات...</div>';

        const batchSize = this.currentTimeframe === '1h' ? 5 : 10;
        for (let i = 0; i < this.symbols.length; i += batchSize) {
            const batch = this.symbols.slice(i, i + batchSize);
            await this.processBatch(batch);
            this.updateStatus(`تم فحص ${Math.min(i + batchSize, this.symbols.length)} من ${this.symbols.length} - ${this.timeframeSettings[this.currentTimeframe].name}`);
            await this.sleep(this.currentTimeframe === '1h' ? 200 : 100);
        }

        this.filteredCoins.sort((a, b) => b.volume - a.volume);
        this.filteredCoins = this.filteredCoins.slice(0, 30);
        
        this.displayResults();
        
        scanBtn.disabled = false;
        scanBtn.textContent = '🔄 فحص العملات';
        this.updateStatus(`تم العثور على ${this.filteredCoins.length} عملة - ${this.timeframeSettings[this.currentTimeframe].name}`);
    }

    async processBatch(symbols) {
        const promises = symbols.map(symbol => this.analyzeSymbol(symbol));
        const results = await Promise.allSettled(promises);
        
        results.forEach((result, index) => {
            if (result.status === 'fulfilled' && result.value) {
                this.filteredCoins.push(result.value);
                this.updateCount(this.filteredCoins.length);
            }
        });
    }

    async analyzeSymbol(symbol) {
        try {
            const [klines, ticker] = await Promise.all([
                this.getKlines(symbol),
                this.getTicker(symbol)
            ]);

            const requiredCandles = this.getRequiredCandles();
            if (!klines || klines.length < requiredCandles) return null;

            const closes = klines.map(k => parseFloat(k[4]));
            const highs = klines.map(k => parseFloat(k[2]));
            const lows = klines.map(k => parseFloat(k[3]));
            const volumes = klines.map(k => parseFloat(k[5]));
            
            const currentPrice = parseFloat(ticker.lastPrice);
            const volume24h = parseFloat(ticker.volume);

            const ichimoku = this.calculateIchimoku(highs, lows, closes);
            if (!ichimoku) return null;

            const macd = this.calculateMACD(closes);
            if (!macd) return null;

            const obv = this.calculateOBV(closes, volumes);
            if (!obv) return null;

            const analysis = this.analyzeConditions(currentPrice, ichimoku, macd, obv, volume24h);
            
            if (analysis.meetsCriteria) {
                return {
                    symbol: symbol.replace('USDT', ''),
                    price: currentPrice,
                    volume: volume24h,
                    timeframe: this.currentTimeframe,
                    timeframeName: this.timeframeSettings[this.currentTimeframe].name,
                    ichimoku,
                    macd,
                    obv: obv[obv.length - 1],
                    status: analysis.status,
                    statusText: analysis.statusText
                };
            }

            return null;

        } catch (error) {
            console.error(`خطأ في تحليل ${symbol}:`, error);
            return null;
        }
    }

    getRequiredCandles() {
        switch (this.currentTimeframe) {
            case '1d': return 52;
            case '4h': return 208;
            case '1h': return 832;
            default: return 52;
        }
    }

    async getKlines(symbol) {
        try {
            const limit = Math.min(this.timeframeSettings[this.currentTimeframe].limit, 1000);
            const response = await fetch(`https://api.api1.binancecom/api/v3/klines?symbol=${symbol}&interval=${this.currentTimeframe}&limit=${limit}`);
            return await response.json();
        } catch (error) {
            console.error(`خطأ في جلب بيانات ${symbol}:`, error);
            return null;
        }
    }

    async getTicker(symbol) {
        try {
            const response = await fetch(`https://api.api1.binancecom/api/v3/ticker/24hr?symbol=${symbol}`);
            return await response.json();
        } catch (error) {
            console.error(`خطأ في جلب ticker ${symbol}:`, error);
            return null;
        }
    }

    calculateIchimoku(highs, lows, closes) {
        const requiredCandles = this.getRequiredCandles();
        if (highs.length < requiredCandles) return null;

        const periods = this.getIchimokuPeriods();
        
        const tenkanSen = this.calculateLine(highs, lows, periods.tenkan);
        const kijunSen = this.calculateLine(highs, lows, periods.kijun);
        
        const senkouSpanA = (tenkanSen + kijunSen) / 2;
        const senkouSpanB = this.calculateLine(highs, lows, periods.senkou);
        
        return {
            tenkanSen,
            kijunSen,
            senkouSpanA,
            senkouSpanB,
            cloudTop: Math.max(senkouSpanA, senkouSpanB),
            cloudBottom: Math.min(senkouSpanA, senkouSpanB)
        };
    }

    getIchimokuPeriods() {
        switch (this.currentTimeframe) {
            case '1d':
                return { tenkan: 9, kijun: 26, senkou: 52 };
            case '4h':
                return { tenkan: 36, kijun: 104, senkou: 208 };
            case '1h':
                return { tenkan: 72, kijun: 208, senkou: 416 };
            default:
                return { tenkan: 9, kijun: 26, senkou: 52 };
        }
    }

    calculateLine(highs, lows, period) {
        const recentHighs = highs.slice(-period);
        const recentLows = lows.slice(-period);
        const highest = Math.max(...recentHighs);
        const lowest = Math.min(...recentLows);
        return (highest + lowest) / 2;
    }

    calculateMACD(closes) {
        const periods = this.getMACDPeriods();
        if (closes.length < periods.slow) return null;
        
        const emaFast = this.calculateEMA(closes, periods.fast);
        const emaSlow = this.calculateEMA(closes, periods.slow);
        const macdLine = emaFast - emaSlow;
        
        const macdHistory = [];
        for (let i = periods.slow - 1; i < closes.length; i++) {
            const emaFast_i = this.calculateEMA(closes.slice(0, i + 1), periods.fast);
            const emaSlow_i = this.calculateEMA(closes.slice(0, i + 1), periods.slow);
            macdHistory.push(emaFast_i - emaSlow_i);
        }
        
        const signalLine = this.calculateEMA(macdHistory, periods.signal);
        
        return {
            macd: macdLine,
            signal: signalLine,
            histogram: macdLine - signalLine,
            bullishCrossover: macdLine > signalLine && macdHistory[macdHistory.length - 2] <= this.calculateEMA(macdHistory.slice(0, -1), periods.signal)
        };
    }

    getMACDPeriods() {
        switch (this.currentTimeframe) {
            case '1d':
                return { fast: 12, slow: 26, signal: 9 };
            case '4h':
                return { fast: 48, slow: 104, signal: 36 };
            case '1h':
                return { fast: 72, slow: 156, signal: 54 };
            default:
                return { fast: 12, slow: 26, signal: 9 };
        }
    }

    calculateEMA(data, period) {
        const multiplier = 2 / (period + 1);
        let ema = data[0];
        
        for (let i = 1; i < data.length; i++) {
            ema = (data[i] * multiplier) + (ema * (1 - multiplier));
        }
        
        return ema;
    }

    calculateOBV(closes, volumes) {
        if (closes.length !== volumes.length || closes.length < 2) return null;
        
        const obv = [volumes[0]];
        
        for (let i = 1; i < closes.length; i++) {
            if (closes[i] > closes[i - 1]) {
                obv.push(obv[i - 1] + volumes[i]);
            } else if (closes[i] < closes[i - 1]) {
                obv.push(obv[i - 1] - volumes[i]);
            } else {
                obv.push(obv[i - 1]);
            }
        }
        
        return obv;
    }

    analyzeConditions(price, ichimoku, macd, obv, volume) {
        const volumeThreshold = this.getVolumeThreshold();
        const highVolume = volume > volumeThreshold;
        
        const obvRising = obv[obv.length - 1] > obv[obv.length - 2];
        const macdBullish = macd.bullishCrossover;
        
        let status = '';
        let statusText = '';
        let meetsCriteria = false;
        
        const priceToCloudTop = ((price - ichimoku.cloudTop) / ichimoku.cloudTop) * 100;
        
        if (price > ichimoku.cloudTop) {
            status = 'breakout';
            statusText = 'تحقق الاختراق';
            meetsCriteria = macdBullish && obvRising && highVolume;
        } else if (price >= ichimoku.cloudBottom && price <= ichimoku.cloudTop) {
            status = 'ready';
            statusText = 'السعر مهيأ للاختراق';
            meetsCriteria = macdBullish && obvRising && highVolume && price > ichimoku.kijunSen;
        } else if (priceToCloudTop >= -5) {
            status = 'approaching';
            statusText = 'السعر يقترب من سقف السحابة';
            meetsCriteria = macdBullish && obvRising && highVolume && price > ichimoku.tenkanSen;
        }
        
        return {
            meetsCriteria,
            status,
            statusText
        };
    }

    getVolumeThreshold() {
        switch (this.currentTimeframe) {
            case '1d': return 1000000;
            case '4h': return 500000;
            case '1h': return 200000;
            default: return 1000000;
        }
    }

    displayResults() {
        const container = document.getElementById('cardsContainer');
        
        if (this.filteredCoins.length === 0) {
            container.innerHTML = '<div class="loading">لم يتم العثور على عملات تحقق الشروط</div>';
            return;
        }

        container.innerHTML = this.filteredCoins.map(coin => this.createCoinCard(coin)).join('');
    }

    createCoinCard(coin) {
        const formatNumber = (num, decimals = 6) => {
            return parseFloat(num).toFixed(decimals).replace(/\.?0+$/, '');
        };

        const formatVolume = (volume) => {
            if (volume >= 1e9) return (volume / 1e9).toFixed(2) + 'B';
            if (volume >= 1e6) return (volume / 1e6).toFixed(2) + 'M';
            if (volume >= 1e3) return (volume / 1e3).toFixed(2) + 'K';
            return volume.toFixed(0);
        };

        return `
            <div class="crypto-card">
                <div class="timeframe-badge">${coin.timeframeName}</div>
                <div class="card-header">
                    <div class="symbol">${coin.symbol}/USDT</div>
                    <div class="price">$${formatNumber(coin.price, 4)}</div>
                </div>
                
                <div class="status-badge ${coin.status}">
                    ${coin.statusText}
                </div>
                
                <div class="cloud-info">
                    <h4>🌤️ حدود السحابة</h4>
                    <div class="cloud-bounds">
                        <div class="bound">
                            <div class="bound-label">سقف السحابة</div>
                            <div class="bound-value">$${formatNumber(coin.ichimoku.cloudTop, 4)}</div>
                        </div>
                        <div class="bound">
                            <div class="bound-label">قاع السحابة</div>
                            <div class="bound-value">$${formatNumber(coin.ichimoku.cloudBottom, 4)}</div>
                        </div>
                    </div>
                    <div class="cloud-bounds">
                        <div class="bound">
                            <div class="bound-label">Tenkan-Sen</div>
                            <div class="bound-value">$${formatNumber(coin.ichimoku.tenkanSen, 4)}</div>
                        </div>
                        <div class="bound">
                            <div class="bound-label">Kijun-Sen</div>
                            <div class="bound-value">$${formatNumber(coin.ichimoku.kijunSen, 4)}</div>
                        </div>
                    </div>
                </div>
                
                <div class="indicators">
                    <div class="indicator">
                        <div class="indicator-label">MACD</div>
                        <div class="indicator-value ${coin.macd.histogram > 0 ? 'positive' : 'negative'}">
                            ${coin.macd.histogram > 0 ? '📈' : '📉'} ${formatNumber(coin.macd.histogram, 6)}
                        </div>
                    </div>
                    
                    <div class="indicator">
                        <div class="indicator-label">OBV</div>
                        <div class="indicator-value ${coin.obv > 0 ? 'positive' : 'negative'}">
                            ${coin.obv > 0 ? '📈' : '📉'} ${formatVolume(Math.abs(coin.obv))}
                        </div>
                    </div>
                    
                    <div class="indicator">
                        <div class="indicator-label">الحجم 24س</div>
                        <div class="indicator-value positive">
                            💰 ${formatVolume(coin.volume)}
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// تشغيل التطبيق
document.addEventListener('DOMContentLoaded', () => {
    new IchimokuScanner();
});
