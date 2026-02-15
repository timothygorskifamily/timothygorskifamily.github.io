/**
 * GSI Strategy Calculator (Shared Logic)
 * Used by: index.html (Simple Simulator) and psa.html (Advanced Analyzer)
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
    // Intrinsic Value at Expiration
    if (T <= 0.001) return Math.max(0, S - K);
    
    const d1 = (Math.log(S / K) + (0.5 * v * v) * T) / (v * Math.sqrt(T));
    const d2 = d1 - v * Math.sqrt(T);
    return Math.exp(-r * T) * (S * normalCDF(d1) - K * normalCDF(d2));
}

// --- Main Calculation Function ---
function calculateGSIProjection(inputs) {
    const {
        investment,         
        currentSpot,        
        spxPriceReturn,     
        spxDivYield,        
        creditYield,        
        volatility,         
        mgmtFee,            
        carryFee,           
        riskFreeRate,       
        years               
    } = inputs;

    // 1. Setup Scaling Ratio
    const ratio = investment / MASTER_COST_BASIS;
    
    // 2. Initial Unit Values
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

    // 3. Prepare Loop Variables
    const gPrice = spxPriceReturn / 100;
    const gTotal = (spxPriceReturn + spxDivYield) / 100; 
    const gCredit = creditYield / 100;
    const vol = volatility / 100;
    const r = riskFreeRate / 100;
    const mFee = mgmtFee / 100;
    const cFee = carryFee / 100;

    // Data Series Output
    const results = {
        labels: [],
        gsi: [initialNAV],
        credit: [uValCredit],
        options: [uValOpt],
        static: [], 
        spx: [investment],
        pe: [investment],
        bonds: [investment]
    };
    
    // Initial Intrinsic calculation
    const initIntrinsic = Math.max(0, currentSpot - weightedStrike) * uQuantityOpt;
    results.static.push(initIntrinsic);
    
    // Date Setup
    const startDate = new Date();

    // 4. Projection Loop (Quarterly)
    const steps = years * 4;
    
    for (let q = 1; q <= steps; q++) {
        const t = q * 0.25; 
        
        // Generate Date Label (e.g., "Feb 26")
        const d = new Date(startDate);
        d.setMonth(d.getMonth() + (q * 3));
        const dateLabel = d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
        
        // --- A. GSI Calculation ---
        const S_fut = currentSpot * Math.pow(1 + gPrice, t); 
        
        // Credit Growth
        let valCreditGross = uValCredit * Math.pow(1 + gCredit, t);
        
        // Option Re-pricing
        // At the final step, force T_rem to 0 to ensure convergence
        let T_rem = Math.max(0, years - t);
        
        // Calculate Raw Option Value (Gross)
        // If it's the last step, bsPrice automatically handles T=0 as Intrinsic
        const optPrice = bsPrice(S_fut, weightedStrike, T_rem, r, vol);
        let valOptGross = optPrice * uQuantityOpt;
        
        // Calculate Intrinsic Value (Static) for comparison
        // This is purely Max(0, S-K). 
        const valIntrinsic = Math.max(0, S_fut - weightedStrike) * uQuantityOpt;

        // Apply Fees to Components
        // Note: For visualization of "Convergence", if we want Option Value to meet Intrinsic
        // we generally compare Gross to Gross. But the chart shows the Portfolio Value (Net).
        // To make the "Option Component" line meet the "Intrinsic" line on the chart,
        // we apply the same fee drag to the Intrinsic line purely for visualization purposes
        // in the PSA chart.
        
        const mgmtDrag = Math.pow(1 - mFee, t);
        
        let finalCredit = valCreditGross * mgmtDrag;
        let finalOpt = valOptGross * mgmtDrag;
        
        // Apply Drag to Intrinsic for visual convergence in Net Chart
        let finalIntrinsic = valIntrinsic * mgmtDrag;

        let finalPort = finalCredit + finalOpt;

        // Apply Carry
        const profit = finalPort - investment;
        if (profit > 0) {
            const carryAmt = profit * cFee;
            finalPort -= carryAmt;
            
            // Pro-rate carry deduction
            const creditShare = finalCredit / (finalCredit + finalOpt);
            finalCredit -= (carryAmt * creditShare);
            
            // Deduct carry from Option & Intrinsic lines so they still meet
            const optShare = 1 - creditShare;
            finalOpt -= (carryAmt * optShare);
            finalIntrinsic -= (carryAmt * optShare);
        }

        results.gsi.push(finalPort);
        results.credit.push(finalCredit);
        results.options.push(finalOpt);
        results.static.push(finalIntrinsic); // Now carries same fee load for visual match

        // --- B. Benchmark Calculations ---
        const spxNetGrowth = gTotal - 0.0003; 
        const valSPX = investment * Math.pow(1 + spxNetGrowth, t);
        results.spx.push(valSPX);

        // PE (Proxy)
        const peBeta = 1.2;
        const peMgmt = 0.015;
        const peCarry = 0.20;
        const peGrossRate = (spxNetGrowth * peBeta); 
        const peNetRatePreCarry = peGrossRate - peMgmt;
        let valPE = investment * Math.pow(1 + peNetRatePreCarry, t);
        const peProfit = valPE - investment;
        if (peProfit > 0) valPE -= (peProfit * peCarry);
        results.pe.push(valPE);

        // Bonds
        const bondRate = 0.062;
        const valBond = investment * Math.pow(1 + bondRate, t);
        results.bonds.push(valBond);
        
        results.labels.push(dateLabel);
    }

    // 5. Metrics
    const finalVal = results.gsi[results.gsi.length - 1];
    const totalReturn = finalVal / investment;
    const irr = (Math.pow(totalReturn, 1/years) - 1) * 100;
    
    // SPX Metrics
    const finalSPX = results.spx[results.spx.length - 1];
    const spxTotalReturn = finalSPX / investment;
    const spxIrr = (Math.pow(spxTotalReturn, 1/years) - 1) * 100;

    return {
        series: results,
        metrics: {
            initialNotional: initialNotional,
            finalValue: finalVal,
            moic: totalReturn,
            irr: irr,
            spxFinal: finalSPX,
            spxMoic: spxTotalReturn,
            spxIrr: spxIrr
        }
    };
}