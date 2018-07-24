import {extend, toNumber, toString} from 'lodash';
import {Connection} from "typeorm";
import {Trader} from "gdax-trading-toolkit/build/src/core";
import {BookBuilder, LiveOrder} from "gdax-trading-toolkit/build/src/lib";
import {Logger} from 'gdax-trading-toolkit/build/src/utils/Logger';
import {LiveOrderbook} from 'gdax-trading-toolkit/build/src/core/LiveOrderbook';
import {Manager} from "./Manager";
import {LinearModel} from "./DataStore";
import {Snapshot} from "../lib/Snapshot";
import {Order} from "../models/order";
import {VOI} from "../models/voi";

export interface LinearStrategyConfig {
    logger: Logger,
    connection: Connection,
    manager: Manager,
    trader: Trader,
    book: LiveOrderbook,
    threshold: number,
    precision: number
}

export class LinearStrategy {
    private readonly logger: Logger;
    private readonly connection: Connection;
    private readonly manager: Manager;
    private readonly trader: Trader;
    private readonly book: BookBuilder;
    private readonly threshold: number;
    private EFPC: number;
    private lastEFPC: number;

    private lastMidPrice: number;


    constructor(config: LinearStrategyConfig) {
        this.logger = config.logger;
        this.connection = config.connection;
        this.manager = config.manager;
        this.trader = config.trader;
        this.book = config.book.book;
        this.threshold = config.threshold;

        this.EFPC = 0;
        this.lastEFPC = 0;

        this.lastMidPrice = 0;
    }

    saveVOI(snapshot: Snapshot): void {
        let voiData = new VOI();

        voiData.voi = snapshot.VOI;
        voiData.time = new Date().toISOString();
        voiData.deltaPrice = snapshot.midPrice - this.lastMidPrice;
        
        this.lastMidPrice = snapshot.midPrice;

        let orderRepository = this.connection.getRepository(VOI);

        orderRepository.save(voiData)
            .catch((error: Error) => {
                this.logger.error(error);
            });
    };

    strategyRunner(snapshot: Snapshot, model: LinearModel): void {
        this.calculateEFPC(snapshot, model);

        try {
            // -- MOVE ORDER
            if (this.manager.position === 1 &&
                this.hasOpenOrders() &&
                this.EFPC >= this.threshold &&
                this.manager.openOrderPrice !== this.book.highestBid.price.toNumber()) {

                // cancel orders
                this.trader.cancelMyOrders()
                    .then((ids: string[]) => {
                        this.logger.log('info', `[Strategy] Orders cancelled: ${ids}`);
                    })
                    .then(() => {
                        // move price to .01 below ask
                        let price: string = toString(this.book.lowestAsk.price.toNumber() - 0.01);
                        let size: number = (this.manager.risk * this.manager.getBalance('USD')) / toNumber(price);

                        this.placeOrder({side: 'buy', price: price, size: toString(size)});
                    })
                    .catch((error: Error) => {
                        this.logger.error(error);
                    });
            }

            // -- BUY TO OPEN POSITION
            if (this.manager.position === 0 &&
                this.EFPC >= this.threshold &&
                !this.manager.activeRequest) {

                // assuming a close order is in place and efpc has turned long
                if (this.hasOpenOrders()) {
                    // cancel orders
                    this.cancelOrders();
                } else {
                    // buy to open
                    let price: string = this.book.highestBid.price.toString();
                    let size: number = (this.manager.risk * this.manager.getBalance('USD')) / toNumber(price);

                    this.logger.log('debug', `[LinearStrategy] attempting order of size ${size} at price ${price}`);

                    // check if we have money to buy
                    if (size > 0.001) {
                        // set position now so we do not attempt to create a new order on the next tick
                        this.manager.previousPosition = this.manager.position;
                        this.manager.position = 1;

                        this.placeOrder({side: 'buy', price: price, size: toString(size)})
                    } else {
                        this.logger.log('warn', `[LinearStrategy] Order size of ${size} is lower than the minimum of 0.001`);
                    }
                }
                // -- SELL TO CLOSE POSITION
            } else if (this.manager.position === 1 &&
                this.EFPC <= -this.threshold &&
                !this.manager.activeRequest) {

                // assuming an open order is in place and efpc has turned short
                if (this.hasOpenOrders()) {
                    // cancel orders
                    this.cancelOrders();
                } else {
                    // sell to close
                    let price = this.book.lowestAsk.price.toString();
                    let size = this.manager.openOrderSize - this.manager.remainingOrderSize > 0 ?
                        this.manager.openOrderSize - this.manager.remainingOrderSize
                        : this.manager.openOrderSize;

                    if (size === 0 || isNaN(size)) {
                        this.logger.log('warn', '[LinearStrategy] Attempting to close order with no size');

                        return;
                    }

                    // set position now so we do not attempt to create a new order on the next tick
                    this.manager.previousPosition = this.manager.position;
                    this.manager.position = 0;

                    this.placeOrder({side: 'sell', price: price, size: toString(size)});
                }
            }
            // -- SELL TO OPEN POSITION
            /* else if (this.manager.position === 0 && this.EFPC <= -this.threshold && !this.manager.activeRequest) {

            // -- BUY TO CLOSE POSITION
            } else if (this.manager.position === -1 && this.EFPC >= this.threshold && !this.manager.activeRequest) {

            } */
        } catch (e) {
            this.logger.error(e);
        }
    }

