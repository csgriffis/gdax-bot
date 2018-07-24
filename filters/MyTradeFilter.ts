import { Logger } from 'gdax-trading-toolkit/build/src/utils/Logger';
import { AbstractMessageTransform, MessageTransformConfig } from 'gdax-trading-toolkit/build/src/lib';
import { isArray, indexOf } from 'lodash';

export interface MyTradeFilterConfig extends MessageTransformConfig {
    logger?: Logger;
    filterType: string[];
}

export class MyTradeFilter extends AbstractMessageTransform {
    private readonly logger?: Logger;
    private readonly filterType: string[];

    constructor(config: MyTradeFilterConfig) {
        super(config);
        this.filterType = config.filterType;
        this.logger = config.logger;
    }

    transformMessage(msg: any): any {
        try {

            if (isArray(this.filterType)) {
                if (indexOf(this.filterType, msg.type) !== -1) {
                    return null;
                }
            }

            return msg;
        } catch (e) {
            this.logger.log('debug', e);
        }
    }
}