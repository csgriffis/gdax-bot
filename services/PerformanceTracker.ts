export class PerformanceTracker {
    private alpha: number;
    private beta: number;
    private Sharpe: number;

    constructor() {}

    get alpha(): number {
        return this.alpha;
    }

    get beta(): number {
        return this.beta;
    }

    get Sharpe(): number {
        return this.Sharpe;
    }
}