/**
 * GSI Strategy Calculator (Shared Logic)
 * Used by: index.html (Simple Simulator), historical.html (Backtester), and psa.html (Advanced Analyzer)
 */

// --- Constants & Demo Data Structure ---
const GSI_DEMO_PORTFOLIO = [
    { Type: 'Credit', CostBasis: 3489323.60, CurrentValue: 3489323.60, Strike: null, Quantity: null, ExpirationDate: null },
    { Type: 'Option', CostBasis: 3799992.87, CurrentValue: 3126483.16, Strike: 563.22, Quantity: 33871, ExpirationDate: '2036-01-15' }
];

const MASTER_COST_BASIS = 7289316.47; 

// --- Black-Scholes Model ---
function normalCDF(z) {
    const b1 = 0.319381530, b2 = -0.356563782, b3 = 1.781477937, b4 = -1.821255978, b5 = 1.330274429;
    const p = 0.2316419, c = 0.39894228;
    if (z > 6.0) return 1.0;
    if (z < -6.0) return 0.0;
    const a = Math.abs(z);
    const t = 1.0 / (1.0 + a * p);
    const b = c * Math.exp((-z * z) / 2.0);
    let n = ((((b5 * t + b4) * t + b3) * t + b2) * t + b1) * t;
    n = 1.0 - b * n;
    return z < 0.0 ? 1.0 - n : n;
}

function bsPrice(S, K, T, r, v) {
    if (T <= 0.001) return Math.max(0, S - K);
    const d1 = (Math.log(S / K) + (0.5 * v * v) * T) / (v * Math.sqrt(T));
    const d2 = d1 - v * Math.sqrt(T);
    return Math.exp(-r * T) * (S * normalCDF(d1) - K * normalCDF(d2));
}

// --- Main Calculation Function ---
function calculateGSIProjection(inputs) {
    const investment = inputs.investment;         
    const currentSpot = inputs.currentSpot;        
    const indexPriceReturn = inputs.indexPriceReturn !== undefined ? inputs.indexPriceReturn : inputs.spxPriceReturn;     
    const indexDivYield = inputs.indexDivYield !== undefined ? inputs.indexDivYield : inputs.spxDivYield;        
    
    // Dynamic SOFR & Credit Yield Integration
    const sofr = inputs.sofr !== undefined ? inputs.sofr : (inputs.riskFreeRate !== undefined ? inputs.riskFreeRate : 4.0);
    const creditYield = inputs.creditYield !== undefined ? inputs.creditYield : (sofr + 6.0);
    
    const volatility = inputs.volatility;         
    const mgmtFee = inputs.mgmtFee;            
    const carryFee = inputs.carryFee;           
    const years = inputs.years;               

    const ratio = investment / MASTER_COST_BASIS;
    
    let uValCredit = 0;
    let uValOpt = 0;
    let uQuantityOpt = 0;
    let weightedStrike = 0;

    GSI_DEMO_PORTFOLIO.forEach(row => {
        if (row.Type === 'Credit') {
            uValCredit += row.CurrentValue * ratio;
        } else if (row.Type === 'Option') {
            uValOpt += row.CurrentValue * ratio;
            uQuantityOpt += row.Quantity * ratio;
            weightedStrike = row.Strike; 
        }
    });

    const initialNAV = uValCredit + uValOpt;
    const initialNotional = uValCredit + (uQuantityOpt * currentSpot);

    const gPrice = indexPriceReturn / 100;
    const gSpxFp = (indexPriceReturn - sofr) / 100; // SPXFP is dragged by SOFR
    const gTotal = (indexPriceReturn + indexDivYield) / 100; 
    const gCredit = creditYield / 100;
    const vol = volatility / 100;
    const r = sofr / 100;
    const mFee = mgmtFee / 100;
    const cFee = carryFee / 100;

    const results = {
        labels: [],
        gsi: [initialNAV],
        credit: [uValCredit],
        options: [uValOpt],
        static: [], 
        index: [investment], 
        spx: [investment],   
        pe: [investment],
        bonds: [investment]
    };
    
    const initIntrinsic = Math.max(0, currentSpot - weightedStrike) * uQuantityOpt;
    results.static.push(initIntrinsic);
    
    const startDate = new Date();
    const steps = years * 4;
    
    for (let q = 1; q <= steps; q++) {
        const t = q * 0.25; 
        
        const d = new Date(startDate);
        d.setMonth(d.getMonth() + (q * 3));
        const dateLabel = d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
        
        // --- A. GSI Calculation ---
        let valCreditGross = uValCredit * Math.pow(1 + gCredit, t);
        
        // Option Re-pricing against the Forward Price (SPXFP)
        const S_fut_fp = currentSpot * Math.pow(1 + gSpxFp, t); 
        let T_rem = Math.max(0, years - t);
        const optPrice = bsPrice(S_fut_fp, weightedStrike, T_rem, r, vol);
        let valOptGross = optPrice * uQuantityOpt;
        
        const valIntrinsic = Math.max(0, S_fut_fp - weightedStrike) * uQuantityOpt;

        const mgmtDrag = Math.pow(1 - mFee, t);
        let finalCredit = valCreditGross * mgmtDrag;
        let finalOpt = valOptGross * mgmtDrag;
        let finalIntrinsic = valIntrinsic * mgmtDrag;

        let finalPort = finalCredit + finalOpt;

        // Apply Carry
        const profit = finalPort - investment;
        if (profit > 0) {
            const carryAmt = profit * cFee;
            finalPort -= carryAmt;
            const creditShare = finalCredit / (finalCredit + finalOpt);
            finalCredit -= (carryAmt * creditShare);
            const optShare = 1 - creditShare;
            finalOpt -= (carryAmt * optShare);
            finalIntrinsic -= (carryAmt * optShare);
        }

        results.gsi.push(finalPort);
        results.credit.push(finalCredit);
        results.options.push(finalOpt);
        results.static.push(finalIntrinsic); 

        // --- B. Benchmark Calculations ---
        const indexNetGrowth = gTotal - 0.0003; 
        const valIndex = investment * Math.pow(1 + indexNetGrowth, t);
        results.index.push(valIndex);
        results.spx.push(valIndex); 

        const peBeta = 1.2;
        const peMgmt = 0.015;
        const peCarry = 0.20;
        const peGrossRate = (indexNetGrowth * peBeta); 
        const peNetRatePreCarry = peGrossRate - peMgmt;
        let valPE = investment * Math.pow(1 + peNetRatePreCarry, t);
        const peProfit = valPE - investment;
        if (peProfit > 0) valPE -= (peProfit * peCarry);
        results.pe.push(valPE);

        const bondRate = 0.062;
        const valBond = investment * Math.pow(1 + bondRate, t);
        results.bonds.push(valBond);
        
        results.labels.push(dateLabel);
    }

    const finalVal = results.gsi[results.gsi.length - 1];
    const totalReturn = finalVal / investment;
    const irr = (Math.pow(totalReturn, 1/years) - 1) * 100;
    
    const finalIndex = results.index[results.index.length - 1];
    const indexTotalReturn = finalIndex / investment;
    const indexIrr = (Math.pow(indexTotalReturn, 1/years) - 1) * 100;

    return {
        series: results,
        metrics: {
            initialNotional: initialNotional,
            finalValue: finalVal,
            moic: totalReturn,
            irr: irr,
            indexFinal: finalIndex,
            indexMoic: indexTotalReturn,
            indexIrr: indexIrr,
            spxFinal: finalIndex, 
            spxMoic: indexTotalReturn,
            spxIrr: indexIrr
        }
    };
}