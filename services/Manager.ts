import {Logger} from "gdax-trading-toolkit/build/src/utils";
import {GDAXExchangeAPI} from "gdax-trading-toolkit/build/src/exchanges";
import {AvailableBalance, Balances} from "gdax-trading-toolkit/build/src/exchanges/AuthenticatedExchangeAPI";
import {HTTPError} from "gdax-trading-toolkit/build/src/lib/errors";

export interface ManagerConfig {
    logger: Logger;
    api: GDAXExchangeAPI;
    riskTolerance: number;
}

export class Manager {
    private readonly api: GDAXExchangeAPI;
    private readonly _riskTolerance: number;
    private logger: Logger;
    private _previousPosition: number;
    private _canShort: boolean;
    private _position: number; // 1 (long) or 0 (out) - strategy does not take short position
    private _cumLosses: number;
    private _accounts: Balances;
    private _openOrderPrice: number;
    private _openOrderSize: number;
    private _remainingOrderSize: number;
    private _activeApiRequest: boolean;

    constructor(config: ManagerConfig) {
        this.logger = config.logger;
        this.api = config.api;
        this._riskTolerance = config.riskTolerance;

        // -- SET DEFAULTS
        this._previousPosition = 0;
        this._position = 0;
        this._cumLosses = 0;
        this._canShort = false;
        this._activeApiRequest = false;

        this.logger.log('info', `[Manager] Risk tolerance: ${this._riskTolerance * 100}%`);

        // -- GET BALANCES
        this.updateBalances()
            .then(() => {
                if (this.getBalance('BTC') >= this.getBalance('USD')) {
                    this._canShort = true;
                }
            })
            .catch((error: HTTPError) => {
                this.logger.log('error', `${error}`);

                // can not load balances - close app
                this.logger.log('error', '[Manager] Exiting app due to error retrieving balances');
                process.exit(1);
            });
    }

    get position(): number {
        return this._position;
    }

    set position(pos: number) {
        this.previousPosition = this.position;
        this._position = pos;
    }

    get previousPosition(): number {
        return this._previousPosition;
    }

    set previousPosition(pos: number) {
        this._previousPosition = pos;
    }

    get remainingOrderSize(): number {
        return this._remainingOrderSize;
    }

    set remainingOrderSize(remainingOrderSize: number) {
        this._remainingOrderSize = remainingOrderSize;
    }

    get openOrderPrice(): number {
        return this._openOrderPrice;
    }

    set openOrderPrice(price: number) {
        this._openOrderPrice = price;
    }

    get openOrderSize(): number {
        return this._openOrderPrice;
    }

    set openOrderSize(size: number) {
        this._openOrderSize = size;
    }

    get cumulativeProfit(): number {
        return this._cumLosses;
    }

    get risk(): number {
        return this._riskTolerance;
    }

    get activeRequest(): boolean {
        return this._activeApiRequest;
    }

    set activeRequest(isActive: boolean) {
        this._activeApiRequest = isActive;
    }

    get canShort(): boolean {
        return this._canShort;
    }

    rollbackPosition(): void {
        this.position = this.previousPosition;
    }

    calculateLoss(closingPrice: number): number {
        let priceDiff = closingPrice - this.openOrderPrice;
        let size = this.openOrderSize;

        if (this.remainingOrderSize > 0) {
            size -= this.remainingOrderSize;
        }

        let profit = size * priceDiff;

        this._cumLosses += profit;

        this.logger.log('info', `[Manager] Trade Profit: ${profit}`);
        this.logger.log('info', `[Manager] Running Profit: ${this._cumLosses}`);

        return this._cumLosses
    }

    closePosition(): void {
        this.position = 0;
        this.openOrderPrice = 0;
        this.openOrderSize = 0;
        this.remainingOrderSize = 0;

        this.updateBalances();
    }

    printAllBalances(): void {
        this.logger.log('info', '[Manager] --------- Balances ---------');

        for (let profile in this._accounts) {
            for (let cur in this._accounts[profile]) {
                if (this._accounts[profile][cur].balance.toNumber() !== 0) {
                    this.logger.log('info', `[Manager] ${cur}: ${this._accounts[profile][cur].balance.toNumber()}`);
                }
            }
        }
    }

    getBalance(currency: string): number {
        let balance: AvailableBalance = this.getProfile(currency);

        if (!balance) {
            this.logger.log('error', `[Manager] Unable to load balances for ${currency}`);
            process.exit(1);
        }

        return balance.balance.toNumber();
    }

    private getProfile(currency: string): AvailableBalance {
        let balance: AvailableBalance;

        for (let profile in this._accounts) {
            for (let cur in this._accounts[profile]) {
                if (currency === cur && this._accounts[profile].hasOwnProperty(cur)) {
                    balance = this._accounts[profile][cur];
                }
            }
        }

        return balance;
    }

    private updateBalances(): Promise<void> {
        this.activeRequest = true;

        return this.api.loadBalances()
            .then((balances: Balances) => {
                this._accounts = balances;

                this.printAllBalances();

                this.activeRequest = false;
            }).catch((err: Error) => {
                this.activeRequest = false;
                this.logger.error(err);
            })
    }
}