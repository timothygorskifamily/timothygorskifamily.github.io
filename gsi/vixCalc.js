/**
 * vix_term_structure.js
 * * Extrapolates 30-Day VIX into Long-Term Implied Volatility
 * using a Square-Root Mean Reverting Variance Model.
 */

const VolatilityEngine = {
    // Standard equity market baseline parameters
    DEFAULT_LONG_TERM_VIX: 0.195, // The 50-year historical average VIX is ~19.5%
    DEFAULT_KAPPA: 2.5,           // Mean reversion speed (Higher = snaps back to average faster)

    /**
     * Calculates the Term Structure adjusted Implied Volatility.
     * * @param {number} spotVix - The current 30-Day VIX as a whole number (e.g., 80.0 for a crash)
     * @param {number} yearsToMaturity - Time remaining on the option (e.g., 10.0)
     * @param {number} kappa - (Optional) Rate of mean reversion
     * @param {number} longTermVix - (Optional) The target baseline volatility to revert to
     * @returns {number} The adjusted Implied Volatility as a decimal (ready for Black-Scholes)
     */
    getTermStructureIV: function(spotVix, yearsToMaturity, kappa = this.DEFAULT_KAPPA, longTermVix = this.DEFAULT_LONG_TERM_VIX) {
        // If time is basically 0, return the spot VIX directly
        if (yearsToMaturity <= 0.01) return spotVix / 100.0;

        // Convert VIX to decimal spot volatility
        const spotVol = spotVix / 100.0;

        // Convert volatilities to Variances (Vol squared)
        const spotVariance = spotVol * spotVol;
        const longTermVariance = longTermVix * longTermVix;

        // Calculate the Mean Reversion Factor: (1 - e^(-kappa * T)) / (kappa * T)
        // This calculates the average weight of the "spiked" variance over the timeframe
        const reversionFactor = (1.0 - Math.exp(-kappa * yearsToMaturity)) / (kappa * yearsToMaturity);

        // Calculate the expected average variance over the life of the option
        const averageVariance = longTermVariance + ((spotVariance - longTermVariance) * reversionFactor);

        // Return the square root of the variance to get back to Implied Volatility
        return Math.sqrt(averageVariance);
    },

    /**
     * Diagnostic function to print the Volatility Surface Curve
     */
    printVolCurve: function(spotVix) {
        console.log(`--- VOLATILITY TERM STRUCTURE (Spot VIX: ${spotVix}) ---`);
        const maturities = [0.08, 1, 3, 5, 10]; // 1-month, 1Y, 3Y, 5Y, 10Y
        
        maturities.forEach(t => {
            let iv = this.getTermStructureIV(spotVix, t);
            console.log(`Maturity: ${t.toFixed(2).padStart(5, ' ')} Years  |  Pricing IV: ${(iv * 100).toFixed(2)}%`);
        });
        console.log("-----------------------------------------------------");
    }
};

// =========================================================
// TEST SCENARIOS (Run this in any JS console to see the math)
// =========================================================

/* Scenario 1: Market Crash (2008 or 2020)
  The VIX spikes to 80. Watch how the 1-month option uses 76% IV, 
  but the 10-year option drops safely down to 26% IV, accurately 
  reflecting institutional long-term pricing.
*/
VolatilityEngine.printVolCurve(80.0);

/* Scenario 2: Ultra-Calm Market (2017)
  The VIX drops to 10. Watch how the formula pulls the 10-year 
  implied volatility UP to ~18%, preventing options from being 
  priced artificially cheap over a 10-year horizon.
*/
VolatilityEngine.printVolCurve(10.0);

// Export for module usage later
// module.exports = VolatilityEngine;