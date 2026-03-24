import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './modules/auth/auth.module';
import { DatabaseModule } from './modules/database/database.module';
import { OrdersModule } from './modules/orders/orders.module';
import { SalesforceModule } from './modules/salesforce/salesforce.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    AuthModule,
    SalesforceModule,
    OrdersModule,
  ],
})
export class AppModule {}
