import { Module } from '@nestjs/common';
import { SalesforceModule } from '../salesforce/salesforce.module';
import { OrdersService } from './orders.service';

@Module({
  imports: [SalesforceModule],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
