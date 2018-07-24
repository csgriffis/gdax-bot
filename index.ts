import "reflect-metadata";
import * as GTT from 'gdax-trading-toolkit';
import {config} from 'dotenv';
import {toNumber} from 'lodash';
import {
    TraderConfig,
    Trader,
    TradeExecutedMessage,
    TradeFinalizedMessage,
    MyOrderPlacedMessage,
    ErrorMessage
} from "gdax-trading-toolkit/build/src/core";
import {LiveBookConfig, LiveOrderbook} from 'gdax-trading-toolkit/build/src/core/LiveOrderbook';
import {GDAXExchangeAPI, GDAXFeed} from 'gdax-trading-toolkit/build/src/exchanges';
import {DefaultAPI, getSubscribedFeeds} from 'gdax-trading-toolkit/build/src/factories/gdaxFactories';
import {LiveOrder} from "gdax-trading-toolkit/build/src/lib";
import {Connection, createConnection, Repository} from "typeorm";
import {MessageTypeFilter, MessageTypeFilterConfig} from './filters/MessageTypeFilter';
import {Trade} from "./models/trade";
import {Order} from "./models/order";
import {DataStore, DataStoreConfig} from "./services/DataStore";
import {LinearStrategy, LinearStrategyConfig} from './services/LinearStrategy';
import {Manager, ManagerConfig} from "./services/Manager";
import {GDAXAuthConfig} from "gdax-trading-toolkit/build/src/exchanges/gdax/GDAXInterfaces";
import {MyTradeFilter, MyTradeFilterConfig} from "./filters/MyTradeFilter";
import {VOI} from "./models/voi";

// dotenv config
config();

const logger = GTT.utils.ConsoleLoggerFactory({level: process.env.LOG_LEVEL, colorize: false});
const product: string = 'BTC-USD';

// -- SETUP DATABASE
let DBConn: Connection;
let tradeRepository: Repository<Trade>;

createConnection({
    type: "mysql",
    host: process.env.DB_HOST,
    port: 3306,
    username: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    entities: [
        Order,
        Trade,
        VOI
    ],
    synchronize: true,
    logging: false
}).then(connection => {
    DBConn = connection;
}).catch(error => {
    logger.log('error', `Error connecting to database: ${error}`);
});

const auth: GDAXAuthConfig = {
    key: process.env.GDAX_KEY,
    secret: process.env.GDAX_SECRET,
    passphrase: process.env.GDAX_PASSPHRASE
};

const options = {
    auth: auth,
    wsUrl: process.env.GDAX_WS,
    apiUrl: process.env.GDAX_URL,
    logger: logger
};

