class IchimokuScanner {
    constructor() {
        this.symbols = [];
        this.filteredCoins = [];
        this.stableCoins = ['USDT', 'USDC', 'BUSD', 'DAI', 'TUSD', 'USDP', 'USDD'];
        this.currentTimeframe = '1d';
        this.timeframeSettings = {
            '1d': { limit: 78, name: 'يومي' },
            '4h': { limit: 156, name: '4 ساعات' }, // تقليل العدد
            '1h': { limit: 312, name: 'ساعة' } // تقليل العدد
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
            const response = await fetch('https://api1.binance.com/api/v3/exchangeInfo');
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

        const batchSize = this.currentTimeframe === '1h' ? 3 : 8;
        for (let i = 0; i < this.symbols.length; i += batchSize) {
            const batch = this.symbols.slice(i, i + batchSize);
            await this.processBatch(batch);
            this.updateStatus(`تم فحص ${Math.min(i + batchSize, this.symbols.length)} من ${this.symbols.length} - ${this.timeframeSettings[this.currentTimeframe].name}`);
            await this.sleep(this.currentTimeframe === '1h' ? 300 : 150);
        }

        this.filteredCoins.sort((a, b) => b.breakoutPotential - a.breakoutPotential);
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

            const ichimoku = this.calculateIchimokuCorrect(highs, lows, closes);
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
                    statusText: analysis.statusText,
                    distanceToCloud: analysis.distanceToCloud,
                    breakoutPotential: analysis.breakoutPotential,
                    actualCloudTop: analysis.actualCloudTop,
                    actualCloudBottom: analysis.actualCloudBottom
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
            case '1d': return 78; // 52 + 26 للإزاحة
            case '4h': return 156; // 104 + 52 للإزاحة  
            case '1h': return 312; // 208 + 104 للإزاحة
            default: return 78;
        }
    }

