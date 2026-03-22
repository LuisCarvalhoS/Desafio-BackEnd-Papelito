import { Body, Controller, Post } from '@nestjs/common';
import { AuthService } from './auth.service';

export class LoginDto {
  username: string;
  password: string;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  login(@Body() dto: LoginDto): { access_token: string } {
    return this.authService.login(dto.username, dto.password);
  }
}
