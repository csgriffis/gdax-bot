import {Column, Entity, PrimaryGeneratedColumn} from "typeorm";

@Entity()
export class Trade {

    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    orderId: string;

    @Column('datetime')
    time: Date;

    @Column()
    side: string;

    @Column("float")
    price: number;

    @Column("float")
    size: number;
}