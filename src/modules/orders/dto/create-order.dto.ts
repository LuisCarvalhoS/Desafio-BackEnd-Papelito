import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsNotEmpty,
  IsNumber,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { CustomerDto } from './customer.dto';
import { OrderItemDto } from './order-item.dto';

export class CreateOrderDto {
  @IsString()
  @IsNotEmpty()
  external_id: string;

  @ValidateNested()
  @Type(() => CustomerDto)
  customer: CustomerDto;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items: OrderItemDto[];

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  total: number;
}