getSubscribedFeeds(options, [product])
    .then((feed: GDAXFeed) => {
// -- SETUP ORDER BOOK
        const config: LiveBookConfig = {
            product: product,
            logger: logger,
        };

        const book = new LiveOrderbook(config);

// -- ORDER BOOK LISTENERS
        book.on('end', () => {
            logger.log('info', 'Order Book Closed');
        });

        book.on('error', (err: Error) => {
            logger.log('error', 'Live book error: ', err);
            feed.pipe(book);
        });

// -- SETUP TRADE MESSAGE FILTER
        const matchFilterConfig: MessageTypeFilterConfig = {
            logger: logger,
            filterType: "trade" // string || string[]
        };

        const matchFilter = new MessageTypeFilter(matchFilterConfig);

// -- SETUP MY TRADES MESSAGE FILTER
        const myTradeFilterConfig: MyTradeFilterConfig = {
            logger: logger,
            filterType: [
                'myOrderPlaced'
            ]
        };

        // use to filter out my trades from the LiveOrderBook
        const myTradeFilter = new MyTradeFilter(myTradeFilterConfig);


// -- SETUP EXCHANGE API
        const gdax: GDAXExchangeAPI = DefaultAPI(logger);

// -- SETUP MANAGER
        const managerConfig: ManagerConfig = {
            logger: logger,
            api: gdax,
            riskTolerance: 0.1
        };

        const manager = new Manager(managerConfig);

// -- SETUP TRADER
        const traderConfig: TraderConfig = {
            logger: logger,
            productId: product,
            exchangeAPI: feed.authenticatedAPI,
            fitOrders: false,
            sizePrecision: 6,
            pricePrecision: 6
        };

        const trader = new Trader(traderConfig);

// -- TRADER LISTENERS
        trader.on('Trader.trade-executed', (msg: TradeExecutedMessage) => {
            logger.log('info', `[Trader Listener] Trade executed: ${JSON.stringify(msg)}`);

            if (toNumber(msg.remainingSize) > manager.remainingOrderSize) {
                manager.remainingOrderSize = toNumber(msg.remainingSize);
            }

            let trade = new Trade();

            trade.price = toNumber(msg.price);
            trade.size = toNumber(msg.tradeSize);
            trade.side = msg.side;
            trade.time = msg.time;
            trade.orderId = msg.orderId;

            tradeRepository.save(trade);
        });

        trader.on('Trader.outOfSyncWarning', (msg: string) => {
            logger.log('warn', `[Trader Listener] Out of sync warning: ${JSON.stringify(msg)}`);
        });

        trader.on('Trader.trade-finalized', (msg: TradeFinalizedMessage) => {
            logger.log('info', `[Trader Listener] Trade finalized: ${JSON.stringify(msg)}`);

            if (msg.side === 'sell') { // closing order; do some calculations
                let cumulativeLoss = manager.calculateLoss(toNumber(msg.price));

                logger.log('info', `[Trader Listener] Running Losses: ${cumulativeLoss}`);

                manager.closePosition();
            }

            manager.openOrders = false;
        });

        trader.on('Trader.external-order-placement', (msg: MyOrderPlacedMessage) => {
            logger.log('info', `[Trader Listener] External order placement (Trader missed callback): ${JSON.stringify(msg)}`);
        });

        trader.on('Trader.cancel-order-failed', (err: Error) => {
            logger.log('error', `[Trader Listener] Cancel order failed: ${JSON.stringify(err)}`);
        });

        trader.on('Trader.order-cancelled', (msg: string) => {
            logger.log('info', `[Trader Listener] Order cancelled: ${JSON.stringify(msg)}`);

            if (manager.remainingOrderSize !== 0) { // partially filled order
                manager.openOrderSize = manager.openOrderSize - manager.remainingOrderSize;
            }

            if (manager.openOrders) {
                manager.openOrders = false;
            }

            manager.rollbackPosition();
        });

        trader.on('Trader.my-orders-cancelled', (ids: string[]) => {
            logger.log('info', `[Trader Listener] Orders cancelled: ${ids}`);
        });

        trader.on('Trader.order-placed', (msg: LiveOrder) => {
            logger.log('info', `[Trader Listener] Order placed: ${JSON.stringify(msg)}`);

            // trade already opened - strat has gone rogue; SHUT IT DOWN
            if ((manager.position && msg.side === "buy") || (!manager.position && msg.side === "sell")) {
                logger.log('error',
                    "[Trader Listener] STRAT'S GONE ROGUE: attempting to open another order matching position");

                process.exit(1);
            }

            if (manager.position) { // opening position
                manager.openOrderPrice = toNumber(msg.price);
                manager.openOrderSize = toNumber(msg.size);
                manager.remainingOrderSize = toNumber(msg.size);
            }

            manager.openOrders = true;
        });

        trader.on('Trader.place-order-failed', (err: ErrorMessage) => {
            logger.log('error', `[Trader Listener] Place order failed: ${err.message} cause: ${err.cause.message}`);

            if (err.cause.message && err.cause.message.toLowerCase() === "insufficient funds") {
                logger.log('error', 'Attempting to place order larger than current balance, shutting down');

                process.exit(1);
            }

            manager.position = manager.position ? 0 : 1;

            manager.openOrders = false;
        });

// -- SETUP STRATEGY
        const linearStrategyConfig: LinearStrategyConfig = {
            logger: logger,
            connection: DBConn,
            manager: manager,
            trader: trader,
            book: book,
            precision: 6,
            threshold: 0.2
        };

        const linearStrategy = new LinearStrategy(linearStrategyConfig);

// -- SETUP DATA STORE
        const dataStoreConfig: DataStoreConfig = {
        logger: logger,
        orderBook: book,
        strategy: linearStrategy,
        recordSize: 1620,
        precision: 6,
        delay: 20,
        lags: 5
    };

        const dataStore = new DataStore(dataStoreConfig);
// -- PIPES
        // maintain orderBook, filter out my trades
        feed.pipe(myTradeFilter)
            .pipe(book);

        // track trades
        feed.pipe(trader); // TODO: filter to allow only my orders

        feed.pipe(matchFilter)
            .pipe(dataStore);
    })
    .catch((err: Error) => {
        logger.error(err);
    });