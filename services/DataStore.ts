import {fill, isNull, toNumber} from 'lodash';
import {Logger} from "gdax-trading-toolkit/build/src/utils";
import {LiveOrderbook,} from "gdax-trading-toolkit/build/src/core";
import {Snapshot} from "../lib/Snapshot";
import {Writable} from "stream";
import {LinearStrategy} from "./LinearStrategy";

export interface DataStoreConfig {
    logger: Logger;
    orderBook: LiveOrderbook;
    strategy: LinearStrategy;
    recordSize: number;
    delay: number;
    lags: number;
}

export interface LinearData {
    VOI: number[];
    OIR: number[];
    MPB: number[];
    dMid: number[];
}

export interface LinearModel {
    b: number;
    OIR_coeff: number;
    VOI_coeff: number;
    MPB_coeff: number;
}

export class DataStore extends Writable {
    public readonly recordSize: number;
    private readonly logger: Logger;
    private readonly orderBook: LiveOrderbook;
    private readonly strategy: LinearStrategy;
    private readonly delay: number;
    private readonly lags: number;
    private records: Snapshot[];
    private _linearModel: LinearModel | null;
    private _processStarted: boolean;
    private _msgCount: number;
    private _turnover: number;
    private _volume: number;

    constructor(config: DataStoreConfig) {
        super({objectMode: true});
        this.logger = config.logger;
        this.orderBook = config.orderBook;
        this.strategy = config.strategy;
        this.recordSize = config.recordSize;
        this.delay = config.delay;
        this.lags = config.lags;

        this._msgCount = 0;
        this.records = [];

        this._turnover = 0;
        this._volume = 0;

        this._processStarted = false;
        this._linearModel = null;
    }

    get lastRecord(): Snapshot {
        return this.records[this.records.length - 1];
    }

    buildSnapshot(): Snapshot {
        let snapshot = {} as Snapshot;

        let bestBid = this.orderBook.book.highestBid;
        let bestAsk = this.orderBook.book.lowestAsk;

        // SET VALUES FROM ORDER BOOK
        snapshot.bid = bestBid.price.toNumber();
        snapshot.ask = bestAsk.price.toNumber();

        snapshot.spread = snapshot.ask - snapshot.bid;
        snapshot.midPrice = (snapshot.ask + snapshot.bid) / 2;

        snapshot.bidVolume = bestBid.totalSize.toNumber();
        snapshot.askVolume = bestAsk.totalSize.toNumber();

        snapshot.volume = this._volume;
        snapshot.turnover = this._turnover;

        // -- RUN CALCULATIONS
        this._setDPrice(snapshot);
        this._setCV(snapshot);
        this._setDVol(snapshot);
        this._setDTO(snapshot);
        this._setAvgTrade(snapshot);
        this._setMPB(snapshot);
        this._setOIR(snapshot);
        this._setVOI(snapshot);

        while (this.records.length > this.recordSize) {
            this.records.shift();
        }

        this.records.push(snapshot);

        return snapshot;
    }

    buildLinearData(): LinearData {
        let VOI: number[] = [];
        let OIR: number[] = [];
        let MPB: number[] = [];
        let dMid: number[] = [];

        if (this.records.length === this.recordSize) {
            if (this.delay > 0) {
                dMid = this._rollingMeanMinusCurrentMidPrice()
                    .concat(fill(Array(this.delay), 0))
                    .slice(this.lags, this.recordSize - this.delay);
            } else {
                dMid = fill(Array(0), this.recordSize);
            }

            if (this.lags > 0) {
                [VOI, MPB, OIR] = ['VOI', 'MPB', 'OIR'].map((param: string) => {
                    return fill(Array(this.lags), 0)
                        .concat(this.records.map((snapshot: Snapshot) => {
                            return snapshot[param];
                        })
                            .slice(this.lags, this.recordSize - this.lags))
                        .slice(this.lags, this.recordSize - this.delay);
                });
            } else {
                [VOI, MPB, OIR] = ['VOI', 'MPB', 'OIR'].map((param: string) => {
                    return this.records.map((snapshot: Snapshot) => {
                        return snapshot[param];
                    });
                });
            }
        }

        return {
            VOI: VOI,
            OIR: OIR,
            MPB: MPB,
            dMid: dMid
        }
    }

    buildLinearModel(data: LinearData): LinearModel {
        this.logger.log('info', '[DataStore] Building new Model...');

        return this._linearRegression(data);
    }

    _write(msg: any, encoding: string, callback: (err?: Error) => any): void {
        let price = toNumber(msg.price);
        let size = toNumber(msg.size);

        if (this._msgCount === this.recordSize) {
            this._msgCount = 0;

            this.logger.log('debug', 'msgCount = recordSize, calling buildLinearData and model');

            //let linearData = this.buildLinearData();
            //this._linearModel = this.buildLinearModel(linearData);
        }

        if (this._msgCount === 0) {
            this._turnover = price * size;
            this._volume = size;
        } else {
            this._turnover += price * size;
            this._volume += size;
        }

        this._msgCount++;

        if (!this._processStarted) {
            this.startSnapshotProcess();
        }

        callback();
    }

// -- PRIVATE METHODS
    private startSnapshotProcess(): void {
        this._processStarted = true;

        // create new snapshot every 500ms
        setInterval(() => {
            let snap = this.buildSnapshot();

            this.strategy.saveVOI(snap);
        }, 500);
    }

