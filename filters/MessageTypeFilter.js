"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const lib_1 = require("gdax-trading-toolkit/build/src/lib");
class MessageTypeFilter extends lib_1.AbstractMessageTransform {
    constructor(config) {
        super(config);
        this.filterType = config.filterType;
    }
    transformMessage(msg) {
        if (!msg || !msg.type || msg.type !== this.filterType) {
            return null;
        }
        return msg;
    }
}
exports.MessageTypeFilter = MessageTypeFilter;
//# sourceMappingURL=MessageTypeFilter.js.map