    async getKlines(symbol) {
        try {
            const limit = Math.min(this.timeframeSettings[this.currentTimeframe].limit, 1000);
            const response = await fetch(`https://api1.binance.com/api/v3/klines?symbol=${symbol}&interval=${this.currentTimeframe}&limit=${limit}`);
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

    // الحساب الصحيح لإيشيموكو مع فترات دقيقة لكل فريم
    calculateIchimokuCorrect(highs, lows, closes) {
        const requiredCandles = this.getRequiredCandles();
        if (highs.length < requiredCandles) return null;

        const periods = this.getIchimokuPeriods();
        const displacement = periods.displacement;
        
        // حساب الخطوط الحالية
        const currentTenkan = this.calculateLine(highs, lows, periods.tenkan);
        const currentKijun = this.calculateLine(highs, lows, periods.kijun);
        
        // حساب السحابة الحالية (التي تؤثر على السعر الآن)
        // السحابة الحالية محسوبة من displacement فترة مضت
        const pastIndex = Math.max(0, highs.length - displacement);
        
        let pastTenkan, pastKijun, pastSenkouB;
        
        if (pastIndex >= periods.senkou) {
            const pastHighs = highs.slice(0, pastIndex);
            const pastLows = lows.slice(0, pastIndex);
            
            pastTenkan = this.calculateLine(pastHighs, pastLows, periods.tenkan);
            pastKijun = this.calculateLine(pastHighs, pastLows, periods.kijun);
            pastSenkouB = this.calculateLine(pastHighs, pastLows, periods.senkou);
        } else {
            // إذا لم تكن هناك بيانات كافية، استخدم القيم الحالية
            pastTenkan = currentTenkan;
            pastKijun = currentKijun;
            pastSenkouB = this.calculateLine(highs, lows, periods.senkou);
        }
        
        const actualSenkouA = (pastTenkan + pastKijun) / 2;
        const actualSenkouB = pastSenkouB;
        
        return {
            tenkanSen: currentTenkan,
            kijunSen: currentKijun,
            senkouSpanA: actualSenkouA,
            senkouSpanB: actualSenkouB,
            cloudTop: Math.max(actualSenkouA, actualSenkouB),
            cloudBottom: Math.min(actualSenkouA, actualSenkouB)
        };
    }

    // فترات إيشيموكو المصححة لكل فريم
    getIchimokuPeriods() {
        switch (this.currentTimeframe) {
            case '1d':
                return { 
                    tenkan: 9, 
                    kijun: 26, 
                    senkou: 52, 
                    displacement: 26 
                };
            case '4h':
                // للفريم 4 ساعات: نضرب في 6 (24÷4=6)
                return { 
                    tenkan: 9,      // نفس القيمة
                    kijun: 26,      // نفس القيمة  
                    senkou: 52,     // نفس القيمة
                    displacement: 26 // نفس القيمة
                };
            case '1h':
                // للفريم ساعة: نضرب في 24
                return { 
                    tenkan: 9,      // نفس القيمة
                    kijun: 26,      // نفس القيمة
                    senkou: 52,     // نفس القيمة  
                    displacement: 26 // نفس القيمة
                };
            default:
                return { tenkan: 9, kijun: 26, senkou: 52, displacement: 26 };
        }
    }

    calculateLine(highs, lows, period) {
        if (highs.length < period) return null;
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

    // فترات MACD المصححة
    getMACDPeriods() {
        switch (this.currentTimeframe) {
            case '1d':
                return { fast: 12, slow: 26, signal: 9 };
            case '4h':
                return { fast: 12, slow: 26, signal: 9 }; // نفس القيم
            case '1h':
                return { fast: 12, slow: 26, signal: 9 }; // نفس القيم
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
        const macdBullish = macd.bullishCrossover || (macd.macd > macd.signal && macd.histogram > 0);
        
        let status = '';
        let statusText = '';
        let meetsCriteria = false;
        let distanceToCloud = 0;
        let breakoutPotential = 0;
        
        // حساب المسافة إلى سقف السحابة الفعلي
        distanceToCloud = ((price - ichimoku.cloudTop) / ichimoku.cloudTop) * 100;
        
        // حساب إمكانية الاختراق (0-100)
        breakoutPotential = this.calculateBreakoutPotential(price, ichimoku, macd, obv, volume);
        
        // شروط مختلفة حسب الفريم الزمني
        const thresholds = this.getTimeframeThresholds();
        
        if (price > ichimoku.cloudTop) {
            // فوق السحابة - نتحقق من قوة الاختراق
            if (distanceToCloud <= thresholds.freshBreakout) {
                status = 'fresh-breakout';
                statusText = '🚀 اختراق حديث جداً';
                meetsCriteria = macdBullish && obvRising && highVolume;
            } else if (distanceToCloud <= thresholds.recentBreakout) {
                status = 'recent-breakout';
                statusText = '✅ اختراق حديث';
                meetsCriteria = macdBullish && obvRising && highVolume;
            } else {
                // اختراق قديم - لا نعرضه
                meetsCriteria = false;
            }
        } else if (price >= ichimoku.cloudBottom && price <= ichimoku.cloudTop) {
            // داخل السحابة
            const cloudPosition = ((price - ichimoku.cloudBottom) / (ichimoku.cloudTop - ichimoku.cloudBottom)) * 100;
            
            if (cloudPosition >= 70) {
                status = 'ready';
                statusText = '⚡ مهيأ للاختراق';
                meetsCriteria = macdBullish && obvRising && highVolume && price > ichimoku.kijunSen;
            } else if (cloudPosition >= 40) {
                status = 'in-cloud';
                statusText = '🌤️ داخل السحابة';
                meetsCriteria = macdBullish && obvRising && highVolume && breakoutPotential > 75;
            }
        } else {
            // تحت السحابة
            if (distanceToCloud >= thresholds.imminent) {
                status = 'imminent';
                statusText = '🎯 اختراق وشيك';
                meetsCriteria = macdBullish && obvRising && highVolume && 
                              price > ichimoku.tenkanSen && breakoutPotential > 80;
            } else if (distanceToCloud >= thresholds.approaching) {
                status = 'approaching';
                statusText = '📈 يقترب من السحابة';
                meetsCriteria = macdBullish && obvRising && highVolume && 
                              price > ichimoku.tenkanSen && breakoutPotential > 70;
            } else if (distanceToCloud >= thresholds.building) {
                status = 'building';
                statusText = '🔨 يبني قوة';
                meetsCriteria = macdBullish && obvRising && highVolume && breakoutPotential > 85;
            }
        }
        
        return {
            meetsCriteria,
            status,
            statusText,
            distanceToCloud,
            breakoutPotential,
            actualCloudTop: ichimoku.cloudTop,
            actualCloudBottom: ichimoku.cloudBottom
        };
    }

    // عتبات مختلفة لكل فريم زمني
    getTimeframeThresholds() {
        switch (this.currentTimeframe) {
            case '1d':
                return {
                    freshBreakout: 1,    // 1% للاختراق الحديث جداً
                    recentBreakout: 3,   // 3% للاختراق الحديث
                    imminent: -2,        // -2% للاختراق الوشيك
                    approaching: -5,     // -5% للاقتراب
                    building: -10        // -10% لبناء القوة
                };
            case '4h':
                return {
                    freshBreakout: 0.5,  // أقل للفريمات الأقصر
                    recentBreakout: 2,   
                    imminent: -1,        
                    approaching: -3,     
                    building: -7         
                };
            case '1h':
                return {
                    freshBreakout: 0.3,  // أقل بكثير للفريم الساعة
                    recentBreakout: 1,   
                    imminent: -0.5,      
                    approaching: -2,     
                    building: -5         
                };
            default:
                return {
                    freshBreakout: 1,
                    recentBreakout: 3,
                    imminent: -2,
                    approaching: -5,
                    building: -10
                };
        }
    }

    calculateBreakoutPotential(price, ichimoku, macd, obv, volume) {
        let potential = 0;
        
        // 1. موقع السعر بالنسبة للسحابة (35 نقطة)
        const distanceToCloud = ((price - ichimoku.cloudTop) / ichimoku.cloudTop) * 100;
        const thresholds = this.getTimeframeThresholds();
        
        if (distanceToCloud >= thresholds.imminent && distanceToCloud <= thresholds.freshBreakout) {
            potential += 35; // في المنطقة المثالية
        } else if (distanceToCloud >= thresholds.approaching && distanceToCloud < thresholds.imminent) {
            potential += 30; // قريب جداً
        } else if (distanceToCloud >= thresholds.building && distanceToCloud < thresholds.approaching) {
            potential += 25; // قريب
        } else if (distanceToCloud < thresholds.building) {
            potential += 15; // بعيد نسبياً
        } else if (distanceToCloud > thresholds.freshBreakout && distanceToCloud <= thresholds.recentBreakout) {
            potential += 25; // اختراق حديث
        } else if (distanceToCloud > thresholds.recentBreakout) {
            potential += 5; // اختراق قديم
        }
        
        // 2. قوة MACD (25 نقطة)
        if (macd.bullishCrossover) {
            potential += 25; // تقاطع صاعد حديث
        } else if (macd.macd > macd.signal && macd.histogram > 0) {
            potential += 20; // إشارة إيجابية قوية
        } else if (macd.histogram > 0) {
            potential += 15; // تحسن في الزخم
        } else if (macd.macd > macd.signal) {
            potential += 10; // إشارة إيجابية ضعيفة
        }
        
        // 3. اتجاه OBV (20 نقطة)
        const obvTrend = this.getOBVTrend(obv);
        if (obvTrend === 'strong-up') {
            potential += 20;
        } else if (obvTrend === 'up') {
            potential += 15;
        } else if (obvTrend === 'neutral') {
            potential += 8;
        } else {
            potential += 0;
        }
        
        // 4. الحجم (10 نقاط)
        const volumeThreshold = this.getVolumeThreshold();
        if (volume > volumeThreshold * 3) {
            potential += 10; // حجم استثنائي
        } else if (volume > volumeThreshold * 2) {
            potential += 8; // حجم عالي جداً
        } else if (volume > volumeThreshold) {
            potential += 6; // حجم عالي
        } else if (volume > volumeThreshold * 0.7) {
            potential += 4; // حجم متوسط
        }
        
        // 5. موقع السعر بالنسبة لخطوط إيشيموكو (10 نقاط)
        let ichimokuScore = 0;
        if (price > ichimoku.tenkanSen) ichimokuScore += 3;
        if (price > ichimoku.kijunSen) ichimokuScore += 4;
        if (ichimoku.tenkanSen > ichimoku.kijunSen) ichimokuScore += 3;
        potential += ichimokuScore;
        
        return Math.min(potential, 100);
    }

    getOBVTrend(obvArray) {
        if (obvArray.length < 5) return 'neutral';
        
        const recent = obvArray.slice(-5);
        let upCount = 0;
        let strongUp = 0;
        
        for (let i = 1; i < recent.length; i++) {
            if (recent[i] > recent[i - 1]) {
                upCount++;
                if (recent[i] > recent[i - 1] * 1.02) strongUp++; // زيادة أكثر من 2%
            }
        }
        
        if (upCount >= 4 && strongUp >= 2) return 'strong-up';
        if (upCount >= 3) return 'up';
        if (upCount >= 2) return 'neutral';
        return 'down';
    }

    // عتبات الحجم المختلفة لكل فريم
    getVolumeThreshold() {
        switch (this.currentTimeframe) {
            case '1d': return 1000000;   // حجم يومي
            case '4h': return 800000;    // حجم 4 ساعات (أقل من اليومي)
            case '1h': return 500000;    // حجم ساعة (أقل بكثير)
            default: return 1000000;
        }
    }

    displayResults() {
        const container = document.getElementById('cardsContainer');
        
        if (this.filteredCoins.length === 0) {
            container.innerHTML = '<div class="loading">لم يتم العثور على عملات تحقق الشروط</div>';
            return;
        }

        // ترتيب حسب إمكانية الاختراق والحالة
        this.filteredCoins.sort((a, b) => {
            // أولوية للعملات الوشيكة الاختراق
            const priorityOrder = {
                'imminent': 5,
                'ready': 4,
                'fresh-breakout': 3,
                'recent-breakout': 2,
                'approaching': 1,
                'building': 0
            };
            
            const aPriority = priorityOrder[a.status] || 0;
            const bPriority = priorityOrder[b.status] || 0;
            
            if (aPriority !== bPriority) {
                return bPriority - aPriority;
            }
            
            return b.breakoutPotential - a.breakoutPotential;
        });
        
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

        const getDistanceColor = (distance) => {
            const thresholds = this.getTimeframeThresholds();
            
            if (distance > thresholds.recentBreakout) return 'old-breakout'; // اختراق قديم
            if (distance > 0) return 'positive'; // فوق السحابة
            if (distance >= thresholds.imminent) return 'warning'; // قريب جداً
            if (distance >= thresholds.approaching) return 'approaching'; // يقترب
            return 'negative'; // بعيد
        };

        const getPotentialColor = (potential) => {
            if (potential >= 85) return 'excellent';
            if (potential >= 70) return 'good';
            if (potential >= 50) return 'fair';
            return 'poor';
        };

        return `
            <div class="crypto-card">
                <div class="timeframe-badge">${coin.timeframeName}</div>
                <div class="potential-badge ${getPotentialColor(coin.breakoutPotential)}">
                    ${coin.breakoutPotential.toFixed(0)}%
                </div>
                
                <div class="card-header">
                    <div class="symbol">${coin.symbol}/USDT</div>
                    <div class="price">$${formatNumber(coin.price, 4)}</div>
                </div>
                
                <div class="status-badge ${coin.status}">
                    ${coin.statusText}
                </div>
                
                <div class="distance-info">
                    <div class="distance-label">المسافة إلى سقف السحابة:</div>
                    <div class="distance-value ${getDistanceColor(coin.distanceToCloud)}">
                        ${coin.distanceToCloud > 0 ? '+' : ''}${coin.distanceToCloud.toFixed(3)}%
                    </div>
                </div>
                
                <div class="cloud-info">
                    <h4>🌤️ السحابة الفعلية (مع الإزاحة)</h4>
                    <div class="cloud-bounds">
                        <div class="bound">
                            <div class="bound-label">سقف السحابة الفعلي</div>
                            <div class="bound-value">$${formatNumber(coin.actualCloudTop, 4)}</div>
                        </div>
                        <div class="bound">
                            <div class="bound-label">قاع السحابة الفعلي</div>
                            <div class="bound-value">$${formatNumber(coin.actualCloudBottom, 4)}</div>
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
                
                <div class="timeframe-specific-info">
                    <div class="info-item">
                        <span class="info-label">دقة الفريم:</span>
                        <span class="info-value ${this.getFrameAccuracyClass()}">${this.getFrameAccuracyText()}</span>
                    </div>
                </div>
            </div>
        `;
    }

    getFrameAccuracyClass() {
        switch (this.currentTimeframe) {
            case '1d': return 'high-accuracy';
            case '4h': return 'medium-accuracy';
            case '1h': return 'low-accuracy';
            default: return 'medium-accuracy';
        }
    }

    getFrameAccuracyText() {
        switch (this.currentTimeframe) {
            case '1d': return '🎯 دقة عالية';
            case '4h': return '⚡ دقة متوسطة';
            case '1h': return '⚠️ دقة منخفضة - للمتابعة السريعة';
            default: return 'متوسط';
        }
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// تشغيل التطبيق
document.addEventListener('DOMContentLoaded', () => {
    new IchimokuScanner();
});