    private placeOrder(order: any): void {
        const defaultOrderProps: any = {
            time: new Date(),
            type: 'placeOrder',
            productId: this.trader.productId,
            orderType: 'limit',
            postOnly: true
        };

        let orderToPlace: any = extend(defaultOrderProps, order);

        this.trader.placeOrder(orderToPlace)
            .then((order: LiveOrder) => {
                if (!this.isRejected(order)) {
                    this.logger.log('debug', `[LinearStrategy] Order: ${JSON.stringify(order)}`);

                    this.manager.openOrderPrice = order.price.toNumber();
                    this.manager.remainingOrderSize = order.price.toNumber();
                    this.manager.openOrderSize = order.size.toNumber();

                    let dbOrder = new Order();

                    dbOrder.orderId = order.id;
                    dbOrder.time = order.time;
                    dbOrder.product = order.productId;
                    dbOrder.price = order.price.toNumber();
                    dbOrder.size = order.size.toNumber();
                    dbOrder.side = order.side;
                    dbOrder.type = order.side === "sell" ? "close" : "open";

                    let orderRepository = this.connection.getRepository(Order);

                    orderRepository.save(dbOrder)
                        .catch((error: Error) => {
                            this.logger.error(error);
                        });
                }

                this.manager.position = this.manager.previousPosition;
            })
            .catch((error: Error) => {
                this.logger.error(error);
            });
    }

    private cancelOrders(): void {
        this.trader.cancelMyOrders()
            .then((ids: string[]) => {
                this.logger.log('info', `[Strategy] Orders cancelled: ${ids}`);
            })
            .catch((error: Error) => {
                this.logger.error(error);
            });
    }

    private isRejected(order: LiveOrder): boolean {
        if (order && order.status === "rejected") {
            this.manager.position = this.manager.previousPosition;

            this.logger.log('warn', `[LinearStrategy] Order was rejected: ${order.extra.reject_reason}`);

            return true;
        }

        return false;
    }

    private hasOpenOrders(): boolean {
        const state = this.trader.state();

        return state.bids.length > 0 || state.asks.length > 0;
    }

    private calculateEFPC(snapshot: Snapshot, model: LinearModel): number {
        let EFPC = toNumber(model.b) +
            (toNumber(model.VOI_coeff) * snapshot.VOI) +
            (toNumber(model.OIR_coeff) * snapshot.OIR) +
            (toNumber(model.MPB_coeff) * snapshot.MPB);

        EFPC = (EFPC + this.lastEFPC) / 2;

        this.lastEFPC = EFPC;

        return EFPC;
    }
}