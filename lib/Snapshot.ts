export class Snapshot {
    public MPB: number;
    public OIR: number;
    public VOI: number;

    private _size: number;
    private _price: number;
    private _spread: number;
    private _midPrice: number;
    private _BID: number;
    private _ASK: number;
    private _ASK_VOLUME: number;
    private _BID_VOLUME: number;
    private _VOLUME: number;
    private _TURNOVER: number;
    private _dBID_PRICE: number;
    private _dASK_PRICE: number;
    private _BidCV: number;
    private _AskCV: number;
    private _dVol: number;
    private _dTO: number;
    private _AvgTrade: number;

    get size(): number {
        return this._size;
    }

    set size(size: number) {
        this._size = size;
    }

    get price(): number {
        return this._price;
    }

    set price(price: number) {
        this._price = price;
    }

    get bid(): number {
        return this._BID;
    }

    set bid(bid: number) {
        this._BID = bid;
    }

    get ask(): number {
        return this._ASK;
    }

    set ask(ask: number) {
        this._ASK = ask;
    }

    get askVolume(): number {
        return this._ASK_VOLUME;
    }

    set askVolume(volume: number) {
        this._ASK_VOLUME = volume;
    }

    get bidVolume(): number {
        return this._BID_VOLUME;
    }

    set bidVolume(volume: number) {
        this._BID_VOLUME = volume;
    }

    get volume(): number {
        return this._VOLUME;
    }

    set volume(volume: number) {
        this._VOLUME = volume;
    }

    get turnover(): number {
        return this._TURNOVER;
    }

    set turnover(turnover: number) {
        this._TURNOVER = turnover;
    }

    get spread(): number {
        return this._spread;
    }

    set spread(spread: number) {
        this._spread = spread;
    }

    get midPrice(): number {
        return this._midPrice;
    }

    set midPrice(midPrice: number) {
        this._midPrice = midPrice;
    }

    get dBid(): number {
        return this._dBID_PRICE;
    }

    set dBid(priceDiff: number) {
        this._dBID_PRICE = priceDiff;
    }

    get dAsk(): number {
        return this._dASK_PRICE;
    }

    set dAsk(priceDiff: number) {
        this._dASK_PRICE = priceDiff;
    }

    get bidCV(): number {
        return this._BidCV;
    }

    set bidCV(cv: number) {
        this._BidCV = cv;
    }

    get askCV(): number {
        return this._AskCV;
    }

    set askCV(cv: number) {
        this._AskCV = cv;
    }

    get dVol(): number {
        return this._dVol;
    }

    set dVol(dvol: number) {
        this._dVol = dvol;
    }

    get dTO(): number {
        return this._dTO;
    }

    set dTO(dto: number) {
        this._dTO = dto;
    }

    get avgTrade(): number {
        return this._AvgTrade;
    }

    set avgTrade(avgTrade: number) {
        this._AvgTrade = avgTrade;
    }
}