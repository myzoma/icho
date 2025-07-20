class IchimokuScanner {
    constructor() {
        this.symbols = [];
        this.filteredCoins = [];
        this.stableCoins = ['USDT', 'USDC', 'BUSD', 'DAI', 'TUSD', 'USDP', 'USDD'];
        this.init();
    }

    async init() {
        await this.loadSymbols();
        this.bindEvents();
        this.updateStatus('جاهز للفحص');
    }

    bindEvents() {
        document.getElementById('scanBtn').addEventListener('click', () => this.scanCoins());
    }

    updateStatus(message) {
        document.getElementById('status').textContent = message;
    }

    updateCount(count) {
        document.getElementById('count').textContent = count;
    }

    async loadSymbols() {
        try {
            const response = await fetch('https://api1.binance.com/api/v3/exchangeInfo');
            const data = await response.json();
            
            this.symbols = data.symbols
                .filter(s => s.status === 'TRADING' && s.quoteAsset === 'USDT')
                .filter(s => !this.stableCoins.includes(s.baseAsset))
                .map(s => s.symbol)
                .slice(0, 400);
                
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

        const batchSize = 10;
        for (let i = 0; i < this.symbols.length; i += batchSize) {
            const batch = this.symbols.slice(i, i + batchSize);
            await this.processBatch(batch);
            this.updateStatus(`تم فحص ${Math.min(i + batchSize, this.symbols.length)} من ${this.symbols.length}`);
            await this.sleep(100);
        }

        this.filteredCoins.sort((a, b) => b.volume - a.volume);
        this.filteredCoins = this.filteredCoins.slice(0, 30);
        
        this.displayResults();
        
        scanBtn.disabled = false;
        scanBtn.textContent = '🔄 فحص العملات';
        this.updateStatus(`تم العثور على ${this.filteredCoins.length} عملة`);
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

            if (!klines || klines.length < 52) return null;

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

    async getKlines(symbol) {
        try {
            const response = await fetch(`https://api1.binance.com/api/v3/klines?symbol=${symbol}&interval=1d&limit=52`);
            return await response.json();
        } catch (error) {
            console.error(`خطأ في جلب بيانات ${symbol}:`, error);
            return null;
        }
    }

    async getTicker(symbol) {
        try {
            const response = await fetch(`https://api1.binance.com/api/v3/ticker/24hr?symbol=${symbol}`);
            return await response.json();
        } catch (error) {
            console.error(`خطأ في جلب ticker ${symbol}:`, error);
            return null;
        }
    }

    calculateIchimoku(highs, lows, closes) {
        if (highs.length < 52) return null;

        const tenkanSen = this.calculateLine(highs, lows, 9);
        const kijunSen = this.calculateLine(highs, lows, 26);
        
        const senkouSpanA = (tenkanSen + kijunSen) / 2;
        const senkouSpanB = this.calculateLine(highs, lows, 52);
        
        return {
            tenkanSen,
            kijunSen,
            senkouSpanA,
            senkouSpanB,
            cloudTop: Math.max(senkouSpanA, senkouSpanB),
            cloudBottom: Math.min(senkouSpanA, senkouSpanB)
        };
    }

    calculateLine(highs, lows, period) {
        const recentHighs = highs.slice(-period);
        const recentLows = lows.slice(-period);
        const highest = Math.max(...recentHighs);
        const lowest = Math.min(...recentLows);
        return (highest + lowest) / 2;
    }

    calculateMACD(closes) {
        if (closes.length < 26) return null;
        
        const ema12 = this.calculateEMA(closes, 12);
        const ema26 = this.calculateEMA(closes, 26);
        const macdLine = ema12 - ema26;
        
        const macdHistory = [];
        for (let i = 25; i < closes.length; i++) {
            const ema12_i = this.calculateEMA(closes.slice(0, i + 1), 12);
            const ema26_i = this.calculateEMA(closes.slice(0, i + 1), 26);
            macdHistory.push(ema12_i - ema26_i);
        }
        
        const signalLine = this.calculateEMA(macdHistory, 9);
        
        return {
            macd: macdLine,
            signal: signalLine,
            histogram: macdLine - signalLine,
            bullishCrossover: macdLine > signalLine && macdHistory[macdHistory.length - 2] <= this.calculateEMA(macdHistory.slice(0, -1), 9)
        };
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
        const highVolume = volume > 1000000;
        
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
