import {Column, Entity, PrimaryGeneratedColumn} from "typeorm";

@Entity()
export class Order {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    orderId: string;

    @Column('datetime')
    time: Date;

    @Column()
    product: string;

    @Column('float')
    price: number;

    @Column('float')
    size: number;

    @Column()
    side: string;

    @Column()
    type: string;
}