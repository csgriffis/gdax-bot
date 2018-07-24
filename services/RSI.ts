import {Series} from 'pandas-js';

export interface RSIConfig {
    periods: number;
}

export class RSI {
    private readonly periods: number;
    private _avgGain: number;
    private _avgLoss: number;

    constructor(config: RSIConfig) {
        this.periods = config.periods;
        this._avgGain = 0;
        this._avgLoss = 0;
    }

    /**
     *
     * @param {number[]} dataSeries array of prices
     * @returns {number[]} array of RSI values
     */
    initSignal(dataSeries: number[]) {
        let gain = 0;
        let loss = 0;

        const ds: Series = new Series(dataSeries);
        const diffs: Series = ds.diff();

        diffs.slice(0, this.periods).map((entry: number) => {
            if (entry > 0) {
                gain += entry;
            } else if (entry < 0) {
                loss += entry;
            }
        });

        this._avgGain = gain / this.periods;
        this._avgLoss = loss / this.periods;

        return diffs.slice(this.periods, diffs.length).map((diffPrice: number) => {
            return this.calculate(diffPrice);
        });
    }

    /**
     *
     * @param {number} diffPrice
     * @returns {number} RSI
     */
    calculate(diffPrice: number) {
        let gain = this._avgGain * (this.periods - 1);
        let loss = this._avgLoss * (this.periods - 1);

        if (diffPrice > 0) {
            gain += diffPrice;
        } else if (diffPrice < 0) {
            loss += diffPrice;
        }

        this._avgGain = gain / this.periods;
        this._avgLoss = loss / this.periods;

        return 100 - (100 / (1 + (this._avgGain / this._avgLoss)));
    }
}