    private _setDPrice(snapshot: Snapshot): void {
        let length = this.records.length;

        if (this.records[length - 2]) {
            snapshot.dBid = snapshot.bid - this.records[length - 2].bid;
            snapshot.dAsk = snapshot.ask - this.records[length - 2].ask;
        } else {
            snapshot.dBid = 0;
            snapshot.dAsk = 0;
        }
    }

    private _setCV(snapshot: Snapshot): void {
        let length = this.records.length;

        if (this.records[length - 2]) {
            snapshot.bidCV = snapshot.bidVolume - (snapshot.dBid === 0 ?
                this.records[length - 2].bidVolume
                : 0) * toNumber(snapshot.dBid >= 0);
            snapshot.askCV = snapshot.askVolume - (snapshot.dAsk === 0 ?
                this.records[length - 2].askVolume
                : 0) * toNumber(snapshot.dAsk <= 0);
        } else {
            snapshot.bidCV = 0;
            snapshot.askCV = 0;
        }
    }

    private _setDVol(snapshot: Snapshot): void {
        let length = this.records.length;

        if (this.records[length - 2]) {
            let current = snapshot.volume - this.records[length - 2].volume > 0 ?
                snapshot.volume - this.records[length - 2].volume
                : null;

            snapshot.dVol = isNull(current) ? this.records[length - 2].dVol : current;
        } else {
            snapshot.dVol = 0;
        }
    }

    private _setDTO(snapshot: Snapshot): void {
        let length = this.records.length;

        if (this.records[length - 2]) {
            let current = snapshot.turnover - this.records[length - 2].turnover > 0
                ? snapshot.turnover - this.records[length - 2].turnover
                : null;

            snapshot.dTO = isNull(current) ? this.records[length - 2].dTO : current;
        } else {
            snapshot.dTO = 0;
        }
    }

    private _setAvgTrade(snapshot: Snapshot): void {
        let length = this.records.length;

        if (this.records[length - 2]) {
            snapshot.avgTrade = this.records[length - 2].volume !== snapshot.volume
                ? snapshot.dTO / snapshot.dVol / 300
                : this.records[length - 2].avgTrade;
        } else {
            snapshot.avgTrade = snapshot.midPrice;
        }
    }

    private _setMPB(snapshot: Snapshot): void {
        let length = this.records.length;

        if (this.records[length - 2]) {
            snapshot.MPB = (snapshot.avgTrade - (snapshot.midPrice + this.records[length - 2].midPrice) / 2)
                / snapshot.spread;
        } else {
            snapshot.MPB = (snapshot.avgTrade - snapshot.midPrice) / snapshot.spread;
        }
    }

    private _setOIR(snapshot: Snapshot): void {
        snapshot.OIR = ((snapshot.bidVolume - snapshot.askVolume) / (snapshot.bidVolume + snapshot.askVolume)) / snapshot.spread;
    }

    private _setVOI(snapshot: Snapshot): void {
        snapshot.VOI = (snapshot.bidCV - snapshot.askCV);
    }

    private _rollingMeanMinusCurrentMidPrice(): number[] {
        let current: any;
        let lastValid: number;

        return this.records.map((snapshot: Snapshot, key: number, col: Snapshot[]) => {
            if (key + this.delay < col.length) {
                current = (col.slice(key, key + this.delay).reduce((acc, obj) => {
                    return acc += toNumber(obj.midPrice);
                }, 0) / this.delay) - toNumber(snapshot.midPrice);

                if (isFinite(current)) {
                    lastValid = current
                }
            }

            return lastValid;
        });
    }

    private _linearRegression(data: LinearData): LinearModel {
        let sumX1 = 0,
            sumX2 = 0,
            sumX3 = 0,
            sumY = 0,
            sumX1Y = 0,
            sumX2Y = 0,
            sumX3Y = 0,
            sumX1sq = 0,
            sumX2sq = 0,
            sumX3sq = 0,
            N = data.VOI.length;

        let x1 = data.VOI;
        let x2 = data.OIR;
        let x3 = data.MPB;
        let y = data.dMid;

        for (let i = 0; i < N; i++) {
            sumX1 += x1[i];
            sumX2 += x2[i];
            sumX3 += x3[i];
            sumY += y[i];
            sumX1Y += x1[i] * y[i];
            sumX2Y += x2[i] * y[i];
            sumX3Y += x3[i] * y[i];
            sumX1sq += x1[i] * x1[i];
            sumX2sq += x2[i] * x2[i];
            sumX3sq += x3[i] * x3[i];
        }

        // y = mx + b
        // returning m and b, x will be given, y will be calculated
        // m is coefficient for each X

        let VOI_coeff = (sumX1Y - sumX1 * sumY / N) / (sumX1sq - sumX1 * sumX1 / N);
        let OIR_coeff = (sumX2Y - sumX2 * sumY / N) / (sumX2sq - sumX2 * sumX2 / N);
        let MPB_coeff = (sumX3Y - sumX3 * sumY / N) / (sumX3sq - sumX3 * sumX3 / N);
        let b = (sumY / N) - ((VOI_coeff * sumX1) / N) - ((OIR_coeff * sumX2) / N) - ((MPB_coeff * sumX3) / N);

        return {
            VOI_coeff: VOI_coeff,
            OIR_coeff: OIR_coeff,
            MPB_coeff: MPB_coeff,
            b: b
        };
    }
}