import {Column, Entity, PrimaryGeneratedColumn} from "typeorm";

@Entity()
export class VOI {

    @PrimaryGeneratedColumn()
    id: number;

    @Column('float')
    voi: number;

    @Column('float')
    deltaPrice: number;

    @Column()
    time: string;
}