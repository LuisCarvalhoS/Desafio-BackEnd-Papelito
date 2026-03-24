import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SalesforceModule } from '../salesforce/salesforce.module';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [SalesforceModule, AuthModule],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
