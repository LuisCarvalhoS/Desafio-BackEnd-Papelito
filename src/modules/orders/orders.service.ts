import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Customer, Order, OrderItem, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import {
  SalesforceException,
  SalesforceService,
} from '../salesforce/salesforce.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrderResponseDto } from './dto/order-response.dto';

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly salesforceService: SalesforceService,
  ) {}

  async createOrder(dto: CreateOrderDto): Promise<OrderResponseDto> {
    this.logger.log(`Creating order #${dto.external_id}`);

    let order: Order & { customer: Customer | null; items: OrderItem[] };

    try {
      order = await this.prisma.order.create({
        data: {
          external_id: dto.external_id,
          total: new Prisma.Decimal(dto.total),
          customer: {
            create: {
              name: dto.customer.name,
              email: dto.customer.email,
              document: dto.customer.document,
            },
          },
          items: {
            create: dto.items.map((item) => ({
              sku: item.sku,
              quantity: item.quantity,
              price: new Prisma.Decimal(item.price),
            })),
          },
        },
        include: { customer: true, items: true },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          `Order with external_id '${dto.external_id}' already exists`,
        );
      }
      throw error;
    }

    this.logger.log(`Order #${dto.external_id} persisted with id=${order.id}, status=PENDING`);

    // Fire-and-forget: sync with Salesforce in the background
    this.syncWithSalesforce(order).catch(() => {
      // Errors are already handled inside syncWithSalesforce
    });

    return this.toResponseDto(order);
  }

  private async syncWithSalesforce(
    order: Order & { customer: Customer | null; items: OrderItem[] },
  ): Promise<void> {
    try {
      const result = await this.salesforceService.syncOrder({
        id: order.id,
        external_id: order.external_id,
        total: order.total.toString(),
        customer: order.customer,
        items: order.items.map((item) => ({
          sku: item.sku,
          quantity: item.quantity,
          price: item.price.toString(),
        })),
      });

      await this.prisma.order.update({
        where: { id: order.id },
        data: {
          salesforce_status: 'SYNCED',
          salesforce_id: result.salesforce_id,
        },
      });

      this.logger.log(
        `Order #${order.external_id} synced with Salesforce (${result.salesforce_id})`,
      );
    } catch (error) {
      const errorMessage =
        error instanceof SalesforceException
          ? error.message
          : 'Unknown Salesforce error';

      await this.prisma.order.update({
        where: { id: order.id },
        data: {
          salesforce_status: 'FAILED',
          error_message: errorMessage,
        },
      });

      this.logger.warn(
        `Order #${order.external_id} Salesforce sync failed: ${errorMessage}`,
      );
    }
  }

  async getOrderById(id: number): Promise<OrderResponseDto> {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: { customer: true, items: true },
    });

    if (!order) {
      throw new NotFoundException(`Order with id ${id} not found`);
    }

    return this.toResponseDto(order);
  }

  private toResponseDto(
    order: Order & { customer: Customer | null; items: OrderItem[] },
  ): OrderResponseDto {
    return {
      id: order.id,
      external_id: order.external_id,
      total: Number(order.total),
      salesforce_status: order.salesforce_status,
      salesforce_id: order.salesforce_id,
      error_message: order.error_message,
      created_at: order.created_at,
      customer: order.customer
        ? {
            id: order.customer.id,
            name: order.customer.name,
            email: order.customer.email,
            document: order.customer.document,
          }
        : null,
      items: order.items.map((item) => ({
        id: item.id,
        sku: item.sku,
        quantity: item.quantity,
        price: Number(item.price),
      })),
    };
  }
}
