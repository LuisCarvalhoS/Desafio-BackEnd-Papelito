import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class AuthService {
  constructor(private readonly jwtService: JwtService) {}

  login(username: string, password: string): { access_token: string } {
    if (username !== 'admin' || password !== 'admin') {
      throw new UnauthorizedException('Invalid credentials');
    }

    const payload = { sub: '1', username };
    return { access_token: this.jwtService.sign(payload) };
  }
}
