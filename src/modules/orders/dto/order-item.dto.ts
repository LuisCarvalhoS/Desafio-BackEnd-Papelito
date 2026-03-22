import { IsInt, IsNotEmpty, IsNumber, IsString, Min } from 'class-validator';

export class OrderItemDto {
  @IsString()
  @IsNotEmpty()
  sku: string;

  @IsInt()
  @Min(1)
  quantity: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  price: number;
}
