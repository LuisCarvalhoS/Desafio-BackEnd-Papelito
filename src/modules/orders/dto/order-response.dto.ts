export class CustomerResponseDto {
  id: number;
  name: string;
  email: string;
  document: string;
}

export class OrderItemResponseDto {
  id: number;
  sku: string;
  quantity: number;
  price: number;
}

export class OrderResponseDto {
  id: number;
  external_id: string;
  total: number;
  salesforce_status: string;
  salesforce_id: string | null;
  error_message: string | null;
  created_at: Date;
  customer: CustomerResponseDto | null;
  items: OrderItemResponseDto[];
}
